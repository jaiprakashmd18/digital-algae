/**
 * Leave Your Trace: submission flow with idempotent retries.
 *
 * A draft gets a client nonce once. If the network fails mid-request the
 * outcome is unknown, so a retry reuses the same nonce: the server either
 * accepts it once or returns the original result (duplicate: true). Success
 * is shown only when the server says ok.
 */
import { api } from '../lib/api.js';
import { newNonce } from '../lib/validation.js';
import { applyEvents, regionBySlug, world } from './world-service.js';
import { track } from './analytics-service.js';
import { localGet, localSet } from '../utils/preferences.js';

const LAST_TRACE_KEY = 'io:last-trace:v1';

export function createDraft(partial = {}) {
  return {
    regionSlug: partial.regionSlug ?? 'the-core',
    pattern: partial.pattern ?? 'spark',
    color: partial.color ?? '#5ee7ff',
    intensity: partial.intensity ?? 0.6,
    persistence: partial.persistence ?? 'lasting',
    nonce: newNonce(),
  };
}

export async function submitTrace(draft) {
  const result = await api().submitTrace(draft);
  if (result?.ok) {
    if (!result.duplicate) track('trace_submitted');
    // Apply our own event immediately; the realtime copy is deduplicated.
    if (result.event_id && !result.duplicate) {
      const region = regionBySlug(result.region.slug);
      applyEvents([{
        id: result.event_id,
        event_type: 'trace',
        origin: 'participant',
        region_id: region?.id ?? null,
        state_version: result.world.state_version,
        created_at: result.created_at,
        payload: {
          alias: result.alias, color: draft.color, pattern: draft.pattern, intensity: draft.intensity,
          persistence: draft.persistence, gain: result.energy_gain, resonance: result.resonance,
          region_slug: result.region.slug, region_energy: result.region.energy, region_state: result.region.state,
          region_level: result.region.level, energy_at: result.created_at,
          total_traces: result.world.total_traces, unique_contributors: result.world.unique_contributors,
          evolution_stage: result.world.evolution_stage,
          region_trace_count: (region?.trace_count ?? 0) + 1,
        },
      }]);
    }
    localSet(LAST_TRACE_KEY, {
      at: result.created_at ?? new Date().toISOString(), alias: result.alias, region: result.region,
      color: draft.color, pattern: draft.pattern, intensity: draft.intensity, persistence: draft.persistence,
    });
  }
  return result ?? { ok: false, code: 'server' };
}

export function lastTrace() {
  return localGet(LAST_TRACE_KEY);
}

export function tracesEnabled() {
  return world().snapshot?.flags?.traces_enabled !== false;
}
