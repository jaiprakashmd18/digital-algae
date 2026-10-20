-- Internet Organism — completely anonymous participation.
--
-- Visitors can leave traces with no sign-in of any kind (not even a Supabase
-- anonymous session). Without a session, the server derives a pseudonymous
-- visitor key from the connection's IP address with a keyed hash
-- (HMAC-SHA256 with a secret salt that never leaves the database). The IP
-- address itself is never stored; only the derived key, which cannot be
-- reversed without the salt, is kept as the trace's actor id.
--
-- Signed-in accounts (and any existing Supabase anonymous sessions) keep
-- working exactly as before, keyed by their auth user id.

-- Private configuration: no API role can read it.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

insert into public.app_secrets (key, value)
values ('visitor_hash_salt', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- Anonymous actors are not auth users, so the trace actor id no longer
-- references auth.users. delete_my_account() detaches traces explicitly.
alter table public.traces drop constraint if exists traces_actor_id_fkey;
alter table public.traces add column if not exists actor_kind text not null default 'account'
  check (actor_kind in ('account', 'session_guest', 'anonymous'));

alter table public.reports add column if not exists reporter_key uuid;
update public.reports set reporter_key = reporter_id where reporter_key is null;
create index if not exists reports_reporter_key_idx on public.reports (reporter_key, created_at desc);

insert into public.feature_flags (key, enabled, description) values
  ('anonymous_traces_enabled', true, 'Visitors can leave traces without signing in (limits are applied per connection).')
on conflict (key) do nothing;

-- Who is calling? Returns (actor, kind), or no row if the caller cannot be
-- identified at all.
--   account / session_guest: the verified auth user id.
--   anonymous: a keyed hash of the client IP that the API gateway reports.
create or replace function public.current_actor() returns table (actor uuid, kind text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_headers jsonb;
  v_ip text;
  v_salt text;
begin
  if auth.uid() is not null then
    return query select auth.uid(),
      case when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then 'session_guest' else 'account' end;
    return;
  end if;
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  -- Prefer headers set by the infrastructure (Cloudflare / the gateway); the
  -- leftmost X-Forwarded-For entry is the last resort.
  v_ip := coalesce(
    nullif(trim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(trim(v_headers ->> 'x-real-ip'), ''),
    nullif(trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''));
  if v_ip is null or char_length(v_ip) > 64 then
    return;
  end if;
  select value into v_salt from public.app_secrets where key = 'visitor_hash_salt';
  return query select md5(encode(extensions.hmac(v_ip, v_salt, 'sha256'), 'hex'))::uuid, 'anonymous'::text;
end
$$;

create or replace function public.submit_trace(
  p_region_slug text,
  p_trace_type text,
  p_color text,
  p_intensity numeric,
  p_persistence text,
  p_client_nonce uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_kind text;
  v_now timestamptz := now();
  v_cooldown integer;
  v_hour_limit integer;
  v_day_limit integer;
  v_color text := lower(trim(coalesce(p_color, '')));
  v_intensity numeric := round(p_intensity, 2);
  v_existing record;
  v_last timestamptz;
  v_hour_count integer;
  v_hour_oldest timestamptz;
  v_day_count integer;
  v_global_minute integer;
  v_region record;
  v_arch record;
  v_world record;
  v_decayed numeric;
  v_recent_same integer;
  v_match boolean;
  v_gain numeric;
  v_energy numeric;
  v_old_state text;
  v_new_state text;
  v_new_level smallint;
  v_actor_new_region boolean;
  v_actor_new_global boolean;
  v_alias text;
  v_total bigint;
  v_contrib integer;
  v_stage smallint;
  v_version integer;
  v_structural boolean := false;
  v_born uuid;
  v_born_region record;
  v_event_id bigint;
  v_trace_id uuid := gen_random_uuid();
  v_milestones jsonb := '[]'::jsonb;
  v_mid bigint;
  v_slug text;
  v_ce record;
  v_progress integer;
  v_global numeric;
  v_level_mark smallint;
begin
  select a.actor, a.kind into v_actor, v_kind from public.current_actor() a;
  if v_actor is null then
    perform public.log_rate_limit(null, 'trace', 'no_identity');
    return jsonb_build_object('ok', false, 'code', 'no_identity',
      'message', 'The organism could not recognise this connection. Reload and try again.');
  end if;
  if v_kind = 'anonymous' and not public.flag_enabled('anonymous_traces_enabled') then
    return jsonb_build_object('ok', false, 'code', 'anonymous_paused',
      'message', 'Anonymous traces are paused. Sign in to leave a trace.');
  end if;

  if not public.flag_enabled('traces_enabled') then
    return jsonb_build_object('ok', false, 'code', 'feature_disabled',
      'message', 'Leaving traces is temporarily paused by the operators.');
  end if;

  -- Validation (the client validates too, but only this counts).
  if p_trace_type is null or p_trace_type not in ('spark', 'spiral', 'ripple', 'bloom', 'filament') then
    return jsonb_build_object('ok', false, 'code', 'invalid_parameters', 'field', 'trace_type');
  end if;
  if v_color !~ '^#[0-9a-f]{6}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_parameters', 'field', 'color');
  end if;
  if v_intensity is null or v_intensity < 0.10 or v_intensity > 1.00 then
    return jsonb_build_object('ok', false, 'code', 'invalid_parameters', 'field', 'intensity');
  end if;
  if p_persistence is null or p_persistence not in ('fleeting', 'lasting') then
    return jsonb_build_object('ok', false, 'code', 'invalid_parameters', 'field', 'persistence');
  end if;
  if p_client_nonce is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_parameters', 'field', 'client_nonce');
  end if;
  if p_region_slug is null or char_length(p_region_slug) > 48 then
    return jsonb_build_object('ok', false, 'code', 'unknown_region');
  end if;

  select r.id into v_region from public.regions r
  where r.slug = p_region_slug and r.visibility = 'public';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_region');
  end if;

  -- Serialize all submissions from this actor.
  perform pg_advisory_xact_lock(hashtextextended('trace:' || v_actor::text, 0));

  -- Idempotency: the same nonce from the same actor returns the original result.
  select t.id, t.world_event_id, t.energy_gain, r.slug as region_slug into v_existing
  from public.traces t join public.regions r on r.id = t.region_id
  where t.actor_id = v_actor and t.client_nonce = p_client_nonce;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'trace_id', v_existing.id,
      'event_id', v_existing.world_event_id, 'energy_gain', v_existing.energy_gain,
      'region', jsonb_build_object('slug', v_existing.region_slug));
  end if;

  -- Rate limits. Anonymous visitors are keyed by network (shared by everyone
  -- behind the same connection), so their limits are a little more generous
  -- than session guests'; verified accounts get the most room.
  if v_kind = 'account' then
    v_cooldown := 10; v_hour_limit := 30; v_day_limit := 120;
  elsif v_kind = 'anonymous' then
    v_cooldown := 15; v_hour_limit := 20; v_day_limit := 60;
  else
    v_cooldown := 20; v_hour_limit := 12; v_day_limit := 40;
  end if;

  select max(t.created_at),
         count(*) filter (where t.created_at > v_now - interval '1 hour'),
         min(t.created_at) filter (where t.created_at > v_now - interval '1 hour'),
         count(*) filter (where t.created_at >= public.utc_day_start(v_now))
    into v_last, v_hour_count, v_hour_oldest, v_day_count
  from public.traces t
  where t.actor_id = v_actor and t.created_at > v_now - interval '1 day';

  if v_last is not null and v_last > v_now - make_interval(secs => v_cooldown) then
    perform public.log_rate_limit(v_actor, 'trace', 'cooldown');
    return jsonb_build_object('ok', false, 'code', 'cooldown',
      'retry_after', ceil(extract(epoch from (v_last + make_interval(secs => v_cooldown) - v_now))));
  end if;
  if v_hour_count >= v_hour_limit then
    perform public.log_rate_limit(v_actor, 'trace', 'hourly_limit');
    return jsonb_build_object('ok', false, 'code', 'hourly_limit',
      'retry_after', ceil(extract(epoch from (v_hour_oldest + interval '1 hour' - v_now))));
  end if;
  if v_day_count >= v_day_limit then
    perform public.log_rate_limit(v_actor, 'trace', 'daily_limit');
    return jsonb_build_object('ok', false, 'code', 'daily_limit',
      'retry_after', ceil(extract(epoch from (public.utc_day_start(v_now) + interval '1 day' - v_now))));
  end if;

  -- Global circuit breaker against floods from many sessions.
  select count(*) into v_global_minute from public.traces t where t.created_at > v_now - interval '1 minute';
  if v_global_minute >= 600 then
    perform public.log_rate_limit(v_actor, 'trace', 'global_busy');
    return jsonb_build_object('ok', false, 'code', 'busy', 'retry_after', 30);
  end if;

  begin
    -- 2. Region row lock.
    select r.* into v_region from public.regions r where r.id = v_region.id for update;
    select a.* into v_arch from public.region_archetypes a where a.region_type = v_region.region_type;

    v_decayed := public.world_decay(v_region.energy, v_region.energy_at, v_arch.half_life_hours, v_now);

    select count(*) into v_recent_same from public.traces t
    where t.region_id = v_region.id and t.actor_id = v_actor and t.created_at > v_now - interval '1 hour';

    v_match := v_arch.resonance_bonus > 0
      and v_region.last_trace_pattern = p_trace_type
      and v_region.last_trace_at > v_now - interval '10 minutes'
      and v_region.last_trace_actor is distinct from v_actor;

    v_gain := public.trace_gain(v_intensity, v_arch.gain_multiplier, v_recent_same, v_arch.resonance_bonus, v_match);
    v_energy := least(100, v_decayed + v_gain);
    v_old_state := public.region_state_for(v_decayed);
    v_new_state := public.region_state_for(v_energy);
    v_new_level := public.region_level_for(v_region.trace_count + 1);

    v_actor_new_region := not exists (select 1 from public.traces t where t.region_id = v_region.id and t.actor_id = v_actor);
    v_actor_new_global := not exists (select 1 from public.traces t where t.actor_id = v_actor);

    select p.display_name into v_alias from public.profiles p where p.id = v_actor;
    v_alias := coalesce(v_alias, public.alias_for(v_actor));

    update public.regions set
      energy = v_energy,
      energy_at = v_now,
      state = v_new_state,
      level = v_new_level,
      trace_count = trace_count + 1,
      contributor_count = contributor_count + (case when v_actor_new_region then 1 else 0 end),
      last_trace_at = v_now,
      last_trace_pattern = p_trace_type,
      last_trace_actor = v_actor
    where id = v_region.id;

    -- 3. World row lock.
    select w.* into v_world from public.world_state w where w.id = 1 for update;
    v_total := v_world.total_traces + 1;
    v_contrib := v_world.unique_contributors + (case when v_actor_new_global then 1 else 0 end);
    v_stage := greatest(v_world.evolution_stage, public.stage_for(v_total, v_contrib));
    v_version := v_world.state_version;

    update public.world_state set
      total_traces = v_total,
      unique_contributors = v_contrib,
      evolution_stage = v_stage,
      stage_changed_at = case when v_stage > v_world.evolution_stage then v_now else stage_changed_at end,
      updated_at = v_now
    where id = 1;

    if v_stage > v_world.evolution_stage then
      v_born := public.birth_region_for_stage(v_stage);
      v_structural := true;
    end if;
    if v_new_level > v_region.level then
      v_structural := true;
    end if;
    if v_structural then
      v_version := public.record_snapshot(
        case when v_stage > v_world.evolution_stage then 'Stage ' || v_stage || ': ' || public.stage_name(v_stage)
             else v_region.name || ' reached level ' || v_new_level end);
    end if;

    v_event_id := public.emit_event('trace', 'participant', v_region.id, jsonb_build_object(
      'alias', v_alias, 'color', v_color, 'pattern', p_trace_type, 'intensity', v_intensity,
      'persistence', p_persistence, 'gain', v_gain, 'resonance', v_match,
      'region_slug', v_region.slug, 'region_energy', v_energy, 'region_state', v_new_state,
      'region_level', v_new_level, 'region_trace_count', v_region.trace_count + 1,
      'energy_at', v_now, 'total_traces', v_total, 'unique_contributors', v_contrib,
      'evolution_stage', v_stage
    ), v_version);

    insert into public.traces (id, region_id, actor_id, actor_kind, client_nonce, trace_type, color, intensity,
                               persistence, energy_gain, alias, world_event_id, created_at)
    values (v_trace_id, v_region.id, v_actor, v_kind, p_client_nonce, p_trace_type, v_color, v_intensity,
            p_persistence, v_gain, v_alias, v_event_id, v_now);

    -- Milestones -------------------------------------------------------
    if v_world.total_traces = 0 then
      v_mid := public.emit_event('first_trace', 'participant', v_region.id,
        jsonb_build_object('alias', v_alias, 'region_slug', v_region.slug), v_version);
      v_slug := public.create_discovery('the-first-trace', 'first_trace', 'participant', v_region.id, v_mid,
        'The first trace',
        format('The first trace ever accepted by the organism was left in %s. Everything that follows grew from this moment.', v_region.name),
        v_alias, v_trace_id, v_version);
      v_milestones := v_milestones || jsonb_build_object('type', 'first_trace', 'discovery', v_slug);
    end if;

    if v_region.trace_count = 0 then
      v_mid := public.emit_event('region_first_trace', 'participant', v_region.id,
        jsonb_build_object('alias', v_alias, 'region_slug', v_region.slug), v_version);
      v_slug := public.create_discovery('first-trace-in-' || v_region.slug, 'region_first_trace', 'participant',
        v_region.id, v_mid, 'First trace in ' || v_region.name,
        format('%s received its first trace from a visitor. Until then it existed only as its initial generated structure.', v_region.name),
        v_alias, v_trace_id, v_version);
      v_milestones := v_milestones || jsonb_build_object('type', 'region_first_trace', 'discovery', v_slug);
    end if;

    if v_new_state in ('surging', 'resonant') and v_old_state not in ('surging', 'resonant')
       and (v_region.last_surge_at is null or v_region.last_surge_at < v_now - interval '6 hours') then
      update public.regions set last_surge_at = v_now where id = v_region.id;
      v_mid := public.emit_event('region_surge', 'participant', v_region.id,
        jsonb_build_object('alias', v_alias, 'region_slug', v_region.slug, 'energy', v_energy, 'state', v_new_state),
        v_version);
      v_slug := public.create_discovery(
        v_region.slug || '-surge-' || to_char(v_now at time zone 'UTC', 'YYYYMMDD-HH24MI'),
        'region_surge', 'participant', v_region.id, v_mid,
        v_region.name || ' surged',
        format('Recent traces pushed %s above %s energy. Its filaments brightened and its pulse quickened.', v_region.name, 45),
        v_alias, v_trace_id, v_version);
      v_milestones := v_milestones || jsonb_build_object('type', 'region_surge', 'discovery', v_slug);
    end if;

    if v_new_level > v_region.level then
      v_mid := public.emit_event('region_level', 'participant', v_region.id,
        jsonb_build_object('alias', v_alias, 'region_slug', v_region.slug, 'level', v_new_level,
                           'trace_count', v_region.trace_count + 1), v_version);
      v_slug := public.create_discovery(v_region.slug || '-level-' || v_new_level, 'region_level', 'participant',
        v_region.id, v_mid, v_region.name || ' grew new branches',
        format('After %s accepted traces, %s reached level %s and grew a new layer of branches.',
               v_region.trace_count + 1, v_region.name, v_new_level),
        v_alias, v_trace_id, v_version);
      v_milestones := v_milestones || jsonb_build_object('type', 'region_level', 'discovery', v_slug);
    end if;

    if v_stage > v_world.evolution_stage then
      v_mid := public.emit_event('stage_advanced', 'participant', null,
        jsonb_build_object('alias', v_alias, 'stage', v_stage, 'stage_name', public.stage_name(v_stage),
                           'total_traces', v_total, 'unique_contributors', v_contrib), v_version);
      v_slug := public.create_discovery('stage-' || v_stage || '-' || lower(replace(public.stage_name(v_stage), ' ', '-')),
        'stage_advanced', 'participant', null, v_mid,
        'The organism entered ' || public.stage_name(v_stage),
        format('With %s accepted traces from %s distinct visitors, the organism evolved to stage %s: %s.',
               v_total, v_contrib, v_stage, public.stage_name(v_stage)),
        v_alias, v_trace_id, v_version);
      v_milestones := v_milestones || jsonb_build_object('type', 'stage_advanced', 'discovery', v_slug, 'stage', v_stage);

      if v_born is not null then
        select r.* into v_born_region from public.regions r where r.id = v_born;
        v_mid := public.emit_event('region_born', 'system', v_born,
          jsonb_build_object('region_slug', v_born_region.slug, 'name', v_born_region.name, 'stage', v_stage), v_version);
        v_slug := public.create_discovery('born-' || v_born_region.slug, 'region_born', 'system', v_born, v_mid,
          v_born_region.name || ' formed',
          format('Reaching %s caused a new region to grow from The Core: %s. Its structure is generated from a fixed seed, so it forms the same way every time.',
                 public.stage_name(v_stage), v_born_region.name),
          null, null, v_version);
        v_milestones := v_milestones || jsonb_build_object('type', 'region_born', 'discovery', v_slug);
      end if;
    end if;

    -- Community event progress.
    perform public.ensure_daily_community_event(v_now);
    select ce.* into v_ce from public.community_events ce
    where ce.status = 'active' and ce.region_id = v_region.id
      and ce.starts_at <= v_now and ce.ends_at > v_now
    limit 1;
    if found then
      select count(distinct t.actor_id) into v_progress from public.traces t
      where t.region_id = v_ce.region_id and t.created_at >= v_ce.starts_at and t.created_at < v_ce.ends_at;
      if v_progress >= v_ce.goal_target then
        update public.community_events set status = 'completed', completed_at = v_now
        where id = v_ce.id and status = 'active';
        if found then
          v_mid := public.emit_event('community_event_completed', 'participant', v_region.id,
            jsonb_build_object('community_event', v_ce.slug, 'title', v_ce.title, 'goal_target', v_ce.goal_target,
                               'progress', v_progress, 'region_slug', v_region.slug, 'alias', v_alias), v_version);
          v_slug := public.create_discovery(v_ce.slug, 'community_event', 'participant', v_region.id, v_mid,
            v_ce.title || ' completed',
            format('%s different visitors left traces in %s on %s (UTC). The region converged.',
                   v_progress, v_region.name, to_char(v_ce.starts_at at time zone 'UTC', 'YYYY-MM-DD')),
            v_alias, v_trace_id, v_version);
          v_milestones := v_milestones || jsonb_build_object('type', 'community_event_completed', 'discovery', v_slug);
        end if;
      end if;
    end if;

    -- Global energy milestones (25 / 50 / 75), each at most once per UTC day.
    v_global := public.current_world_energy(v_now);
    v_level_mark := case when v_global >= 75 then 75 when v_global >= 50 then 50 when v_global >= 25 then 25 else 0 end;
    if v_level_mark > 0 and (v_world.energy_milestone_day is distinct from (v_now at time zone 'UTC')::date
                             or v_level_mark > v_world.energy_milestone_level) then
      update public.world_state set energy_milestone_day = (v_now at time zone 'UTC')::date,
                                    energy_milestone_level = v_level_mark
      where id = 1;
      v_mid := public.emit_event('energy_milestone', 'participant', null,
        jsonb_build_object('level', v_level_mark, 'global_energy', v_global, 'alias', v_alias), v_version);
      if v_level_mark = 75 then
        v_slug := public.create_discovery('energy-75-' || to_char(v_now at time zone 'UTC', 'YYYY-MM-DD'),
          'energy_milestone', 'participant', null, v_mid, 'The whole organism glowed',
          'Average energy across every region passed 75 — the organism was brighter than it had been all day.',
          v_alias, v_trace_id, v_version);
        v_milestones := v_milestones || jsonb_build_object('type', 'energy_milestone', 'discovery', v_slug);
      else
        v_milestones := v_milestones || jsonb_build_object('type', 'energy_milestone', 'level', v_level_mark);
      end if;
    end if;

    update public.world_state set global_energy = least(100, v_global) where id = 1;

    return jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'trace_id', v_trace_id,
      'event_id', v_event_id,
      'alias', v_alias,
      'energy_gain', v_gain,
      'resonance', v_match,
      'region', jsonb_build_object('slug', v_region.slug, 'name', v_region.name, 'energy', v_energy,
                                   'state', v_new_state, 'level', v_new_level),
      'world', jsonb_build_object('total_traces', v_total, 'unique_contributors', v_contrib,
                                  'evolution_stage', v_stage, 'state_version', v_version,
                                  'global_energy', v_global),
      'milestones', v_milestones,
      'created_at', v_now
    );
  exception when others then
    insert into public.system_errors (source, code, message, context)
    values ('submit_trace', sqlstate, left(sqlerrm, 500), jsonb_build_object('region', p_region_slug));
    return jsonb_build_object('ok', false, 'code', 'internal_error',
      'message', 'The organism could not accept this trace. Nothing was recorded.');
  end;
end
$$;

create or replace function public.submit_report(
  p_target_type text, p_target_id text, p_reason text, p_details text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_kind text;
  v_count integer;
  v_details text := nullif(left(trim(coalesce(p_details, '')), 500), '');
begin
  select a.actor, a.kind into v_actor, v_kind from public.current_actor() a;
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'no_identity');
  end if;
  if not public.flag_enabled('reports_enabled') then
    return jsonb_build_object('ok', false, 'code', 'feature_disabled');
  end if;
  if p_target_type not in ('world_event', 'discovery') or p_reason not in ('offensive_name', 'spam', 'harassment', 'other')
     or p_target_id is null or char_length(p_target_id) > 64 then
    return jsonb_build_object('ok', false, 'code', 'invalid_parameters');
  end if;
  if p_target_type = 'world_event' and (p_target_id !~ '^[0-9]{1,18}$'
       or not exists (select 1 from public.world_events where id = p_target_id::bigint and not hidden)) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_target_type = 'discovery' and not exists (select 1 from public.discoveries where slug = p_target_id and visibility = 'public') then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || v_actor::text, 0));
  select count(*) into v_count from public.reports where reporter_key = v_actor and created_at > now() - interval '1 hour';
  if v_count >= 5 then
    perform public.log_rate_limit(v_actor, 'report', 'hourly_limit');
    return jsonb_build_object('ok', false, 'code', 'hourly_limit', 'retry_after', 3600);
  end if;
  if exists (select 1 from public.reports where reporter_key = v_actor and target_type = p_target_type
             and target_id = p_target_id and status = 'open') then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into public.reports (reporter_id, reporter_key, target_type, target_id, reason, details)
  values (case when v_kind = 'anonymous' then null else v_actor end, v_actor, p_target_type, p_target_id, p_reason, v_details);
  return jsonb_build_object('ok', true, 'duplicate', false);
end
$$;

create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  update public.world_events e set payload = jsonb_set(e.payload, '{alias}', '"Former visitor"')
  where e.payload ? 'alias' and (
    e.id in (select world_event_id from public.traces where actor_id = v_actor and world_event_id is not null)
    or e.id in (select d.world_event_id from public.discoveries d join public.traces t on t.id = d.trigger_trace_id
                where t.actor_id = v_actor and d.world_event_id is not null));
  update public.discoveries d set triggered_by_alias = 'Former visitor'
  from public.traces t where t.id = d.trigger_trace_id and t.actor_id = v_actor;
  update public.traces set alias = 'Former visitor' where actor_id = v_actor;
  update public.traces set actor_id = null where actor_id = v_actor;
  delete from auth.users where id = v_actor;
  return jsonb_build_object('ok', true);
end
$$;

revoke all on function public.current_actor() from public, anon, authenticated;
revoke all on function public.submit_trace(text, text, text, numeric, text, uuid) from public;
revoke all on function public.submit_report(text, text, text, text) from public;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.submit_trace(text, text, text, numeric, text, uuid) to anon, authenticated;
grant execute on function public.submit_report(text, text, text, text) to anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
