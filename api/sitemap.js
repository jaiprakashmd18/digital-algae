/** /sitemap.xml — static pages plus public regions and discoveries. */
import { buildSitemap, env, originOf, supabaseGet } from './_lib.js';

export default async function handler(req, res) {
  const cfg = env();
  const origin = originOf(req, cfg);
  let discoveries = [];
  let regions = [];
  if (cfg.supabaseUrl && cfg.supabaseKey) {
    try {
      [discoveries, regions] = await Promise.all([
        supabaseGet(cfg, '/rest/v1/discoveries?select=slug,created_at&visibility=eq.public&order=created_at.desc&limit=1000'),
        supabaseGet(cfg, '/rest/v1/regions?select=slug&visibility=eq.public&limit=100'),
      ]);
    } catch {
      // Serve the static part of the sitemap if the backend is unavailable.
    }
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.end(buildSitemap(origin, { discoveries, regions }));
}
