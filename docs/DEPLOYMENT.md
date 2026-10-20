# Deployment guide

The short version is in the [README](../README.md#7-deploy). This page lists
every setting that must be right in production, and how to verify it.

## 1. Supabase project

1. Create a project at <https://supabase.com/dashboard>. Note the **Project URL**
   and the **publishable key** (Settings → API Keys; the legacy `anon` key also works).
2. Link and push the migrations:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   Migration `20261020000005_initial_world.sql` creates the six starting regions,
   so a fresh production database is never empty. `seed.sql` is for local resets only.
3. **Authentication → Sign In / Providers**
   * Anonymous sign-ins are **not** needed — visitors leave traces with no session.
   * Email: keep **Confirm email** on. Minimum password length 10.
   * Optional OAuth providers; list the same ones in `VITE_AUTH_OAUTH_PROVIDERS`.
4. **Authentication → URL Configuration**
   * Site URL: `https://your-domain`
   * Redirect URLs: `https://your-domain/profile`, `https://your-domain/reset-password`
     (and your Vercel preview domain pattern if you use previews).
5. **Authentication → Rate limits**: defaults are fine (they only apply to optional accounts).
6. **API settings**: set *Max rows* to 100.
7. **Realtime**: the migration adds `world_events` and `community_events` to the
   `supabase_realtime` publication. Check under Database → Publications.
8. **Scheduler (optional but recommended)**: enable the `pg_cron` extension
   (Database → Extensions), then run once in the SQL editor:

   ```sql
   select cron.schedule('internet-organism-maintenance', '*/15 * * * *', 'select public.run_world_maintenance()');
   ```

   Without pg_cron the world still works (decay is computed on read and the daily
   Convergence is created lazily). Alternatives: the `world-tick` Edge Function
   called by any external cron, or "Run maintenance now" in `/admin`.

## 2. Edge Functions (only if you want payments or the HTTP maintenance tick)

```bash
npx supabase functions deploy world-tick --no-verify-jwt
npx supabase functions deploy create-checkout --no-verify-jwt
npx supabase functions deploy stripe-webhook --no-verify-jwt
npx supabase secrets set SITE_URL=https://your-domain WORLD_TICK_SECRET=$(openssl rand -hex 32)
# Payments only:
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to
functions automatically — never copy them into Vercel or the frontend.

Stripe: add a webhook endpoint `https://<ref>.supabase.co/functions/v1/stripe-webhook`
for `checkout.session.completed` (and `customer.subscription.*` if you later enable
memberships). Then set `VITE_SUPPORT_CHECKOUT=true` in Vercel.

## 3. Vercel

1. Import the GitHub repository (framework preset: Vite — `vercel.json` already sets
   build command and output directory).
2. Environment variables (Production and Preview):

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable / anon key |
   | `VITE_PUBLIC_SITE_URL` | `https://your-domain` (no trailing slash) |
   | `VITE_OPERATOR_NAME`, `VITE_CONTACT_EMAIL` | shown in the privacy policy |
   | optional | `VITE_AUTH_OAUTH_PROVIDERS`, `VITE_ANALYTICS_PROVIDER`, `VITE_PLAUSIBLE_DOMAIN`, `VITE_SUPPORT_CHECKOUT`, `VITE_SUPPORT_EXTERNAL_URL` |

   The `/api` functions read the same public values. No secret is needed on Vercel.
3. Deploy. Add your custom domain under Project → Domains, then update
   `VITE_PUBLIC_SITE_URL`, the Supabase Site URL/redirects and `SITE_URL` secret, and redeploy.

## 4. Verify the live site

* The demo banner is **absent** and the header says **Live**.
* Leave a trace in a private window → "Trace accepted"; the trace appears in a
  second browser within a second or two; `/explore/<region>` shows the new count.
* A second immediate trace is refused with a cooldown message.
* `https://your-domain/discovery/initial-structure` returns HTML whose `<title>` is
  "The initial structure · Internet Organism" (`curl -s … | grep '<title>'`).
* `https://your-domain/sitemap.xml` lists regions and discoveries.
* Grant yourself admin (see SECURITY.md) and open `/admin`.
* Run the E2E suite against production: `E2E_BASE_URL=https://your-domain npm run test:e2e`
  (it leaves one real trace).

## 5. Before launch

See the launch checklist in the README.
