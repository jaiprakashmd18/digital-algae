// Stripe webhook receiver.
//
// Deploy with JWT verification disabled (Stripe cannot send a Supabase JWT):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Security comes from the Stripe signature, verified against the raw body.
// Secrets: STRIPE_WEBHOOK_SECRET (and the automatic SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY). Processing is idempotent per Stripe event id.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { mapStripeEvent, verifyStripeSignature } from '../_shared/stripe-signature.js';

const MAX_BODY = 256 * 1024;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response('Payload too large', { status: 413 });

  const check = await verifyStripeSignature(raw, req.headers.get('stripe-signature'), Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '');
  if (!check.ok) {
    console.warn('stripe-webhook rejected:', check.reason);
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const mapped = mapStripeEvent(event);
  if (!mapped) return Response.json({ received: true, ignored: true });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('record_payment_event', {
    p_provider_event_id: String(event.id),
    p_event_type: mapped.type,
    p_data: mapped.data,
  });
  if (error) {
    console.error('record_payment_event failed', error.message);
    // 500 makes Stripe retry; the RPC is idempotent per event id.
    return new Response('Temporary failure', { status: 500 });
  }
  return Response.json({ received: true, result: data });
});
