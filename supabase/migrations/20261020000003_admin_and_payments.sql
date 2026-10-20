-- Internet Organism — administration, moderation and payment recording.
--
-- Roles live in public.user_roles and can only be granted with direct SQL by
-- the operator (see docs/SECURITY.md). Every function below re-checks the
-- caller's role on the server and writes an audit log row for sensitive
-- actions. Nothing here trusts a role claimed by the browser.

create or replace function public.has_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and (role = p_role or role = 'admin')
  )
$$;

create or replace function public.require_role(p_role text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role(p_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return auth.uid();
end
$$;

create or replace function public.audit(p_action text, p_target_type text, p_target_id text, p_details jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb))
$$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('moderator');
  return jsonb_build_object(
    'is_admin', public.has_role('admin'),
    'world', (select to_jsonb(w) from public.world_state w where id = 1),
    'traces_24h', (select count(*) from public.traces where created_at > now() - interval '24 hours'),
    'contributors_24h', (select count(distinct actor_id) from public.traces where created_at > now() - interval '24 hours'),
    'rejections_24h', coalesce((select jsonb_object_agg(reason, n) from (
        select reason, sum(rejected_count) as n from public.rate_limit_events
        where window_start > now() - interval '24 hours' group by reason) x), '{}'::jsonb),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'errors_24h', (select count(*) from public.system_errors where created_at > now() - interval '24 hours'),
    'hidden_events', (select count(*) from public.world_events where hidden),
    'flags', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'enabled', enabled, 'description', description) order by key), '[]'::jsonb)
              from public.feature_flags),
    'analytics_7d', coalesce((select jsonb_object_agg(event, n) from (
        select event, sum(count) as n from public.analytics_daily
        where day > (now() at time zone 'UTC')::date - 7 group by event) a), '{}'::jsonb)
  );
end
$$;

create or replace function public.admin_list_reports(p_status text, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('moderator');
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at, r.resolved_at,
        case r.target_type
          when 'world_event' then (select jsonb_build_object('event_type', e.event_type, 'payload', e.payload, 'hidden', e.hidden)
                                   from public.world_events e where e.id::text = r.target_id)
          when 'discovery' then (select jsonb_build_object('title', d.title, 'alias', d.triggered_by_alias, 'visibility', d.visibility)
                                 from public.discoveries d where d.slug = r.target_id)
        end as target
      from public.reports r
      where p_status is null or r.status = p_status
      order by r.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) x), '[]'::jsonb);
end
$$;

create or replace function public.admin_set_event_hidden(p_event_id bigint, p_hidden boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_role('moderator');
  update public.world_events set hidden = p_hidden where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform public.audit(case when p_hidden then 'hide_event' else 'unhide_event' end, 'world_event', p_event_id::text, '{}');
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_set_discovery_visibility(p_slug text, p_visibility text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_role('moderator');
  if p_visibility not in ('public', 'hidden') then
    return jsonb_build_object('ok', false, 'code', 'invalid_parameters');
  end if;
  update public.discoveries set visibility = p_visibility where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform public.audit('set_discovery_visibility', 'discovery', p_slug, jsonb_build_object('visibility', p_visibility));
  return jsonb_build_object('ok', true);
end
$$;

-- Replaces an abusive pseudonym everywhere it appears publicly, and resets
-- the author's profile name. The target is identified by a public event.
create or replace function public.admin_redact_alias(p_event_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_events integer;
begin
  perform public.require_role('moderator');
  select t.actor_id into v_actor from public.traces t
  where t.world_event_id = p_event_id
     or t.id = (select d.trigger_trace_id from public.discoveries d where d.world_event_id = p_event_id);
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  update public.world_events e set payload = jsonb_set(e.payload, '{alias}', '"Redacted visitor"')
  where e.payload ? 'alias' and (
    e.id in (select world_event_id from public.traces where actor_id = v_actor and world_event_id is not null)
    or e.id in (select d.world_event_id from public.discoveries d join public.traces t on t.id = d.trigger_trace_id
                where t.actor_id = v_actor and d.world_event_id is not null));
  get diagnostics v_events = row_count;
  update public.discoveries d set triggered_by_alias = 'Redacted visitor'
  from public.traces t where t.id = d.trigger_trace_id and t.actor_id = v_actor;
  update public.traces set alias = 'Redacted visitor' where actor_id = v_actor;
  update public.profiles set display_name = public.alias_for(v_actor) where id = v_actor;

  perform public.audit('redact_alias', 'world_event', p_event_id::text, jsonb_build_object('events_updated', v_events));
  return jsonb_build_object('ok', true, 'events_updated', v_events);
end
$$;

create or replace function public.admin_resolve_report(p_report_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_report public.reports;
  v_result jsonb := jsonb_build_object('ok', true);
begin
  perform public.require_role('moderator');
  if p_action not in ('dismiss', 'hide_target', 'redact_alias') then
    return jsonb_build_object('ok', false, 'code', 'invalid_parameters');
  end if;
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_report.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'already_resolved');
  end if;

  if p_action = 'hide_target' then
    if v_report.target_type = 'world_event' then
      v_result := public.admin_set_event_hidden(v_report.target_id::bigint, true);
    else
      v_result := public.admin_set_discovery_visibility(v_report.target_id, 'hidden');
    end if;
  elsif p_action = 'redact_alias' then
    if v_report.target_type = 'world_event' then
      v_result := public.admin_redact_alias(v_report.target_id::bigint);
    else
      v_result := public.admin_redact_alias((select world_event_id from public.discoveries where slug = v_report.target_id));
    end if;
  end if;

  if not coalesce((v_result ->> 'ok')::boolean, false) then
    return v_result;
  end if;

  update public.reports set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
    resolved_by = auth.uid(), resolved_at = now()
  where id = p_report_id;
  perform public.audit('resolve_report', 'report', p_report_id::text, jsonb_build_object('action', p_action));
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_set_feature_flag(p_key text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_role('admin');
  update public.feature_flags set enabled = p_enabled, updated_at = now() where key = p_key;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform public.audit('set_feature_flag', 'feature_flag', p_key, jsonb_build_object('enabled', p_enabled));
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_run_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform public.require_role('admin');
  v_result := public.run_world_maintenance();
  perform public.audit('run_maintenance', 'world', '1', v_result);
  return v_result;
end
$$;

create or replace function public.admin_list_errors(p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('moderator');
  return coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (
    select id, source, code, message, context, created_at from public.system_errors
    order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) e), '[]'::jsonb);
end
$$;

-- Rate-limit activity, aggregated. Actor ids are shortened hashes so
-- moderators can spot a repeat offender without seeing account ids.
create or replace function public.admin_list_rate_limits(p_hours integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('moderator');
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.window_start desc, x.rejected desc) from (
    select action, reason, window_start, sum(rejected_count) as rejected,
           count(distinct actor_id) as actors,
           (array_agg(substr(md5(actor_id::text), 1, 8) order by rejected_count desc))[1] as top_actor_hash
    from public.rate_limit_events
    where window_start > now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 336))
    group by action, reason, window_start
    limit 200) x), '[]'::jsonb);
