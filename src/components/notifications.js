/**
 * Toasts for short confirmations and errors. Non-blocking, dismissible,
 * announced to screen readers. Never used for marketing or nags.
 */
import { h, icon } from '../utils/dom.js';

let region = null;

function mount() {
  if (region) return region;
  region = h('div', { class: 'toasts', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  document.body.append(region);
  return region;
}

export function notify(message, { kind = 'info', timeout = 5000, action = null } = {}) {
  mount();
  const close = h('button', { type: 'button', class: 'icon-btn toast-close', 'aria-label': 'Dismiss' }, icon('x', { size: 16 }));
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info'),
    h('p', {}, message),
    action ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { action.run(); dismiss(); } }, action.label) : null,
    close);
  const dismiss = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  close.addEventListener('click', dismiss);
  region.append(el);
  if (region.children.length > 3) region.firstElementChild.remove();
  if (timeout) setTimeout(dismiss, timeout);
  return dismiss;
}
