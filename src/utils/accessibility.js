/**
 * Accessibility helpers: a polite live region for world events, reduced
 * motion detection, and focus management for dialogs.
 */
import { getPreference } from './preferences.js';

let liveRegion = null;
let lastAnnounce = 0;
let pending = null;

export function mountLiveRegion() {
  if (liveRegion) return liveRegion;
  liveRegion = document.createElement('div');
  liveRegion.className = 'visually-hidden';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  liveRegion.id = 'live-announcer';
  document.body.append(liveRegion);
  return liveRegion;
}

/** Announce to screen readers, throttled so bursts of events don't flood. */
export function announce(message, { minIntervalMs = 4000 } = {}) {
  if (!liveRegion) mountLiveRegion();
  const now = Date.now();
  const wait = Math.max(0, lastAnnounce + minIntervalMs - now);
  clearTimeout(pending);
  pending = setTimeout(() => {
    lastAnnounce = Date.now();
    liveRegion.textContent = '';
    // A fresh text node makes repeated identical messages re-announce.
    requestAnimationFrame(() => (liveRegion.textContent = message));
  }, wait);
}

export function prefersReducedMotion() {
  const pref = getPreference('motion');
  if (pref === 'reduce') return true;
  if (pref === 'full') return false;
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab focus inside `container`; returns a release function. */
export function trapFocus(container) {
  const previous = document.activeElement;
  function onKey(e) {
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  container.addEventListener('keydown', onKey);
  return () => {
    container.removeEventListener('keydown', onKey);
    if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
  };
}
