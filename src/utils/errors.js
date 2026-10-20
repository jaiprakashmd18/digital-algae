/**
 * Maps backend result codes and transport failures to short, actionable
 * messages. Never shows database internals to visitors.
 */
import { formatDuration } from './formatting.js';

const MESSAGES = {
  no_session: 'We could not start a visitor session. Reload the page and try again.',
  no_identity: 'The organism could not recognise this connection. Reload the page and try again.',
  account_required: 'This needs a free account. Leaving traces does not — only personal features like saving.',
  anonymous_paused: 'Anonymous traces are paused by the operators for now. Signed-in accounts can still leave traces.',
  guest_disabled: 'Guest contributions are not enabled on this site yet. Create an account to leave a trace.',
  feature_disabled: 'This feature is temporarily paused by the operators.',
  invalid_parameters: 'Something about this trace was not valid. Adjust it and try again.',
  unknown_region: 'That region is not available any more. Choose another one.',
  cooldown: 'The organism is still absorbing your last trace.',
  hourly_limit: 'You have reached the hourly limit for traces.',
  daily_limit: 'You have reached today’s limit for traces.',
  busy: 'The organism is very busy right now.',
  internal_error: 'The organism could not accept this. Nothing was recorded — please try again.',
  network: 'Could not reach the organism. Check your connection — nothing was confirmed.',
  forbidden: 'You do not have permission to do that.',
  not_found: 'That could not be found.',
  hourly_limit_report: 'You have sent several reports recently. Please wait before sending another.',
  demo_mode: 'Accounts need a configured backend. This copy of the site is running in demo mode.',
  display_name_rejected: 'That name is not allowed. Please choose another.',
  invalid_credentials: 'That email and password do not match an account.',
  email_not_confirmed: 'Confirm your email address first — check your inbox for the link.',
  session_expired: 'Your session expired. Sign in again.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  already_resolved: 'This report was already resolved.',
  payment_failed: 'The payment could not be started. You have not been charged.',
  server: 'The server could not complete this request. Please try again shortly.',
};

export function messageFor(result) {
  const code = result?.code ?? 'server';
  let msg = MESSAGES[code] ?? MESSAGES.server;
  if (result?.retryAfter > 0 && ['cooldown', 'hourly_limit', 'daily_limit', 'busy'].includes(code)) {
    msg += ` Try again in ${formatDuration(result.retryAfter)}.`;
  }
  return msg;
}

/** Normalizes a thrown/returned error from supabase-js or fetch into a result code. */
export function codeFromError(error) {
  if (!error) return 'server';
  const msg = String(error.message ?? error);
  if (error.name === 'TypeError' || /Failed to fetch|NetworkError|network|Load failed/i.test(msg)) return 'network';
  if (error.code === '42501' || /forbidden|permission denied/i.test(msg)) return 'forbidden';
  if (/display_name_rejected/.test(msg)) return 'display_name_rejected';
  if (/Invalid login credentials/i.test(msg)) return 'invalid_credentials';
  if (/Email not confirmed/i.test(msg)) return 'email_not_confirmed';
  if (/Anonymous sign-ins are disabled/i.test(msg)) return 'guest_disabled';
  if (/JWT expired|refresh token/i.test(msg)) return 'session_expired';
  if (error.status === 429 || /rate limit/i.test(msg)) return 'rate_limited';
  return 'server';
}

export class ApiError extends Error {
  constructor(code, cause) {
    super(MESSAGES[code] ?? MESSAGES.server);
    this.code = code;
    this.cause = cause;
  }
}
