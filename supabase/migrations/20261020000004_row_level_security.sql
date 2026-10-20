-- Internet Organism — Row Level Security and table privileges.
--
-- Model:
--   * Public world data (regions, events, discoveries, snapshots, community
--     events, world state, archetypes, feature flags) is readable by anyone,
--     filtered to public/non-hidden rows.
--   * No API role can INSERT/UPDATE/DELETE world tables. All world mutations
--     run inside SECURITY DEFINER functions with server-side validation.
--   * Personal rows (traces, profile, saved discoveries, preferences,
--     entitlements) are readable only by their owner.
--   * Operational tables (reports, audit logs, errors, rate limits,
--     analytics, payments, roles of other users) have no API access at all;
--     moderators reach them through role-checked functions.
-- Note: Supabase anonymous (guest) users have the `authenticated` role, so
-- "authenticated" policies below apply to guests too, always scoped to
-- auth.uid().

-- Enable RLS everywhere first.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$;

-- Defense in depth: strip default write privileges from the API roles.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Private operational tables: no direct access at all.
revoke all on public.reports, public.admin_audit_logs, public.rate_limit_events, public.system_errors,
  public.analytics_daily, public.payment_events, public.supporters, public.blocked_terms
  from anon, authenticated;

-- Personal tables are not visible to signed-out (anon role) requests.
revoke all on public.traces, public.profiles, public.user_discoveries, public.user_preferences,
  public.entitlements, public.user_roles
  from anon;

-- ---------------------------------------------------------------------------
-- Public world data
-- ---------------------------------------------------------------------------
create policy "archetypes are public" on public.region_archetypes
  for select to anon, authenticated using (true);

create policy "world state is public" on public.world_state
  for select to anon, authenticated using (true);

create policy "public regions are readable" on public.regions
  for select to anon, authenticated using (visibility = 'public');

create policy "visible events are readable" on public.world_events
  for select to anon, authenticated using (not hidden);

create policy "public discoveries are readable" on public.discoveries
  for select to anon, authenticated using (visibility = 'public');

create policy "snapshots are public" on public.world_snapshots
  for select to anon, authenticated using (true);

create policy "community events are public" on public.community_events
  for select to anon, authenticated using (true);

create policy "feature flags are public" on public.feature_flags
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Personal data
-- ---------------------------------------------------------------------------
create policy "own traces are readable" on public.traces
  for select to authenticated using (actor_id = (select auth.uid()));

create policy "own profile is readable" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "own profile is editable" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- Only these columns can be changed by the owner.
grant update (display_name, avatar_preferences) on public.profiles to authenticated;

create policy "own roles are readable" on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()));

create policy "own saved discoveries are readable" on public.user_discoveries
  for select to authenticated using (user_id = (select auth.uid()));
create policy "save public discoveries" on public.user_discoveries
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.discoveries d where d.id = discovery_id and d.visibility = 'public')
  );
create policy "remove own saved discoveries" on public.user_discoveries
  for delete to authenticated using (user_id = (select auth.uid()));
grant insert (user_id, discovery_id), delete on public.user_discoveries to authenticated;

create policy "own preferences are readable" on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "create own preferences" on public.user_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own preferences" on public.user_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- user_id is updatable so PostgREST upserts work; the policy pins it to auth.uid().
grant insert (user_id, preferences), update (user_id, preferences) on public.user_preferences to authenticated;

create policy "own entitlements are readable" on public.entitlements
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime: publish only the public event stream and community events.
-- Supabase Realtime applies the SELECT policies above per subscriber.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.world_events, public.community_events;
  end if;
end
$$;
