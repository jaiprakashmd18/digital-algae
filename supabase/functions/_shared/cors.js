/** CORS for browser-invoked functions: only the configured site origin. */
export function corsHeaders(req) {
  const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  const origin = req.headers.get('Origin') ?? '';
  const allowed = origin && (origin === site || /^http:\/\/localhost:\d+$/.test(origin)) ? origin : site;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}
