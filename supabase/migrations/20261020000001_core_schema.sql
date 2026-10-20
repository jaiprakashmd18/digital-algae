-- Internet Organism — core schema.
--
-- The shared world is made of regions (clusters of the organism), traces
-- (validated visitor contributions), world events (the public event stream)
-- and discoveries (notable events with stable public URLs). A single
-- world_state row is the authoritative aggregate.
--
-- Clients never write world tables directly. Every mutation goes through the
-- SECURITY DEFINER functions in the following migrations; RLS (migration 4)
-- only grants read access to public rows.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Region archetypes: tunable, public parameters for each kind of region.
-- Mirrored in src/lib/world-model.js; tests assert both agree.
-- ---------------------------------------------------------------------------
create table public.region_archetypes (
  region_type text primary key check (region_type ~ '^[a-z]{3,20}$'),
  label text not null,
  description text not null,
  gain_multiplier numeric(4, 2) not null check (gain_multiplier between 0.1 and 3),
  half_life_hours numeric(5, 2) not null check (half_life_hours between 0.5 and 168),
  resonance_bonus numeric(4, 2) not null default 0 check (resonance_bonus between 0 and 2)
);

-- ---------------------------------------------------------------------------
-- Profiles. One per auth user, including Supabase anonymous (guest) users.
-- Holds only a public-facing pseudonym and cosmetic preferences.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(display_name) between 2 and 24 and display_name ~ '^[[:alnum:]][[:alnum:] _.-]*$'),
  avatar_preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(avatar_preferences) = 'object' and pg_column_size(avatar_preferences) <= 1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'moderator')),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------------
-- World state: exactly one row (id = 1).
-- ---------------------------------------------------------------------------
create table public.world_state (
  id smallint primary key default 1 check (id = 1),
  state_version integer not null default 1 check (state_version >= 1),
  evolution_stage smallint not null default 0 check (evolution_stage between 0 and 5),
  global_energy numeric(6, 2) not null default 0 check (global_energy between 0 and 100),
  total_traces bigint not null default 0 check (total_traces >= 0),
  unique_contributors integer not null default 0 check (unique_contributors >= 0),
  world_seed bigint not null,
  stage_changed_at timestamptz not null default now(),
  energy_milestone_day date,
  energy_milestone_level smallint not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Regions.
-- energy is stored as of energy_at; readers apply decay (see world_decay()).
-- ---------------------------------------------------------------------------
create table public.regions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 48),
  name text not null check (char_length(name) between 2 and 48),
  region_type text not null references public.region_archetypes (region_type),
  description text not null check (char_length(description) <= 600),
  generation_seed bigint not null,
  hue smallint not null check (hue between 0 and 359),
  anchor_x real not null default 0,
  anchor_y real not null default 0,
  anchor_z real not null default 0,
  parent_region_id uuid references public.regions (id) on delete set null,
  origin text not null default 'seeded' check (origin in ('seeded', 'system')),
  unlocked_at_stage smallint not null default 0 check (unlocked_at_stage between 0 and 5),
  state text not null default 'dormant' check (state in ('dormant', 'stirring', 'active', 'surging', 'resonant')),
  energy numeric(6, 2) not null default 0 check (energy between 0 and 100),
  energy_at timestamptz not null default now(),
  level smallint not null default 0 check (level between 0 and 5),
  trace_count bigint not null default 0 check (trace_count >= 0),
  contributor_count integer not null default 0 check (contributor_count >= 0),
  last_trace_at timestamptz,
  last_trace_pattern text,
  last_trace_actor uuid,
  last_surge_at timestamptz,
  visibility text not null default 'public' check (visibility in ('public', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index regions_visibility_idx on public.regions (visibility, created_at);

-- ---------------------------------------------------------------------------
-- World events: the public, append-only event stream (Realtime-published).
-- payload is small and never contains account identifiers.
-- ---------------------------------------------------------------------------
create table public.world_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'world_seeded', 'trace', 'first_trace', 'region_first_trace', 'region_surge',
    'region_level', 'stage_advanced', 'region_born', 'energy_milestone',
    'community_event_started', 'community_event_completed', 'community_event_expired'
  )),
  origin text not null check (origin in ('seeded', 'system', 'participant')),
  region_id uuid references public.regions (id) on delete set null,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2048),
  state_version integer not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index world_events_recent_idx on public.world_events (id desc) where not hidden;
create index world_events_type_idx on public.world_events (event_type, id desc) where not hidden;
create index world_events_region_idx on public.world_events (region_id, id desc) where not hidden;
create index world_events_created_idx on public.world_events (created_at);

