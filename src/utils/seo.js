/**
 * Per-route document metadata. Static routes are also prerendered at build
 * time (scripts/prerender.js) and discovery/region pages get server-side
 * metadata from the Vercel functions in /api, so crawlers that do not run
 * JavaScript still see meaningful titles and descriptions.
 */
import { config } from '../lib/config.js';

export const SITE_NAME = 'Internet Organism';
export const DEFAULT_DESCRIPTION = 'One internet. One living organism. A persistent digital life form shared by everyone who visits — every trace you leave changes the world.';

function setTag(selector, create, attr, value) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = create();
    document.head.append(el);
  }
  el.setAttribute(attr, value);
}

const meta = (name, prop = false) => () => {
  const m = document.createElement('meta');
  m.setAttribute(prop ? 'property' : 'name', name);
  return m;
};

export function setMeta({ title, description, path = '/', noindex = false, image = null }) {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} — One internet. One living organism.`;
  const desc = description || DEFAULT_DESCRIPTION;
  const url = `${config.siteUrl}${path}`;
  document.title = fullTitle;
  setTag('meta[name="description"]', meta('description'), 'content', desc);
  setTag('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', url);
  setTag('meta[property="og:title"]', meta('og:title', true), 'content', fullTitle);
  setTag('meta[property="og:description"]', meta('og:description', true), 'content', desc);
  setTag('meta[property="og:url"]', meta('og:url', true), 'content', url);
  setTag('meta[property="og:image"]', meta('og:image', true), 'content', image || `${config.siteUrl}/images/og-default.png`);
  setTag('meta[name="twitter:card"]', meta('twitter:card'), 'content', 'summary_large_image');
  setTag('meta[name="robots"]', meta('robots'), 'content', noindex ? 'noindex, nofollow' : 'index, follow');
}
