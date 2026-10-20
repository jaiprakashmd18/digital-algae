/**
 * Runtime configuration from Vite environment variables.
 * Only public values belong here — anything prefixed VITE_ ships to browsers.
 */
const env = import.meta.env ?? {};

const OAUTH_ALLOWED = new Set(['github', 'google', 'gitlab', 'discord', 'apple']);

function looksLikeSecretKey(key) {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  // Legacy JWT keys: refuse a service_role key.
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

export function readConfig(source = env, origin = globalThis.location?.origin ?? 'http://localhost:5173') {
  const supabaseUrl = (source.VITE_SUPABASE_URL ?? '').trim();
  const supabaseKey = (source.VITE_SUPABASE_PUBLISHABLE_KEY || source.VITE_SUPABASE_ANON_KEY || '').trim();
  const secretKeyRejected = looksLikeSecretKey(supabaseKey);
  const hasBackend = Boolean(supabaseUrl && supabaseKey) && !secretKeyRejected;
  const demo = source.VITE_DEMO_MODE === 'true' || !hasBackend;
  const siteUrl = (source.VITE_PUBLIC_SITE_URL || origin).replace(/\/+$/, '');

  return Object.freeze({
    supabaseUrl,
    supabaseKey: secretKeyRejected ? '' : supabaseKey,
    secretKeyRejected,
    demo,
    siteUrl,
    analyticsProvider: ['aggregate', 'plausible'].includes(source.VITE_ANALYTICS_PROVIDER) ? source.VITE_ANALYTICS_PROVIDER : 'off',
    plausibleDomain: source.VITE_PLAUSIBLE_DOMAIN ?? '',
    oauthProviders: String(source.VITE_AUTH_OAUTH_PROVIDERS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((p) => OAUTH_ALLOWED.has(p)),
    supportCheckout: source.VITE_SUPPORT_CHECKOUT === 'true' && hasBackend && source.VITE_DEMO_MODE !== 'true',
    supportExternalUrl: /^https:\/\//.test(source.VITE_SUPPORT_EXTERNAL_URL ?? '') ? source.VITE_SUPPORT_EXTERNAL_URL : '',
    operatorName: source.VITE_OPERATOR_NAME || 'the operators of this site',
    contactEmail: source.VITE_CONTACT_EMAIL || '',
  });
}

export const config = readConfig();
