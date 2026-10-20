import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, decayEnergy, globalEnergy, liveRegionEnergy, nextStageProgress, regionLevelFor, regionStateFor,
  stageFor, traceGain,
} from '../../src/lib/world-model.js';

const H = 3600e3;

describe('energy', () => {
  it('halves after one half-life and never leaves 0..100', () => {
    const t0 = Date.UTC(2026, 0, 1);
    expect(decayEnergy(80, t0, 6, t0)).toBe(80);
    expect(decayEnergy(80, t0, 6, t0 + 6 * H)).toBe(40);
    expect(decayEnergy(80, t0, 6, t0 + 12 * H)).toBe(20);
    expect(decayEnergy(500, t0, 6, t0)).toBe(100);
    expect(decayEnergy(-5, t0, 6, t0)).toBe(0);
    // Clock skew (future timestamp) never increases energy.
    expect(decayEnergy(50, t0 + H, 6, t0)).toBe(50);
  });

  it('decays to a calm state after inactivity', () => {
    const t0 = Date.UTC(2026, 0, 1);
    expect(regionStateFor(decayEnergy(100, t0, 2, t0 + 24 * H))).toBe('dormant');
  });

  it('global energy is the mean of live region energies', () => {
    const now = Date.now();
    const regions = [
      { type: 'core', stored_energy: 60, energy_at: new Date(now).toISOString() },
      { type: 'pulse', stored_energy: 20, energy_at: new Date(now).toISOString() },
    ];
    expect(globalEnergy(regions, now)).toBe(40);
    expect(globalEnergy([], now)).toBe(0);
    expect(liveRegionEnergy({ type: 'pulse', stored_energy: 20, energy_at: new Date(now - 2 * H).toISOString() }, now)).toBe(10);
  });
});

describe('gain', () => {
  it('scales with intensity and archetype, with diminishing returns', () => {
    expect(traceGain(0.1, 'core')).toBe(2.4);
    expect(traceGain(1, 'core')).toBe(6);
    expect(traceGain(1, 'pulse')).toBe(8.1);
    expect(traceGain(1, 'core', 1)).toBe(3.6);
    expect(traceGain(1, 'core', 2)).toBe(2.16);
    expect(traceGain(0.5, ARCHETYPES.resonance, 0, true)).toBe(6);
    // A single trace can never exceed 100 energy on its own.
    expect(traceGain(1, 'pulse', 0, true)).toBeLessThan(100);
  });
});

describe('states, levels, stages', () => {
  it('maps energy to states', () => {
    expect([0, 5, 20, 45, 75, 100].map(regionStateFor)).toEqual(['dormant', 'stirring', 'active', 'surging', 'resonant', 'resonant']);
  });
  it('maps trace counts to levels', () => {
    expect([0, 9, 10, 40, 120, 400, 1200, 99999].map(regionLevelFor)).toEqual([0, 0, 1, 2, 3, 4, 5, 5]);
  });
  it('needs both traces and distinct contributors to evolve', () => {
    expect(stageFor(0, 0)).toBe(0);
    expect(stageFor(1, 1)).toBe(1);
    expect(stageFor(5000, 1)).toBe(1);
    expect(stageFor(20, 5)).toBe(2);
    expect(stageFor(2500, 200)).toBe(5);
    expect(nextStageProgress(5, 0, 0)).toBeNull();
    expect(nextStageProgress(1, 10, 5)).toMatchObject({ traces: 0.5, contributors: 1 });
  });
});
