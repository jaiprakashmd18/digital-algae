/**
 * /discovery/:slug — stable public page for one discovery.
 */
import { h, icon, link, statusMessage } from '../utils/dom.js';
import { DISCOVERY_KINDS, EVENT_LABELS, getDiscovery } from '../services/discovery-service.js';
import { regionById, whenReady } from '../services/world-service.js';
import { ORIGIN_LABELS } from '../utils/formatting.js';
import { formatDateTime, formatUtc } from '../utils/dates.js';
import { describeEvent } from '../components/event-text.js';
import { cardActions, renderMilestoneCard, shareControls } from '../components/share.js';
import { drawStaticRegion } from '../organism/renderer-2d.js';
import { track } from '../services/analytics-service.js';
import { api } from '../lib/api.js';
import { messageFor } from '../utils/errors.js';
import { notify } from '../components/notifications.js';
import { render as notFound } from './not-found.js';

export async function render({ params }) {
  let d;
  await whenReady();
  try {
    d = await getDiscovery(params.slug);
  } catch (e) {
    return { el: h('div', { class: 'page page-narrow' }, h('h1', {}, 'Discovery unavailable'), statusMessage('error', messageFor({ code: e.code ?? 'network' }))), title: 'Discovery unavailable', noindex: true };
  }
  if (!d) return notFound({ missing: 'Discovery' });
  track('discovery_opened');

  const region = regionById(d.region_id);
  const visual = h('canvas', { class: 'visual-frame', role: 'img', 'aria-label': region ? `Structure of ${region.name}` : 'Structure of the organism' });

  const save = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('bookmark'), h('span', {}, 'Save'));
  save.addEventListener('click', async () => {
    save.disabled = true;
    const r = await api().saveDiscovery(d.id);
    save.disabled = false;
    if (r.ok) {
      save.replaceChildren(icon('bookmark-check'), h('span', {}, 'Saved'));
      notify('Saved to your profile.', { kind: 'success', timeout: 2500 });
    } else notify(messageFor(r), { kind: 'error' });
  });

  const report = h('details', { class: 'report' },
    h('summary', { class: 'muted fine' }, icon('flag', { size: 14 }), ' Report this'),
    reportForm(d));

  const card = renderMilestoneCard({ title: d.title, subtitle: d.triggered_by_alias ? `Triggered by ${d.triggered_by_alias}` : ORIGIN_LABELS[d.origin], at: d.created_at, hue: region?.hue ?? 188 });

  const el = h('article', { class: 'page' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, link('/discoveries', {}, 'Discoveries'), ` / ${DISCOVERY_KINDS[d.kind] ?? d.kind}`),
      h('h1', {}, d.title),
      h('div', { class: 'tags' }, h('span', { class: `tag tag-${d.origin}` }, ORIGIN_LABELS[d.origin]), h('span', { class: 'tag' }, `World version ${d.state_version}`))),
    h('div', { class: 'two-col' },
      h('div', { class: 'section' },
        visual,
        h('p', {}, d.description),
        h('dl', { class: 'kv' },
          h('div', {}, h('dt', {}, 'Recorded'), h('dd', {}, h('time', { datetime: d.created_at }, formatDateTime(d.created_at)), h('div', { class: 'muted fine mono' }, formatUtc(d.created_at)))),
          h('div', {}, h('dt', {}, 'Region'), h('dd', {}, region ? link(`/explore/${region.slug}`, {}, region.name) : 'The whole organism')),
          h('div', {}, h('dt', {}, 'Origin'), h('dd', {}, d.origin === 'participant' ? `A visitor's accepted trace${d.triggered_by_alias ? ` (${d.triggered_by_alias})` : ''}` : ORIGIN_LABELS[d.origin])),
          d.event ? h('div', {}, h('dt', {}, 'Underlying event'), h('dd', {}, `${EVENT_LABELS[d.event.event_type] ?? d.event.event_type} #${d.event.id}`, h('div', { class: 'muted fine' }, describeEvent(d.event)))) : null),
        h('div', { class: 'share-controls' },
          region ? link(`/?region=${region.slug}`, { class: 'btn btn-primary btn-sm' }, icon('crosshair'), h('span', {}, 'Explore this region')) : link('/', { class: 'btn btn-primary btn-sm' }, 'Open the organism'),
          save),
        shareControls({ path: `/discovery/${d.slug}`, title: `${d.title} — Internet Organism`, text: d.description }),
        report),
      h('div', { class: 'section' }, h('h2', {}, 'Milestone card'), cardActions(card, { filename: `internet-organism-${d.slug}.png`, title: d.title, path: `/discovery/${d.slug}` }))));

  whenReady().then((s) => drawStaticRegion(visual, s.regions, region?.slug ?? null, { stage: s.snapshot?.world.evolution_stage ?? 0 }));

  return { el, title: d.title, description: d.description, image: null };
}

export function reportForm(d) {
  const reason = h('select', { id: 'report-reason' },
    [['offensive_name', 'Offensive name'], ['spam', 'Spam'], ['harassment', 'Harassment'], ['other', 'Something else']].map(([v, l]) => h('option', { value: v }, l)));
  const details = h('textarea', { id: 'report-details', rows: 3, maxlength: 500 });
  const out = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'form' },
    h('div', { class: 'field' }, h('label', { for: 'report-reason' }, 'Reason'), reason),
    h('div', { class: 'field' }, h('label', { for: 'report-details' }, 'Details (optional, only moderators see this)'), details),
    h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, 'Send report'), out);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api().submitReport({ targetType: 'discovery', targetId: d.slug, reason: reason.value, details: details.value });
    out.replaceChildren(r.ok ? statusMessage('success', 'Thank you. A moderator will review it.') : statusMessage('error', messageFor(r)));
    if (r.ok) form.querySelector('button').disabled = true;
  });
  return form;
}
