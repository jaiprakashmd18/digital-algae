/**
 * /profile (and /reset-password) — optional account: sign up / sign in /
 * password recovery, then personal traces, saved discoveries, pseudonym and
 * account actions. Guests see their guest history and how to keep it.
 */
import { h, icon, link, loading, statusMessage } from '../utils/dom.js';
import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { authState, clearRecovery, isPermanentUser, onAuth } from '../lib/auth.js';
import { validateDisplayName, validateEmail, validatePassword } from '../lib/validation.js';
import { messageFor } from '../utils/errors.js';
import { regionById } from '../services/world-service.js';
import { formatDateTime } from '../utils/dates.js';
import { PATTERN_LABELS, formatNumber } from '../utils/formatting.js';
import { navigate } from '../router.js';
import { track } from '../services/analytics-service.js';
import { notify } from '../components/notifications.js';
import { localTraceHistory } from '../services/trace-service.js';

export function render({ route }) {
  const root = h('div', { class: 'page' });
  const draw = (state) => {
    root.replaceChildren(h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Profile'), h('h1', {}, isPermanentUser(state.user) ? 'Your profile' : 'Your traces')));
    if (!state.ready) {
      root.append(loading());
      return;
    }
    if (route === 'reset-password' || state.recovery) {
      root.append(resetPasswordForm());
      return;
    }
    if (isPermanentUser(state.user)) root.append(accountView(state.user));
    else root.append(guestView(state.user));
  };
  const off = onAuth(draw);
  draw(authState());
  return { el: root, title: route === 'reset-password' ? 'Reset password' : 'Profile', noindex: true, cleanup: off };
}

function field(id, label, input, hint) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'fine muted' }, hint) : null);
}

function guestView(user) {
  const wrap = h('div', { class: 'two-col' });
  const left = h('div', { class: 'section' });
  if (user) left.append(statusMessage('info', 'You are visiting as a guest. Your traces are tied to this browser’s guest session. Create an account to keep them if you clear your browser data or switch devices.'));
  else left.append(h('p', { class: 'muted' }, 'You do not need an account to explore or leave traces — participation is completely anonymous. An account is optional: it keeps your trace history across devices, lets you save discoveries and choose a pseudonym.'));
  if (config.demo) left.append(statusMessage('info', messageFor({ code: 'demo_mode' })));
  left.append(authForms(user));
  wrap.append(left, h('div', { class: 'section' }, personalData(user)));
  return wrap;
}

function authForms(user) {
  let mode = 'signup';
  const box = h('div', { class: 'section' });
  const tabs = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Account action' },
    [['signup', user?.is_anonymous ? 'Keep my traces' : 'Create account'], ['signin', 'Sign in'], ['reset', 'Forgot password']].map(([v, l]) =>
      h('label', {}, h('input', { type: 'radio', name: 'auth-mode', value: v, checked: v === mode, onchange: () => { mode = v; drawForm(); } }), h('span', {}, l))));
  const formBox = h('div');

  function drawForm() {
    const email = h('input', { type: 'email', id: 'auth-email', autocomplete: 'email', required: true });
    const password = h('input', { type: 'password', id: 'auth-password', autocomplete: mode === 'signin' ? 'current-password' : 'new-password', required: true, minlength: 10 });
    const out = h('div', { 'aria-live': 'polite' });
    const linking = mode === 'signup' && user?.is_anonymous;
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' },
      mode === 'signup' ? (linking ? 'Send confirmation email' : 'Create account') : mode === 'signin' ? 'Sign in' : 'Send reset link');
    const form = h('form', { class: 'form', novalidate: true },
      field('auth-email', 'Email', email),
      mode !== 'reset' && !linking ? field('auth-password', 'Password', password, mode === 'signup' ? 'At least 10 characters.' : null) : null,
      linking ? h('p', { class: 'fine muted' }, 'We will email you a confirmation link. After confirming, your guest traces belong to your new account and you can set a password here.') : null,
      mode === 'signin' && user?.is_anonymous ? h('p', { class: 'fine muted' }, 'Signing in to an existing account leaves this guest session’s traces with the guest identity.') : null,
      submit, out);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ve = validateEmail(email.value);
      if (!ve.ok) return out.replaceChildren(statusMessage('error', ve.message));
      if (mode !== 'reset' && !linking) {
        const vp = validatePassword(password.value);
        if (!vp.ok) return out.replaceChildren(statusMessage('error', vp.message));
      }
      submit.disabled = true;
      let r;
      if (mode === 'signup') r = await api().signUp(ve.value, password.value);
      else if (mode === 'signin') r = await api().signIn(ve.value, password.value);
      else r = await api().requestPasswordReset(ve.value);
      submit.disabled = false;
      if (!r.ok) {
        out.replaceChildren(statusMessage('error', r.code === 'server' && r.message ? r.message : messageFor(r)));
        return;
      }
      if (mode === 'signup') {
        track('registration');
        out.replaceChildren(statusMessage('success', r.linked || r.needsConfirmation ? 'Check your inbox and open the confirmation link to finish.' : 'Account created.'));
      } else if (mode === 'reset') {
        out.replaceChildren(statusMessage('success', 'If an account exists for that address, a reset link is on its way.'));
      }
    });
    const oauth = config.oauthProviders.length && mode !== 'reset'
      ? h('div', { class: 'share-controls' }, config.oauthProviders.map((p) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => { const r = await api().signInWithOAuth(p); if (!r.ok) out.replaceChildren(statusMessage('error', messageFor(r))); } }, `Continue with ${p[0].toUpperCase()}${p.slice(1)}`)))
      : null;
    formBox.replaceChildren(form, oauth ?? '');
  }
  drawForm();
  box.append(tabs, formBox);
  return box;
}

