/**
 * /explore/:slug — a region's public page (shareable deep link).
 */
import { h, icon, link, loading, statusMessage } from '../utils/dom.js';
import { getRegionDetail, listDiscoveries, listRegionEvents, DISCOVERY_KINDS } from '../services/discovery-service.js';
import { whenReady } from '../services/world-service.js';
import { ARCHETYPES, liveRegionEnergy, regionStateFor, regionStateLabel } from '../lib/world-model.js';
import { formatEnergy, formatNumber, ORIGIN_LABELS } from '../utils/formatting.js';
import { formatDateTime, timeAgo } from '../utils/dates.js';
import { describeEvent } from '../components/event-text.js';
import { shareControls } from '../components/share.js';
import { drawStaticRegion } from '../organism/renderer-2d.js';
import { messageFor } from '../utils/errors.js';
import { render as notFound } from './not-found.js';

export async function render({ params }) {
  let detail;
  try {
    detail = await getRegionDetail(params.slug);
  } catch (e) {
    const el = h('div', { class: 'page page-narrow' }, h('h1', {}, 'Region unavailable'), statusMessage('error', messageFor({ code: e.code ?? 'network' })));
    return { el, title: 'Region unavailable', noindex: true };
  }
  if (!detail) return notFound({ missing: 'Region' });

  const live = liveRegionEnergy(detail);
  const st = regionStateFor(live);
  const arch = ARCHETYPES[detail.type];
  const visual = h('canvas', { class: 'visual-frame', role: 'img', 'aria-label': `Generated structure of ${detail.name}` });
  const activity = h('div', { class: 'section' }, loading('Loading activity…'));

  const el = h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, link('/explore', {}, 'Explore'), ' / Region'),
      h('h1', {}, detail.name),
      h('p', {}, detail.description)),
    h('div', { class: 'two-col' },
      h('div', { class: 'section' },
        visual,
        h('div', { class: 'share-controls' },
          link(`/?region=${detail.slug}`, { class: 'btn btn-primary' }, icon('crosshair'), h('span', {}, 'View in the organism')),
          link(`/?region=${detail.slug}&trace=1`, { class: 'btn btn-ghost' }, icon('sparkles'), h('span', {}, 'Leave a trace here'))),
        shareControls({ path: `/explore/${detail.slug}`, title: `${detail.name} — Internet Organism`, text: detail.description })),
      h('div', { class: 'section' },
        h('dl', { class: 'kv' },
          h('div', {}, h('dt', {}, 'State now'), h('dd', {}, h('span', { class: `state-pill state-${st}` }, regionStateLabel(st)))),
          h('div', {}, h('dt', {}, 'Energy now'), h('dd', { class: 'mono' }, `${formatEnergy(live)} / 100`)),
          h('div', {}, h('dt', {}, 'Level'), h('dd', { class: 'mono' }, String(detail.level))),
          h('div', {}, h('dt', {}, 'All-time traces'), h('dd', { class: 'mono' }, formatNumber(detail.trace_count))),
          h('div', {}, h('dt', {}, 'Distinct contributors, all time'), h('dd', { class: 'mono' }, formatNumber(detail.contributor_count))),
          h('div', {}, h('dt', {}, 'Traces, last 24 h'), h('dd', { class: 'mono' }, formatNumber(detail.stats.traces_24h))),
          h('div', {}, h('dt', {}, 'Contributors, last 24 h'), h('dd', { class: 'mono' }, formatNumber(detail.stats.contributors_24h))),
          h('div', {}, h('dt', {}, 'Contributors, last 7 days'), h('dd', { class: 'mono' }, formatNumber(detail.stats.contributors_7d)))),
        h('div', { class: 'card' },
          h('h2', {}, `${arch?.label ?? detail.type} archetype`),
          h('p', { class: 'fine muted' }, `Energy halves every ${detail.half_life_hours} hours. Traces here count ×${Number(detail.gain_multiplier).toFixed(2)}${Number(detail.resonance_bonus) > 0 ? `; a pattern matching the previous visitor's within 10 minutes adds +${Math.round(detail.resonance_bonus * 100)}%` : ''}.`),
          h('p', { class: 'fine muted' }, detail.origin === 'system' ? `Grew from The Core when the organism reached stage ${detail.unlocked_at_stage}.` : 'Part of the initial generated structure.')))),
    activity);

  whenReady().then((s) => drawStaticRegion(visual, s.regions.length ? s.regions : [detail], detail.slug, { stage: s.snapshot?.world.evolution_stage ?? 0 }));

  Promise.all([listRegionEvents(detail.id, 15), listDiscoveries({ regionId: detail.id, pageSize: 10 })]).then(([events, discoveries]) => {
    activity.replaceChildren(
      h('div', { class: 'two-col' },
        h('div', {}, h('h2', {}, 'Recent public events'),
          events.length ? h('ol', { class: 'event-list' }, events.map((e) => h('li', {}, h('span', {}, describeEvent(e)), h('time', { datetime: e.created_at, class: 'muted', title: formatDateTime(e.created_at) }, timeAgo(e.created_at)))))
            : h('p', { class: 'muted' }, 'No public events in this region yet.')),
        h('div', {}, h('h2', {}, 'Discovery history'),
          discoveries.items.length ? h('ul', { class: 'mini-list' }, discoveries.items.map((d) => h('li', {},
            link(`/discovery/${d.slug}`, {}, d.title), h('div', { class: 'muted fine' }, `${DISCOVERY_KINDS[d.kind] ?? d.kind} · ${ORIGIN_LABELS[d.origin]} · ${formatDateTime(d.created_at)}`))))
            : h('p', { class: 'muted' }, 'Nothing has been discovered here yet.'))));
  }).catch((e) => activity.replaceChildren(statusMessage('error', messageFor({ code: e.code ?? 'network' }))));

  return {
    el,
    title: detail.name,
    description: `${detail.description} Currently ${regionStateLabel(st).toLowerCase()} with ${formatNumber(detail.trace_count)} accepted traces.`,
  };
}
