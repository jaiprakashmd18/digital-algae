/**
 * Demo backend. Used when no Supabase project is configured (or
 * VITE_DEMO_MODE=true). The world is stored in this browser's localStorage
 * and "realtime" spans only this browser's tabs (BroadcastChannel). The
 * interface labels this clearly; nothing here is presented as global data.
 */
import * as engine from './demo-engine.js';
import { ApiError } from '../utils/errors.js';
import { localGet, localSet } from '../utils/preferences.js';

const STATE_KEY = 'io:demo:world:v1';
const ACTOR_KEY = 'io:demo:actor:v1';
const SAVED_KEY = 'io:demo:saved:v1';

export function createDemoBackend({ storage = { get: localGet, set: localSet }, now = () => Date.now() } = {}) {
  let state = storage.get(STATE_KEY) ?? engine.createInitialState(now());
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('io-demo') : null;
  const tabId = Math.random().toString(36).slice(2);
  const tabs = new Map();
  const persist = () => storage.set(STATE_KEY, state);
  persist();

  function reload() {
    state = storage.get(STATE_KEY) ?? state;
  }

  function actor() {
    let a = storage.get(ACTOR_KEY);
    if (!a) {
      a = { id: `demo-guest-${crypto.randomUUID()}`, isAnonymous: true };
      storage.set(ACTOR_KEY, a);
    }
    return a;
  }

  const listEventsLocal = ({ afterId = null, beforeId = null, limit = 30, types = null, regionId = null, excludeTypes = null } = {}) => {
    let list = state.events.filter((e) => !e.hidden);
    if (afterId != null) list = list.filter((e) => e.id > afterId);
    if (beforeId != null) list = list.filter((e) => e.id < beforeId);
    if (types?.length) list = list.filter((e) => types.includes(e.event_type));
    if (excludeTypes?.length) list = list.filter((e) => !excludeTypes.includes(e.event_type));
    if (regionId) list = list.filter((e) => e.region_id === regionId);
    list = afterId != null ? list.sort((a, b) => a.id - b.id) : list.sort((a, b) => b.id - a.id);
    return list.slice(0, limit).map(publicEvent);
  };

  const backend = {
    mode: 'demo',

    async getSnapshot() {
      reload();
      const s = engine.snapshot(state, now());
      persist();
      return s;
    },
    async listEvents(opts) {
      reload();
      return listEventsLocal(opts);
    },
    async listDiscoveries({ page = 1, pageSize = 12, kind = null, origin = null, search = '', regionId = null } = {}) {
      reload();
      let list = [...state.discoveries].sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (kind) list = list.filter((d) => d.kind === kind);
      if (origin) list = list.filter((d) => d.origin === origin);
      if (regionId) list = list.filter((d) => d.region_id === regionId);
      const term = search.trim().toLowerCase();
      if (term) list = list.filter((d) => d.title.toLowerCase().includes(term));
      return { items: list.slice((page - 1) * pageSize, page * pageSize), total: list.length };
    },
    async getDiscovery(slug) {
      reload();
      const d = state.discoveries.find((x) => x.slug === slug);
      if (!d) return null;
      const event = state.events.find((e) => e.id === d.world_event_id);
      return { ...d, event: event ? publicEvent(event) : null };
    },
    async discoveriesForEvents(eventIds) {
      reload();
      return state.discoveries.filter((d) => eventIds.includes(d.world_event_id)).map((d) => ({ slug: d.slug, world_event_id: d.world_event_id }));
    },
    async getRegion(slug) {
      reload();
      const r = state.regions.find((x) => x.slug === slug);
      if (!r) return null;
      const t = now();
      const traces = state.traces.filter((x) => x.region_id === r.id);
      const since = (ms) => traces.filter((x) => Date.parse(x.created_at) > t - ms);
      const distinct = (arr) => new Set(arr.map((x) => x.actor_id)).size;
      return {
        ...engine.regionJson(state, r, t),
        archetype: { label: r.type[0].toUpperCase() + r.type.slice(1), description: '' },
        stats: {
          traces_24h: since(86400e3).length, contributors_24h: distinct(since(86400e3)), contributors_7d: distinct(since(7 * 86400e3)),
          discoveries: state.discoveries.filter((d) => d.region_id === r.id).length,
        },
      };
    },
    async listSnapshots() {
      reload();
      return [...state.snapshots].reverse().map((s) => ({ state_version: s.state_version, evolution_stage: s.evolution_stage, reason: s.reason, created_at: s.created_at }));
    },
    async getWorldSnapshotVersion(version) {
      reload();
      return state.snapshots.find((s) => s.state_version === version) ?? null;
    },
    async listCommunityEvents({ limit = 14 } = {}) {
      reload();
      return [...state.communityEvents].reverse().slice(0, limit);
    },
    async getDailyFeature() {
      reload();
      return engine.dailyFeature(state, now());
    },

    async submitTrace(draft) {
      reload();
      const before = state.nextEventId;
      const result = engine.submitTrace(state, actor(), draft, now());
      if (result && !result.ok && result.retry_after) result.retryAfter = result.retry_after;
      persist();
      const fresh = state.events.filter((e) => e.id >= before).map(publicEvent);
      channel?.postMessage({ type: 'events', events: fresh });
      queueMicrotask(() => fresh.forEach((e) => listeners.forEach((l) => l.onEvent?.(e))));
      return result;
    },

    subscribe(handlers) {
      listeners.add(handlers);
      handlers.onStatus?.('demo');
      const ping = () => channel?.postMessage({ type: 'presence', tabId, at: Date.now() });
      const countTabs = () => {
        const cutoff = Date.now() - 12e3;
        for (const [id, at] of tabs) if (at < cutoff) tabs.delete(id);
        handlers.onPresence?.(tabs.size + 1);
      };
      const onMessage = (msg) => {
        const data = msg.data;
        if (data?.type === 'events') {
          reload();
          data.events.forEach((e) => handlers.onEvent?.(e));
        } else if (data?.type === 'presence') {
          tabs.set(data.tabId, data.at);
          countTabs();
        }
      };
      channel?.addEventListener('message', onMessage);
      ping();
      countTabs();
      const timer = setInterval(() => {
        ping();
        countTabs();
      }, 5000);
      return () => {
        listeners.delete(handlers);
        channel?.removeEventListener('message', onMessage);
        clearInterval(timer);
      };
    },

    async getUser() {
      return null;
    },
    onAuthChange() {
      return () => {};
    },
    async ensureSession() {
      return { ok: true, user: { id: actor().id, is_anonymous: true } };
    },
    async signUp() {
      return { ok: false, code: 'demo_mode' };
    },
    async signIn() {
      return { ok: false, code: 'demo_mode' };
    },
    async signInWithOAuth() {
      return { ok: false, code: 'demo_mode' };
    },
    async signOut() {
      return { ok: false, code: 'demo_mode' };
    },
    async requestPasswordReset() {
      return { ok: false, code: 'demo_mode' };
    },
    async updatePassword() {
      return { ok: false, code: 'demo_mode' };
    },

    async getAccount() {
      reload();
      const a = actor();
      const mine = state.traces.filter((t) => t.actor_id === a.id);
      return {
        id: a.id, display_name: engine.demoAlias(a.id), avatar_preferences: {}, roles: [],
        trace_count: mine.length, regions_touched: new Set(mine.map((t) => t.region_id)).size,
        first_trace_at: mine[0]?.created_at ?? null, discoveries_triggered: 0, entitlements: [],
      };
    },
    async updateProfile() {
      return { ok: false, code: 'demo_mode' };
    },
    async listMyTraces({ limit = 50 } = {}) {
      reload();
      const a = actor();
      return state.traces.filter((t) => t.actor_id === a.id).reverse().slice(0, limit);
    },
    async listSaved() {
      reload();
      const saved = storage.get(SAVED_KEY) ?? [];
      return saved.map((s) => ({ ...s, discoveries: state.discoveries.find((d) => d.id === s.discovery_id) })).filter((s) => s.discoveries);
    },
    async saveDiscovery(discoveryId) {
      const saved = storage.get(SAVED_KEY) ?? [];
      if (!saved.some((s) => s.discovery_id === discoveryId)) saved.unshift({ discovery_id: discoveryId, created_at: new Date(now()).toISOString() });
      storage.set(SAVED_KEY, saved);
      return { ok: true };
    },
    async unsaveDiscovery(discoveryId) {
      storage.set(SAVED_KEY, (storage.get(SAVED_KEY) ?? []).filter((s) => s.discovery_id !== discoveryId));
      return { ok: true };
    },
    async getRemotePreferences() {
      return null;
    },
    async saveRemotePreferences() {
      return { ok: false, code: 'demo_mode' };
    },
    async deleteAccount() {
      return { ok: false, code: 'demo_mode' };
    },
    async submitReport() {
      return { ok: false, code: 'demo_mode' };
    },
    async admin() {
      throw new ApiError('demo_mode');
    },
    logError() {},
    track() {},
    async getSupporterWall() {
      return [];
    },
    async startCheckout() {
      return { ok: false, code: 'demo_mode' };
    },
    /** Demo only: wipe the local world. */
    resetDemoWorld() {
      state = engine.createInitialState(now());
      persist();
    },
  };
  const listeners = new Set();
  return backend;
}

function publicEvent(e) {
  const rest = { ...e };
  delete rest.hidden;
  return rest;
}
