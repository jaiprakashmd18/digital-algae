import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, mapStripeEvent, parseSignatureHeader, SUPPORT_TIERS, verifyStripeSignature } from '../../supabase/functions/_shared/stripe-signature.js';
import { SUPPORT_TIERS as UI_TIERS } from '../../src/pages/support.js';

const SECRET = 'whsec_test_secret';
const NOW = 1_800_000_000;

async function sign(body, t = NOW, secret = SECRET) {
  return `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${body}`)}`;
}

describe('Stripe webhook verification', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

  it('accepts a correct signature', async () => {
    expect(await verifyStripeSignature(body, await sign(body), SECRET, { nowSeconds: NOW })).toEqual({ ok: true });
  });

  it('rejects a tampered body, wrong secret, stale timestamp and malformed headers', async () => {
    const header = await sign(body);
    expect((await verifyStripeSignature(`${body} `, header, SECRET, { nowSeconds: NOW })).reason).toBe('signature_mismatch');
    expect((await verifyStripeSignature(body, await sign(body, NOW, 'other'), SECRET, { nowSeconds: NOW })).reason).toBe('signature_mismatch');
    expect((await verifyStripeSignature(body, header, SECRET, { nowSeconds: NOW + 301 })).reason).toBe('timestamp_out_of_tolerance');
    expect((await verifyStripeSignature(body, 'garbage', SECRET, { nowSeconds: NOW })).reason).toBe('malformed_header');
    expect((await verifyStripeSignature(body, header, '', { nowSeconds: NOW })).reason).toBe('missing_secret');
  });

  it('accepts any matching v1 among several (secret rotation)', async () => {
    const good = await sign(body);
    const header = `t=${NOW},v1=${'0'.repeat(64)},${good.split(',')[1]}`;
    expect(parseSignatureHeader(header).v1).toHaveLength(2);
    expect((await verifyStripeSignature(body, header, SECRET, { nowSeconds: NOW })).ok).toBe(true);
  });
});

describe('event mapping', () => {
  it('maps paid one-time checkouts to donations', () => {
    const m = mapStripeEvent({ type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 500, currency: 'eur', metadata: { user_id: 'u', public_acknowledgment: 'true', public_name: 'Ada' } } } });
    expect(m).toEqual({ type: 'donation_completed', data: { payment_id: 'pi_1', amount_cents: 500, currency: 'eur', user_id: 'u', public_acknowledgment: true, public_name: 'Ada' } });
  });
  it('ignores unpaid sessions and unknown events', () => {
    expect(mapStripeEvent({ type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'unpaid' } } })).toBeNull();
    expect(mapStripeEvent({ type: 'invoice.created', data: { object: {} } })).toBeNull();
  });
  it('maps subscription lifecycle to entitlement status', () => {
    expect(mapStripeEvent({ type: 'customer.subscription.deleted', data: { object: { id: 's', status: 'active' } } }).data.status).toBe('canceled');
    expect(mapStripeEvent({ type: 'customer.subscription.updated', data: { object: { id: 's', status: 'past_due' } } }).data.status).toBe('past_due');
  });
  it('UI tiers match server tiers (labels only, prices are server-side)', () => {
    expect(UI_TIERS.map((t) => t.key).sort()).toEqual(Object.keys(SUPPORT_TIERS).sort());
    for (const t of UI_TIERS) expect(t.label).toBe(`€${SUPPORT_TIERS[t.key].amount / 100}`);
  });
});
