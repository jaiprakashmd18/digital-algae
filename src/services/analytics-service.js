/**
 * Privacy-conscious analytics. Off by default (VITE_ANALYTICS_PROVIDER).
 *  - aggregate: increments daily counters in our own database — no ids,
 *    no IPs, no cookies.
 *  - plausible: forwards event names to a configured Plausible domain.
 * Respects the visitor's opt-out in Settings and Global Privacy Control /
 * Do Not Track.
 */
import { config } from '../lib/config.js';
import { api } from '../lib/api.js';
import { getPreference, localGet, localSet } from '../utils/preferences.js';
import { localDayKey } from '../utils/dates.js';

const ONCE = new Set();

export function analyticsEnabled() {
  if (config.analyticsProvider === 'off') return false;
  if (!getPreference('analytics')) return false;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1') return false;
  return true;
}

export function track(event, { oncePerPage = false } = {}) {
  if (oncePerPage) {
    if (ONCE.has(event)) return;
    ONCE.add(event);
  }
  if (!analyticsEnabled()) return;
  if (config.analyticsProvider === 'aggregate') api().track(event);
  else if (config.analyticsProvider === 'plausible') window.plausible?.(event);
}

export function initAnalytics() {
  if (config.analyticsProvider === 'plausible' && config.plausibleDomain && analyticsEnabled()) {
    const s = document.createElement('script');
    s.defer = true;
    s.dataset.domain = config.plausibleDomain;
    s.src = 'https://plausible.io/js/script.manual.js';
    document.head.append(s);
    window.plausible = window.plausible || function (...args) {
      (window.plausible.q = window.plausible.q || []).push(args);
    };
  }
  track('landing_visit', { oncePerPage: true });

  const today = localDayKey();
  const last = localGet('io:last-visit');
  if (last && last !== today) track('return_visit', { oncePerPage: true });
  localSet('io:last-visit', today);

  // Referral attribution: count the visit, then drop the parameter so it is
  // not re-shared. It never affects world statistics.
  const url = new URL(location.href);
  const ref = url.searchParams.get('ref');
  if (ref) {
    if (['copy', 'native', 'card'].includes(ref)) track('shared_link_visit', { oncePerPage: true });
    url.searchParams.delete('ref');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
}
