import { describe, expect, it } from 'vitest';
import { createInitialState, dailyFeature, snapshot, submitTrace } from '../../src/lib/demo-engine.js';
import { newNonce } from '../../src/lib/validation.js';

const T0 = Date.UTC(2026, 9, 20, 10);
const draft = (patch = {}) => ({ regionSlug: 'the-core', pattern: 'spark', color: '#5ee7ff', intensity: 0.6, persistence: 'lasting', nonce: newNonce(), ...patch });
const guestActor = (n = 1) => ({ id: `guest-${n}`, isAnonymous: true });

describe('demo engine (mirror of submit_trace)', () => {
  it('starts with a non-empty seeded world', () => {
    const s = createInitialState(T0);
    const snap = snapshot(s, T0);
    expect(snap.regions).toHaveLength(6);
    expect(snap.world.total_traces).toBe(0);
    expect(s.discoveries[0].origin).toBe('seeded');
  });

  it('accepts a trace and records milestones', () => {
    const s = createInitialState(T0);
    const r = submitTrace(s, guestActor(), draft(), T0);
    expect(r.ok).toBe(true);
    expect(r.milestones.map((m) => m.type)).toEqual(expect.arrayContaining(['first_trace', 'region_first_trace', 'stage_advanced']));
    expect(snapshot(s, T0).world.total_traces).toBe(1);
  });

  it('rejects sessions-less and invalid traces', () => {
    const s = createInitialState(T0);
    expect(submitTrace(s, null, draft(), T0).code).toBe('no_session');
    expect(submitTrace(s, guestActor(), draft({ color: 'x' }), T0).code).toBe('invalid_parameters');
    expect(submitTrace(s, guestActor(), draft({ regionSlug: 'nowhere' }), T0).code).toBe('unknown_region');
  });

  it('prevents duplicate submissions with the same nonce', () => {
    const s = createInitialState(T0);
    const d = draft();
    const a = submitTrace(s, guestActor(), d, T0);
    const b = submitTrace(s, guestActor(), d, T0 + 60e3);
    expect(b.duplicate).toBe(true);
    expect(b.trace_id).toBe(a.trace_id);
    expect(s.traces).toHaveLength(1);
  });

  it('enforces cooldown and hourly limits', () => {
    const s = createInitialState(T0);
    expect(submitTrace(s, guestActor(), draft(), T0).ok).toBe(true);
    const cool = submitTrace(s, guestActor(), draft(), T0 + 5e3);
    expect(cool).toMatchObject({ ok: false, code: 'cooldown', retry_after: 15 });
    let t = T0;
    let last;
    for (let i = 0; i < 12; i++) {
      t += 21e3;
      last = submitTrace(s, guestActor(), draft(), t);
    }
    expect(last.code).toBe('hourly_limit');
  });

  it('evolves and grows a frontier region with distinct visitors', () => {
    const s = createInitialState(T0);
    let t = T0;
    for (let i = 0; i < 20; i++) {
      t += 1000;
      submitTrace(s, guestActor(i % 5), draft(), t + Math.floor(i / 5) * 30e3);
    }
    const snap = snapshot(s, t + 200e3);
    expect(snap.world.evolution_stage).toBeGreaterThanOrEqual(1);
    // 20 traces from 5 visitors within cooldowns may need more time; run until stage 2.
    let n = 0;
    while (snapshot(s, t).world.evolution_stage < 2 && n < 100) {
      t += 25e3;
      submitTrace(s, guestActor(n % 5), draft(), t);
      n++;
    }
    expect(snapshot(s, t).world.evolution_stage).toBe(2);
    expect(s.regions.some((r) => r.origin === 'system')).toBe(true);
    expect(s.snapshots.length).toBeGreaterThan(1);
  });

  it('daily feature falls back to a labelled featured region', () => {
    const s = createInitialState(T0);
    expect(dailyFeature(s, T0).rule).toBe('featured_region');
    submitTrace(s, guestActor(), draft(), T0);
    expect(dailyFeature(s, T0).rule).toBe('recent_discovery');
    expect(dailyFeature(s, T0 + 86400e3).rule).toBe('participant_discovery_yesterday');
  });
});
