// Requires a local PostgreSQL (see tests/db/harness.js). No Supabase credentials needed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { account, anon, guest, setupDb } from './harness.js';

let db;
beforeAll(async () => {
  db = await setupDb();
});
afterAll(async () => {
  await db?.close();
});

describe('initial world', () => {
  it('seeds six regions, one world state row, a labelled initial discovery and snapshot', async () => {
    const regions = await db.pool.query('select slug, origin from public.regions order by slug');
    expect(regions.rows).toHaveLength(6);
    expect(regions.rows.every((r) => r.origin === 'seeded')).toBe(true);
    const ws = await db.pool.query('select * from public.world_state');
    expect(ws.rows).toHaveLength(1);
    expect(ws.rows[0].total_traces).toBe('0');
    const d = await db.pool.query("select origin from public.discoveries where slug = 'initial-structure'");
    expect(d.rows[0].origin).toBe('seeded');
    const s = await db.pool.query('select state_version from public.world_snapshots');
    expect(s.rows.map((r) => r.state_version)).toEqual([1]);
  });

  it('enforces a single world_state row', async () => {
    await expect(db.pool.query('insert into public.world_state (id, world_seed) values (2, 1)')).rejects.toThrow();
  });

  it('re-running the seed is a no-op', async () => {
    await db.pool.query('select public.seed_initial_world()');
    const r = await db.pool.query('select count(*)::int as n from public.regions');
    expect(r.rows[0].n).toBe(6);
  });
});