function resetPasswordForm() {
  const password = h('input', { type: 'password', id: 'new-password', autocomplete: 'new-password', minlength: 10 });
  const out = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'form' }, h('p', {}, 'Choose a new password.'), field('new-password', 'New password', password, 'At least 10 characters.'),
    h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save password'), out);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = validatePassword(password.value);
    if (!v.ok) return out.replaceChildren(statusMessage('error', v.message));
    const r = await api().updatePassword(v.value);
    if (!r.ok) return out.replaceChildren(statusMessage('error', r.message ?? messageFor(r)));
    clearRecovery();
    out.replaceChildren(statusMessage('success', 'Password updated.'));
    setTimeout(() => navigate('/profile', { replace: true }), 1200);
  });
  return form;
}

function accountView(user) {
  const left = h('div', { class: 'section' });
  const right = h('div', { class: 'section' }, personalData(user));
  const nameInput = h('input', { type: 'text', id: 'display-name', maxlength: 24, autocomplete: 'nickname' });
  const nameOut = h('div', { 'aria-live': 'polite' });
  const nameForm = h('form', { class: 'form' }, field('display-name', 'Public pseudonym', nameInput, 'Shown on your future traces. 2–24 characters. Past traces keep the name they were made with.'),
    h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, 'Save pseudonym'), nameOut);
  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = validateDisplayName(nameInput.value);
    if (!v.ok) return nameOut.replaceChildren(statusMessage('error', v.message));
    const r = await api().updateProfile({ displayName: v.value });
    nameOut.replaceChildren(r.ok ? statusMessage('success', 'Saved.') : statusMessage('error', messageFor(r)));
  });

  const pw = h('input', { type: 'password', id: 'set-password', autocomplete: 'new-password', minlength: 10 });
  const pwOut = h('div', { 'aria-live': 'polite' });
  const pwForm = h('form', { class: 'form' }, field('set-password', 'Set or change password', pw), h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, 'Save password'), pwOut);
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = validatePassword(pw.value);
    if (!v.ok) return pwOut.replaceChildren(statusMessage('error', v.message));
    const r = await api().updatePassword(v.value);
    pwOut.replaceChildren(r.ok ? statusMessage('success', 'Password saved.') : statusMessage('error', r.message ?? messageFor(r)));
  });

  const signOut = h('button', { type: 'button', class: 'btn btn-ghost' }, icon('log-out'), h('span', {}, 'Sign out'));
  signOut.addEventListener('click', async () => {
    const r = await api().signOut();
    if (!r.ok) notify(messageFor(r), { kind: 'error' });
  });

  left.append(
    h('p', { class: 'muted' }, `Signed in as ${user.email ?? 'an account'}. Your email is private and never shown in the world.`),
    nameForm, pwForm,
    h('div', { class: 'share-controls' }, signOut, link('/settings', { class: 'btn btn-ghost' }, icon('settings'), h('span', {}, 'Settings & account deletion'))));

  api().getAccount().then((acc) => {
    if (acc?.display_name) nameInput.value = acc.display_name;
    if (acc?.roles?.length) left.append(link('/admin', { class: 'btn btn-ghost btn-sm' }, icon('shield'), h('span', {}, 'Administration')));
  }).catch(() => {});
  return h('div', { class: 'two-col' }, left, right);
}

