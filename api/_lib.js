/**
 * Shared helpers for the Vercel functions. Files starting with "_" are not
 * exposed as routes. These functions only use the public publishable/anon
 * key and public, RLS-filtered data.
 */
import { STATIC_ROUTES, applyMeta, escapeAttr } from '../scripts/prerender.js';

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function env() {
  const e = process.env;
  return {
    supabaseUrl: (e.SUPABASE_URL || e.VITE_SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseKey: e.SUPABASE_PUBLISHABLE_KEY || e.VITE_SUPABASE_PUBLISHABLE_KEY || e.SUPABASE_ANON_KEY || e.VITE_SUPABASE_ANON_KEY || '',
    siteUrl: (e.VITE_PUBLIC_SITE_URL || '').replace(/\/+$/, ''),
  };
}

export async function supabaseGet(cfg, path, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.supabaseUrl}${path}`, {
    headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return res.json();
}

export async function supabaseRpc(cfg, name, body, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return res.json();
}

/** Look up public metadata for a discovery or region. Returns null if missing. */
export async function lookupMeta(cfg, type, slug, fetchImpl = fetch) {
  if (!SLUG.test(slug) || slug.length > 80) return null;
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return null;
  if (type === 'discovery') {
    const rows = await supabaseGet(cfg, `/rest/v1/discoveries?select=title,description&visibility=eq.public&slug=eq.${encodeURIComponent(slug)}&limit=1`, fetchImpl);
    return rows[0] ? { title: rows[0].title, description: rows[0].description, path: `/discovery/${slug}` } : null;
  }
  if (type === 'region') {
    const r = await supabaseRpc(cfg, 'get_region_detail', { p_slug: slug }, fetchImpl);
    return r ? { title: r.name, description: r.description, path: `/explore/${slug}` } : null;
  }
  return null;
}

export function renderMetaPage(shell, siteUrl, meta, fallbackPath) {
  if (!meta) {
    return applyMeta(shell, { siteUrl, path: fallbackPath, title: 'Not found', description: 'This page does not exist or is no longer public.', noindex: true });
  }
  return applyMeta(shell, { siteUrl, path: meta.path, title: meta.title, description: String(meta.description).slice(0, 300) });
}

export function buildSitemap(siteUrl, { discoveries = [], regions = [] } = {}) {
  const urls = [
    { loc: `${siteUrl}/`, priority: '1.0', changefreq: 'hourly' },
    ...STATIC_ROUTES.filter((r) => !r.noindex).map((r) => ({ loc: `${siteUrl}${r.path}`, priority: '0.6', changefreq: 'daily' })),
    ...regions.filter((r) => SLUG.test(r.slug)).map((r) => ({ loc: `${siteUrl}/explore/${r.slug}`, priority: '0.7', changefreq: 'hourly' })),
    ...discoveries.filter((d) => SLUG.test(d.slug)).map((d) => ({ loc: `${siteUrl}/discovery/${d.slug}`, lastmod: d.created_at?.slice(0, 10), priority: '0.5', changefreq: 'monthly' })),
  ];
  const body = urls.map((u) => `  <url><loc>${escapeAttr(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function originOf(req, cfg) {
  if (cfg.siteUrl) return cfg.siteUrl;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}
