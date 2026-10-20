/**
 * Client-side validation. This is for fast feedback only — the database
 * re-validates everything in submit_trace() and other functions.
 */
import { TRACE_PATTERNS, TRACE_PERSISTENCE } from './world-model.js';

const HEX = /^#[0-9a-f]{6}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DISPLAY_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u;

export function normalizeColor(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Validate a trace draft. Returns { ok: true, value } with normalized values,
 * or { ok: false, field, message }.
 */
export function validateTrace(draft) {
  if (!draft || typeof draft !== 'object') return fail('trace', 'Missing trace.');
  const regionSlug = String(draft.regionSlug ?? '');
  if (!SLUG.test(regionSlug) || regionSlug.length > 48) return fail('region', 'Choose a region.');
  if (!TRACE_PATTERNS.includes(draft.pattern)) return fail('pattern', 'Choose a pattern.');
  const color = normalizeColor(draft.color);
  if (!HEX.test(color)) return fail('color', 'Choose a colour.');
  const intensity = Math.round(Number(draft.intensity) * 100) / 100;
  if (!Number.isFinite(intensity) || intensity < 0.1 || intensity > 1) {
    return fail('intensity', 'Intensity must be between 10% and 100%.');
  }
  if (!TRACE_PERSISTENCE.includes(draft.persistence)) return fail('persistence', 'Choose how long it lingers.');
  const nonce = String(draft.nonce ?? '');
  if (!UUID.test(nonce)) return fail('nonce', 'Internal error: missing request id.');
  return { ok: true, value: { regionSlug, pattern: draft.pattern, color, intensity, persistence: draft.persistence, nonce } };
}

export function validateDisplayName(name) {
  const value = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 24) return fail('display_name', 'Use 2–24 characters.');
  if (!DISPLAY_NAME.test(value)) {
    return fail('display_name', 'Start with a letter or number; then letters, numbers, spaces, “_”, “.” or “-”.');
  }
  return { ok: true, value };
}

export function validateEmail(email) {
  const value = String(email ?? '').trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return fail('email', 'Enter a valid email address.');
  return { ok: true, value };
}

export function validatePassword(password) {
  const value = String(password ?? '');
  if (value.length < 10) return fail('password', 'Use at least 10 characters.');
  if (value.length > 72) return fail('password', 'Use at most 72 characters.');
  return { ok: true, value };
}

export function isSlug(value) {
  return typeof value === 'string' && value.length <= 80 && SLUG.test(value);
}

export function newNonce() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function fail(field, message) {
  return { ok: false, field, message };
}
