-- DANGER: deletes ALL Internet Organism data (world, traces, discoveries,
-- profiles, reports, payments records) so the setup can be run again from
-- scratch. Use only on a new project or when you are sure.
-- It removes only objects created by this project's migrations; other
-- tables in your database and your Supabase auth users are not touched.

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists
  public.app_secrets, public.entitlements, public.supporters, public.payment_events,
  public.analytics_daily, public.system_errors, public.rate_limit_events, public.feature_flags,
  public.blocked_terms, public.admin_audit_logs, public.reports, public.user_preferences,
  public.user_discoveries, public.community_events, public.world_snapshots, public.discoveries,
  public.traces, public.world_events, public.regions, public.world_state, public.user_roles,
  public.profiles, public.region_archetypes
  cascade;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'admin_list_audit', 'admin_list_errors', 'admin_list_events', 'admin_list_rate_limits', 'admin_list_reports',
      'admin_overview', 'admin_redact_alias', 'admin_resolve_report', 'admin_run_maintenance',
      'admin_set_discovery_visibility', 'admin_set_event_hidden', 'admin_set_feature_flag', 'alias_for', 'audit',
      'birth_region_for_stage', 'create_discovery', 'current_actor', 'current_world_energy', 'delete_my_account',
      'emit_event', 'ensure_daily_community_event', 'flag_enabled', 'get_daily_feature', 'get_my_account',
      'get_region_detail', 'get_supporter_wall', 'get_world_snapshot', 'handle_new_user', 'has_role',
      'log_client_error', 'log_rate_limit', 'record_payment_event', 'record_snapshot', 'region_level_for',
      'region_public_json', 'region_state_for', 'require_role', 'run_world_maintenance', 'seed_initial_world',
      'stage_for', 'stage_name', 'submit_report', 'submit_trace', 'touch_updated_at', 'trace_gain', 'track_event',
      'utc_day_start', 'validate_display_name', 'world_decay', 'world_structure')
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'internet-organism-maintenance';
  end if;
end
$$;