-- ---------------------------------------------------------------------------
-- Traces. Private to their author; the public sees the derived world event.
-- ---------------------------------------------------------------------------
create table public.traces (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  client_nonce uuid not null,
  trace_type text not null check (trace_type in ('spark', 'spiral', 'ripple', 'bloom', 'filament')),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  intensity numeric(3, 2) not null check (intensity between 0.10 and 1.00),
  persistence text not null check (persistence in ('fleeting', 'lasting')),
  energy_gain numeric(6, 2) not null check (energy_gain >= 0 and energy_gain <= 100),
  alias text not null,
  world_event_id bigint references public.world_events (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (actor_id, client_nonce)
);
create index traces_actor_idx on public.traces (actor_id, created_at desc);
create index traces_region_idx on public.traces (region_id, created_at desc);
create index traces_created_idx on public.traces (created_at);

-- ---------------------------------------------------------------------------
-- Discoveries: notable events with stable public URLs.
-- ---------------------------------------------------------------------------
create table public.discoveries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  region_id uuid references public.regions (id) on delete set null,
  world_event_id bigint unique references public.world_events (id) on delete set null,
  kind text not null check (kind in (
    'initial_structure', 'first_trace', 'region_first_trace', 'region_surge', 'region_level',
    'stage_advanced', 'region_born', 'energy_milestone', 'community_event'
  )),
  origin text not null check (origin in ('seeded', 'system', 'participant')),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) <= 1000),
  triggered_by_alias text check (triggered_by_alias is null or char_length(triggered_by_alias) <= 24),
  trigger_trace_id uuid references public.traces (id) on delete set null,
  state_version integer not null,
  visibility text not null default 'public' check (visibility in ('public', 'hidden')),
  created_at timestamptz not null default now()
);
create index discoveries_public_idx on public.discoveries (created_at desc) where visibility = 'public';
create index discoveries_region_idx on public.discoveries (region_id, created_at desc);
create index discoveries_kind_idx on public.discoveries (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- World snapshots: the structural state at each state_version, so historical
-- views can be regenerated deterministically (no per-frame data).
-- ---------------------------------------------------------------------------
create table public.world_snapshots (
  state_version integer primary key,
  evolution_stage smallint not null,
  world_seed bigint not null,
  structure jsonb not null check (jsonb_typeof(structure) = 'array' and pg_column_size(structure) <= 65536),
  reason text not null check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Community events (daily Convergence).
-- ---------------------------------------------------------------------------
create table public.community_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  region_id uuid not null references public.regions (id) on delete cascade,
  goal_type text not null default 'unique_contributors' check (goal_type in ('unique_contributors')),
  goal_target integer not null check (goal_target between 1 and 1000),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'active' check (status in ('active', 'completed', 'expired')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index community_events_status_idx on public.community_events (status, ends_at);

-- ---------------------------------------------------------------------------
-- Personal data.
-- ---------------------------------------------------------------------------
create table public.user_discoveries (
  user_id uuid not null references auth.users (id) on delete cascade,
  discovery_id uuid not null references public.discoveries (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, discovery_id)
);

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) <= 2048),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Moderation, operations and audit.
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users (id) on delete set null,
  target_type text not null check (target_type in ('world_event', 'discovery')),
  target_id text not null check (char_length(target_id) <= 64),
  reason text not null check (reason in ('offensive_name', 'spam', 'harassment', 'other')),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at desc);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

-- Display-name terms that are rejected (impersonation, abuse). Operators
-- extend this list; it is never exposed to clients.
create table public.blocked_terms (
  term text primary key check (term = lower(term) and char_length(term) between 2 and 40)
);

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z_]{3,40}$'),
  enabled boolean not null,
  description text not null,
  updated_at timestamptz not null default now()
);

-- Aggregated per actor, action and hour — no IPs, no request bodies.
-- The all-zero UUID is the bucket for requests made without a session.
create table public.rate_limit_events (
  actor_id uuid not null default '00000000-0000-0000-0000-000000000000',
  action text not null,
  reason text not null,
  window_start timestamptz not null,
  rejected_count integer not null default 1,
  primary key (action, reason, window_start, actor_id)
);
create index rate_limit_events_window_idx on public.rate_limit_events (window_start);

create table public.system_errors (
  id bigint generated always as identity primary key,
  source text not null check (char_length(source) <= 40),
  code text not null check (char_length(code) <= 60),
  message text not null check (char_length(message) <= 500),
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) <= 1024),
  created_at timestamptz not null default now()
);
create index system_errors_created_idx on public.system_errors (created_at desc);

-- Privacy-preserving product analytics: daily counts only.
create table public.analytics_daily (
  day date not null,
  event text not null check (event ~ '^[a-z_]{3,40}$'),
  count bigint not null default 0,
  primary key (day, event)
);

-- ---------------------------------------------------------------------------
-- Support and (feature-flagged) membership. Written only by the payment
-- webhook Edge Function through the service role. No card data is stored.
-- ---------------------------------------------------------------------------
create table public.payment_events (
  provider_event_id text primary key,
  provider text not null default 'stripe',
  event_type text not null,
  processed_at timestamptz not null default now()
);

create table public.supporters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  provider_payment_id text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  public_acknowledgment boolean not null default false,
  public_name text check (public_name is null or char_length(public_name) between 2 and 40),
  created_at timestamptz not null default now()
);

create table public.entitlements (
  user_id uuid not null references auth.users (id) on delete cascade,
  entitlement text not null check (entitlement in ('supporter_membership')),
  status text not null check (status in ('active', 'past_due', 'canceled')),
  provider_subscription_id text unique,
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, entitlement)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger regions_touch before update on public.regions
  for each row execute function public.touch_updated_at();
create trigger user_preferences_touch before update on public.user_preferences
  for each row execute function public.touch_updated_at();
