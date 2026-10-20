/**
 * World store: the client's view of the shared organism.
 *
 * Authoritative state comes from api().getSnapshot(). Realtime events are
 * applied incrementally through an EventLedger (no double application), and
 * the store reconciles with the database after reconnects, when the tab
 * becomes visible again, when a structural change is announced, and every
 * few minutes as a safety net.
 */
import { api } from '../lib/api.js';
import { EventLedger } from '../lib/realtime.js';
import { INITIAL_REGIONS } from '../lib/initial-world.js';
import { ARCHETYPES } from '../lib/world-model.js';

const RECONCILE_INTERVAL_MS = 5 * 60e3;
const RECENT_LIMIT = 60;

const listeners = { change: new Set(), event: new Set() };
const ledger = new EventLedger();

const store = {
  status: 'loading', // loading | ready | error
  connection: 'connecting',
  presence: null,
  snapshot: null,
  regions: [],
  recent: [], // newest first, public world events
  traceMarks: [], // recent trace events for visual marks
  error: null,
  fetchedAt: 0,
};

let unsubscribe = null;
let refreshTimer = null;
let intervalTimer = null;
let hiddenAt = 0;

export function world() {
  return store;
}

export function onWorldChange(fn) {
  listeners.change.add(fn);
  return () => listeners.change.delete(fn);
}

/** Fires for every newly applied world event (after dedupe). */
export function onWorldEvent(fn) {
  listeners.event.add(fn);
  return () => listeners.event.delete(fn);
}

function emitChange() {
  for (const fn of listeners.change) fn(store);
}

/** Resolves once the first snapshot attempt has finished (success or not). */
export function whenReady() {
  if (store.status !== 'loading') return Promise.resolve(store);
  return new Promise((resolve) => {
    const off = onWorldChange((s) => {
      if (s.status !== 'loading') {
        off();
        resolve(s);
      }
    });
  });
}

export function regionBySlug(slug) {
  return store.regions.find((r) => r.slug === slug) ?? null;
}

export function regionById(id) {
  return store.regions.find((r) => r.id === id) ?? null;
}

/** Fallback structure so the organism is never empty, even offline. */
function fallbackRegions() {
  return INITIAL_REGIONS.map((r) => ({
    ...r, id: null, energy: 0, stored_energy: 0, energy_at: new Date().toISOString(), state: 'dormant', level: 0,
    trace_count: 0, contributor_count: 0, origin: 'seeded', half_life_hours: ARCHETYPES[r.type].halfLifeHours,
  }));
}

export async function startWorld() {
  store.regions = fallbackRegions();
  emitChange();
  await refreshSnapshot();
  await loadRecent();
  unsubscribe = api().subscribe({
    onEvent: (e) => applyEvents([e]),
    onCommunityEvent: () => scheduleRefresh(500),
    onStatus: (s) => {
      store.connection = s;
      emitChange();
    },
    onRecovered: () => reconcile(),
    onPresence: (n) => {
      store.presence = n;
      emitChange();
    },
  });
  intervalTimer = setInterval(() => {
    if (document.visibilityState === 'visible') reconcile();
  }, RECONCILE_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibility);
}

export function stopWorld() {
  unsubscribe?.();
  clearInterval(intervalTimer);
  clearTimeout(refreshTimer);
  document.removeEventListener('visibilitychange', onVisibility);
}

function onVisibility() {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 60e3) reconcile();
}

export async function refreshSnapshot() {
  try {
    const snap = await api().getSnapshot();
    store.snapshot = snap;
    store.regions = snap.regions;
    store.status = 'ready';
    store.error = null;
    store.fetchedAt = Date.now();
    ledger.setBaseline(snap.latest_event_id);
  } catch (e) {
    store.status = store.snapshot ? 'ready' : 'error';
    store.error = e?.code ?? 'network';
    if (store.connection !== 'demo') store.connection = 'unavailable';
    scheduleRefresh(15000);
  }
  emitChange();
}

async function loadRecent() {
  try {
    const events = await api().listEvents({ limit: RECENT_LIMIT });
    // Mark as seen so realtime duplicates are ignored, without re-applying.
    for (const e of events) ledger.accept(e);
    store.recent = events;
    store.traceMarks = events.filter((e) => e.event_type === 'trace');
    emitChange();
  } catch {
    // Recent events are optional; the snapshot is enough to render.
  }
}

export async function reconcile() {
  try {
    let after = ledger.lastId;
    for (let page = 0; page < 5; page++) {
      const batch = await api().listEvents({ afterId: after, limit: 100 });
      applyEvents(batch, { quiet: batch.length > 20 });
      if (batch.length < 100) break;
      after = batch[batch.length - 1].id;
    }
  } catch {
    // Keep showing the last known state; the next reconcile will retry.
  }
  await refreshSnapshot();
}

function scheduleRefresh(ms = 1500) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshSnapshot, ms);
}

/**
 * Apply events (from realtime, catch-up fetches or a local submission).
 * Each event id is applied once. Returns the events that were new.
 */
export function applyEvents(events, { quiet = false } = {}) {
  const fresh = ledger.acceptMany(events);
  if (!fresh.length) return fresh;
  let structural = false;
  for (const e of fresh) {
    store.recent = [e, ...store.recent].slice(0, RECENT_LIMIT);
    if (e.event_type === 'trace') {
      applyTracePayload(e);
      store.traceMarks = [e, ...store.traceMarks].slice(0, 200);
    } else {
      structural = true;
    }
    if (store.snapshot && e.state_version > store.snapshot.world.state_version) structural = true;
    if (!quiet) for (const fn of listeners.event) fn(e);
  }
  if (store.snapshot && fresh.some((e) => e.event_type !== 'trace')) {
    store.snapshot.last_meaningful_event = toMeaningful([...fresh].reverse().find((e) => e.event_type !== 'trace')) ?? store.snapshot.last_meaningful_event;
  }
  scheduleRefresh(structural ? 800 : 8000);
  emitChange();
  return fresh;
}

function toMeaningful(e) {
  if (!e) return null;
  return { ...e, region_slug: regionById(e.region_id)?.slug ?? e.payload?.region_slug ?? null };
}

function applyTracePayload(e) {
  const p = e.payload ?? {};
  const region = regionBySlug(p.region_slug) ?? regionById(e.region_id);
  if (region) {
    region.stored_energy = Number(p.region_energy);
    region.energy = Number(p.region_energy);
    region.energy_at = p.energy_at ?? e.created_at;
    region.state = p.region_state ?? region.state;
    region.level = p.region_level ?? region.level;
    region.trace_count = p.region_trace_count ?? region.trace_count;
    region.last_trace_at = e.created_at;
  }
  const w = store.snapshot?.world;
  if (w) {
    if (p.total_traces > w.total_traces) w.total_traces = p.total_traces;
    if (p.unique_contributors > w.unique_contributors) w.unique_contributors = p.unique_contributors;
    if (p.evolution_stage > w.evolution_stage) w.evolution_stage = p.evolution_stage;
  }
}

/** For tests and the demo reset button. */
export function _ledger() {
  return ledger;
}
