/**
 * Auth state for the UI. The UI uses this only for presentation (showing a
 * profile link, hiding the admin link); every privileged action is checked
 * again by the database.
 */
import { api } from './api.js';

const listeners = new Set();
let current = { user: null, ready: false, recovery: false };

export function authState() {
  return current;
}

export function onAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(patch) {
  current = { ...current, ...patch };
  for (const fn of listeners) fn(current);
}

export async function initAuth() {
  const backend = api();
  const user = await backend.getUser().catch(() => null);
  set({ user, ready: true });
  backend.onAuthChange((event, nextUser) => {
    set({ user: nextUser, recovery: event === 'PASSWORD_RECOVERY' ? true : current.recovery && event !== 'SIGNED_OUT' });
  });
}

export function isPermanentUser(user = current.user) {
  return Boolean(user && !user.is_anonymous);
}

export function clearRecovery() {
  set({ recovery: false });
}
