/**
 * /admin — operators only. Every call below is authorised again on the
 * server (role-checked SECURITY DEFINER functions); this page merely
 * renders what the server allows. Results are shown only when the server
 * reports success.
 */
import { h, icon, loading, statusMessage } from '../utils/dom.js';
import { api } from '../lib/api.js';
import { authState, isPermanentUser, onAuth } from '../lib/auth.js';
import { formatDateTime } from '../utils/dates.js';
import { messageFor } from '../utils/errors.js';
import { notify } from '../components/notifications.js';
import { formatNumber } from '../utils/formatting.js';

export function render() {
  const root = h('div', { class: 'page' });
  const draw = async ({ user, ready }) => {
    root.replaceChildren(h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Operators'), h('h1', {}, 'Administration')));
    if (!ready) return root.append(loading());
    if (api().mode === 'demo') return root.append(statusMessage('info', 'Administration needs a configured backend.'));
    if (!isPermanentUser(user)) return root.append(statusMessage('info', 'Sign in with an operator account to continue.'));
    const body = h('div');
    root.append(body);
    await dashboard(body);
  };
  const off = onAuth(draw);
  draw(authState());
  return { el: root, title: 'Administration', noindex: true, cleanup: off };
}

async function call(name, args, { body, okMessage } = {}) {
  try {
    const r = await api().admin(name, args);
    if (r && r.ok === false) {
      notify(messageFor(r), { kind: 'error' });
      return null;
    }
    if (okMessage) notify(okMessage, { kind: 'success' });
    return r;
  } catch (e) {
    if (body && e.code === 'forbidden') body.replaceChildren(statusMessage('error', 'Your account does not have operator access.'));
    else notify(messageFor({ code: e.code ?? 'server' }), { kind: 'error' });
    return null;
  }
}

async function dashboard(body) {
  body.replaceChildren(loading('Loading overview…'));
  const overview = await call('admin_overview', {}, { body });
  if (!overview) return;
  const reports = h('div', { class: 'section' });
  const errors = h('div', { class: 'section' });
  const limits = h('div', { class: 'section' });
  const events = h('div', { class: 'section' });
  const audit = h('div', { class: 'section' });

  const flags = h('div', { class: 'section' }, h('h2', {}, 'Feature flags'),
    h('div', { class: 'grid' }, overview.flags.map((f) => {
      const input = h('input', { type: 'checkbox', checked: f.enabled, disabled: !overview.is_admin, id: `flag-${f.key}` });
      input.addEventListener('change', async () => {
        input.disabled = true;
        const r = await call('admin_set_feature_flag', { p_key: f.key, p_enabled: input.checked }, { okMessage: `${f.key} ${input.checked ? 'enabled' : 'disabled'}.` });
        if (!r) input.checked = !input.checked;
        input.disabled = false;
      });
      return h('div', { class: 'card' }, h('label', { class: 'check', for: `flag-${f.key}` }, input, h('strong', { class: 'mono' }, f.key)), h('p', { class: 'fine muted' }, f.description));
    })));

  const maintenance = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: !overview.is_admin }, icon('refresh'), h('span', {}, 'Run maintenance now'));
  maintenance.addEventListener('click', async () => {
    maintenance.disabled = true;
    const r = await call('admin_run_maintenance', {});
    maintenance.disabled = false;
    if (r) notify(`Maintenance ran: ${r.regions_refreshed} regions refreshed, ${r.pruned_trace_events} old trace events pruned.`, { kind: 'success', timeout: 8000 });
  });

  body.replaceChildren(
    h('div', { class: 'section' },
      h('h2', {}, 'Platform health'),
      h('dl', { class: 'kv kv-compact' },
        ...[
          ['Traces, 24 h', overview.traces_24h], ['Contributors, 24 h', overview.contributors_24h], ['Open reports', overview.open_reports],
          ['Errors, 24 h', overview.errors_24h], ['Hidden events', overview.hidden_events], ['All-time traces', overview.world.total_traces],
        ].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', { class: 'mono' }, formatNumber(v)))),
        h('div', {}, h('dt', {}, 'Rejections, 24 h'), h('dd', { class: 'mono fine' }, Object.entries(overview.rejections_24h).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none')),
        h('div', {}, h('dt', {}, 'Usage, 7 days'), h('dd', { class: 'mono fine' }, Object.entries(overview.analytics_7d).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none'))),
      maintenance),
    flags, reports, events, errors, limits, overview.is_admin ? audit : '');

  loadReports(reports);
  loadEvents(events);
  loadTable(errors, 'Recent system errors', 'admin_list_errors', { p_limit: 50 }, ['created_at', 'source', 'code', 'message']);
  loadTable(limits, 'Rate-limit activity (24 h)', 'admin_list_rate_limits', { p_hours: 24 }, ['window_start', 'action', 'reason', 'rejected', 'actors', 'top_actor_hash']);
  if (overview.is_admin) loadTable(audit, 'Audit log', 'admin_list_audit', { p_limit: 50 }, ['created_at', 'admin_name', 'action', 'target_type', 'target_id']);
}

function cell(key, value) {
  if (key === 'created_at' || key === 'window_start') return formatDateTime(value);
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '—');
}

async function loadTable(box, title, name, args, cols) {
  box.replaceChildren(h('h2', {}, title), loading());
  const rows = await call(name, args);
  if (!rows) return box.replaceChildren(h('h2', {}, title), statusMessage('error', 'Could not load.'));
  box.replaceChildren(h('h2', {}, title), rows.length
    ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col' }, c.replace(/_/g, ' '))))),
      h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', { class: c.includes('hash') || c === 'code' ? 'mono' : '' }, cell(c, r[c]))))))))
    : h('p', { class: 'muted' }, 'Nothing to show.'));
}

async function loadReports(box) {
  let status = 'open';
  const list = h('div');
  const filter = h('select', { id: 'report-status' }, [['open', 'Open'], ['actioned', 'Actioned'], ['dismissed', 'Dismissed']].map(([v, l]) => h('option', { value: v }, l)));
  filter.addEventListener('change', () => {
    status = filter.value;
    draw();
  });
  box.replaceChildren(h('h2', {}, 'Reports'), h('div', { class: 'toolbar' }, h('div', { class: 'field' }, h('label', { for: 'report-status' }, 'Status'), filter)), list);
  async function draw() {
    list.replaceChildren(loading());
    const rows = await call('admin_list_reports', { p_status: status, p_limit: 50 });
    if (!rows) return list.replaceChildren(statusMessage('error', 'Could not load reports.'));
    if (!rows.length) return list.replaceChildren(h('p', { class: 'muted' }, 'No reports.'));
    list.replaceChildren(h('div', { class: 'grid' }, rows.map((r) => {
      const act = (action, label) => h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        onclick: async () => {
          const res = await call('admin_resolve_report', { p_report_id: r.id, p_action: action }, { okMessage: 'Report resolved.' });
          if (res) draw();
        },
      }, label);
      return h('div', { class: 'card' },
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, r.reason), h('span', { class: 'tag' }, r.status), h('span', { class: 'tag' }, `${r.target_type} ${r.target_id}`)),
        h('p', { class: 'fine' }, r.target ? JSON.stringify(r.target.payload ?? r.target) : 'Target no longer exists.'),
        r.details ? h('p', { class: 'fine muted' }, `“${r.details}”`) : null,
        h('p', { class: 'fine muted' }, formatDateTime(r.created_at)),
        r.status === 'open' ? h('div', { class: 'share-controls' }, act('dismiss', 'Dismiss'), act('hide_target', 'Hide content'), act('redact_alias', 'Redact pseudonym')) : null);
    })));
  }
  draw();
}

async function loadEvents(box) {
  box.replaceChildren(h('h2', {}, 'Recent world events'), loading());
  const rows = await call('admin_list_events', { p_limit: 40, p_before: null });
  if (!rows) return box.replaceChildren(h('h2', {}, 'Recent world events'), statusMessage('error', 'Could not load events.'));
  box.replaceChildren(h('h2', {}, 'Recent world events'), h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['id', 'type', 'origin', 'alias', 'when', 'visibility'].map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, rows.map((e) => {
      const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, e.hidden ? 'Unhide' : 'Hide');
      btn.addEventListener('click', async () => {
        const r = await call('admin_set_event_hidden', { p_event_id: e.id, p_hidden: !e.hidden }, { okMessage: e.hidden ? 'Event visible again.' : 'Event hidden.' });
        if (r) loadEvents(box);
      });
      return h('tr', {}, h('td', { class: 'mono' }, String(e.id)), h('td', {}, e.event_type), h('td', {}, e.origin), h('td', {}, e.payload?.alias ?? '—'),
        h('td', {}, formatDateTime(e.created_at)), h('td', {}, btn));
    })))));
}
