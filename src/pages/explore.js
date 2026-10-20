/**
 * /explore — browse all regions without the 3D world, with filters.
 */
import { h, link, loading } from '../utils/dom.js';
import { onWorldChange, world } from '../services/world-service.js';
import { ARCHETYPES, REGION_STATES, liveRegionEnergy, regionStateFor, regionStateLabel } from '../lib/world-model.js';
import { formatEnergy, formatNumber } from '../utils/formatting.js';
import { timeAgo } from '../utils/dates.js';

export function render({ query }) {
  const state = {
    type: query.get('type') ?? '',
    activity: query.get('activity') ?? '',
    sort: query.get('sort') ?? 'energy',
  };
  const list = h('div', { class: 'grid', 'aria-live': 'polite' });
  const count = h('p', { class: 'muted fine' });

  const select = (id, label, value, options, key) => {
    const s = h('select', { id }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    s.addEventListener('change', () => {
      state[key] = s.value;
      const url = new URL(location.href);
      if (s.value) url.searchParams.set(key, s.value);
      else url.searchParams.delete(key);
      history.replaceState(history.state, '', url.pathname + url.search);
      draw();
    });
    return h('div', { class: 'field' }, h('label', { for: id }, label), s);
  };

  const toolbar = h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Filter regions' },
    select('f-type', 'Region type', state.type, [['', 'All types'], ...Object.entries(ARCHETYPES).map(([k, a]) => [k, a.label])], 'type'),
    select('f-activity', 'Current state', state.activity, [['', 'Any state'], ...REGION_STATES.map((s) => [s.id, s.label])], 'activity'),
    select('f-sort', 'Sort by', state.sort, [['energy', 'Energy now'], ['recent', 'Most recent trace'], ['traces', 'All-time traces'], ['name', 'Name']], 'sort'));

  function draw() {
    const s = world();
    if (s.status === 'loading') {
      list.replaceChildren(loading('Loading regions…'));
      return;
    }
    let regions = s.regions.map((r) => ({ ...r, live: liveRegionEnergy(r) }));
    if (state.type) regions = regions.filter((r) => r.type === state.type);
    if (state.activity) regions = regions.filter((r) => regionStateFor(r.live) === state.activity);
    const sorters = {
      energy: (a, b) => b.live - a.live,
      recent: (a, b) => (Date.parse(b.last_trace_at ?? 0) || 0) - (Date.parse(a.last_trace_at ?? 0) || 0),
      traces: (a, b) => (b.trace_count ?? 0) - (a.trace_count ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    regions.sort(sorters[state.sort] ?? sorters.energy);
    count.textContent = `${regions.length} of ${s.regions.length} regions${s.status === 'error' ? ' · showing the initial structure (world data unavailable)' : ''}`;
    list.replaceChildren(...(regions.length ? regions.map((r) => {
      const st = regionStateFor(r.live);
      return link(`/explore/${r.slug}`, { class: 'card', style: { borderColor: `hsl(${r.hue} 80% 60% / 0.25)` } },
        h('div', { class: 'tags' }, h('span', { class: `state-pill state-${st}` }, regionStateLabel(st)), h('span', { class: 'tag' }, ARCHETYPES[r.type]?.label ?? r.type),
          r.origin === 'system' ? h('span', { class: 'tag tag-system' }, 'Grown at a milestone') : null),
        h('h2', {}, r.name),
        h('p', { class: 'muted fine' }, r.description),
        h('p', { class: 'fine mono' }, `energy ${formatEnergy(r.live)} · level ${r.level ?? 0} · ${formatNumber(r.trace_count ?? 0)} traces`),
        h('p', { class: 'fine muted' }, r.last_trace_at ? `Last trace ${timeAgo(r.last_trace_at)}` : 'No traces yet'));
    }) : [h('p', { class: 'muted' }, 'No regions match these filters.')]));
  }

  const off = onWorldChange(draw);
  draw();

  const el = h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Explore'),
      h('h1', {}, 'Regions of the organism'),
      h('p', {}, 'Each region has its own character: how strongly it reacts, how long it remembers. Energy fades over time, so what you see here is the state right now.')),
    toolbar, count, list);
  return {
    el,
    title: 'Explore the regions',
    description: 'Browse every region of the shared organism — its state, energy and recent activity — without navigating the 3D world.',
    cleanup: off,
  };
}
