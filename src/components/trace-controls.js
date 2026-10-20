/**
 * Leave Your Trace dialog. A native <dialog> (focus trap, Escape, inert
 * background). States: compose → submitting → accepted | rejected.
 * Success is shown only after the server accepted the trace.
 */
import { h, icon } from '../utils/dom.js';
import { createDraft, submitTrace, tracesEnabled } from '../services/trace-service.js';
import { world } from '../services/world-service.js';
import { LIMITS, TRACE_PATTERNS, regionStateLabel } from '../lib/world-model.js';
import { validateTrace } from '../lib/validation.js';
import { PATTERN_LABELS, formatDuration } from '../utils/formatting.js';
import { messageFor } from '../utils/errors.js';
import { cardActions, renderTraceCard, shareControls } from './share.js';
import { announce } from '../utils/accessibility.js';
import { authState, isPermanentUser } from '../lib/auth.js';
import { mulberry32 } from '../organism/generator.js';

const MILESTONE_LABELS = {
  first_trace: 'The first trace ever',
  region_first_trace: 'First trace in this region',
  region_surge: 'The region surged',
  region_level: 'The region grew new branches',
  stage_advanced: 'The organism evolved',
  region_born: 'A new region formed',
  energy_milestone: 'The whole organism glowed',
  community_event_completed: 'Today’s Convergence completed',
};

const SWATCHES = ['#5ee7ff', '#8f7bff', '#7dffb2', '#ff7bd5', '#ffd27a', '#7ab8ff', '#c9f0ff', '#ff9a7a'];

const PATTERN_HELP = {
  spark: 'A quick bright burst.',
  spiral: 'Two turning waves.',
  ripple: 'Three rings in a row.',
  bloom: 'A slow, wide glow.',
  filament: 'A fast thread of light.',
};

function patternGlyph(pattern) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('glyph');
  const paths = {
    spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
    spiral: 'M12 12m-1 0a1 1 0 1 0 2 0a3 3 0 1 0-6 0a5 5 0 1 0 10 0a7 7 0 1 0-14 0',
    ripple: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 12m-5.5 0a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0',
    bloom: 'M12 12c-3-5-1-9 0-9s3 4 0 9c5-3 9-1 9 0s-4 3-9 0c3 5 1 9 0 9s-3-4 0-9c-5 3-9 1-9 0s4-3 9 0',
    filament: 'M3 20c3-1 4-5 7-6s4 1 6-2 2-7 5-9',
  };
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', paths[pattern]);
  svg.append(p);
  return svg;
}

