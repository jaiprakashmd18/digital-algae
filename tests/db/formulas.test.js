// Asserts that the JavaScript world model mirrors the SQL engine exactly.
// Requires a local PostgreSQL (see harness.js).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupDb } from './harness.js';
import { ARCHETYPES, decayEnergy, regionLevelFor, regionStateFor, stageFor, STAGES, traceGain } from '../../src/lib/world-model.js';
import { INITIAL_REGIONS, WORLD_SEED } from '../../src/lib/initial-world.js';

let db;
beforeAll(async () => {
  db = await setupDb();
});
afterAll(async () => {
  await db?.close();
});

const one = async (sql, params) => (await db.pool.query(sql, params)).rows[0];

describe('SQL and JS formulas agree', () => {
  it('archetypes', async () => {
    const rows = (await db.pool.query('select * from public.region_archetypes')).rows;
    for (const r of rows) {
      expect(ARCHETYPES[r.region_type]).toMatchObject({ gainMultiplier: Number(r.gain_multiplier), halfLifeHours: Number(r.half_life_hours), resonanceBonus: Number(r.resonance_bonus) });
    }
    expect(rows).toHaveLength(Object.keys(ARCHETYPES).length);
  });

  it('decay', async () => {
    for (const [e, hours, hl] of [[80, 0, 6], [80, 6, 6], [50, 1.5, 2], [100, 30, 24], [3, 100, 4]]) {
      const now = Date.UTC(2026, 9, 20, 12);
      const since = now - hours * 3600e3;
      const r = await one('select public.world_decay($1, $2, $3, $4)::float8 as v', [e, new Date(since), hl, new Date(now)]);
      expect(r.v).toBeCloseTo(decayEnergy(e, since, hl, now), 2);
    }
  });

  it('states, levels, stages and gains', async () => {
    for (const e of [0, 4.99, 5, 19.9, 20, 44.9, 45, 74.99, 75, 100]) {
      expect((await one('select public.region_state_for($1) as s', [e])).s).toBe(regionStateFor(e));
    }
    for (const n of [0, 9, 10, 39, 40, 120, 399, 400, 1200, 5000]) {
      expect((await one('select public.region_level_for($1) as l', [n])).l).toBe(regionLevelFor(n));
    }
    for (const s of STAGES) {
      expect((await one('select public.stage_for($1, $2) as s', [s.traces, s.contributors])).s).toBe(stageFor(s.traces, s.contributors));
      expect((await one('select public.stage_name($1::smallint) as n', [s.stage])).n).toBe(s.name);
    }
    for (const [i, type, n, match] of [[0.1, 'core', 0, false], [1, 'pulse', 0, false], [0.55, 'quiet', 2, false], [0.6, 'resonance', 0, true]]) {
      const a = ARCHETYPES[type];
      const r = await one('select public.trace_gain($1, $2, $3, $4, $5)::float8 as g', [i, a.gainMultiplier, n, a.resonanceBonus, match]);
      expect(r.g).toBeCloseTo(traceGain(i, a, n, match), 2);
    }
  });

  it('initial world matches src/lib/initial-world.js', async () => {
    const rows = (await db.pool.query("select slug, name, region_type, generation_seed, hue, anchor_x, anchor_y, anchor_z, description from public.regions where origin = 'seeded' order by created_at, slug")).rows;
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    for (const r of INITIAL_REGIONS) {
      const s = bySlug.get(r.slug);
      expect(s).toBeTruthy();
      expect({ name: s.name, type: s.region_type, seed: Number(s.generation_seed), hue: s.hue, description: s.description })
        .toEqual({ name: r.name, type: r.type, seed: r.seed, hue: r.hue, description: r.description });
      expect([s.anchor_x, s.anchor_y, s.anchor_z].map((v) => Math.round(v * 10) / 10)).toEqual(r.anchor);
    }
    expect(Number((await one('select world_seed from public.world_state')).world_seed)).toBe(WORLD_SEED);
  });
});
