/**
 * Supabase client (browser). Uses the public publishable/anon key only;
 * access is enforced by RLS and SECURITY DEFINER functions in the database.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

let client = null;

export function getSupabase() {
  if (config.demo) return null;
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { headers: { 'x-client-info': 'internet-organism-web' } },
    });
  }
  return client;
}
