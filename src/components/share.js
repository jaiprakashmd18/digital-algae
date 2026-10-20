/**
 * Sharing: copy link, native share (when supported) and generated PNG cards
 * for traces and milestones. Cards contain only the public pseudonym,
 * region, time and a link — never account identifiers.
 */
import { h, icon } from '../utils/dom.js';
import { notify } from './notifications.js';
import { track } from '../services/analytics-service.js';
import { config } from '../lib/config.js';
import { mulberry32 } from '../organism/generator.js';
import { formatUtc } from '../utils/dates.js';
import { PATTERN_LABELS } from '../utils/formatting.js';

export function shareUrl(path, source) {
  const url = new URL(path, config.siteUrl);
  if (source) url.searchParams.set('ref', source);
  return url.toString();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without async clipboard permission.
    const ta = h('textarea', { class: 'visually-hidden', readonly: true }, text);
    document.body.append(ta);
    ta.select();
    let ok;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Copy-link + native share buttons. */
export function shareControls({ path, title, text }) {
  const copy = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('copy'), h('span', {}, 'Copy link'));
  copy.addEventListener('click', async () => {
    const ok = await copyText(shareUrl(path, 'copy'));
    if (ok) {
      track('share_copy');
      notify('Link copied.', { kind: 'success', timeout: 2500 });
    } else {
      notify(`Copy this link: ${shareUrl(path)}`, { timeout: 10000 });
    }
  });
  const items = [copy];
  if (navigator.share) {
    const native = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('share'), h('span', {}, 'Share'));
    native.addEventListener('click', async () => {
      try {
        await navigator.share({ title, text, url: shareUrl(path, 'native') });
        track('share_native');
      } catch (e) {
        if (e?.name !== 'AbortError') notify('Sharing is not available here. Use “Copy link” instead.');
      }
    });
    items.push(native);
  }
  return h('div', { class: 'share-controls' }, items);
}

// ------------------------------------------------------------------ cards

const W = 1200;
const H = 630;

function baseCard(ctx, accent) {
  const g = ctx.createRadialGradient(W * 0.68, H * 0.45, 20, W * 0.68, H * 0.45, W * 0.75);
  g.addColorStop(0, '#0d1b2e');
  g.addColorStop(1, '#04060c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rand = mulberry32(42);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(160,200,255,${0.05 + rand() * 0.25})`;
    ctx.fillRect(rand() * W, rand() * H, 1.4, 1.4);
  }
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.25;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.globalAlpha = 1;
}

function drawGlyph(ctx, cx, cy, pattern, color, intensity, seed) {
  const rand = mulberry32(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const R = 150 + intensity * 70;
  const dot = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.25, hexA(color, a * 0.9));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.strokeStyle = hexA(color, 0.5);
  ctx.lineWidth = 1.4;
  if (pattern === 'ripple') {
    for (let i = 1; i <= 5; i++) {
      ctx.globalAlpha = 1 - i / 6;
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (pattern === 'spiral') {
    ctx.beginPath();
    for (let t = 0; t < 26; t += 0.05) ctx.lineTo(cx + Math.cos(t) * t * (R / 26), cy + Math.sin(t) * t * (R / 26));
    ctx.stroke();
  } else if (pattern === 'bloom') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * R * 0.45, cy + Math.sin(a) * R * 0.45, R * 0.5, R * 0.18, a, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (pattern === 'filament') {
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      let x = cx;
      let y = cy;
      ctx.moveTo(x, y);
      const a = rand() * Math.PI * 2;
      for (let s = 0; s < 12; s++) {
        x += Math.cos(a + (rand() - 0.5)) * R / 10;
        y += Math.sin(a + (rand() - 0.5)) * R / 10;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      dot(x, y, 10, 0.8);
    }
  } else {
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const r = R * (0.4 + rand() * 0.6);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * R;
    dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4 + rand() * 10, 0.5 + rand() * 0.5);
  }
  dot(cx, cy, 46 + intensity * 30, 1);
  ctx.restore();
}

function hexA(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function text(ctx, str, x, y, { size = 28, weight = 400, color = '#e9f1ff', font = 'Inter Variable, Inter, system-ui, sans-serif', max = 560 } = {}) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillText(str, x, y, max);
}

export function renderTraceCard({ alias, regionName, pattern, color, intensity, at }) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  baseCard(ctx, color);
  drawGlyph(ctx, 860, 315, pattern, color, intensity, Date.parse(at) | 0);
  text(ctx, 'INTERNET ORGANISM', 72, 104, { size: 20, weight: 600, color: '#8fb3d9', font: 'JetBrains Mono Variable, ui-monospace, monospace' });
  text(ctx, `${alias} left a trace`, 72, 220, { size: 52, weight: 600 });
  text(ctx, `${PATTERN_LABELS[pattern] ?? 'Trace'} in ${regionName}`, 72, 286, { size: 34, color: '#b9c9e0' });
  text(ctx, formatUtc(at), 72, 344, { size: 24, color: '#7f93b0', font: 'JetBrains Mono Variable, ui-monospace, monospace' });
  text(ctx, 'One internet. One living organism.', 72, 520, { size: 24, color: '#8fb3d9' });
  text(ctx, new URL(config.siteUrl).host, 72, 560, { size: 22, color: '#5f7391', font: 'JetBrains Mono Variable, ui-monospace, monospace' });
  return c;
}

