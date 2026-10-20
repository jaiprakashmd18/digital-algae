-- Internet Organism — initial world.
--
-- Production databases only receive migrations, so the starting structure
-- lives here (seed.sql calls the same idempotent function for local resets).
-- Everything created here is marked origin = 'seeded' so the interface can
-- distinguish the generated starting structure from participant activity.

create or replace function public.seed_initial_world() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_event bigint;
begin
  insert into public.region_archetypes (region_type, label, description, gain_multiplier, half_life_hours, resonance_bonus) values
    ('core', 'Core', 'The central network. Steady, balanced, connected to everything.', 1.00, 6, 0),
    ('pulse', 'Pulse', 'Reacts strongly and quickly. Energy arrives fast and fades fast.', 1.35, 2, 0),
    ('quiet', 'Quiet', 'Absorbs slowly and holds what it receives for a long time.', 0.70, 12, 0),
    ('memory', 'Memory', 'Keeps the longest record. Energy here decays over days, not hours.', 0.85, 24, 0),
    ('frontier', 'Frontier', 'Young, eager structures at the edge of the organism.', 1.15, 4, 0),
    ('resonance', 'Resonance', 'Amplifies repetition: matching patterns from different visitors resonate.', 1.00, 6, 0.50)
  on conflict (region_type) do nothing;

  insert into public.feature_flags (key, enabled, description) values
    ('traces_enabled', true, 'Visitors can leave traces. Disable to pause all world mutations.'),
    ('reports_enabled', true, 'Visitors can report public content.'),
    ('community_events_enabled', true, 'Daily Convergence community events are created and tracked.'),
    ('membership_enabled', false, 'Supporter membership checkout (requires a configured payment provider).')
  on conflict (key) do nothing;

  -- Names that impersonate operators. Extend in production; see docs/SECURITY.md.
  insert into public.blocked_terms (term) values
    ('admin'), ('administrator'), ('moderator'), ('official'), ('staff'), ('support'), ('system'), ('operator')
  on conflict (term) do nothing;

  insert into public.world_state (id, world_seed) values (1, 2026102001)
  on conflict (id) do nothing;

  insert into public.regions (slug, name, region_type, description, generation_seed, hue, anchor_x, anchor_y, anchor_z, origin) values
    ('the-core', 'The Core', 'core',
     'The dense heart of the organism, where every filament eventually returns. Traces here travel outward to every other region.',
     91823, 188, 0, 0, 0, 'seeded'),
    ('the-pulse', 'The Pulse', 'pulse',
     'A restless cluster that flares at the slightest touch and calms just as fast. It shows what is happening right now.',
     44017, 296, 6.6, 1.6, -2.2, 'seeded'),
    ('the-quiet-zone', 'The Quiet Zone', 'quiet',
     'A slow, deep region that barely reacts — but remembers every disturbance for half a day.',
     70331, 214, -6.2, -1.4, 2.9, 'seeded'),
    ('the-memory-garden', 'The Memory Garden', 'memory',
     'Branches that hold their glow for days. Milestones of the organism settle here like rings in a tree.',
     15559, 142, -2.8, 4.8, -5.1, 'seeded'),
    ('the-frontier', 'The Frontier', 'frontier',
     'The newest growth at the edge of the structure, quick to respond and eager to branch.',
     60601, 168, 3.6, -5.0, 4.6, 'seeded'),
    ('the-resonance-field', 'The Resonance Field', 'resonance',
     'A lattice tuned to repetition. When different visitors leave the same pattern in quick succession, it resonates.',
     38183, 262, 1.4, 5.6, 5.0, 'seeded')
  on conflict (slug) do nothing;

  update public.regions set parent_region_id = (select id from public.regions where slug = 'the-core')
  where slug <> 'the-core' and origin = 'seeded' and parent_region_id is null;

  if not exists (select 1 from public.world_events where event_type = 'world_seeded') then
    v_event := public.emit_event('world_seeded', 'seeded', null,
      jsonb_build_object('regions', 6, 'world_seed', 2026102001), 1);
    insert into public.discoveries (slug, kind, origin, world_event_id, title, description, state_version) values
      ('initial-structure', 'initial_structure', 'seeded', v_event, 'The initial structure',
       'The organism began as six generated regions around a central Core. This structure was created by the system from fixed seeds, not by visitors. Every change since then comes from real, recorded traces.',
       1);
    insert into public.world_snapshots (state_version, evolution_stage, world_seed, structure, reason)
    values (1, 0, 2026102001, public.world_structure(), 'Initial generated structure');
  end if;
end
$$;

revoke all on function public.seed_initial_world() from public, anon, authenticated;

select public.seed_initial_world();

-- Optional scheduler. If pg_cron is available (enable it under Database →
-- Extensions in Supabase), run maintenance every 15 minutes. Without it the
-- world still works: decay is computed on read, the daily community event is
-- created lazily, and maintenance can be run from /admin or the world-tick
-- Edge Function.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('internet-organism-maintenance', '*/15 * * * *', 'select public.run_world_maintenance()');
  end if;
end
$$;
