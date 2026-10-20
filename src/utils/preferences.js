/**
 * Per-viewer preferences. Stored locally (works without an account) and,
 * for signed-in accounts, synced to user_preferences by profile-service.
 */
const KEY = 'io:prefs:v1';

export const DEFAULT_PREFERENCES = Object.freeze({
  motion: 'system', // system | reduce | full
  quality: 'auto', // auto | low | medium | high | 2d
  sound: false,
  analytics: true,
  labels: true,
});

const listeners = new Set();
let cache = null;

function load() {
  if (cache) return cache;
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    stored = {};
  }
  cache = sanitizePreferences({ ...DEFAULT_PREFERENCES, ...stored });
  return cache;
}

export function sanitizePreferences(p) {
  const out = { ...DEFAULT_PREFERENCES };
  if (['system', 'reduce', 'full'].includes(p?.motion)) out.motion = p.motion;
  if (['auto', 'low', 'medium', 'high', '2d'].includes(p?.quality)) out.quality = p.quality;
  if (typeof p?.sound === 'boolean') out.sound = p.sound;
  if (typeof p?.analytics === 'boolean') out.analytics = p.analytics;
  if (typeof p?.labels === 'boolean') out.labels = p.labels;
  return out;
}

export function getPreferences() {
  return { ...load() };
}

export function getPreference(key) {
  return load()[key];
}

export function setPreferences(patch) {
  cache = sanitizePreferences({ ...load(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage unavailable (private mode): keep in memory for this visit.
  }
  for (const fn of listeners) fn(getPreferences());
  return getPreferences();
}

export function onPreferencesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Small key/value helpers for local conveniences (never security relevant). */
export function localGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function localSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function localRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
