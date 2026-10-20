import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/reset.css';
import './styles/variables.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/organism.css';

import { config } from './lib/config.js';
import { initApi, api } from './lib/api.js';
import { initAuth } from './lib/auth.js';
import { createRouter, setRouter } from './router.js';
import { createFooter, createNavigation } from './components/navigation.js';
import { startWorld } from './services/world-service.js';
import { initAnalytics } from './services/analytics-service.js';
import { mountLiveRegion } from './utils/accessibility.js';
import { h, link } from './utils/dom.js';
import { syncPreferencesOnSignIn } from './services/profile-service.js';

function installErrorReporting() {
  let sent = 0;
  const report = (code, message) => {
    if (sent++ > 5) return;
    try {
      api().logError(code, String(message).slice(0, 300), location.pathname);
    } catch {
      // Reporting must never break the page.
    }
  };
  window.addEventListener('error', (e) => report('window_error', e.message));
  window.addEventListener('unhandledrejection', (e) => report('unhandled_rejection', e.reason?.message ?? e.reason));
}

async function boot() {
  const app = document.getElementById('app');
  mountLiveRegion();
  await initApi();

  const nav = createNavigation();
  const outlet = h('main', { id: 'main', class: 'main' });
  const skip = h('a', { class: 'skip-link', href: '#main' }, 'Skip to content');
  const banner = config.demo
    ? h('div', { class: 'demo-banner', role: 'note' },
      h('strong', {}, 'Demo mode. '),
      config.secretKeyRejected
        ? 'A secret Supabase key was configured for the browser and was refused. Use the publishable (anon) key. '
        : 'No backend is configured, so this world is stored only in your browser and is not shared with anyone. ',
      link('/about#demo', {}, 'What this means'))
    : null;
  app.replaceChildren(skip, banner ?? '', nav.el, outlet, createFooter());
  document.body.classList.toggle('is-demo', config.demo);

  const router = createRouter({ outlet, onNavigate: (route) => nav.setActive(route) });
  setRouter(router);

  installErrorReporting();
  initAuth().then(syncPreferencesOnSignIn).catch(() => {});
  startWorld();
  await router.render(new URL(location.href), { focus: false });
  initAnalytics();
}

boot();
