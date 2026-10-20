import { describe, expect, it } from 'vitest';
import { readConfig } from '../../src/lib/config.js';
import { codeFromError, messageFor } from '../../src/utils/errors.js';
import { escapeHtml, formatDuration } from '../../src/utils/formatting.js';
import { sanitizePreferences } from '../../src/utils/preferences.js';
import { secondsUntilUtcMidnight } from '../../src/utils/dates.js';
import { generateOrganism } from '../../src/organism/generator.js';
import { INITIAL_REGIONS } from '../../src/lib/initial-world.js';
import { h } from '../../src/utils/dom.js';

describe('config', () => {
  it('falls back to demo mode without a backend', () => {
    expect(readConfig({}).demo).toBe(true);
    expect(readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' }).demo).toBe(false);
  });

  it('refuses secret keys in browser config', () => {
    const c1 = readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' });
    expect(c1).toMatchObject({ demo: true, secretKeyRejected: true, supabaseKey: '' });
    const payload = btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '');
    const c2 = readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: `h.${payload}.s` });
    expect(c2.secretKeyRejected).toBe(true);
  });

  it('only allow-lists known OAuth providers and https support links', () => {
    const c = readConfig({ VITE_AUTH_OAUTH_PROVIDERS: 'github, evil ,google', VITE_SUPPORT_EXTERNAL_URL: 'javascript:alert(1)' });
    expect(c.oauthProviders).toEqual(['github', 'google']);
    expect(c.supportExternalUrl).toBe('');
  });
});

describe('errors', () => {
  it('maps codes to actionable messages without internals', () => {
    expect(messageFor({ code: 'cooldown', retryAfter: 12 })).toMatch(/12 s/);
    expect(messageFor({ code: 'something_internal' })).toMatch(/server could not/);
    expect(codeFromError(new TypeError('Failed to fetch'))).toBe('network');
    expect(codeFromError({ code: '42501', message: 'permission denied' })).toBe('forbidden');
    expect(codeFromError({ message: 'Anonymous sign-ins are disabled' })).toBe('guest_disabled');
  });
});

describe('formatting and dates', () => {
  it('formats durations and escapes HTML', () => {
    expect(formatDuration(5)).toBe('5 s');
    expect(formatDuration(125)).toBe('3 min');
    expect(formatDuration(3 * 3600 + 600)).toBe('3 h 10 min');
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
  it('computes the UTC day boundary', () => {
    expect(secondsUntilUtcMidnight(Date.UTC(2026, 9, 20, 23, 59, 0))).toBe(60);
  });
});

describe('preferences', () => {
  it('drops unknown values', () => {
    expect(sanitizePreferences({ motion: 'wild', quality: '2d', sound: 'yes', analytics: false, evil: 1 }))
      .toEqual({ motion: 'system', quality: '2d', sound: false, analytics: false, labels: true });
  });
});

describe('organism generator', () => {
  it('is deterministic for the same world structure', () => {
    const a = generateOrganism(INITIAL_REGIONS, { quality: 'medium' });
    const b = generateOrganism(INITIAL_REGIONS, { quality: 'medium' });
    expect(a.count).toBe(b.count);
    expect([...a.positions.slice(0, 30)]).toEqual([...b.positions.slice(0, 30)]);
    expect([...a.edges]).toEqual([...b.edges]);
  });

  it('grows with region level and respects quality', () => {
    const base = generateOrganism(INITIAL_REGIONS, { quality: 'high' });
    const grown = generateOrganism(INITIAL_REGIONS.map((r, i) => ({ ...r, level: i === 0 ? 3 : 0 })), { quality: 'high' });
    const low = generateOrganism(INITIAL_REGIONS, { quality: 'low' });
    expect(grown.count).toBeGreaterThan(base.count);
    expect(low.count).toBeLessThan(base.count);
    for (let i = 0; i < base.edges.length; i++) expect(base.edges[i]).toBeLessThan(base.count);
  });
});

describe('dom helper', () => {
  it('inserts strings as text, never HTML', () => {
    const el = h('div', {}, '<img src=x onerror=alert(1)>');
    expect(el.children).toHaveLength(0);
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(() => h('div', { html: '<b>' })).toThrow();
  });
  it('sets CSS custom properties', () => {
    const el = h('div', { style: { '--hue': 120, color: 'red' } });
    expect(el.style.getPropertyValue('--hue')).toBe('120');
    expect(el.style.color).toBe('red');
  });
});
