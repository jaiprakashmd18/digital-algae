/**
 * /settings — motion, graphics, sound, labels, privacy controls and
 * account management.
 */
import { h, icon, link, statusMessage } from '../utils/dom.js';
import { getPreferences, localRemove, setPreferences } from '../utils/preferences.js';
import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { authState, isPermanentUser } from '../lib/auth.js';
import { messageFor } from '../utils/errors.js';
import { navigate } from '../router.js';

function radioGroup(name, legend, value, options, onChange, hint) {
  return h('fieldset', { class: 'field' }, h('legend', {}, legend),
    h('div', { class: 'segmented', role: 'radiogroup' }, options.map(([v, l]) => h('label', {},
      h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onChange(v) }), h('span', {}, l)))),
    hint ? h('p', { class: 'fine muted' }, hint) : null);
}

function toggle(id, label, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', id, checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'field' }, h('label', { class: 'check', for: id }, input, h('span', {}, label)), hint ? h('p', { class: 'fine muted' }, hint) : null);
}

export function render() {
  const p = getPreferences();
  const saved = h('p', { class: 'fine muted', 'aria-live': 'polite' });
  const set = (patch) => {
    setPreferences(patch);
    saved.textContent = isPermanentUser() ? 'Saved on this device and to your account.' : 'Saved on this device.';
  };

  const dangerOut = h('div', { 'aria-live': 'polite' });
  const user = authState().user;
  const del = h('button', { type: 'button', class: 'btn btn-danger btn-sm', disabled: !user || config.demo }, icon('trash'), h('span', {}, isPermanentUser(user) ? 'Delete my account' : 'Forget my guest identity'));
  del.addEventListener('click', async () => {
    const ok = confirm('This permanently deletes your account data. Your traces stay in the world but are detached from you and renamed “Former visitor”. Continue?');
    if (!ok) return;
    del.disabled = true;
    const r = await api().deleteAccount();
    if (r.ok) {
      dangerOut.replaceChildren(statusMessage('success', 'Your account was deleted.'));
      setTimeout(() => navigate('/'), 1500);
    } else {
      del.disabled = false;
      dangerOut.replaceChildren(statusMessage('error', messageFor(r)));
    }
  });

  const clearLocal = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Clear local preferences');
  clearLocal.addEventListener('click', () => {
    for (const k of ['io:prefs:v1', 'io:intro-dismissed', 'io:observed:v1', 'io:last-visit', 'io:last-trace:v1']) localRemove(k);
    location.reload();
  });

  const demoReset = config.demo ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm('Reset the local demo world?')) { api().resetDemoWorld(); location.assign('/'); } } }, 'Reset demo world') : null;

  const el = h('div', { class: 'page page-narrow' },
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Settings'), h('h1', {}, 'Settings')),
    h('div', { class: 'section' },
      h('h2', {}, 'Motion & graphics'),
      radioGroup('motion', 'Motion', p.motion, [['system', 'Follow system'], ['reduce', 'Reduced'], ['full', 'Full']], (v) => set({ motion: v }), 'Reduced motion stops auto-rotation and slows waves; changes are still shown.'),
      radioGroup('quality', 'Graphics quality', p.quality, [['auto', 'Automatic'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['2d', '2D view']], (v) => set({ quality: v }), 'Automatic adapts to your device and switches to the 2D view if 3D runs slowly.'),
      toggle('labels', 'Show region names on the organism', p.labels, (v) => set({ labels: v })),
      toggle('sound', 'Sound: a soft tone when a trace arrives', p.sound, (v) => set({ sound: v }), 'Off by default.')),
    h('div', { class: 'section' },
      h('h2', {}, 'Privacy'),
      toggle('analytics', 'Allow privacy-friendly usage counts', p.analytics, (v) => set({ analytics: v }),
        config.analyticsProvider === 'off' ? 'Analytics are currently disabled on this site, so nothing is counted either way.' : 'Only anonymous daily counts of a few actions (no ids, no cookies). Your browser’s Global Privacy Control / Do Not Track signal is also respected.'),
      h('div', { class: 'share-controls' }, clearLocal, demoReset),
      h('p', { class: 'fine muted' }, 'Read the ', link('/privacy', {}, 'privacy policy'), ' for what is stored.')),
    h('div', { class: 'section' },
      h('h2', {}, 'Account'),
      isPermanentUser(user) ? h('p', { class: 'muted fine' }, 'Manage your pseudonym and password on your ', link('/profile', {}, 'profile'), '.') : h('p', { class: 'muted fine' }, 'You are not signed in. ', link('/profile', {}, 'Create an account or sign in'), '.'),
      del, dangerOut),
    saved);
  return { el, title: 'Settings', noindex: true };
}
