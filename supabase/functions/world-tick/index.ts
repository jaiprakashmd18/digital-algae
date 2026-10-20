// Runs world maintenance (expire/create daily community events, retention
// pruning, fold decay into stored values). Use this when pg_cron is not
// available: call it from any external scheduler (e.g. a Vercel Cron job or
// GitHub Actions) with the shared secret header.
//
//   supabase functions deploy world-tick --no-verify-jwt
//   supabase secrets set WORLD_TICK_SECRET=<long random string>
//   curl -X POST -H "x-world-tick-secret: $WORLD_TICK_SECRET" \
//        https://<project>.supabase.co/functions/v1/world-tick
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { timingSafeEqualHex, hmacSha256Hex } from '../_shared/stripe-signature.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('WORLD_TICK_SECRET') ?? '';
  const given = req.headers.get('x-world-tick-secret') ?? '';
  // Compare HMACs of both values so the comparison is constant-time.
  const ok = secret.length >= 24 && timingSafeEqualHex(await hmacSha256Hex('tick', given), await hmacSha256Hex('tick', secret));
  if (!ok) return new Response('Forbidden', { status: 403 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('run_world_maintenance');
  if (error) {
    console.error('maintenance failed', error.message);
    return new Response('Maintenance failed', { status: 500 });
  }
  return Response.json(data);
});