describe('submit_trace', () => {
  it('rejects signed-out callers that cannot be identified', async () => {
    const r = await db.trace(anon);
    expect(r).toMatchObject({ ok: false, code: 'no_identity' });
  });

  it('accepts a valid guest trace, persists it and updates aggregates', async () => {
    const id = await db.createUser({ anonymous: true });
    const r = await db.trace(guest(id), { region: 'the-pulse', intensity: 0.8 });
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(Number(r.energy_gain)).toBeCloseTo((2 + 4 * 0.8) * 1.35, 2);
    expect(r.alias).toMatch(/^[A-Za-z]+-[0-9A-F]{4}$/);
    const t = await db.pool.query('select * from public.traces where actor_id = $1', [id]);
    expect(t.rows).toHaveLength(1);
    const reg = await db.pool.query("select trace_count, contributor_count, state from public.regions where slug = 'the-pulse'");
    expect(reg.rows[0]).toMatchObject({ trace_count: '1', contributor_count: 1, state: 'stirring' });
    const ws = await db.pool.query('select total_traces, unique_contributors, evolution_stage from public.world_state');
    expect(ws.rows[0]).toMatchObject({ total_traces: '1', unique_contributors: 1, evolution_stage: 1 });
    // The first trace ever produces participant discoveries linked to the trace.
    expect(r.milestones.map((m) => m.type)).toEqual(expect.arrayContaining(['first_trace', 'region_first_trace', 'stage_advanced']));
    const d = await db.pool.query("select origin, triggered_by_alias, trigger_trace_id from public.discoveries where slug = 'the-first-trace'");
    expect(d.rows[0].origin).toBe('participant');
    expect(d.rows[0].trigger_trace_id).toBe(r.trace_id);
  });

  it('broadcasts a public event without account identifiers', async () => {
    const id = await db.createUser({ anonymous: true });
    const r = await db.trace(guest(id));
    const e = await db.pool.query('select payload from public.world_events where id = $1', [r.event_id]);
    const text = JSON.stringify(e.rows[0].payload);
    expect(text).not.toContain(id);
    expect(e.rows[0].payload).toMatchObject({ pattern: 'spark', region_slug: 'the-core' });
  });

  it('is idempotent for the same nonce (replay / retry protection)', async () => {
    const id = await db.createUser({ anonymous: true });
    const nonce = randomUUID();
    const a = await db.trace(guest(id), { nonce });
    await db.age(id, '1 hour'); // even after the cooldown, the same nonce is not counted again
    const b = await db.trace(guest(id), { nonce });
    expect(a.ok && b.ok).toBe(true);
    expect(b.duplicate).toBe(true);
    expect(b.trace_id).toBe(a.trace_id);
    const n = await db.pool.query('select count(*)::int as n from public.traces where actor_id = $1', [id]);
    expect(n.rows[0].n).toBe(1);
  });

  it('validates every parameter on the server', async () => {
    const id = await db.createUser({ anonymous: true });
    const who = guest(id);
    expect((await db.trace(who, { type: 'nuke' })).field).toBe('trace_type');
    expect((await db.trace(who, { color: 'red' })).field).toBe('color');
    expect((await db.trace(who, { color: '<script>' })).field).toBe('color');
    expect((await db.trace(who, { intensity: 5 })).field).toBe('intensity');
    expect((await db.trace(who, { intensity: 0 })).field).toBe('intensity');
    expect((await db.trace(who, { persistence: 'forever' })).field).toBe('persistence');
    expect((await db.trace(who, { region: 'nowhere' })).code).toBe('unknown_region');
    expect((await db.trace(who, { region: "x'; drop table traces; --" })).code).toBe('unknown_region');
    const n = await db.pool.query('select count(*)::int as n from public.traces where actor_id = $1', [id]);
    expect(n.rows[0].n).toBe(0);
  });

  it('applies the guest cooldown, hourly and daily limits', async () => {
    const id = await db.createUser({ anonymous: true });
    const who = guest(id);
    expect((await db.trace(who)).ok).toBe(true);
    const cool = await db.trace(who);
    expect(cool).toMatchObject({ ok: false, code: 'cooldown' });
    expect(cool.retry_after).toBeGreaterThan(0);
    expect(cool.retry_after).toBeLessThanOrEqual(20);

    // Fill the hour for a second guest: 12 traces within the last hour.
    const id2 = await db.createUser({ anonymous: true });
    for (let i = 0; i < 12; i++) {
      await db.pool.query(
        `insert into public.traces (region_id, actor_id, client_nonce, trace_type, color, intensity, persistence, energy_gain, alias, created_at)
         select id, $1, gen_random_uuid(), 'spark', '#ffffff', 0.5, 'lasting', 1, 'x', now() - make_interval(mins => $2) from public.regions where slug = 'the-core'`,
        [id2, 2 + i * 4]);
    }
    expect(await db.trace(guest(id2))).toMatchObject({ ok: false, code: 'hourly_limit' });

    const logged = await db.pool.query('select actor_id, reason from public.rate_limit_events where actor_id = any($1) order by reason', [[id, id2]]);
    expect(logged.rows.map((r) => r.reason)).toEqual(['cooldown', 'hourly_limit']);
    // Remove the hand-inserted rows (they bypassed the world counters).
    await db.pool.query('delete from public.traces where actor_id = $1', [id2]);
  });

  it('gives verified accounts a shorter cooldown than guests', async () => {
    const id = await db.createUser();
    const who = account(id);
    expect((await db.trace(who)).ok).toBe(true);
    await db.pool.query("update public.traces set created_at = now() - interval '12 seconds' where actor_id = $1", [id]);
    expect((await db.trace(who)).ok).toBe(true);
  });

  it('applies diminishing returns for repeated traces in one region', async () => {
    const id = await db.createUser({ anonymous: true });
    const who = guest(id);
    const first = await db.trace(who, { region: 'the-frontier', intensity: 1 });
    await db.age(id, '30 seconds');
    const second = await db.trace(who, { region: 'the-frontier', intensity: 1 });
    expect(Number(second.energy_gain)).toBeCloseTo(Number(first.energy_gain) * 0.6, 1);
  });

  it('keeps energy within 0..100 regardless of volume', async () => {
    await db.pool.query("update public.regions set energy = 99.5, energy_at = now() where slug = 'the-memory-garden'");
    const id = await db.createUser({ anonymous: true });
    const r = await db.trace(guest(id), { region: 'the-memory-garden', intensity: 1 });
    expect(Number(r.region.energy)).toBeLessThanOrEqual(100);
    await expect(db.pool.query("update public.regions set energy = 150 where slug = 'the-core'")).rejects.toThrow(/check/);
  });

  it('respects the traces_enabled kill switch', async () => {
    await db.pool.query("update public.feature_flags set enabled = false where key = 'traces_enabled'");
    const id = await db.createUser({ anonymous: true });
    expect(await db.trace(guest(id))).toMatchObject({ ok: false, code: 'feature_disabled' });
    await db.pool.query("update public.feature_flags set enabled = true where key = 'traces_enabled'");
  });

  it('handles simultaneous contributions without lost updates or deadlocks', async () => {
    const before = await db.pool.query('select total_traces::int as t from public.world_state');
    const regionBefore = await db.pool.query("select trace_count::int as t from public.regions where slug = 'the-resonance-field'");
    const ids = await Promise.all(Array.from({ length: 10 }, () => db.createUser({ anonymous: true })));
    const nonce = randomUUID();
    const repeater = await db.createUser({ anonymous: true });
    // 10 different visitors at once, plus one visitor sending the same nonce 3 times.
    const results = await Promise.all([
      ...ids.map((id, i) => db.trace(guest(id), { region: i % 2 ? 'the-resonance-field' : 'the-quiet-zone' })),
      ...[0, 1, 2].map(() => db.trace(guest(repeater), { nonce, region: 'the-resonance-field' })),
    ]);
    const okFresh = results.filter((r) => r.ok && !r.duplicate).length;
    const after = await db.pool.query('select total_traces::int as t from public.world_state');
    expect(after.rows[0].t - before.rows[0].t).toBe(okFresh);
    const counted = await db.pool.query('select count(*)::int as n from public.traces');
    expect(counted.rows[0].n).toBe(after.rows[0].t);
    const regionAfter = await db.pool.query("select trace_count::int as t from public.regions where slug = 'the-resonance-field'");
    const realInRegion = await db.pool.query("select count(*)::int as n from public.traces t join public.regions r on r.id = t.region_id where r.slug = 'the-resonance-field'");
    expect(regionAfter.rows[0].t).toBe(realInRegion.rows[0].n);
    expect(regionAfter.rows[0].t).toBeGreaterThan(regionBefore.rows[0].t);
    // Same nonce: exactly one insert; the other two return the original as duplicates.
    expect(results.slice(10).filter((r) => r.duplicate)).toHaveLength(2);
    const sameNonce = await db.pool.query('select count(*)::int as n from public.traces where client_nonce = $1', [nonce]);
    expect(sameNonce.rows[0].n).toBe(1);
  });
});

