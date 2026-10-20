/**
 * /evolution — current stage, the stage ladder with the exact thresholds,
 * the formulas that govern the world, the event timeline (filterable,
 * paginated) and reproducible historical snapshots.
 */
import { h, link, loading, statusMessage } from '../utils/dom.js';
import { api } from '../lib/api.js';
import { onWorldChange, whenReady, world } from '../services/world-service.js';
import { EVENT_LABELS, listTimeline } from '../services/discovery-service.js';
import { ARCHETYPES, LEVEL_THRESHOLDS, LIMITS, REGION_STATES, STAGES, nextStageProgress } from '../lib/world-model.js';
import { describeEvent } from '../components/event-text.js';
import { formatNumber, formatPercent, ORIGIN_LABELS, pluralize } from '../utils/formatting.js';
import { formatDateTime } from '../utils/dates.js';
import { drawStaticRegion } from '../organism/renderer-2d.js';
import { messageFor } from '../utils/errors.js';
import { shareControls } from '../components/share.js';

const FILTERS = [
  ['', 'All milestones'],
  ['stage_advanced', 'Evolution'],
  ['region_born', 'New regions'],
  ['region_level', 'New branches'],
  ['region_surge', 'Surges'],
  ['region_first_trace,first_trace', 'First traces'],
  ['energy_milestone', 'Energy milestones'],
  ['community_event_started,community_event_completed,community_event_expired', 'Community events'],
  ['world_seeded', 'System'],
];

