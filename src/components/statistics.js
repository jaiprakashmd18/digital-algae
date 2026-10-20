/**
 * Live world statistics. Every number comes from the backend snapshot or
 * the realtime presence channel, with an explicit time window in its label.
 */
import { h, icon } from '../utils/dom.js';
import { onWorldChange, world } from '../services/world-service.js';
import { formatEnergy, formatNumber, pluralize } from '../utils/formatting.js';
import { timeAgo } from '../utils/dates.js';
import { globalEnergy, nextStageProgress, stageName } from '../lib/world-model.js';
import { describeEvent } from './event-text.js';

export function createStatistics({ compact = false } = {}) {
  const rows = {};
  const row = (key, label, hint) => {
    rows[key] = h('dd', { class: 'stat-value mono' }, '—');
    return h('div', { class: 'stat' }, h('dt', {}, label, hint ? h('span', { class: 'stat-hint' }, hint) : null), rows[key]);
  };
  const toggle = h('button', { type: 'button', class: 'stats-toggle', 'aria-expanded': String(!compact), 'aria-controls': 'stats-body' },
    icon('activity'), h('span', {}, 'World statistics'));
  const body = h('dl', { class: 'stats-grid', id: 'stats-body' },
    row('presence', 'Connected now', 'live presence'),
    row('recent', 'Contributors', 'last 5 min'),
    row('today', 'Contributors', 'today, UTC'),
    row('traces', 'Accepted traces', 'all time'),
    row('energy', 'Global energy', '0–100, decays'),
    row('regions', 'Regions', 'currently formed'),
    row('discoveries', 'Discoveries', 'by visitors / total'));
  const stage = h('div', { class: 'stage-line' });
  const last = h('p', { class: 'last-event' });
  const demoNote = h('p', { class: 'demo-note', hidden: true }, 'Demo mode: these numbers describe a world stored only in this browser.');
  const el = h('section', { class: `panel stats ${compact ? 'collapsed' : ''}`, 'aria-label': 'World statistics' }, toggle, h('div', { class: 'stats-inner' }, stage, body, last, demoNote));

  toggle.addEventListener('click', () => {
    const open = el.classList.toggle('collapsed') === false;
    toggle.setAttribute('aria-expanded', String(open));
  });

  function render(s) {
    const snap = s.snapshot;
    demoNote.hidden = s.connection !== 'demo';
    if (!snap) {
      stage.replaceChildren(h('span', { class: 'muted' }, s.status === 'error' ? 'World data unavailable — showing the initial structure.' : 'Loading world…'));
      return;
    }
    const w = snap.world;
    rows.presence.textContent = s.presence == null ? '—' : formatNumber(s.presence);
    rows.presence.title = s.presence == null ? 'Presence is measured only while live updates are connected.' : 'Open tabs connected to live updates right now';
    rows.recent.textContent = formatNumber(snap.stats.contributors_last_5m);
    rows.today.textContent = formatNumber(snap.stats.contributors_today);
    rows.traces.textContent = formatNumber(w.total_traces);
    rows.energy.textContent = formatEnergy(globalEnergy(s.regions));
    rows.regions.textContent = formatNumber(s.regions.length);
    rows.discoveries.textContent = `${formatNumber(snap.stats.participant_discoveries)} / ${formatNumber(snap.stats.discoveries_total)}`;

    const prog = nextStageProgress(w.evolution_stage, w.total_traces, w.unique_contributors);
    stage.replaceChildren(
      h('span', { class: 'stage-badge' }, `Stage ${w.evolution_stage}`),
      h('strong', {}, stageName(w.evolution_stage)),
      prog ? h('span', { class: 'stage-next muted' },
        `Next: ${prog.next.name} at ${pluralize(prog.next.traces, 'trace')} from ${pluralize(prog.next.contributors, 'visitor')}`) : null,
    );
    const ev = snap.last_meaningful_event;
    if (ev) last.replaceChildren(h('span', { class: 'muted' }, 'Latest milestone: '), `${describeEvent(ev)} `, h('time', { datetime: ev.created_at, class: 'muted' }, timeAgo(ev.created_at)));
    else last.replaceChildren();
  }
  const off = onWorldChange(render);
  render(world());
  // Refresh live-decayed energy and relative times without network calls.
  const timer = setInterval(() => render(world()), 15000);
  return {
    el,
    setCollapsed(collapsed) {
      el.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
    },
    get collapsed() {
      return el.classList.contains('collapsed');
    },
    destroy: () => {
      clearInterval(timer);
      off();
    },
  };
}
