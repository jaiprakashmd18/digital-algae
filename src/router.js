/**
 * History-API router with lazily loaded pages.
 * Each page module exports `render(ctx)` returning
 *   { el, title, description, cleanup?, noindex? }  (or a Promise of it).
 */
import { setMeta } from './utils/seo.js';

export const ROUTES = [
  { path: '/', page: () => import('./pages/home.js'), name: 'home' },
  { path: '/explore', page: () => import('./pages/explore.js'), name: 'explore' },
  { path: '/explore/:slug', page: () => import('./pages/region-detail.js'), name: 'region' },
  { path: '/discoveries', page: () => import('./pages/discoveries.js'), name: 'discoveries' },
  { path: '/discovery/:slug', page: () => import('./pages/discovery-detail.js'), name: 'discovery' },
  { path: '/evolution', page: () => import('./pages/evolution.js'), name: 'evolution' },
  { path: '/about', page: () => import('./pages/about.js'), name: 'about' },
  { path: '/support', page: () => import('./pages/support.js'), name: 'support' },
  { path: '/profile', page: () => import('./pages/profile.js'), name: 'profile' },
  { path: '/reset-password', page: () => import('./pages/profile.js'), name: 'reset-password' },
  { path: '/settings', page: () => import('./pages/settings.js'), name: 'settings' },
  { path: '/privacy', page: () => import('./pages/legal.js'), name: 'privacy' },
  { path: '/terms', page: () => import('./pages/legal.js'), name: 'terms' },
  { path: '/admin', page: () => import('./pages/admin.js'), name: 'admin' },
];

const NOT_FOUND = { path: '*', page: () => import('./pages/not-found.js'), name: 'not-found' };

export function matchRoute(pathname, routes = ROUTES) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  for (const route of routes) {
    const params = matchPath(route.path, clean);
    if (params) return { route, params };
  }
  return { route: NOT_FOUND, params: {} };
}

export function matchPath(pattern, pathname) {
  const a = pattern.split('/').filter(Boolean);
  const b = pathname.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) {
      try {
        params[a[i].slice(1)] = decodeURIComponent(b[i]);
      } catch {
        return null;
      }
    } else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function createRouter({ outlet, onNavigate }) {
  let current = null;
  let token = 0;

  async function render(url = new URL(location.href), { focus = true } = {}) {
    const my = ++token;
    const { route, params } = matchRoute(url.pathname);
    let view;
    try {
      const mod = await route.page();
      if (my !== token) return;
      current?.cleanup?.();
      current = null;
      view = await mod.render({ params, query: url.searchParams, route: route.name, url });
    } catch (e) {
      console.error(e);
      const mod = await import('./pages/not-found.js');
      view = await mod.render({ error: true });
    }
    if (my !== token) {
      view.cleanup?.();
      return;
    }
    current = view;
    outlet.replaceChildren(view.el);
    document.body.dataset.route = route.name;
    setMeta({ title: view.title, description: view.description, path: url.pathname, noindex: view.noindex, image: view.image });
    onNavigate?.(route.name, url);
    if (focus) {
      const heading = outlet.querySelector('h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
      if (!url.hash) window.scrollTo(0, 0);
    }
  }

  function navigate(href, { replace = false } = {}) {
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) {
      location.assign(url.href);
      return;
    }
    if (url.pathname === location.pathname && url.search === location.search && !replace) {
      if (url.hash) location.hash = url.hash;
      return;
    }
    history[replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search + url.hash);
    render(url);
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[data-link]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', () => render(new URL(location.href), { focus: false }));

  return { render, navigate };
}

let routerInstance = null;
export function setRouter(r) {
  routerInstance = r;
}
export function navigate(href, opts) {
  routerInstance?.navigate(href, opts);
}
