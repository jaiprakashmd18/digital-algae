/**
 * Dates. Global boundaries (daily events, "today" statistics) use UTC on the
 * server; these helpers only format for local presentation.
 */

export function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatDate(value) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

export function formatUtc(value) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

export function timeAgo(value, now = Date.now()) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 10) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === 'second') return rtf.format(Math.round(diff / secs), unit);
  }
  return '';
}

/** Seconds until the next UTC midnight (when daily server boundaries reset). */
export function secondsUntilUtcMidnight(now = Date.now()) {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(0, Math.round((next - now) / 1000));
}

/** Local calendar date key (for local-only presentation like "visited today"). */
export function localDayKey(now = new Date()) {
  const d = toDate(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
