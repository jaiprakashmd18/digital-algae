/**
 * Discoveries, timeline and region reads, with small in-memory caches for
 * back/forward navigation.
 */
import { api } from '../lib/api.js';
import { onWorldEvent, regionById } from './world-service.js';

const cache = new Map();
const TTL = 30e3;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateDiscoveries() {
  cache.clear();
}

// Any new world event can change counts and lists; drop cached reads.
onWorldEvent(() => cache.clear());

export function listDiscoveries(opts) {
  return cached(`list:${JSON.stringify(opts)}`, () => api().listDiscoveries(opts));
}

export function getDiscovery(slug) {
  return cached(`d:${slug}`, () => api().getDiscovery(slug));
}

export function getRegionDetail(slug) {
  return cached(`r:${slug}`, () => api().getRegion(slug));
}

export function listTimeline({ beforeId = null, types = null, limit = 25 } = {}) {
  return api().listEvents({ beforeId, limit, types, excludeTypes: types ? null : ['trace'] });
}

export function listRegionEvents(regionId, limit = 12) {
  return api().listEvents({ regionId, limit });
}

export function getDailyFeature() {
  return cached('daily', () => api().getDailyFeature());
}

export function regionSlugFor(item) {
  return regionById(item?.region_id)?.slug ?? item?.payload?.region_slug ?? null;
}

export const DISCOVERY_KINDS = Object.freeze({
  initial_structure: 'Initial structure',
  first_trace: 'First trace',
  region_first_trace: 'Region awakened',
  region_surge: 'Surge',
  region_level: 'New branches',
  stage_advanced: 'Evolution',
  region_born: 'New region',
  energy_milestone: 'Energy milestone',
  community_event: 'Convergence',
});

export const EVENT_LABELS = Object.freeze({
  world_seeded: 'World generated',
  trace: 'Trace',
  first_trace: 'First trace',
  region_first_trace: 'Region awakened',
  region_surge: 'Surge',
  region_level: 'New branches',
  stage_advanced: 'Evolution',
  region_born: 'New region',
  energy_milestone: 'Energy milestone',
  community_event_started: 'Convergence began',
  community_event_completed: 'Convergence completed',
  community_event_expired: 'Convergence ended',
});
