/**
 * Region information panel (side sheet on desktop, bottom sheet on mobile).
 * Shows verified statistics, recent public events and discoveries, and a
 * shareable deep link.
 */
import { h, icon, link, loading, statusMessage } from '../utils/dom.js';
import { getRegionDetail, listDiscoveries, listRegionEvents, DISCOVERY_KINDS } from '../services/discovery-service.js';
import { liveRegionEnergy, regionStateFor, regionStateLabel, ARCHETYPES } from '../lib/world-model.js';
import { formatEnergy, formatNumber, ORIGIN_LABELS } from '../utils/formatting.js';
import { timeAgo } from '../utils/dates.js';
import { describeEvent } from './event-text.js';
import { shareControls } from './share.js';
import { messageFor } from '../utils/errors.js';

export function createRegionPanel({ onClose, onLeaveTrace }) {
  const body = h('div', { class: 'region-body' });
  const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close region panel' }, icon('x'));
  const title = h('h2', { id: 'region-panel-title' }, '');
  const el = h('aside', { class: 'panel region-panel', 'aria-labelledby': 'region-panel-title', hidden: true },
    h('div', { class: 'region-head' }, title, close), body);
  close.addEventListener('click', () => onClose?.());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onClose?.();
  });

  let currentSlug = null;
  let token = 0;

  async function show(region) {
    currentSlug = region.slug;
    const my = ++token;
    el.hidden = false;
    el.style.setProperty('--region-hue', region.hue);
    title.textContent = region.name;
    const energy = liveRegionEnergy(region);
    const state = regionStateFor(energy);
    const arch = ARCHETYPES[region.type];
    const summary = h('div', { class: 'region-summary' },
      h('p', { class: 'region-desc' }, region.description),
      h('dl', { class: 'kv' },
        h('div', {}, h('dt', {}, 'State'), h('dd', {}, h('span', { class: `state-pill state-${state}` }, regionStateLabel(state)))),
        h('div', {}, h('dt', {}, 'Energy'), h('dd', { class: 'mono' }, `${formatEnergy(energy)} / 100`)),
        h('div', {}, h('dt', {}, 'Level'), h('dd', { class: 'mono' }, String(region.level ?? 0))),
        h('div', {}, h('dt', {}, 'Accepted traces'), h('dd', { class: 'mono' }, formatNumber(region.trace_count))),
        h('div', {}, h('dt', {}, 'Archetype'), h('dd', {}, `${arch?.label ?? region.type} · half-life ${arch?.halfLifeHours ?? '?'} h`)),
        h('div', {}, h('dt', {}, 'Origin'), h('dd', {}, region.origin === 'system' ? 'Grown by the system at a milestone' : 'Initial generated structure'))),
      h('div', { class: 'region-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => onLeaveTrace?.(region.slug) }, icon('sparkles'), h('span', {}, 'Leave a trace here')),
        link(`/explore/${region.slug}`, { class: 'btn btn-ghost btn-sm' }, icon('info'), h('span', {}, 'Region page'))),
      shareControls({ path: `/explore/${region.slug}`, title: `${region.name} — Internet Organism`, text: region.description }));
    const live = h('div', { class: 'region-live' }, loading('Loading recent activity…'));
    body.replaceChildren(summary, live);

    try {
      const [detail, events, discoveries] = await Promise.all([
        getRegionDetail(region.slug),
        region.id ? listRegionEvents(region.id, 8) : Promise.resolve([]),
        region.id ? listDiscoveries({ regionId: region.id, pageSize: 5 }) : Promise.resolve({ items: [] }),
      ]);
      if (my !== token) return;
      live.replaceChildren(
        detail ? h('dl', { class: 'kv kv-compact' },
          h('div', {}, h('dt', {}, 'Traces, last 24 h'), h('dd', { class: 'mono' }, formatNumber(detail.stats.traces_24h))),
          h('div', {}, h('dt', {}, 'Contributors, last 24 h'), h('dd', { class: 'mono' }, formatNumber(detail.stats.contributors_24h))),
          h('div', {}, h('dt', {}, 'Contributors, last 7 days'), h('dd', { class: 'mono' }, formatNumber(detail.stats.contributors_7d)))) : null,
        h('h3', {}, 'Recent events'),
        events.length ? h('ol', { class: 'event-list' }, events.map((e) => h('li', {},
          h('span', {}, describeEvent(e)), h('time', { datetime: e.created_at, class: 'muted' }, timeAgo(e.created_at)))))
          : h('p', { class: 'muted' }, 'No public events here yet. A trace from you would be the first.'),
        h('h3', {}, 'Discoveries'),
        discoveries.items.length ? h('ul', { class: 'mini-list' }, discoveries.items.map((d) => h('li', {},
          link(`/discovery/${d.slug}`, {}, d.title), h('span', { class: 'muted' }, ` · ${DISCOVERY_KINDS[d.kind] ?? d.kind} · ${ORIGIN_LABELS[d.origin]}`))))
          : h('p', { class: 'muted' }, 'Nothing discovered in this region yet.'));
    } catch (e) {
      if (my !== token) return;
      live.replaceChildren(statusMessage('error', messageFor({ code: e.code ?? 'network' })));
    }
  }

  return {
    el,
    show,
    hide() {
      el.hidden = true;
      currentSlug = null;
      token++;
    },
    get slug() {
      return currentSlug;
    },
  };
}