export function render({ query }) {
  const stageBox = h('div', { class: 'section' });
  const timeline = h('ol', { class: 'timeline' });
  const more = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true }, 'Load earlier events');
  const timelineStatus = h('div', { 'aria-live': 'polite' });
  const snapshots = h('div', { class: 'section' });
  let filter = FILTERS.some(([v]) => v === query.get('type')) ? query.get('type') : '';
  let before = null;

  const filterSelect = h('select', { id: 'tl-filter' }, FILTERS.map(([v, l]) => h('option', { value: v, selected: v === filter }, l)));
  filterSelect.addEventListener('change', () => {
    filter = filterSelect.value;
    const url = new URL(location.href);
    if (filter) url.searchParams.set('type', filter);
    else url.searchParams.delete('type');
    history.replaceState(history.state, '', url.pathname + url.search);
    before = null;
    timeline.replaceChildren();
    loadTimeline();
  });

  function renderStage(s) {
    const w = s.snapshot?.world;
    if (!w) {
      stageBox.replaceChildren(s.status === 'error' ? statusMessage('error', 'World data is unavailable right now.') : loading());
      return;
    }
    const prog = nextStageProgress(w.evolution_stage, w.total_traces, w.unique_contributors);
    stageBox.replaceChildren(
      h('div', { class: 'card' },
        h('p', { class: 'muted fine mono' }, `Stage ${w.evolution_stage} of ${STAGES.length - 1} · since ${formatDateTime(w.stage_changed_at)}`),
        h('h2', {}, w.stage_name),
        h('p', { class: 'muted' }, STAGES[w.evolution_stage].summary),
        prog ? h('div', { class: 'section', style: { marginTop: '8px', gap: '8px' } },
          h('p', { class: 'fine' }, `Next: ${prog.next.name} — needs ${pluralize(prog.next.traces, 'accepted trace')} from ${pluralize(prog.next.contributors, 'distinct visitor')}.`),
          h('p', { class: 'fine muted' }, `Traces ${formatNumber(w.total_traces)} / ${formatNumber(prog.next.traces)}`),
          h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Trace progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(prog.traces * 100)) }, h('span', { style: { width: formatPercent(prog.traces) } })),
          h('p', { class: 'fine muted' }, `Distinct visitors ${formatNumber(w.unique_contributors)} / ${formatNumber(prog.next.contributors)}`),
          h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Visitor progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(prog.contributors * 100)) }, h('span', { style: { width: formatPercent(prog.contributors) } })))
          : h('p', {}, 'The organism has reached its final stage.')),
      h('ol', { class: 'stages', 'aria-label': 'Evolution stages' }, STAGES.map((st) => h('li', { class: `${st.stage <= w.evolution_stage ? 'reached' : ''} ${st.stage === w.evolution_stage ? 'current' : ''}`, 'aria-current': st.stage === w.evolution_stage ? 'step' : null },
        h('span', { class: 'mono muted fine' }, `Stage ${st.stage}`), h('strong', {}, st.name),
        h('span', { class: 'muted fine' }, st.stage === 0 ? 'Start' : `${pluralize(st.traces, 'trace')} · ${pluralize(st.contributors, 'visitor')}`)))));
  }

  async function loadTimeline() {
    timelineStatus.replaceChildren(loading('Loading timeline…'));
    more.hidden = true;
    try {
      await whenReady();
      const types = filter ? filter.split(',') : null;
      const events = await listTimeline({ beforeId: before, types, limit: 25 });
      const links = await api().discoveriesForEvents(events.map((e) => e.id)).catch(() => []);
      const bySlug = new Map(links.map((l) => [l.world_event_id, l.slug]));
      timelineStatus.replaceChildren();
      if (!events.length && !before) timelineStatus.replaceChildren(h('p', { class: 'muted' }, 'No events of this kind have been recorded yet.'));
      timeline.append(...events.map((e) => h('li', { class: 'timeline-item' },
        h('time', { datetime: e.created_at }, formatDateTime(e.created_at)),
        h('strong', {}, EVENT_LABELS[e.event_type] ?? e.event_type),
        h('span', { class: 'fine' }, describeEvent(e)),
        h('span', { class: 'fine muted' }, `${ORIGIN_LABELS[e.origin]} · world version ${e.state_version}`,
          bySlug.has(e.id) ? [' · ', link(`/discovery/${bySlug.get(e.id)}`, {}, 'Open discovery')] : ''))));
      if (events.length === 25) {
        before = events[events.length - 1].id;
        more.hidden = false;
      }
    } catch (e) {
      timelineStatus.replaceChildren(statusMessage('error', messageFor({ code: e.code ?? 'network' })));
    }
  }
  more.addEventListener('click', loadTimeline);

  async function loadSnapshots() {
    try {
      const list = await api().listSnapshots();
      const canvas = h('canvas', { class: 'visual-frame', role: 'img', 'aria-label': 'Selected historical structure' });
      const caption = h('p', { class: 'fine muted', 'aria-live': 'polite' });
      const select = h('select', { id: 'snap-select' }, list.map((s) => h('option', { value: s.state_version }, `v${s.state_version} · ${formatDateTime(s.created_at)} · ${s.reason}`)));
      const shareBox = h('div');
      const show = async (version) => {
        const snap = await api().getWorldSnapshotVersion(Number(version));
        if (!snap) return;
        drawStaticRegion(canvas, snap.structure, null, { stage: snap.evolution_stage });
        caption.textContent = `World version ${snap.state_version}: ${snap.reason}. ${snap.structure.length} regions at stage ${snap.evolution_stage}. Regenerated from stored seeds and levels.`;
        shareBox.replaceChildren(shareControls({ path: `/evolution?v=${snap.state_version}`, title: `Internet Organism — world version ${snap.state_version}`, text: snap.reason }));
        const url = new URL(location.href);
        url.searchParams.set('v', snap.state_version);
        history.replaceState(history.state, '', url.pathname + url.search);
      };
      select.addEventListener('change', () => show(select.value));
      snapshots.replaceChildren(
        h('h2', {}, 'World snapshots'),
        h('p', { class: 'muted fine' }, 'Every structural change (a new stage, new branches, a new region) stores the seeds and levels needed to regenerate the organism exactly as it was. No animation frames are stored.'),
        h('div', { class: 'field' }, h('label', { for: 'snap-select' }, 'Version'), select), canvas, caption, shareBox);
      const wanted = Number(query.get('v'));
      const initial = list.find((s) => s.state_version === wanted) ?? list[0];
      if (initial) {
        select.value = String(initial.state_version);
        show(initial.state_version);
      }
    } catch (e) {
      snapshots.replaceChildren(statusMessage('error', messageFor({ code: e.code ?? 'network' })));
    }
  }

  const off = onWorldChange(renderStage);
  renderStage(world());
  loadTimeline();
  loadSnapshots();

  const el = h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Evolution'),
      h('h1', {}, 'How the organism changes'),
      h('p', {}, 'The organism evolves only through recorded, validated activity. These are the exact rules the server applies.')),
    stageBox,
    h('section', { class: 'section' },
      h('h2', {}, 'The rules'),
      h('div', { class: 'grid' },
        h('div', { class: 'card' }, h('h3', {}, 'Energy'),
          h('p', { class: 'fine muted' }, 'Each region holds 0–100 energy. A trace adds (2 + 4 × intensity) × the region’s multiplier. Each further trace by the same visitor in the same region within an hour adds 40% less than the previous one. Energy halves after the region’s half-life.')),
        h('div', { class: 'card' }, h('h3', {}, 'Region states'),
          h('p', { class: 'fine muted' }, REGION_STATES.map((s) => `${s.label} ≥ ${s.min}`).join(' · ')),
          h('p', { class: 'fine muted' }, 'Crossing 45 is recorded as a surge (at most once every 6 hours per region).')),
        h('div', { class: 'card' }, h('h3', {}, 'Branches'),
          h('p', { class: 'fine muted' }, `A region grows new branches at ${LEVEL_THRESHOLDS.join(', ')} all-time traces.`)),
        h('div', { class: 'card' }, h('h3', {}, 'Archetypes'),
          h('p', { class: 'fine muted' }, Object.values(ARCHETYPES).map((a) => `${a.label}: ×${a.gainMultiplier}, half-life ${a.halfLifeHours} h`).join(' · '))),
        h('div', { class: 'card' }, h('h3', {}, 'Convergence'),
          h('p', { class: 'fine muted' }, 'Every UTC day one region is chosen by a hash of the date. If enough different visitors leave a trace there that day — 60% of the recent daily average, between 3 and 25 — it converges.')),
        h('div', { class: 'card' }, h('h3', {}, 'Limits'),
          h('p', { class: 'fine muted' }, `Guests: one trace per ${LIMITS.guest.cooldownSeconds} s, ${LIMITS.guest.perHour}/hour, ${LIMITS.guest.perDay}/day. Accounts: ${LIMITS.account.cooldownSeconds} s, ${LIMITS.account.perHour}/hour, ${LIMITS.account.perDay}/day.`)))),
    h('section', { class: 'section' },
      h('h2', {}, 'Timeline'),
      h('div', { class: 'toolbar' }, h('div', { class: 'field' }, h('label', { for: 'tl-filter' }, 'Show'), filterSelect)),
      timeline, timelineStatus, more),
    snapshots);
  return { el, title: 'Evolution', description: 'How the organism changes: evolution stages, milestones, the timeline of recorded events, and historical world snapshots.', cleanup: off };
}