describe('evolution', () => {
  it('advances stage only with enough distinct contributors and grows a region', async () => {
    // One visitor alone can never advance past stage 1, however many traces.
    const f = await db.pool.query('select public.stage_for(10000, 1) as one, public.stage_for(20, 5) as two, public.stage_for(19, 50) as not_yet');
    expect(f.rows[0]).toEqual({ one: 1, two: 2, not_yet: 1 });
    // Keep adding distinct visitors until stage 2 is reached (it may already be).
    for (let i = 0; i < 25; i++) {
      const ws = await db.pool.query('select evolution_stage as s from public.world_state');
      if (ws.rows[0].s >= 2) break;
      const id = await db.createUser({ anonymous: true });
      await db.trace(guest(id), { region: 'the-core' });
    }
    const ws = await db.pool.query('select evolution_stage as s from public.world_state');
    expect(ws.rows[0].s).toBe(2);
    const born = await db.pool.query("select slug, origin, unlocked_at_stage from public.regions where origin = 'system'");
    expect(born.rows).toEqual([{ slug: 'mycelial-reach', origin: 'system', unlocked_at_stage: 2 }]);
    const d = await db.pool.query("select origin from public.discoveries where slug in ('stage-2-mycelium', 'born-mycelial-reach') order by slug");
    expect(d.rows.map((r) => r.origin)).toEqual(['system', 'participant']);
    const snap = await db.pool.query('select structure from public.world_snapshots order by state_version desc limit 1');
    expect(snap.rows[0].structure.map((r) => r.slug)).toContain('mycelial-reach');
  });

  it('records a level-up as a structural change with a new snapshot', async () => {
    const before = await db.pool.query('select max(state_version) as v from public.world_snapshots');
    await db.pool.query("update public.regions set trace_count = 9 where slug = 'the-pulse'");
    const id = await db.createUser({ anonymous: true });
    const r = await db.trace(guest(id), { region: 'the-pulse' });
    expect(r.region.level).toBe(1);
    expect(r.milestones.map((m) => m.type)).toContain('region_level');
    const after = await db.pool.query('select max(state_version) as v from public.world_snapshots');
    expect(after.rows[0].v).toBe(before.rows[0].v + 1);
  });

  it('resonance: matching patterns from different visitors get a bonus', async () => {
    const a = await db.createUser({ anonymous: true });
    const b = await db.createUser({ anonymous: true });
    await db.trace(guest(a), { region: 'the-resonance-field', type: 'spiral', intensity: 0.5 });
    const r = await db.trace(guest(b), { region: 'the-resonance-field', type: 'spiral', intensity: 0.5 });
    expect(r.resonance).toBe(true);
    expect(Number(r.energy_gain)).toBeCloseTo((2 + 4 * 0.5) * 1.5, 2);
  });
});

