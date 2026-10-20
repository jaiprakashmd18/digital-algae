import { h, link } from '../utils/dom.js';

export function render({ error = false, missing = null } = {}) {
  const title = error ? 'Something went wrong' : missing ? `${missing} not found` : 'Page not found';
  const el = h('div', { class: 'page page-narrow' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, error ? 'Error' : '404'),
      h('h1', {}, title),
      h('p', {}, error
        ? 'This page could not be loaded. Check your connection and try again.'
        : missing
          ? `This ${missing.toLowerCase()} does not exist, or it is no longer public.`
          : 'There is nothing at this address. The organism is still out there, though.')),
    h('div', { class: 'share-controls' },
      link('/', { class: 'btn btn-primary' }, 'Back to the organism'),
      link('/discoveries', { class: 'btn btn-ghost' }, 'Browse discoveries'),
      error ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => location.reload() }, 'Reload') : null));
  return { el, title, noindex: true };
}
