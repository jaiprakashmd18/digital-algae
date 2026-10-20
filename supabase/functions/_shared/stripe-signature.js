/**
 * Stripe webhook signature verification (v1 scheme), using Web Crypto so
 * it runs unchanged in Deno (Edge Functions) and Node 20+ (unit tests).
 *
 * Header format: "t=<unix seconds>,v1=<hex hmac>[,v1=...]"
 * Signed payload: `${t}.${rawBody}` with HMAC-SHA256 and the endpoint secret.
 */

const encoder = new TextEncoder();

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two equal-length hex strings. */
export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  for (const part of String(header ?? '').split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s?.trim());
    if (k === 't' && /^\d+$/.test(v ?? '')) out.t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '')) out.v1.push(v);
  }
  return out;
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function verifyStripeSignature(rawBody, header, secret, { toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  const { t, v1 } = parseSignatureHeader(header);
  if (t == null || !v1.length) return { ok: false, reason: 'malformed_header' };
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return { ok: false, reason: 'timestamp_out_of_tolerance' };
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return v1.some((sig) => timingSafeEqualHex(sig, expected)) ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

/** Server-defined support tiers. The browser only ever sends a tier key. */
export const SUPPORT_TIERS = Object.freeze({
  spark: { amount: 300, currency: 'eur', label: 'Spark' },
  pulse: { amount: 500, currency: 'eur', label: 'Pulse' },
  bloom: { amount: 1000, currency: 'eur', label: 'Bloom' },
  canopy: { amount: 2500, currency: 'eur', label: 'Canopy' },
});

/**
 * Map a verified Stripe event to our record_payment_event() input, or null
 * if we do not handle it.
 */
export function mapStripeEvent(event) {
  const obj = event?.data?.object ?? {};
  if (event?.type === 'checkout.session.completed' && obj.mode === 'payment' && obj.payment_status === 'paid') {
    return {
      type: 'donation_completed',
      data: {
        payment_id: String(obj.payment_intent ?? obj.id),
        amount_cents: Number(obj.amount_total),
        currency: String(obj.currency ?? 'eur'),
        user_id: obj.metadata?.user_id ?? null,
        public_acknowledgment: obj.metadata?.public_acknowledgment === 'true',
        public_name: obj.metadata?.public_name ?? null,
      },
    };
  }
  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event?.type)) {
    const status = event.type === 'customer.subscription.deleted' || obj.status === 'canceled' ? 'canceled'
      : obj.status === 'active' || obj.status === 'trialing' ? 'active' : 'past_due';
    return {
      type: 'membership_updated',
      data: { user_id: obj.metadata?.user_id ?? null, subscription_id: String(obj.id), status, current_period_end: Number(obj.current_period_end ?? 0) },
    };
  }
  return null;
}
