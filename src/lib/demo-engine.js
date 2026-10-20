/**
 * Demo engine: a faithful JavaScript port of the database world engine,
 * operating on a plain state object. Used only in demo mode (no Supabase
 * configured), where the world lives in this browser and is never shared.
 * Time is injected so the logic is testable.
 */
import {
  ARCHETYPES, LIMITS, STAGES, decayEnergy, globalEnergy, regionLevelFor, regionStateFor,
  stageFor, stageName, traceGain,
} from './world-model.js';
import { BORN_REGIONS, INITIAL_REGIONS, WORLD_SEED } from './initial-world.js';
import { validateTrace } from './validation.js';

const HOUR = 3600e3;
const DAY = 24 * HOUR;

export function utcDayStart(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function demoAlias(actorId) {
  const prefixes = ['Drifter', 'Wanderer', 'Spore', 'Signal', 'Lumen', 'Echo', 'Tendril', 'Ember'];
  const h = hash(`alias:${actorId}`);
  return `${prefixes[h % 8]}-${(h >>> 8).toString(16).toUpperCase().padStart(6, '0').slice(0, 4)}`;
}

function structure(state) {
  return state.regions.map((r) => ({
    slug: r.slug, name: r.name, type: r.type, seed: r.seed, hue: r.hue, level: r.level, anchor: r.anchor, parent: r.parent,
  }));
}

export function createInitialState(now = Date.now()) {
  const state = {
    schema: 1,
    world: {
      state_version: 1, evolution_stage: 0, total_traces: 0, unique_contributors: 0, world_seed: WORLD_SEED,
      stage_changed_at: iso(now), energy_milestone_day: null, energy_milestone_level: 0,
    },
    regions: INITIAL_REGIONS.map((r, i) => ({
      ...r, anchor: [...r.anchor], id: `demo-${r.slug}`, origin: 'seeded', unlocked_at_stage: 0,
      stored_energy: 0, energy_at: iso(now), level: 0, trace_count: 0, contributor_count: 0,
      last_trace_at: null, last_trace_pattern: null, last_trace_actor: null, last_surge_at: null,
      created_at: iso(now + i), contributors: [],
    })),
    events: [],
    nextEventId: 1,
    traces: [],
    actors: [],
    discoveries: [],
    snapshots: [],
    communityEvents: [],
    rateLimitRejections: 0,
  };
  const ev = emit(state, 'world_seeded', 'seeded', null, { regions: 6, world_seed: WORLD_SEED }, now);
  state.discoveries.push({
    id: 'demo-initial-structure', slug: 'initial-structure', kind: 'initial_structure', origin: 'seeded',
    region_id: null, world_event_id: ev.id, title: 'The initial structure',
    description: 'The organism began as six generated regions around a central Core. This structure was created by the system from fixed seeds, not by visitors. Every change since then comes from real, recorded traces.',
    triggered_by_alias: null, state_version: 1, created_at: iso(now),
  });
  state.snapshots.push({ state_version: 1, evolution_stage: 0, world_seed: WORLD_SEED, structure: structure(state), reason: 'Initial generated structure', created_at: iso(now) });
  return state;
}

function emit(state, type, origin, regionId, payload, now) {
  const ev = { id: state.nextEventId++, event_type: type, origin, region_id: regionId, payload, state_version: state.world.state_version, hidden: false, created_at: iso(now) };
  state.events.push(ev);
  if (state.events.length > 3000) state.events.splice(0, state.events.length - 3000);
  return ev;
}

function discovery(state, slug, kind, origin, regionId, eventId, title, description, alias, now) {
  let s = slug;
  let i = 2;
  while (state.discoveries.some((d) => d.slug === s)) s = `${slug}-${i++}`;
  state.discoveries.push({ id: `demo-${s}`, slug: s, kind, origin, region_id: regionId, world_event_id: eventId, title, description, triggered_by_alias: alias, state_version: state.world.state_version, created_at: iso(now) });
  return s;
}

function recordSnapshot(state, reason, now) {
  state.world.state_version += 1;
  state.snapshots.push({ state_version: state.world.state_version, evolution_stage: state.world.evolution_stage, world_seed: state.world.world_seed, structure: structure(state), reason, created_at: iso(now) });
}

function birthRegion(state, stage, now) {
  const def = BORN_REGIONS[stage];
  if (!def) return null;
  const slug = def.name.replace(/^The /, '').toLowerCase().replace(/\s+/g, '-');
  if (state.regions.some((r) => r.slug === slug)) return null;
  const seed = hash(`born:${stage}`);
  const angle = ((seed % 360) * Math.PI) / 180;
  const radius = 8.5 + stage;
  const region = {
    slug, name: def.name, type: def.type, description: def.description, seed, hue: def.hue,
    anchor: [Math.round(radius * Math.cos(angle) * 100) / 100, (Math.floor(seed / 360) % 9) - 4, Math.round(radius * Math.sin(angle) * 100) / 100],
    parent: 'the-core', id: `demo-${slug}`, origin: 'system', unlocked_at_stage: stage, stored_energy: 0, energy_at: iso(now),
    level: 0, trace_count: 0, contributor_count: 0, last_trace_at: null, last_trace_pattern: null, last_trace_actor: null,
    last_surge_at: null, created_at: iso(now), contributors: [],
  };
  state.regions.push(region);
  return region;
}

export function ensureDailyCommunityEvent(state, now) {
  for (const ce of state.communityEvents) {
    if (ce.status === 'active' && Date.parse(ce.ends_at) <= now) {
      ce.status = 'expired';
      emit(state, 'community_event_expired', 'system', ce.region_id, { community_event: ce.slug, title: ce.title, goal_target: ce.goal_target, progress: progressOf(state, ce) }, now);
    }
  }
  const dayStart = utcDayStart(now);
  const slug = `convergence-${new Date(dayStart).toISOString().slice(0, 10)}`;
  let ce = state.communityEvents.find((c) => c.slug === slug);
  if (ce) return ce;
  const region = [...state.regions].sort((a, b) => hash(slug + a.slug) - hash(slug + b.slug))[0];
  const week = new Set(state.traces.filter((t) => Date.parse(t.created_at) >= dayStart - 7 * DAY && Date.parse(t.created_at) < dayStart).map((t) => t.actor_id));
  const target = Math.max(3, Math.min(25, Math.ceil((week.size / 7) * 0.6)));
  ce = {
    id: `demo-${slug}`, slug, title: `Convergence in ${region.name}`,
    description: `If ${target} different visitors leave a trace in ${region.name} before the end of the UTC day, the region converges and the moment is recorded in the organism's memory.`,
    region_id: region.id, goal_type: 'unique_contributors', goal_target: target, starts_at: iso(dayStart), ends_at: iso(dayStart + DAY), status: 'active', completed_at: null,
  };
  state.communityEvents.push(ce);
  emit(state, 'community_event_started', 'system', region.id, { community_event: slug, title: ce.title, goal_target: target, region_slug: region.slug }, now);
  return ce;
}

function progressOf(state, ce) {
  const s = Date.parse(ce.starts_at);
  const e = Date.parse(ce.ends_at);
  return new Set(state.traces.filter((t) => t.region_id === ce.region_id && Date.parse(t.created_at) >= s && Date.parse(t.created_at) < e).map((t) => t.actor_id)).size;
}

/**
 * Mirrors public.submit_trace(). Mutates state and returns the same result
 * shape. `actor` is { id, kind: 'anonymous' | 'account', alias } (or legacy { isAnonymous }).
 */
export function submitTrace(state, actor, draft, now = Date.now()) {
  if (!actor?.id) return { ok: false, code: 'no_session' };
  const v = validateTrace(draft);
  if (!v.ok) return { ok: false, code: 'invalid_parameters', field: v.field };
  const { regionSlug, pattern, color, intensity, persistence, nonce } = v.value;
  const region = state.regions.find((r) => r.slug === regionSlug);
  if (!region) return { ok: false, code: 'unknown_region' };

  const existing = state.traces.find((t) => t.actor_id === actor.id && t.client_nonce === nonce);
  if (existing) {
    return { ok: true, duplicate: true, trace_id: existing.id, event_id: existing.world_event_id, energy_gain: existing.energy_gain, region: { slug: regionSlug } };
  }

  const limits = actor.kind === 'anonymous' ? LIMITS.anonymous : actor.kind === 'account' || !actor.isAnonymous ? LIMITS.account : LIMITS.guest;
  const mine = state.traces.filter((t) => t.actor_id === actor.id && Date.parse(t.created_at) > now - DAY);
  const last = mine.reduce((m, t) => Math.max(m, Date.parse(t.created_at)), 0);
  const inHour = mine.filter((t) => Date.parse(t.created_at) > now - HOUR);
  const today = mine.filter((t) => Date.parse(t.created_at) >= utcDayStart(now));
  if (last && last > now - limits.cooldownSeconds * 1000) {
    state.rateLimitRejections++;
    return { ok: false, code: 'cooldown', retry_after: Math.ceil((last + limits.cooldownSeconds * 1000 - now) / 1000) };
  }
  if (inHour.length >= limits.perHour) {
    state.rateLimitRejections++;
    const oldest = Math.min(...inHour.map((t) => Date.parse(t.created_at)));
    return { ok: false, code: 'hourly_limit', retry_after: Math.ceil((oldest + HOUR - now) / 1000) };
  }
  if (today.length >= limits.perDay) {
    state.rateLimitRejections++;
    return { ok: false, code: 'daily_limit', retry_after: Math.ceil((utcDayStart(now) + DAY - now) / 1000) };
  }

  const arch = ARCHETYPES[region.type];
  const decayed = decayEnergy(region.stored_energy, region.energy_at, arch.halfLifeHours, now);
  const recentSame = state.traces.filter((t) => t.region_id === region.id && t.actor_id === actor.id && Date.parse(t.created_at) > now - HOUR).length;
  const match = arch.resonanceBonus > 0 && region.last_trace_pattern === pattern && region.last_trace_at
    && Date.parse(region.last_trace_at) > now - LIMITS.resonanceWindowMinutes * 60e3 && region.last_trace_actor !== actor.id;
  const gain = traceGain(intensity, arch, recentSame, Boolean(match));
  const energy = Math.min(100, Math.round((decayed + gain) * 100) / 100);
  const oldState = regionStateFor(decayed);
  const newState = regionStateFor(energy);
  const oldLevel = region.level;
  const newLevel = regionLevelFor(region.trace_count + 1);
  const newToRegion = !region.contributors.includes(actor.id);
  const newGlobal = !state.actors.includes(actor.id);
  const prevTraceCount = region.trace_count;
  const alias = actor.alias || demoAlias(actor.id);

  Object.assign(region, {
    stored_energy: energy, energy_at: iso(now), level: newLevel, trace_count: region.trace_count + 1,
    contributor_count: region.contributor_count + (newToRegion ? 1 : 0),
    last_trace_at: iso(now), last_trace_pattern: pattern, last_trace_actor: actor.id,
  });
  if (newToRegion) region.contributors.push(actor.id);
  if (newGlobal) state.actors.push(actor.id);

  const w = state.world;
  const prevTotal = w.total_traces;
  const prevStage = w.evolution_stage;
  w.total_traces += 1;
  w.unique_contributors += newGlobal ? 1 : 0;
  w.evolution_stage = Math.max(prevStage, stageFor(w.total_traces, w.unique_contributors));
  let born = null;
  if (w.evolution_stage > prevStage) {
    w.stage_changed_at = iso(now);
    born = birthRegion(state, w.evolution_stage, now);
  }
  if (w.evolution_stage > prevStage || newLevel > oldLevel) {
    recordSnapshot(state, w.evolution_stage > prevStage ? `Stage ${w.evolution_stage}: ${stageName(w.evolution_stage)}` : `${region.name} reached level ${newLevel}`, now);
  }

  const ev = emit(state, 'trace', 'participant', region.id, {
    alias, color, pattern, intensity, persistence, gain, resonance: Boolean(match), region_slug: region.slug,
    region_energy: energy, region_state: newState, region_level: newLevel, region_trace_count: region.trace_count,
    energy_at: iso(now), total_traces: w.total_traces, unique_contributors: w.unique_contributors, evolution_stage: w.evolution_stage,
  }, now);
  const trace = { id: `demo-trace-${ev.id}`, region_id: region.id, actor_id: actor.id, client_nonce: nonce, trace_type: pattern, color, intensity, persistence, energy_gain: gain, alias, world_event_id: ev.id, created_at: iso(now) };
  state.traces.push(trace);
  if (state.traces.length > 2000) state.traces.splice(0, state.traces.length - 2000);

  const milestones = [];
  const mark = (type, slug, extra = {}) => milestones.push({ type, discovery: slug, ...extra });
  if (prevTotal === 0) {
    const m = emit(state, 'first_trace', 'participant', region.id, { alias, region_slug: region.slug }, now);
    mark('first_trace', discovery(state, 'the-first-trace', 'first_trace', 'participant', region.id, m.id, 'The first trace',
      `The first trace ever accepted by the organism was left in ${region.name}. Everything that follows grew from this moment.`, alias, now));
  }
  if (prevTraceCount === 0) {
    const m = emit(state, 'region_first_trace', 'participant', region.id, { alias, region_slug: region.slug }, now);
    mark('region_first_trace', discovery(state, `first-trace-in-${region.slug}`, 'region_first_trace', 'participant', region.id, m.id, `First trace in ${region.name}`,
      `${region.name} received its first trace from a visitor. Until then it existed only as its initial generated structure.`, alias, now));
  }
  const surging = (s) => s === 'surging' || s === 'resonant';
  if (surging(newState) && !surging(oldState) && (!region.last_surge_at || Date.parse(region.last_surge_at) < now - LIMITS.surgeRepeatHours * HOUR)) {
    region.last_surge_at = iso(now);
    const m = emit(state, 'region_surge', 'participant', region.id, { alias, region_slug: region.slug, energy, state: newState }, now);
    const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-').toLowerCase();
    mark('region_surge', discovery(state, `${region.slug}-surge-${stamp}`, 'region_surge', 'participant', region.id, m.id, `${region.name} surged`,
      `Recent traces pushed ${region.name} above 45 energy. Its filaments brightened and its pulse quickened.`, alias, now));
  }
  if (newLevel > oldLevel) {
    const m = emit(state, 'region_level', 'participant', region.id, { alias, region_slug: region.slug, level: newLevel, trace_count: region.trace_count }, now);
    mark('region_level', discovery(state, `${region.slug}-level-${newLevel}`, 'region_level', 'participant', region.id, m.id, `${region.name} grew new branches`,
      `After ${region.trace_count} accepted traces, ${region.name} reached level ${newLevel} and grew a new layer of branches.`, alias, now));
  }
  if (w.evolution_stage > prevStage) {
    const name = stageName(w.evolution_stage);
    const m = emit(state, 'stage_advanced', 'participant', null, { alias, stage: w.evolution_stage, stage_name: name, total_traces: w.total_traces, unique_contributors: w.unique_contributors }, now);
    mark('stage_advanced', discovery(state, `stage-${w.evolution_stage}-${name.toLowerCase().replace(/\s+/g, '-')}`, 'stage_advanced', 'participant', null, m.id,
      `The organism entered ${name}`, `With ${w.total_traces} accepted traces from ${w.unique_contributors} distinct visitors, the organism evolved to stage ${w.evolution_stage}: ${name}.`, alias, now), { stage: w.evolution_stage });
    if (born) {
      const b = emit(state, 'region_born', 'system', born.id, { region_slug: born.slug, name: born.name, stage: w.evolution_stage }, now);
      mark('region_born', discovery(state, `born-${born.slug}`, 'region_born', 'system', born.id, b.id, `${born.name} formed`,
        `Reaching ${name} caused a new region to grow from The Core: ${born.name}. Its structure is generated from a fixed seed, so it forms the same way every time.`, null, now));
    }
  }

  const ce = ensureDailyCommunityEvent(state, now);
  if (ce && ce.status === 'active' && ce.region_id === region.id) {
    const progress = progressOf(state, ce);
    if (progress >= ce.goal_target) {
      ce.status = 'completed';
      ce.completed_at = iso(now);
      const m = emit(state, 'community_event_completed', 'participant', region.id, { community_event: ce.slug, title: ce.title, goal_target: ce.goal_target, progress, region_slug: region.slug, alias }, now);
      mark('community_event_completed', discovery(state, ce.slug, 'community_event', 'participant', region.id, m.id, `${ce.title} completed`,
        `${progress} different visitors left traces in ${region.name} on ${ce.starts_at.slice(0, 10)} (UTC). The region converged.`, alias, now));
    }
  }

  const g = globalEnergy(state.regions, now);
  const level = g >= 75 ? 75 : g >= 50 ? 50 : g >= 25 ? 25 : 0;
  const day = new Date(now).toISOString().slice(0, 10);
  if (level > 0 && (w.energy_milestone_day !== day || level > w.energy_milestone_level)) {
    w.energy_milestone_day = day;
    w.energy_milestone_level = level;
    const m = emit(state, 'energy_milestone', 'participant', null, { level, global_energy: g, alias }, now);
    if (level === 75) {
      mark('energy_milestone', discovery(state, `energy-75-${day}`, 'energy_milestone', 'participant', null, m.id, 'The whole organism glowed',
        'Average energy across every region passed 75 — the organism was brighter than it had been all day.', alias, now));
    } else milestones.push({ type: 'energy_milestone', level });
  }

  return {
    ok: true, duplicate: false, trace_id: trace.id, event_id: ev.id, alias, energy_gain: gain, resonance: Boolean(match),
    region: { slug: region.slug, name: region.name, energy, state: newState, level: newLevel },
    world: { total_traces: w.total_traces, unique_contributors: w.unique_contributors, evolution_stage: w.evolution_stage, state_version: w.state_version, global_energy: g },
    milestones, created_at: iso(now),
  };
}

export function regionJson(state, r, now) {
  const arch = ARCHETYPES[r.type];
  const energy = decayEnergy(r.stored_energy, r.energy_at, arch.halfLifeHours, now);
  return {
    id: r.id, slug: r.slug, name: r.name, type: r.type, description: r.description, seed: r.seed, hue: r.hue,
    anchor: r.anchor, parent: r.parent, origin: r.origin, unlocked_at_stage: r.unlocked_at_stage,
    energy, state: regionStateFor(energy), stored_energy: r.stored_energy, energy_at: r.energy_at,
    level: r.level, trace_count: r.trace_count, contributor_count: r.contributor_count, last_trace_at: r.last_trace_at,
    half_life_hours: arch.halfLifeHours, gain_multiplier: arch.gainMultiplier, resonance_bonus: arch.resonanceBonus, created_at: r.created_at,
  };
}

export function snapshot(state, now = Date.now()) {
  const ce = ensureDailyCommunityEvent(state, now);
  const dayStart = utcDayStart(now);
  const t = state.traces.map((x) => ({ ...x, at: Date.parse(x.created_at) }));
  const distinct = (arr) => new Set(arr.map((x) => x.actor_id)).size;
  const region = (id) => state.regions.find((r) => r.id === id);
  const meaningful = [...state.events].reverse().find((e) => e.event_type !== 'trace' && !e.hidden);
  return {
    server_time: iso(now),
    world: { ...pick(state.world, ['state_version', 'evolution_stage', 'stage_changed_at', 'total_traces', 'unique_contributors', 'world_seed']), stage_name: stageName(state.world.evolution_stage), global_energy: globalEnergy(state.regions, now) },
    regions: state.regions.map((r) => regionJson(state, r, now)),
    stats: {
      contributors_today: distinct(t.filter((x) => x.at >= dayStart)),
      traces_today: t.filter((x) => x.at >= dayStart).length,
      contributors_last_5m: distinct(t.filter((x) => x.at > now - 5 * 60e3)),
      traces_last_hour: t.filter((x) => x.at > now - HOUR).length,
      discoveries_total: state.discoveries.length,
      participant_discoveries: state.discoveries.filter((d) => d.origin === 'participant').length,
    },
    community_event: ce ? { slug: ce.slug, title: ce.title, description: ce.description, region_slug: region(ce.region_id)?.slug, region_name: region(ce.region_id)?.name, goal_target: ce.goal_target, progress: progressOf(state, ce), status: ce.status, starts_at: ce.starts_at, ends_at: ce.ends_at } : null,
    latest_event_id: state.nextEventId - 1,
    last_meaningful_event: meaningful ? { id: meaningful.id, event_type: meaningful.event_type, origin: meaningful.origin, payload: meaningful.payload, created_at: meaningful.created_at, region_slug: region(meaningful.region_id)?.slug } : null,
    flags: { traces_enabled: true, reports_enabled: false, community_events_enabled: true, membership_enabled: false },
  };
}

export function dailyFeature(state, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const dayStart = utcDayStart(now);
  const byHash = (a, b) => hash(day + a.slug) - hash(day + b.slug);
  const yesterday = state.discoveries.filter((d) => d.origin === 'participant' && Date.parse(d.created_at) >= dayStart - DAY && Date.parse(d.created_at) < dayStart).sort(byHash);
  if (yesterday.length) return { kind: 'discovery', rule: 'participant_discovery_yesterday', day, discovery: yesterday[0] };
  const recent = state.discoveries.filter((d) => d.kind !== 'initial_structure' && Date.parse(d.created_at) > now - 30 * DAY).sort(byHash);
  if (recent.length) return { kind: 'discovery', rule: 'recent_discovery', day, discovery: recent[0] };
  const regions = state.regions.map((r) => regionJson(state, r, now)).sort((a, b) => b.energy - a.energy || byHash(a, b));
  return { kind: 'region', rule: 'featured_region', day, region: regions[0] };
}

export function stageTable() {
  return STAGES;
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
