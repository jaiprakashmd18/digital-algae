import { describe, expect, it, vi } from 'vitest';
import { matchPath, matchRoute, ROUTES } from '../../src/router.js';
import { applyMeta, STATIC_ROUTES } from '../../scripts/prerender.js';
import { buildSitemap, lookupMeta, renderMetaPage } from '../../api/_lib.js';
import { NAV_LINKS } from '../../src/components/navigation.js';

describe('router', () => {
  it('matches static and parameterised routes', () => {
    expect(matchRoute('/').route.name).toBe('home');
    expect(matchRoute('/explore/').route.name).toBe('explore');
    expect(matchRoute('/discovery/the-first-trace')).toMatchObject({ route: { name: 'discovery' }, params: { slug: 'the-first-trace' } });
    expect(matchRoute('/explore/the-pulse').params.slug).toBe('the-pulse');
    expect(matchRoute('/nope').route.name).toBe('not-found');
    expect(matchRoute('/discovery/a/b').route.name).toBe('not-found');
    expect(matchPath('/discovery/:slug', '/discovery/%E0%A4%A')).toBeNull();
  });

  it('every navigation and footer link points at an existing route', () => {
    const paths = ['/', ...NAV_LINKS.map((l) => l.href), '/support', '/privacy', '/terms', '/settings', '/profile', '/admin'];
    for (const p of paths) expect(matchRoute(p).route.name, p).not.toBe('not-found');
  });

  it('every prerendered route exists in the router', () => {
    for (const r of STATIC_ROUTES) expect(ROUTES.some((x) => x.path === r.path), r.path).toBe(true);
  });
});

const SHELL = `<title>x</title><meta name="description" content="d" /><link rel="canonical" href="c" />
<meta property="og:title" content="t" /><meta property="og:description" content="d" /><meta property="og:url" content="u" />
<meta property="og:image" content="i" /><meta name="robots" content="index, follow" />`;

describe('metadata', () => {
  it('replaces head tags and escapes values', () => {
    const html = applyMeta(SHELL, { siteUrl: 'https://io.example', path: '/discovery/x', title: 'A "quote" <b>', description: 'D & E' });
    expect(html).toContain('<title>A &quot;quote&quot; &lt;b&gt; · Internet Organism</title>');
    expect(html).toContain('content="D &amp; E"');
    expect(html).toContain('href="https://io.example/discovery/x"');
    expect(html).not.toContain('<b>');
  });

  it('missing records render noindex', () => {
    const html = renderMetaPage(SHELL, 'https://io.example', null, '/discovery/gone');
    expect(html).toContain('noindex, nofollow');
  });

  it('looks up discoveries with the public key and rejects bad slugs without a request', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => [{ title: 'T', description: 'D' }] }));
    const cfg = { supabaseUrl: 'https://p.supabase.co', supabaseKey: 'pub' };
    expect(await lookupMeta(cfg, 'discovery', 'the-first-trace', fetchImpl)).toEqual({ title: 'T', description: 'D', path: '/discovery/the-first-trace' });
    expect(fetchImpl.mock.calls[0][0]).toContain('visibility=eq.public');
    expect(await lookupMeta(cfg, 'discovery', 'x&select=*', fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('builds a sitemap without private routes', () => {
    const xml = buildSitemap('https://io.example', { discoveries: [{ slug: 'the-first-trace', created_at: '2026-10-20T00:00:00Z' }, { slug: 'bad slug' }], regions: [{ slug: 'the-core' }] });
    expect(xml).toContain('https://io.example/discovery/the-first-trace');
    expect(xml).toContain('https://io.example/explore/the-core');
    expect(xml).not.toContain('bad slug');
    expect(xml).not.toMatch(/\/admin|\/profile|\/settings/);
  });
});
