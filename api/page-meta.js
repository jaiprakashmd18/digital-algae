/**
 * Serves the SPA shell for /discovery/:slug and /explore/:slug with
 * server-rendered <title>, description, canonical and Open Graph tags, so
 * shared links preview correctly. The client app then renders the page.
 * Missing records get a 404 status (and noindex) but still load the app,
 * which shows its own "not found" view.
 */
import { env, lookupMeta, originOf, renderMetaPage, SLUG } from './_lib.js';

export default async function handler(req, res) {
  const cfg = env();
  const type = req.query.type === 'region' ? 'region' : 'discovery';
  const slug = String(req.query.slug ?? '');
  const origin = originOf(req, cfg);
  const fallbackPath = type === 'region' ? `/explore/${SLUG.test(slug) ? slug : ''}` : `/discovery/${SLUG.test(slug) ? slug : ''}`;

  let shell;
  try {
    const r = await fetch(`${origin}/app-shell.html`);
    if (!r.ok) throw new Error(String(r.status));
    shell = await r.text();
  } catch {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    return res.end();
  }

  let meta = null;
  let lookupFailed = false;
  try {
    meta = await lookupMeta(cfg, type, slug);
  } catch {
    lookupFailed = true;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (lookupFailed) {
    // Backend unavailable: serve the plain shell; the client shows its own state.
    res.setHeader('Cache-Control', 'no-store');
    return res.end(shell);
  }
  res.statusCode = meta ? 200 : 404;
  res.setHeader('Cache-Control', meta ? 'public, s-maxage=300, stale-while-revalidate=600' : 'public, s-maxage=60');
  return res.end(renderMetaPage(shell, origin, meta, fallbackPath));
}