describe('community events', () => {
  it('creates exactly one Convergence per UTC day, idempotently', async () => {
    await db.as(anon, (c) => c.query('select public.get_world_snapshot()'), { commit: true });
    await db.as(anon, (c) => c.query('select public.get_world_snapshot()'), { commit: true });
    const r = await db.pool.query("select count(*)::int as n from public.community_events where starts_at = date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'");
    expect(r.rows[0].n).toBe(1);
    const started = await db.pool.query("select count(*)::int as n from public.world_events where event_type = 'community_event_started'");
    expect(started.rows[0].n).toBe(1);
  });

  it('completes when enough distinct visitors take part, once', async () => {
    const ce = (await db.pool.query("select ce.*, r.slug as region_slug from public.community_events ce join public.regions r on r.id = ce.region_id where status = 'active'")).rows[0];
    await db.pool.query('update public.community_events set goal_target = 2 where id = $1', [ce.id]);
    const ids = [await db.createUser({ anonymous: true }), await db.createUser({ anonymous: true }), await db.createUser({ anonymous: true })];
    const results = [];
    for (const id of ids) results.push(await db.trace(guest(id), { region: ce.region_slug }));
    const completions = results.flatMap((r) => r.milestones).filter((m) => m.type === 'community_event_completed');
    expect(completions).toHaveLength(1);
    const status = await db.pool.query('select status from public.community_events where id = $1', [ce.id]);
    expect(status.rows[0].status).toBe('completed');
  });

  it('expires overdue events through maintenance', async () => {
    await db.pool.query(`insert into public.community_events (slug, title, description, region_id, goal_target, starts_at, ends_at)
      select 'convergence-2000-01-01', 'Old', 'Old', id, 3, '2000-01-01', '2000-01-02' from public.regions where slug = 'the-core'`);
    await db.pool.query('select public.run_world_maintenance()');
    const r = await db.pool.query("select status from public.community_events where slug = 'convergence-2000-01-01'");
    expect(r.rows[0].status).toBe('expired');
  });
});

describe('public snapshot', () => {
  it('is readable by anonymous visitors and reports real counts', async () => {
    const snap = await db.as(anon, async (c) => (await c.query('select public.get_world_snapshot() as s')).rows[0].s);
    const counted = await db.pool.query('select count(*)::int as n from public.traces');
    expect(snap.world.total_traces).toBe(counted.rows[0].n);
    expect(snap.regions.length).toBeGreaterThanOrEqual(6);
    expect(snap.stats.contributors_today).toBeGreaterThan(0);
    expect(JSON.stringify(snap)).not.toMatch(/actor_id|email/);
  });

  it('daily feature always returns a labelled rule', async () => {
    const f = await db.as(anon, async (c) => (await c.query('select public.get_daily_feature() as f')).rows[0].f);
    expect(['participant_discovery_yesterday', 'recent_discovery', 'featured_region']).toContain(f.rule);
  });
});