function personalData(user) {
  const box = h('div', { class: 'section' }, loading('Loading your activity…'));
  if (!user && !config.demo) {
    // Anonymous traces are not linked to anyone; this browser remembers its own.
    const local = localTraceHistory();
    box.replaceChildren(
      h('h2', {}, 'Traces from this browser'),
      h('p', { class: 'muted fine' }, 'Anonymous traces are not linked to you on the server. This list is kept only in this browser.'),
      local.length ? h('ol', { class: 'event-list' }, local.map((t) => h('li', {},
        h('span', {}, h('span', { class: 'tick-dot', style: { background: t.color, display: 'inline-block', marginRight: '8px' }, 'aria-hidden': 'true' }),
          `${PATTERN_LABELS[t.pattern] ?? 'Trace'} in ${t.region?.name ?? t.region?.slug ?? 'a region'}${t.gain != null ? ` · +${Number(t.gain).toFixed(2)}` : ''}`),
        h('time', { datetime: t.at, class: 'muted' }, formatDateTime(t.at)))))
        : h('p', { class: 'muted' }, 'No traces from this browser yet.'),
      link('/?trace=1', { class: 'btn btn-primary btn-sm' }, 'Leave your trace'));
    return box;
  }
  Promise.all([api().getAccount(), api().listMyTraces({ limit: 30 }), api().listSaved()]).then(([acc, traces, saved]) => {
    box.replaceChildren(
      acc ? h('dl', { class: 'kv' },
        h('div', {}, h('dt', {}, 'Pseudonym'), h('dd', {}, acc.display_name)),
        h('div', {}, h('dt', {}, 'Traces'), h('dd', { class: 'mono' }, formatNumber(acc.trace_count))),
        h('div', {}, h('dt', {}, 'Regions touched'), h('dd', { class: 'mono' }, formatNumber(acc.regions_touched))),
        h('div', {}, h('dt', {}, 'Discoveries you triggered'), h('dd', { class: 'mono' }, formatNumber(acc.discoveries_triggered))),
        h('div', {}, h('dt', {}, 'First trace'), h('dd', {}, acc.first_trace_at ? formatDateTime(acc.first_trace_at) : '—'))) : null,
      h('h2', {}, 'Your traces'),
      traces.length ? h('ol', { class: 'event-list' }, traces.map((t) => h('li', {},
        h('span', {}, h('span', { class: 'tick-dot', style: { background: t.color, display: 'inline-block', marginRight: '8px' }, 'aria-hidden': 'true' }),
          `${PATTERN_LABELS[t.trace_type]} in ${regionById(t.region_id)?.name ?? 'a region'} · +${Number(t.energy_gain).toFixed(2)}`),
        h('time', { datetime: t.created_at, class: 'muted' }, formatDateTime(t.created_at)))))
        : h('p', { class: 'muted' }, 'No traces yet.'),
      h('h2', {}, 'Saved discoveries'),
      saved.length ? h('ul', { class: 'mini-list' }, saved.map((s) => h('li', {}, link(`/discovery/${s.discoveries.slug}`, {}, s.discoveries.title), ' ',
        h('button', { type: 'button', class: 'btn btn-link fine', onclick: async (e) => { const r = await api().unsaveDiscovery(s.discovery_id); if (r.ok) e.target.closest('li').remove(); } }, 'Remove'))))
        : h('p', { class: 'muted' }, 'Save discoveries from their pages to find them here.'));
  }).catch((e) => box.replaceChildren(statusMessage('error', messageFor({ code: e.code ?? 'network' }))));
  return box;
}
