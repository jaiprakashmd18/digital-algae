/**
 * /discoveries — searchable, filterable, paginated list of discoveries.
 */
import { h, link, loading, statusMessage } from '../utils/dom.js';
import { DISCOVERY_KINDS, getDailyFeature, listDiscoveries } from '../services/discovery-service.js';
import { regionById, whenReady, world } from '../services/world-service.js';
import { ORIGIN_LABELS, formatNumber } from '../utils/formatting.js';
import { formatDateTime } from '../utils/dates.js';
import { messageFor } from '../utils/errors.js';

const PAGE_SIZE = 12;

export function render({ query }) {
  const state = {
    page: Math.max(1, Number(query.get('page')) || 1),
    kind: DISCOVERY_KINDS[query.get('kind')] ? query.get('kind') : '',
    origin: ORIGIN_LABELS[query.get('origin')] ? query.get('origin') : '',
    region: query.get('region') ?? '',
    search: (query.get('q') ?? '').slice(0, 60),
  };
  const results = h('div', { class: 'section', 'aria-live': 'polite' });
  const featured = h('div');

  function syncUrl() {
    const url = new URL(location.pathname, location.origin);
    for (const [k, v] of [['page', state.page > 1 ? state.page : ''], ['kind', state.kind], ['origin', state.origin], ['region', state.region], ['q', state.search]]) {
      if (v) url.searchParams.set(k, v);
    }
    history.replaceState(history.state, '', url.pathname + url.search);
  }

  const search = h('input', { type: 'search', id: 'd-search', value: state.search, placeholder: 'Search titles', maxlength: 60 });
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = search.value;
      state.page = 1;
      load();
    }, 300);
  });
  const sel = (id, label, key, options) => {
    const s = h('select', { id }, options.map(([v, l]) => h('option', { value: v, selected: v === state[key] }, l)));
    s.addEventListener('change', () => {
      state[key] = s.value;
      state.page = 1;
      load();
    });
    return h('div', { class: 'field' }, h('label', { for: id }, label), s);
  };
  const toolbar = h('form', { class: 'toolbar', role: 'search', onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'field' }, h('label', { for: 'd-search' }, 'Search'), search),
    sel('d-kind', 'Type', 'kind', [['', 'All types'], ...Object.entries(DISCOVERY_KINDS)]),
    sel('d-origin', 'Origin', 'origin', [['', 'Any origin'], ...Object.entries(ORIGIN_LABELS)]),
    sel('d-region', 'Region', 'region', [['', 'All regions'], ...world().regions.map((r) => [r.slug, r.name])]));

  let token = 0;
  async function load() {
    const my = ++token;
    syncUrl();
    results.replaceChildren(loading('Loading discoveries…'));
    await whenReady();
    const regionId = state.region ? world().regions.find((r) => r.slug === state.region)?.id ?? '00000000-0000-0000-0000-000000000000' : null;
    try {
      const { items, total } = await listDiscoveries({ page: state.page, pageSize: PAGE_SIZE, kind: state.kind || null, origin: state.origin || null, search: state.search, regionId });
      if (my !== token) return;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      results.replaceChildren(
        h('p', { class: 'muted fine' }, `${formatNumber(total)} ${total === 1 ? 'discovery' : 'discoveries'}`),
        items.length ? h('div', { class: 'grid' }, items.map(discoveryCard)) : h('p', { class: 'muted' }, 'No discoveries match. Try removing a filter.'),
        pages > 1 ? h('nav', { class: 'pager', 'aria-label': 'Pagination' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: state.page <= 1, onclick: () => { state.page--; load(); } }, 'Previous'),
          h('span', { class: 'muted fine' }, `Page ${state.page} of ${pages}`),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: state.page >= pages, onclick: () => { state.page++; load(); } }, 'Next')) : null);
    } catch (e) {
      if (my !== token) return;
      results.replaceChildren(statusMessage('error', messageFor({ code: e.code ?? 'network' }), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: load }, 'Try again')));
    }
  }

  getDailyFeature().then((f) => {
    if (!f) return;
    featured.replaceChildren(h('section', { class: 'card', 'aria-labelledby': 'daily-title' },
      h('p', { class: 'eyebrow mono fine muted' }, `Daily feature · ${f.day} UTC`),
      f.kind === 'discovery'
        ? [h('h2', { id: 'daily-title' }, link(`/discovery/${f.discovery.slug}`, {}, f.discovery.title)), h('p', { class: 'muted fine' }, f.discovery.description)]
        : [h('h2', { id: 'daily-title' }, link(`/explore/${f.region.slug}`, {}, `Featured region: ${f.region.name}`)), h('p', { class: 'muted fine' }, f.region.description)],
      h('p', { class: 'fine muted' }, f.rule === 'participant_discovery_yesterday'
        ? 'Chosen from discoveries visitors triggered yesterday (UTC), by a fixed hash of the date.'
        : f.rule === 'recent_discovery'
          ? 'No visitor discoveries yesterday, so this is chosen from the last 30 days by a fixed hash of the date.'
          : 'There are no recent discoveries yet, so this is the region with the most energy right now — labelled as a featured region, not a discovery.')));
  }).catch(() => {});

  load();
  const el = h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Memory'),
      h('h1', {}, 'Discoveries'),
      h('p', {}, 'Notable moments recorded by the organism. Each one comes from a real database event — “Triggered by a visitor” means a specific accepted trace caused it; the initial structure is labelled as generated.')),
    featured, h('div', { class: 'section' }, toolbar, results));
  return { el, title: 'Discoveries', description: 'Notable moments in the life of the organism: first traces, surges, new branches, new regions and community Convergences.' };
}

export function discoveryCard(d) {
  const region = regionById(d.region_id);
  return link(`/discovery/${d.slug}`, { class: 'card' },
    h('div', { class: 'tags' }, h('span', { class: 'tag' }, DISCOVERY_KINDS[d.kind] ?? d.kind), h('span', { class: `tag tag-${d.origin}` }, ORIGIN_LABELS[d.origin])),
    h('h2', {}, d.title),
    h('p', { class: 'muted fine' }, d.description),
    h('p', { class: 'fine muted' }, [formatDateTime(d.created_at), region ? ` · ${region.name}` : '', d.triggered_by_alias ? ` · by ${d.triggered_by_alias}` : '']));
}
