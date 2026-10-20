/**
 * Backend selection. Pages and services import `api` and never care whether
 * the live Supabase backend or the local demo backend is in use — except to
 * label demo data clearly (api.mode === 'demo').
 */
import { config } from './config.js';
import { createDemoBackend } from './backend-demo.js';

let instance = null;

export async function initApi() {
  if (instance) return instance;
  if (config.demo) {
    instance = createDemoBackend();
  } else {
    // Loaded on demand so the demo build does not ship supabase-js twice.
    const { createSupabaseBackend } = await import('./backend-supabase.js');
    instance = createSupabaseBackend();
  }
  return instance;
}

export function api() {
  if (!instance) throw new Error('initApi() must run before api() is used');
  return instance;
}
