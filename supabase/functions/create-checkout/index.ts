// Creates a Stripe Checkout session for a one-time contribution.
//
// The browser sends only { tier, acknowledge, publicName }. The amount is
// looked up server-side from SUPPORT_TIERS; prices from the client are never
// used. The caller's user id (if signed in) is taken from the verified JWT.
// Secrets: STRIPE_SECRET_KEY, SITE_URL.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { SUPPORT_TIERS } from '../_shared/stripe-signature.js';
import { corsHeaders } from '../_shared/cors.js';

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  if (!stripeKey || !siteUrl) return Response.json({ error: 'not_configured' }, { status: 503, headers: cors });

  let body: { tier?: string; acknowledge?: boolean; publicName?: string };
  try {
    const text = await req.text();
    if (text.length > 2048) throw new Error('too large');
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400, headers: cors });
  }
  const tier = SUPPORT_TIERS[body.tier as keyof typeof SUPPORT_TIERS];
  if (!tier) return Response.json({ error: 'invalid_tier' }, { status: 400, headers: cors });
  const publicName = body.acknowledge ? String(body.publicName ?? '').trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) : '';

  // Identify the caller (guest or account) from the JWT, if present.
  let userId = '';
  const auth = req.headers.get('Authorization');
  if (auth) {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data } = await sb.auth.getUser();
    userId = data.user?.id ?? '';
  }

  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': tier.currency,
    'line_items[0][price_data][unit_amount]': String(tier.amount),
    'line_items[0][price_data][product_data][name]': `Internet Organism support — ${tier.label}`,
    success_url: `${siteUrl}/support?checkout=success`,
    cancel_url: `${siteUrl}/support?checkout=cancelled`,
    'metadata[user_id]': userId,
    'metadata[public_acknowledgment]': String(Boolean(body.acknowledge && publicName.length >= 2)),
    'metadata[public_name]': publicName,
    submit_type: 'donate',
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: params,
  });
  if (!res.ok) {
    console.error('stripe checkout error', res.status, await res.text());
    return Response.json({ error: 'payment_failed' }, { status: 502, headers: cors });
  }
  const session = await res.json();
  return Response.json({ url: session.url }, { headers: cors });
});
