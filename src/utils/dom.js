/**
 * Tiny DOM helpers. User-supplied strings are only ever inserted as text
 * nodes — never as HTML — so no visitor content can inject markup.
 */
import {
  createElement, Activity, Bookmark, BookmarkCheck, Check, ChevronLeft, ChevronRight, CircleAlert, Clock, Compass,
  Copy, Crosshair, Download, ExternalLink, Eye, Flag, Heart, History, Info, Layers, LogOut, Menu, Orbit, RefreshCw,
  RotateCcw, Search, Settings, Share2, Shield, Sparkles, Sprout, Trash2, User, Waves, Wifi, WifiOff, X, ZoomIn, ZoomOut,
} from 'lucide';

const ICONS = {
  activity: Activity, bookmark: Bookmark, 'bookmark-check': BookmarkCheck, check: Check, 'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight, alert: CircleAlert, clock: Clock, compass: Compass, copy: Copy, crosshair: Crosshair,
  download: Download, external: ExternalLink, eye: Eye, flag: Flag, heart: Heart, history: History, info: Info,
  layers: Layers, 'log-out': LogOut, menu: Menu, orbit: Orbit, refresh: RefreshCw, reset: RotateCcw, search: Search,
  settings: Settings, share: Share2, shield: Shield, sparkles: Sparkles, sprout: Sprout, trash: Trash2, user: User,
  waves: Waves, wifi: Wifi, 'wifi-off': WifiOff, x: X, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut,
};

export function icon(name, { size = 18, label = null } = {}) {
  const node = ICONS[name];
  if (!node) return document.createTextNode('');
  const svg = createElement(node, { width: size, height: size, 'stroke-width': 1.6, class: 'icon' });
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  return svg;
}

/**
 * h('div', { class: 'x', onclick: fn, dataset: {...}, aria-label: '...' }, child, 'text', [more])
 * Children: Node | string | number | null | false | array.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') throw new Error('h(): raw HTML is not supported');
    else if (v === true) el.setAttribute(k, '');
    else if (k in el && !k.includes('-') && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Internal navigation link handled by the router. */
export function link(href, attrs = {}, ...children) {
  return h('a', { href, 'data-link': '', ...attrs }, ...children);
}

export function button(label, attrs = {}, iconName = null) {
  return h('button', { type: 'button', ...attrs }, iconName ? icon(iconName) : null, label ? h('span', {}, label) : null);
}

export function iconButton(iconName, label, attrs = {}) {
  return h('button', { type: 'button', ...attrs, class: `icon-btn ${attrs.class ?? ''}`.trim(), 'aria-label': label, title: label }, icon(iconName));
}

export function statusMessage(kind, text, extra = null) {
  return h('div', { class: `status-msg status-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info'), h('div', {}, h('p', {}, text), extra));
}

export function loading(text = 'Loading…') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'loading-dot', 'aria-hidden': 'true' }), text);
}
