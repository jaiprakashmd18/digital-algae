/**
 * /support — optional one-time support. Checkout is created server-side by
 * the create-checkout Edge Function with server-defined amounts; nothing
 * here can set a price, and success is only ever confirmed by the payment
 * provider's verified webhook. If no provider is configured, the page says so.
 */
import { h, icon, link, statusMessage } from '../utils/dom.js';
import { config } from '../lib/config.js';
import { api } from '../lib/api.js';
import { messageFor } from '../utils/errors.js';
import { track } from '../services/analytics-service.js';

export const SUPPORT_TIERS = Object.freeze([
  { key: 'spark', label: '€3', note: 'A spark' },
  { key: 'pulse', label: '€5', note: 'A pulse' },
  { key: 'bloom', label: '€10', note: 'A bloom' },
  { key: 'canopy', label: '€25', note: 'A canopy' },
]);

export function render({ query }) {
  const status = query.get('checkout');
  const out = h('div', { 'aria-live': 'polite' });
  let content;

  if (config.supportCheckout) {
    let tier = 'pulse';
    const tiers = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Amount' },
      SUPPORT_TIERS.map((t) => h('label', {}, h('input', { type: 'radio', name: 'tier', value: t.key, checked: t.key === tier, onchange: () => (tier = t.key) }), h('span', {}, `${t.label} · ${t.note}`))));
    const ack = h('input', { type: 'checkbox', id: 'ack' });
    const name = h('input', { type: 'text', id: 'ack-name', maxlength: 40, disabled: true, autocomplete: 'nickname' });
    ack.addEventListener('change', () => (name.disabled = !ack.checked));
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('heart'), h('span', {}, 'Continue to secure checkout'));
    const form = h('form', { class: 'form' }, h('fieldset', { class: 'field' }, h('legend', {}, 'Choose an amount (one-time)'), tiers),
      h('label', { class: 'check' }, ack, h('span', {}, 'Thank me publicly on the supporters list')),
      h('div', { class: 'field' }, h('label', { for: 'ack-name' }, 'Name to show (optional)'), name),
      submit, out,
      h('p', { class: 'fine muted' }, 'You will be redirected to our payment provider. We never see or store your card details. Payments are confirmed only by the provider.'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      out.replaceChildren(statusMessage('info', 'Creating a secure checkout…'));
      const r = await api().startCheckout({ tier, acknowledge: ack.checked, publicName: ack.checked ? name.value.trim() : '' });
      if (r.ok) {
        track('support_checkout_started');
        location.assign(r.url);
      } else {
        submit.disabled = false;
        out.replaceChildren(statusMessage('error', messageFor(r)));
      }
    });
    content = form;
  } else if (config.supportExternalUrl) {
    content = h('div', { class: 'section' },
      h('p', {}, 'Support is handled by an external platform chosen by the operators.'),
      h('a', { class: 'btn btn-primary', href: config.supportExternalUrl, rel: 'noopener', target: '_blank' }, icon('external'), h('span', {}, 'Support on the external page')));
  } else {
    content = statusMessage('info', 'Online support is not set up on this site yet. When the operators connect a payment provider, you will be able to contribute here. No payment can be taken until then.');
  }

  const wall = h('div', { class: 'section' });
  api().getSupporterWall().then((list) => {
    wall.replaceChildren(h('h2', {}, 'Supporters'), list.length
      ? h('ul', { class: 'tags' }, list.map((s) => h('li', { class: 'tag' }, s.name)))
      : h('p', { class: 'muted fine' }, 'No public acknowledgements yet. Only supporters who opt in are listed.'));
  }).catch(() => wall.replaceChildren());

  const el = h('div', { class: 'page page-narrow' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Support'),
      h('h1', {}, 'Keep the organism alive'),
      h('p', {}, 'Internet Organism is free and will stay free. Support helps pay for the database, realtime connections, hosting and continued development.')),
    status === 'success' ? statusMessage('success', 'Thank you. Your payment is being confirmed by the provider; if you asked to be acknowledged, your name appears once it is confirmed.') : null,
    status === 'cancelled' ? statusMessage('info', 'Checkout was cancelled. You have not been charged.') : null,
    h('div', { class: 'section' }, content),
    h('div', { class: 'section prose' },
      h('h2', {}, 'What support does — and does not — do'),
      h('ul', {},
        h('li', {}, 'It does not give you more energy, more traces, or any control over the shared world.'),
        h('li', {}, 'Any future supporter perks will be cosmetic (for example extra trace styles or personal view presets) and clearly described before purchase.'),
        h('li', {}, 'One-time contributions are not subscriptions. Refund requests: see the ', link('/terms', {}, 'terms'), '.'))),
    wall);
  return { el, title: 'Support the organism', description: 'Help cover hosting and development. The organism stays free; support never buys control of the shared world.' };
}