export function renderMilestoneCard({ title, subtitle, at, hue = 188 }) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const color = hslHex(hue);
  baseCard(ctx, color);
  drawGlyph(ctx, 900, 315, 'bloom', color, 0.9, hue * 7919);
  text(ctx, 'INTERNET ORGANISM · MILESTONE', 72, 104, { size: 20, weight: 600, color: '#8fb3d9', font: 'JetBrains Mono Variable, ui-monospace, monospace' });
  wrap(ctx, title, 72, 210, 640, 58, { size: 50, weight: 600 });
  if (subtitle) wrap(ctx, subtitle, 72, 380, 640, 34, { size: 24, color: '#b9c9e0' });
  text(ctx, formatUtc(at), 72, 520, { size: 22, color: '#7f93b0', font: 'JetBrains Mono Variable, ui-monospace, monospace' });
  text(ctx, new URL(config.siteUrl).host, 72, 560, { size: 22, color: '#5f7391', font: 'JetBrains Mono Variable, ui-monospace, monospace' });
  return c;
}

function wrap(ctx, str, x, y, max, lh, opts) {
  ctx.font = `${opts.weight ?? 400} ${opts.size}px Inter Variable, Inter, system-ui, sans-serif`;
  const words = String(str).split(/\s+/);
  let line = '';
  let yy = y;
  let lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > max && line) {
      text(ctx, line, x, yy, { ...opts, max });
      line = w;
      yy += lh;
      if (++lines >= 3) return;
    } else line = test;
  }
  if (line) text(ctx, line, x, yy, { ...opts, max });
}

function hslHex(hue) {
  const s = 0.85;
  const l = 0.6;
  const k = (n) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Card preview with download + share-as-file controls. */
export function cardActions(canvas, { filename, title, path }) {
  const img = h('img', { class: 'card-preview', alt: title, src: canvas.toDataURL('image/png') });
  const download = h('a', { class: 'btn btn-ghost btn-sm', href: img.src, download: filename }, icon('download'), h('span', {}, 'Download image'));
  download.addEventListener('click', () => track('share_card'));
  const actions = [download];
  if (navigator.canShare) {
    const share = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('share'), h('span', {}, 'Share image'));
    share.addEventListener('click', async () => {
      try {
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        const file = new File([blob], filename, { type: 'image/png' });
        if (!navigator.canShare({ files: [file] })) throw new Error('unsupported');
        await navigator.share({ files: [file], title, url: shareUrl(path, 'card') });
        track('share_card');
      } catch (e) {
        if (e?.name !== 'AbortError') notify('Image sharing is not supported here — download the image instead.');
      }
    });
    actions.push(share);
  }
  return h('div', { class: 'card-block' }, img, h('div', { class: 'share-controls' }, actions));
}
