/**
 * Account-related reads and writes, plus preference sync for signed-in
 * (non-guest) accounts. Local preferences stay the source of truth for this
 * device; the server copy follows the visitor across devices.
 */
import { api } from '../lib/api.js';
import { authState, isPermanentUser, onAuth } from '../lib/auth.js';
import { getPreferences, onPreferencesChange, sanitizePreferences, setPreferences } from '../utils/preferences.js';

let syncing = false;
let saveTimer = null;

export async function syncPreferencesOnSignIn() {
  const pull = async (user) => {
    if (!isPermanentUser(user)) return;
    try {
      const remote = await api().getRemotePreferences();
      if (remote) {
        syncing = true;
        setPreferences(sanitizePreferences(remote));
        syncing = false;
      }
    } catch {
      // Remote preferences are a convenience; local ones keep working.
    }
  };
  await pull(authState().user);
  let lastUserId = authState().user?.id ?? null;
  onAuth(({ user }) => {
    if ((user?.id ?? null) !== lastUserId) {
      lastUserId = user?.id ?? null;
      pull(user);
    }
  });
  onPreferencesChange((prefs) => {
    if (syncing || !isPermanentUser()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api().saveRemotePreferences(prefs), 800);
  });
}

export function currentPreferences() {
  return getPreferences();
}
