/**
 * World model: the formulas that govern the organism.
 *
 * These mirror the SQL functions in supabase/migrations/…_world_engine.sql.
 * The database is authoritative; this module lets the client display live
 * decay between server updates and powers the local demo backend.
 * tests/db/formulas.test.js asserts both implementations agree.
 */

export const ENERGY_MAX = 100;

export const ARCHETYPES = Object.freeze({
  core: { label: 'Core', gainMultiplier: 1.0, halfLifeHours: 6, resonanceBonus: 0 },
  pulse: { label: 'Pulse', gainMultiplier: 1.35, halfLifeHours: 2, resonanceBonus: 0 },
  quiet: { label: 'Quiet', gainMultiplier: 0.7, halfLifeHours: 12, resonanceBonus: 0 },
  memory: { label: 'Memory', gainMultiplier: 0.85, halfLifeHours: 24, resonanceBonus: 0 },
  frontier: { label: 'Frontier', gainMultiplier: 1.15, halfLifeHours: 4, resonanceBonus: 0 },
  resonance: { label: 'Resonance', gainMultiplier: 1.0, halfLifeHours: 6, resonanceBonus: 0.5 },
});

export const REGION_STATES = Object.freeze([
  { id: 'dormant', label: 'Dormant', min: 0 },
  { id: 'stirring', label: 'Stirring', min: 5 },
  { id: 'active', label: 'Active', min: 20 },
  { id: 'surging', label: 'Surging', min: 45 },
  { id: 'resonant', label: 'Resonant', min: 75 },
]);

export const LEVEL_THRESHOLDS = Object.freeze([10, 40, 120, 400, 1200]);

export const STAGES = Object.freeze([
  { stage: 0, name: 'Dormant Seed', traces: 0, contributors: 0, summary: 'The generated starting structure, waiting for its first visitor.' },
  { stage: 1, name: 'First Light', traces: 1, contributors: 1, summary: 'The first accepted trace wakes the organism.' },
  { stage: 2, name: 'Mycelium', traces: 20, contributors: 5, summary: 'Threads spread between regions and a new frontier region forms.' },
  { stage: 3, name: 'Bloom', traces: 120, contributors: 15, summary: 'The structure flowers and a resonance field opens.' },
  { stage: 4, name: 'Canopy', traces: 600, contributors: 60, summary: 'A fast-moving canopy layer grows over the older regions.' },
  { stage: 5, name: 'Sentience', traces: 2500, contributors: 200, summary: 'A deep, persistent shoal forms. The organism holds its shape.' },
]);

export const TRACE_PATTERNS = Object.freeze(['spark', 'spiral', 'ripple', 'bloom', 'filament']);
export const TRACE_PERSISTENCE = Object.freeze(['fleeting', 'lasting']);

/** Server-enforced limits (shown to visitors; the database is the authority). */
export const LIMITS = Object.freeze({
  guest: { cooldownSeconds: 20, perHour: 12, perDay: 40 },
  account: { cooldownSeconds: 10, perHour: 30, perDay: 120 },
  diminishingFactor: 0.6,
  resonanceWindowMinutes: 10,
  surgeRepeatHours: 6,
  globalPerMinute: 600,
});

const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Energy after exponential decay. Times are ms epoch or Date/ISO strings. */
export function decayEnergy(energy, since, halfLifeHours, at = Date.now()) {
  const elapsed = Math.max(0, (toMs(at) - toMs(since)) / 1000);
  const value = energy * Math.pow(0.5, elapsed / (halfLifeHours * 3600));
  return round2(clamp(value, 0, ENERGY_MAX));
}

export function regionStateFor(energy) {
  let state = REGION_STATES[0];
  for (const s of REGION_STATES) if (energy >= s.min) state = s;
  return state.id;
}

export function regionStateLabel(id) {
  return REGION_STATES.find((s) => s.id === id)?.label ?? 'Unknown';
}

export function regionLevelFor(traceCount) {
  let level = 0;
  for (const t of LEVEL_THRESHOLDS) if (traceCount >= t) level += 1;
  return level;
}

export function stageFor(traces, contributors) {
  let stage = 0;
  for (const s of STAGES) if (traces >= s.traces && contributors >= s.contributors) stage = s.stage;
  return stage;
}

export function stageName(stage) {
  return STAGES[stage]?.name ?? 'Unknown';
}

/** Progress toward the next stage as a fraction 0..1 for each requirement. */
export function nextStageProgress(stage, traces, contributors) {
  const next = STAGES[stage + 1];
  if (!next) return null;
  return {
    next,
    traces: Math.min(1, traces / next.traces),
    contributors: Math.min(1, contributors / next.contributors),
  };
}

export function traceGain(intensity, archetype, recentSameActor = 0, resonanceMatch = false) {
  const a = typeof archetype === 'string' ? ARCHETYPES[archetype] : archetype;
  const n = clamp(recentSameActor, 0, 20);
  const bonus = resonanceMatch ? 1 + a.resonanceBonus : 1;
  return round2((2 + 4 * intensity) * a.gainMultiplier * Math.pow(LIMITS.diminishingFactor, n) * bonus);
}

/** Mean decayed energy over regions. */
export function globalEnergy(regions, at = Date.now()) {
  if (!regions.length) return 0;
  const sum = regions.reduce((acc, r) => acc + liveRegionEnergy(r, at), 0);
  return round2(sum / regions.length);
}

/** A region's energy right now, from its stored value and timestamp. */
export function liveRegionEnergy(region, at = Date.now()) {
  const hl = region.half_life_hours ?? ARCHETYPES[region.type]?.halfLifeHours ?? 6;
  const base = region.stored_energy ?? region.energy ?? 0;
  const since = region.energy_at ?? at;
  return decayEnergy(Number(base), since, Number(hl), at);
}

function toMs(t) {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return new Date(t).getTime();
}
