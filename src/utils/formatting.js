export function formatNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
}

export function formatEnergy(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(1);
}

export function formatPercent(fraction) {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

/** Seconds → "45 s", "3 min", "2 h 10 min". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (s < 60) return `${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function pluralize(n, one, many = `${one}s`) {
  return `${formatNumber(n)} ${Number(n) === 1 ? one : many}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function hsl(hue, s = 90, l = 62) {
  return `hsl(${hue} ${s}% ${l}%)`;
}

export const PATTERN_LABELS = Object.freeze({
  spark: 'Spark',
  spiral: 'Spiral',
  ripple: 'Ripple',
  bloom: 'Bloom',
  filament: 'Filament',
});

export const ORIGIN_LABELS = Object.freeze({
  seeded: 'Initial structure',
  system: 'System-generated',
  participant: 'Triggered by a visitor',
});