end
$$;

create or replace function public.admin_list_audit(p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('admin');
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (
    select l.id, l.action, l.target_type, l.target_id, l.details, l.created_at,
           coalesce(p.display_name, 'removed account') as admin_name
    from public.admin_audit_logs l left join public.profiles p on p.id = l.admin_id
    order by l.id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) a), '[]'::jsonb);
end
$$;

create or replace function public.admin_list_events(p_limit integer, p_before bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('moderator');
  return coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (
    select id, event_type, origin, payload, state_version, hidden, created_at
    from public.world_events
    where p_before is null or id < p_before
    order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) e), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Payments. Called only by the stripe-webhook Edge Function (service role)
-- after it has verified the provider signature. Idempotent per provider
-- event id.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_event(
  p_provider_event_id text, p_event_type text, p_data jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inserted text;
  v_user uuid;
begin
  insert into public.payment_events (provider_event_id, event_type)
  values (p_provider_event_id, p_event_type)
  on conflict (provider_event_id) do nothing
  returning provider_event_id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  v_user := case when coalesce(p_data ->> 'user_id', '') ~ '^[0-9a-f-]{36}$'
                 and exists (select 1 from auth.users where id = (p_data ->> 'user_id')::uuid)
            then (p_data ->> 'user_id')::uuid end;

  if p_event_type = 'donation_completed' then
    insert into public.supporters (user_id, provider_payment_id, amount_cents, currency, public_acknowledgment, public_name)
    values (v_user, p_data ->> 'payment_id', (p_data ->> 'amount_cents')::integer, lower(p_data ->> 'currency'),
            coalesce((p_data ->> 'public_acknowledgment')::boolean, false),
            nullif(left(trim(coalesce(p_data ->> 'public_name', '')), 40), ''))
    on conflict (provider_payment_id) do nothing;
  elsif p_event_type = 'membership_updated' then
    if v_user is null then
      return jsonb_build_object('ok', false, 'code', 'unknown_user');
    end if;
    insert into public.entitlements (user_id, entitlement, status, provider_subscription_id, current_period_end)
    values (v_user, 'supporter_membership', p_data ->> 'status', p_data ->> 'subscription_id',
            to_timestamp((p_data ->> 'current_period_end')::bigint))
    on conflict (user_id, entitlement) do update set
      status = excluded.status, provider_subscription_id = excluded.provider_subscription_id,
      current_period_end = excluded.current_period_end, updated_at = now();
  else
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false);
end
$$;

create or replace function public.get_supporter_wall() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', public_name, 'since', created_at) order by created_at desc), '[]'::jsonb)
  from (select public_name, min(created_at) as created_at from public.supporters
        where public_acknowledgment and public_name is not null
        group by public_name order by min(created_at) desc limit 200) s
$$;

-- Privileges: revoke defaults, grant the role-checked API to authenticated.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'has_role', 'require_role', 'audit', 'admin_overview', 'admin_list_reports', 'admin_set_event_hidden',
      'admin_set_discovery_visibility', 'admin_redact_alias', 'admin_resolve_report', 'admin_set_feature_flag',
      'admin_run_maintenance', 'admin_list_errors', 'admin_list_rate_limits', 'admin_list_audit',
      'admin_list_events', 'record_payment_event', 'get_supporter_wall')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end
$$;

grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_reports(text, integer) to authenticated;
grant execute on function public.admin_set_event_hidden(bigint, boolean) to authenticated;
grant execute on function public.admin_set_discovery_visibility(text, text) to authenticated;
grant execute on function public.admin_redact_alias(bigint) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;
grant execute on function public.admin_set_feature_flag(text, boolean) to authenticated;
grant execute on function public.admin_run_maintenance() to authenticated;
grant execute on function public.admin_list_errors(integer) to authenticated;
grant execute on function public.admin_list_rate_limits(integer) to authenticated;
grant execute on function public.admin_list_audit(integer) to authenticated;
grant execute on function public.admin_list_events(integer, bigint) to authenticated;
grant execute on function public.get_supporter_wall() to anon, authenticated;
grant execute on function public.record_payment_event(text, text, jsonb) to service_role;
