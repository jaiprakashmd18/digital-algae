/**
 * Plain-language descriptions of world events — used by the ticker, the
 * timeline, screen-reader announcements and the text alternative.
 */
import { regionById, regionBySlug } from '../services/world-service.js';
import { PATTERN_LABELS } from '../utils/formatting.js';
import { regionStateLabel } from '../lib/world-model.js';

function regionName(e) {
  return regionBySlug(e.payload?.region_slug)?.name ?? regionById(e.region_id)?.name ?? e.payload?.name ?? 'a region';
}

export function describeEvent(e) {
  const p = e.payload ?? {};
  const who = p.alias ?? 'A visitor';
  switch (e.event_type) {
    case 'world_seeded':
      return 'The system generated the initial structure.';
    case 'trace':
      return `${who} left a ${(PATTERN_LABELS[p.pattern] ?? 'trace').toLowerCase()} in ${regionName(e)}${p.resonance ? ' — it resonated' : ''}. ${regionName(e)} is now ${regionStateLabel(p.region_state).toLowerCase()}.`;
    case 'first_trace':
      return `${who} left the first trace the organism ever received.`;
    case 'region_first_trace':
      return `${regionName(e)} received its first trace, from ${who}.`;
    case 'region_surge':
      return `${regionName(e)} surged after a trace from ${who}.`;
    case 'region_level':
      return `${regionName(e)} grew new branches (level ${p.level}).`;
    case 'stage_advanced':
      return `The organism evolved to ${p.stage_name}.`;
    case 'region_born':
      return `A new region formed: ${p.name ?? regionName(e)}.`;
    case 'energy_milestone':
      return `Average energy passed ${p.level}.`;
    case 'community_event_started':
      return `${p.title ?? 'A Convergence'} began: ${p.goal_target} different visitors are needed today.`;
    case 'community_event_completed':
      return `${p.title ?? 'The Convergence'} completed with ${p.progress} visitors.`;
    case 'community_event_expired':
      return `${p.title ?? 'The Convergence'} ended with ${p.progress ?? 0} of ${p.goal_target} visitors.`;
    default:
      return 'Something changed.';
  }
}