export function createTraceDialog() {
  let draft = createDraft();
  let busy = false;

  const dialog = h('dialog', { class: 'trace-dialog', 'aria-labelledby': 'trace-title' });
  const content = h('div', { class: 'trace-content' });
  dialog.append(content);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && !busy) dialog.close();
  });
  dialog.addEventListener('cancel', (e) => {
    if (busy) e.preventDefault();
  });
  document.body.append(dialog);

  function header(title, sub) {
    return h('div', { class: 'dialog-head' },
      h('div', {}, h('h2', { id: 'trace-title' }, title), sub ? h('p', { class: 'muted' }, sub) : null),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => !busy && dialog.close() }, icon('x')));
  }

  function compose(error = null) {
    const regions = world().regions;
    const isGuest = !isPermanentUser(authState().user);
    const limits = isGuest ? LIMITS.guest : LIMITS.account;

    const regionSelect = h('select', { id: 'trace-region', name: 'region' },
      regions.map((r) => h('option', { value: r.slug, selected: r.slug === draft.regionSlug }, `${r.name} — ${regionStateLabel(r.state)}`)));
    regionSelect.addEventListener('change', () => (draft.regionSlug = regionSelect.value));

    const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' },
      SWATCHES.map((c) => {
        const b = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(c === draft.color), 'aria-label': `Colour ${c}`, style: { '--c': c } });
        b.addEventListener('click', () => {
          draft.color = c;
          custom.value = c;
          swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s === b)));
          updatePreview();
        });
        return b;
      }));
    const custom = h('input', { type: 'color', value: draft.color, 'aria-label': 'Custom colour', class: 'color-input' });
    custom.addEventListener('input', () => {
      draft.color = custom.value.toLowerCase();
      swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', 'false'));
      updatePreview();
    });

    const patterns = h('div', { class: 'patterns', role: 'radiogroup', 'aria-label': 'Pattern' },
      TRACE_PATTERNS.map((p) => h('label', { class: 'pattern-option' },
        h('input', { type: 'radio', name: 'pattern', value: p, checked: p === draft.pattern, onchange: () => { draft.pattern = p; updatePreview(); } }),
        patternGlyph(p), h('span', { class: 'pattern-name' }, PATTERN_LABELS[p]), h('span', { class: 'pattern-help' }, PATTERN_HELP[p]))));

    const intensityOut = h('output', { for: 'trace-intensity', class: 'mono' }, `${Math.round(draft.intensity * 100)}%`);
    const intensity = h('input', { type: 'range', id: 'trace-intensity', min: '10', max: '100', step: '5', value: String(Math.round(draft.intensity * 100)) });
    intensity.addEventListener('input', () => {
      draft.intensity = Number(intensity.value) / 100;
      intensityOut.textContent = `${intensity.value}%`;
      updatePreview();
    });

    const persistence = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'How long the mark lingers' },
      [['fleeting', 'Fleeting · 1 hour'], ['lasting', 'Lasting · 24 hours']].map(([v, label]) => h('label', {},
        h('input', { type: 'radio', name: 'persistence', value: v, checked: draft.persistence === v, onchange: () => (draft.persistence = v) }), h('span', {}, label))));

    const preview = h('canvas', { class: 'trace-preview', width: 160, height: 160, 'aria-hidden': 'true' });
    function updatePreview() {
      const ctx = preview.getContext('2d');
      ctx.clearRect(0, 0, 160, 160);
      ctx.globalCompositeOperation = 'lighter';
      const rand = mulberry32(draft.pattern.length * 97 + Math.round(draft.intensity * 100));
      const n = 10 + Math.round(draft.intensity * 30);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * (30 + draft.intensity * 40);
        const x = 80 + Math.cos(a) * r;
        const y = 80 + Math.sin(a) * r;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.3, draft.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 9, y - 9, 18, 18);
      }
    }

    const surprise = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('sparkles'), h('span', {}, 'Surprise me'));
    surprise.addEventListener('click', () => {
      const r = Math.random;
      draft = { ...draft, color: SWATCHES[Math.floor(r() * SWATCHES.length)], pattern: TRACE_PATTERNS[Math.floor(r() * TRACE_PATTERNS.length)], intensity: Math.round((0.3 + r() * 0.7) * 20) / 20, persistence: r() > 0.5 ? 'lasting' : 'fleeting' };
      compose();
    });

    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('sparkles'), h('span', {}, 'Leave your trace'));
    const form = h('form', { class: 'trace-form', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'trace-region' }, 'Region'), regionSelect),
      h('fieldset', { class: 'field' }, h('legend', {}, 'Colour'), h('div', { class: 'swatch-row' }, swatches, custom)),
      h('fieldset', { class: 'field' }, h('legend', {}, 'Pattern'), patterns),
      h('div', { class: 'field field-inline' }, h('label', { for: 'trace-intensity' }, 'Intensity'), intensity, intensityOut),
      h('fieldset', { class: 'field' }, h('legend', {}, 'Lingers'), persistence),
      error ? h('p', { class: 'form-error', role: 'alert' }, error) : null,
      h('div', { class: 'dialog-actions' }, surprise, submit),
      h('p', { class: 'fine muted' },
        `No account needed. ${isGuest ? 'Guests' : 'Accounts'} can leave a trace every ${limits.cooldownSeconds} s, up to ${limits.perHour} per hour and ${limits.perDay} per UTC day. `,
        'Repeated traces in the same region within an hour add less energy. Your trace is public under a pseudonym; see the privacy policy.'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      send();
    });

    content.replaceChildren(
      header('Leave your trace', 'Add a little energy to the shared organism. Everyone connected will see it.'),
      h('div', { class: 'trace-layout' }, form, h('div', { class: 'preview-wrap' }, preview, h('p', { class: 'muted fine' }, 'Preview'))));
    updatePreview();
    if (!tracesEnabled()) {
      submit.disabled = true;
      form.prepend(h('p', { class: 'form-error', role: 'status' }, messageFor({ code: 'feature_disabled' })));
    }
  }

  async function send() {
    const v = validateTrace(draft);
    if (!v.ok) {
      compose(v.message);
      return;
    }
    busy = true;
    content.replaceChildren(header('Leaving your trace…'), h('div', { class: 'submitting', role: 'status' }, h('span', { class: 'loading-dot' }), 'Sending to the organism and waiting for confirmation.'));
    let result;
    try {
      result = await submitTrace(draft);
    } catch {
      result = { ok: false, code: 'network' };
    }
    busy = false;
    if (result.ok) accepted(result);
    else rejected(result);
  }

  function accepted(result) {
    const region = world().regions.find((r) => r.slug === result.region.slug);
    const at = result.created_at ?? new Date().toISOString();
    const milestones = (result.milestones ?? []).filter((m) => m.discovery);
    announce(`Your trace was accepted. ${result.region.name ?? region?.name} is now ${regionStateLabel(result.region.state).toLowerCase()}.`, { minIntervalMs: 0 });
    const card = renderTraceCard({ alias: result.alias ?? 'A visitor', regionName: region?.name ?? result.region.slug, pattern: draft.pattern, color: draft.color, intensity: draft.intensity, at });
    content.replaceChildren(
      header('Trace accepted', result.duplicate ? 'This trace had already been recorded — nothing was counted twice.' : 'The organism absorbed it. Watch the ripple travel through the region.'),
      h('dl', { class: 'kv' },
        h('div', {}, h('dt', {}, 'Signed as'), h('dd', {}, result.alias ?? '—')),
        h('div', {}, h('dt', {}, 'Region'), h('dd', {}, region?.name ?? result.region.slug)),
        result.energy_gain != null ? h('div', {}, h('dt', {}, 'Energy added'), h('dd', { class: 'mono' }, `+${Number(result.energy_gain).toFixed(2)}${result.resonance ? ' (resonance bonus)' : ''}`)) : null,
        result.region.state ? h('div', {}, h('dt', {}, 'Region is now'), h('dd', {}, regionStateLabel(result.region.state))) : null),
      milestones.length ? h('div', { class: 'milestone-note' }, h('p', {}, h('strong', {}, 'Your trace triggered a discovery: ')),
        h('ul', {}, milestones.map((m) => h('li', {}, h('a', { href: `/discovery/${m.discovery}`, 'data-link': '', onclick: () => dialog.close() }, MILESTONE_LABELS[m.type] ?? 'View discovery'))))) : null,
      h('h3', {}, 'Your trace card'),
      cardActions(card, { filename: `internet-organism-trace-${at.slice(0, 10)}.png`, title: 'My trace in Internet Organism', path: `/explore/${result.region.slug}` }),
      shareControls({ path: `/explore/${result.region.slug}`, title: 'Internet Organism', text: `I left a trace in ${region?.name ?? 'the organism'}.` }),
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dialog.close() }, 'Back to the organism')));
    draft = createDraft({ ...draft, nonce: undefined });
  }

  function rejected(result) {
    const retryable = result.code === 'network' || result.code === 'internal_error';
    const msg = messageFor({ code: result.code, retryAfter: result.retryAfter ?? result.retry_after });
    const actions = [h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => compose() }, 'Back')];
    if (retryable) {
      // Same nonce: if the first attempt actually succeeded, the server returns it instead of counting twice.
      actions.push(h('button', { type: 'button', class: 'btn btn-primary', onclick: send }, icon('refresh'), h('span', {}, 'Try again')));
    } else {
      draft = { ...draft, nonce: createDraft().nonce };
    }
    if (result.code === 'cooldown' && result.retryAfter) {
      actions.push(h('span', { class: 'muted fine' }, `Ready again in ${formatDuration(result.retryAfter)}.`));
    }
    content.replaceChildren(header('Not recorded'), h('p', { class: 'form-error', role: 'alert' }, msg), h('div', { class: 'dialog-actions' }, actions));
  }

  return {
    open(regionSlug) {
      if (regionSlug) draft.regionSlug = regionSlug;
      compose();
      dialog.showModal();
    },
    close() {
      dialog.close();
    },
    el: dialog,
  };
}
