/**
 * Site header: brand, primary links, connection status, account link and a
 * mobile menu (a disclosure with focus management and Escape to close).
 */
import { h, icon, link } from '../utils/dom.js';
import { onWorldChange, world } from '../services/world-service.js';
import { CONNECTION_LABELS } from '../lib/realtime.js';
import { authState, isPermanentUser, onAuth } from '../lib/auth.js';

export const NAV_LINKS = [
  { href: '/', label: 'Organism', route: 'home' },
  { href: '/explore', label: 'Explore', route: 'explore' },
  { href: '/discoveries', label: 'Discoveries', route: 'discoveries' },
  { href: '/evolution', label: 'Evolution', route: 'evolution' },
  { href: '/about', label: 'About', route: 'about' },
];

export function createNavigation() {
  const status = h('span', { class: 'conn', 'data-state': 'connecting' },
    h('span', { class: 'conn-dot', 'aria-hidden': 'true' }), h('span', { class: 'conn-label' }, 'Connecting'));
  const statusWrap = h('div', { class: 'conn-wrap', role: 'status', 'aria-live': 'polite', title: 'Connection to the shared world' }, status);

  const links = NAV_LINKS.map((l) => link(l.href, { class: 'nav-link', dataset: { route: l.route } }, l.label));
  const account = link('/profile', { class: 'nav-account', 'aria-label': 'Your profile' }, icon('user'), h('span', { class: 'nav-account-label' }, 'Profile'));
  const settings = link('/settings', { class: 'nav-account', 'aria-label': 'Settings' }, icon('settings'));

  const menuButton = h('button', { type: 'button', class: 'icon-btn nav-toggle', 'aria-expanded': 'false', 'aria-controls': 'site-menu', 'aria-label': 'Open menu' }, icon('menu'));
  const menu = h('div', { class: 'nav-menu', id: 'site-menu' },
    h('nav', { class: 'nav-links', 'aria-label': 'Primary' }, links),
    h('div', { class: 'nav-secondary' }, statusWrap, settings, account));

  const header = h('header', { class: 'site-header' },
    link('/', { class: 'brand', 'aria-label': 'Internet Organism — home' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('span', { class: 'brand-name' }, 'Internet Organism')),
    menuButton, menu);

  function setOpen(open) {
    header.classList.toggle('menu-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menuButton.replaceChildren(icon(open ? 'x' : 'menu'));
    if (open) links[0].focus();
  }
  menuButton.addEventListener('click', () => setOpen(!header.classList.contains('menu-open')));
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && header.classList.contains('menu-open')) {
      setOpen(false);
      menuButton.focus();
    }
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });

  const renderStatus = (s) => {
    const state = s.connection;
    status.dataset.state = state;
    status.querySelector('.conn-label').textContent = CONNECTION_LABELS[state] ?? state;
  };
  onWorldChange(renderStatus);
  renderStatus(world());

  const renderAuth = ({ user }) => {
    account.querySelector('.nav-account-label').textContent = isPermanentUser(user) ? 'Profile' : 'Sign in';
  };
  onAuth(renderAuth);
  renderAuth(authState());

  return {
    el: header,
    setActive(route) {
      for (const a of links) {
        const active = a.dataset.route === route || (route === 'region' && a.dataset.route === 'explore') || (route === 'discovery' && a.dataset.route === 'discoveries');
        if (active) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
  };
}

export function createFooter() {
  return h('footer', { class: 'site-footer' },
    h('p', { class: 'footer-tag' }, 'One internet. One living organism.'),
    h('nav', { 'aria-label': 'Footer' },
      link('/about', {}, 'About'), link('/support', {}, 'Support'), link('/privacy', {}, 'Privacy'),
      link('/terms', {}, 'Terms'), link('/settings', {}, 'Settings')));
}
