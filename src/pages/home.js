/**
 * Home: the living organism, full screen, with the concept explained up
 * front, Leave Your Trace, live statistics, region selection, the current
 * community event, the latest events and a text alternative of the world.
 */
import { h, icon, link } from '../utils/dom.js';
import { createOrganismCanvas } from '../components/organism-canvas.js';
import { createStatistics } from '../components/statistics.js';
import { createRegionPanel } from '../components/region-panel.js';
import { createTraceDialog } from '../components/trace-controls.js';
import { describeEvent } from '../components/event-text.js';
import { onWorldChange, onWorldEvent, regionBySlug, world } from '../services/world-service.js';
import { getDailyFeature } from '../services/discovery-service.js';
import { track } from '../services/analytics-service.js';
import { announce } from '../utils/accessibility.js';
import { localGet, localSet } from '../utils/preferences.js';
import { formatDuration, formatEnergy, formatNumber, pluralize } from '../utils/formatting.js';
import { timeAgo } from '../utils/dates.js';
import { liveRegionEnergy, regionStateFor, regionStateLabel } from '../lib/world-model.js';

const INTRO_KEY = 'io:intro-dismissed';
const OBSERVE_KEY = 'io:observed:v1';

export function render({ query }) {
  const cleanups = [];
  const traceDialog = createTraceDialog();
  cleanups.push(() => traceDialog.el.remove());

  let organism = null;
  const regionPanel = createRegionPanel({
    onClose: () => selectRegion(null),
    onLeaveTrace: (slug) => traceDialog.open(slug),
  });

  let statsWereCollapsed = null;
  function selectRegion(slug, { fromUrl = false } = {}) {
    const region = slug ? regionBySlug(slug) : null;
    organism?.select(region ? slug : null);
    // The region panel takes the statistics' place while it is open.
    if (region && statsWereCollapsed === null) {
      statsWereCollapsed = stats.collapsed;
      stats.setCollapsed(true);
    } else if (!region && statsWereCollapsed !== null) {
      stats.setCollapsed(statsWereCollapsed);
      statsWereCollapsed = null;
    }
    if (region) {
      regionPanel.show(region);
      announce(`${region.name} selected.`, { minIntervalMs: 0 });
    } else regionPanel.hide();
    if (!fromUrl) {
      const url = new URL(location.href);
      if (region) url.searchParams.set('region', slug);
      else url.searchParams.delete('region');
      history.replaceState(history.state, '', url.pathname + url.search);
    }
  }

  organism = createOrganismCanvas({
    onSelectRegion: (slug) => selectRegion(slug),
    onFirstInteraction: () => track('first_interaction', { oncePerPage: true }),
  });
  cleanups.push(() => organism.destroy());

  // ---- Intro: explains the concept before the animation needs to.
  const introDismissed = localGet(INTRO_KEY, false);
  const intro = h('section', { class: `intro panel ${introDismissed ? 'intro-compact' : ''}`, 'aria-labelledby': 'home-title' },
    h('h1', { id: 'home-title' }, 'One internet. ', h('span', { class: 'accent' }, 'One living organism.')),
    h('div', { class: 'intro-body' },
      h('p', {}, 'This is a single digital life form shared by everyone who visits. It grows, glows and calms down according to what real people do here.'),
      h('p', {}, 'Leave a trace — a small burst of colour and energy — and watch it ripple through the region you chose. Your trace stays in the world after you leave, and every visitor sees it.'),
      h('p', { class: 'muted fine' }, 'Drag to rotate, scroll or pinch to zoom, tap a node or a region name to explore it.')),
    h('div', { class: 'intro-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => traceDialog.open(regionPanel.slug) }, icon('sparkles'), h('span', {}, 'Leave your trace')),
      link('/about', { class: 'btn btn-ghost' }, 'How it works'),
      h('button', {
        type: 'button', class: 'btn btn-link intro-toggle',
        onclick: () => {
          const compact = intro.classList.toggle('intro-compact');
          localSet(INTRO_KEY, compact);
        },
      }, introDismissed ? 'Show introduction' : 'Hide introduction')));

  const stats = createStatistics({ compact: matchMedia('(max-width: 860px), (max-height: 560px)').matches });
  cleanups.push(() => stats.destroy());

  // ---- Community event (today's Convergence).
  const community = h('section', { class: 'panel community', 'aria-label': 'Today’s community event', hidden: true });

  // ---- Latest events ticker (visual; screen readers get announcements).
  const ticker = h('ol', { class: 'ticker', 'aria-label': 'Latest world events' });

  // ---- Observe the organism: what changed since the last visit.
  const observe = h('section', { class: 'panel observe', 'aria-labelledby': 'observe-title', hidden: true });

  // ---- Text alternative of the world.
  const textWorld = h('details', { class: 'panel world-text' },
    h('summary', {}, icon('eye'), h('span', {}, 'The world as text')),
    h('div', { class: 'world-text-body' }));

  const fab = h('button', { type: 'button', class: 'btn btn-primary btn-trace', onclick: () => traceDialog.open(regionPanel.slug) },
    icon('sparkles'), h('span', {}, 'Leave your trace'));

  const el = h('div', { class: 'home' },
    organism.el,
    h('div', { class: 'home-overlay' },
      h('div', { class: 'home-left' }, intro, observe, community),
      h('div', { class: 'home-right' }, stats.el, regionPanel.el),
      h('div', { class: 'home-bottom' }, ticker, h('div', { class: 'home-actions' }, fab,
        link('/discoveries', { class: 'btn btn-ghost btn-sm', 'aria-label': 'Discoveries' }, icon('compass'), h('span', { class: 'btn-label' }, 'Discoveries'))))),
    textWorld);

  function renderCommunity(s) {
    const ce = s.snapshot?.community_event;
    community.hidden = !ce;
    if (!ce) return;
    const pct = Math.min(1, ce.progress / ce.goal_target);
    const secondsLeft = Math.max(0, (Date.parse(ce.ends_at) - Date.now()) / 1000);
    community.replaceChildren(
      h('h2', { class: 'panel-title' }, icon('waves'), h('span', {}, ce.title)),
      h('p', { class: 'muted fine' }, ce.description),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(ce.goal_target), 'aria-valuenow': String(ce.progress), 'aria-label': 'Distinct visitors so far' },
        h('span', { style: { width: `${pct * 100}%` } })),
      h('p', { class: 'fine' },
        h('span', { class: 'mono' }, `${ce.progress} / ${ce.goal_target}`), ' different visitors · ',
        ce.status === 'completed' ? h('strong', {}, 'Completed') : ce.status === 'expired' ? 'Ended' : `ends in ${formatDuration(secondsLeft)} (midnight UTC)`),
      ce.status === 'active' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { selectRegion(ce.region_slug); traceDialog.open(ce.region_slug); } }, `Leave a trace in ${ce.region_name}`) : null);
  }

  function renderTicker(s) {
    const items = s.recent.slice(0, 4);
    ticker.replaceChildren(...items.map((e) => h('li', { class: `tick tick-${e.event_type}` },
      e.payload?.color ? h('span', { class: 'tick-dot', style: { background: e.payload.color }, 'aria-hidden': 'true' }) : h('span', { class: 'tick-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'tick-text' }, describeEvent(e)), h('time', { datetime: e.created_at, class: 'muted' }, timeAgo(e.created_at)))));
    if (!items.length) ticker.replaceChildren(h('li', { class: 'tick muted' }, s.status === 'loading' ? 'Listening for activity…' : 'No visitor activity yet. The first trace could be yours.'));
  }

  function renderText(s) {
    const body = textWorld.querySelector('.world-text-body');
    const w = s.snapshot?.world;
    body.replaceChildren(
      h('p', {}, w
        ? `The organism is at stage ${w.evolution_stage}, ${w.stage_name}, with ${pluralize(w.total_traces, 'accepted trace')} from ${pluralize(w.unique_contributors, 'distinct visitor')}.`
        : 'World data is loading. The initial generated structure is shown.'),
      h('ul', {}, s.regions.map((r) => {
        const e = liveRegionEnergy(r);
        return h('li', {}, link(`/explore/${r.slug}`, {}, r.name), `: ${regionStateLabel(regionStateFor(e))}, energy ${formatEnergy(e)} of 100, level ${r.level ?? 0}, ${pluralize(r.trace_count ?? 0, 'trace')}. `,
          h('button', { type: 'button', class: 'btn btn-link', onclick: () => selectRegion(r.slug) }, `Select ${r.name}`));
      })));
  }

  async function renderObserve(s) {
    const snap = s.snapshot;
    if (!snap || observe.dataset.done) return;
    observe.dataset.done = '1';
    const prev = localGet(OBSERVE_KEY);
    localSet(OBSERVE_KEY, { at: Date.now(), traces: snap.world.total_traces, stage: snap.world.evolution_stage, discoveries: snap.stats.discoveries_total });
    if (!prev || Date.now() - prev.at < 30 * 60e3) return;
    let feature;
    try {
      feature = await getDailyFeature();
    } catch {
      feature = null;
    }
    const traces = snap.world.total_traces - prev.traces;
    const discoveries = snap.stats.discoveries_total - prev.discoveries;
    observe.hidden = false;
    observe.replaceChildren(
      h('div', { class: 'observe-head' },
        h('h2', { id: 'observe-title', class: 'panel-title' }, icon('eye'), h('span', {}, 'Observe the organism')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => (observe.hidden = true) }, icon('x'))),
      h('p', { class: 'fine' }, `Since you were last here (${timeAgo(prev.at)}): `,
        h('strong', {}, `${formatNumber(Math.max(0, traces))} new ${traces === 1 ? 'trace' : 'traces'}`), ', ',
        h('strong', {}, `${formatNumber(Math.max(0, discoveries))} new ${discoveries === 1 ? 'discovery' : 'discoveries'}`),
        snap.world.evolution_stage > prev.stage ? [', and the organism evolved to ', h('strong', {}, snap.world.stage_name)] : '', '.'),
      feature?.kind === 'discovery'
        ? h('p', { class: 'fine' }, h('span', { class: 'muted' }, 'Today’s featured discovery: '), link(`/discovery/${feature.discovery.slug}`, {}, feature.discovery.title))
        : feature?.kind === 'region'
          ? h('p', { class: 'fine' }, h('span', { class: 'muted' }, 'Featured region (no new discoveries yesterday): '), link(`/explore/${feature.region.slug}`, {}, feature.region.name))
          : null);
  }

  const offChange = onWorldChange((s) => {
    renderCommunity(s);
    renderTicker(s);
    renderText(s);
    renderObserve(s);
    if (regionPanel.slug && !regionBySlug(regionPanel.slug)) selectRegion(null);
  });
  cleanups.push(offChange);
  let panelRefresh = null;
  const offEvent = onWorldEvent((e) => {
    announce(describeEvent(e));
    const slug = e.payload?.region_slug ?? world().regions.find((r) => r.id === e.region_id)?.slug;
    if (slug && slug === regionPanel.slug) {
      clearTimeout(panelRefresh);
      panelRefresh = setTimeout(() => regionBySlug(slug) && regionPanel.show(regionBySlug(slug)), 400);
    }
  });
  cleanups.push(() => clearTimeout(panelRefresh));
  cleanups.push(offEvent);
  const s0 = world();
  renderCommunity(s0);
  renderTicker(s0);
  renderText(s0);
  renderObserve(s0);

  const initial = query.get('region');
  if (initial) {
    const tryInitial = () => {
      if (regionBySlug(initial)) {
        selectRegion(initial, { fromUrl: true });
        return true;
      }
      return false;
    };
    if (!tryInitial()) {
      const off = onWorldChange(() => {
        if (world().status !== 'loading' && (tryInitial() || world().snapshot)) off();
      });
      cleanups.push(off);
    }
  }
  if (query.get('trace') === '1') setTimeout(() => traceDialog.open(initial), 0);

  return {
    el,
    title: null,
    description: 'A persistent digital life form shared by everyone who visits. Leave a trace, watch it ripple through the organism, and discover what the community has grown.',
    cleanup: () => cleanups.forEach((fn) => fn()),
  };
}
