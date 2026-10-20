# Internet Organism

**One internet. One living organism.**

A persistent digital life form shared by everyone who visits. Visitors leave
small *traces* of colour and energy; each one is validated and recorded by
the server, ripples through the organism for everyone connected, and stays
in the world. Regions grow branches, the organism evolves through stages,
and milestones become public discoveries with stable links.

* Frontend: HTML, CSS, vanilla JavaScript (ES modules), Three.js with a Canvas 2D fallback, built with Vite.
* Backend: Supabase — Postgres with Row Level Security, Auth (anonymous guests + email), Realtime, Edge Functions.
* Hosting: Vercel (static build + two small functions for link previews and the sitemap).

Further reading: [Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md)

---

## Quick start (no accounts needed)

```bash
git clone <this repository> internet-organism
cd internet-organism
npm ci
npm run dev
```

Open <http://localhost:5173>. Without Supabase settings the site runs in
**demo mode**: a banner says so, and the world lives only in your browser
(tabs of the same browser share it). Everything else — the organism,
traces, limits, discoveries, evolution — works the same way.

---

## Step-by-step guide

### 1. Install Node.js and npm

Install Node.js **20.19 or newer** (22 LTS recommended) from <https://nodejs.org>.
npm comes with it. Check with `node -v` and `npm -v`.

### 2. Get the project

Clone the repository (or download it) and open a terminal in the folder.

### 3. Install dependencies

```bash
npm ci        # uses the exact versions in package-lock.json
```

### 4. Run locally

```bash
npm run dev       # development server at http://localhost:5173
npm run build     # production build into dist/
npm run preview   # serve the production build at http://localhost:4173
```

### 5. Create a Supabase project

Sign in at <https://supabase.com>, create a project, wait for it to start.
In **Settings → API Keys** copy the **Project URL** and the **publishable key**
(or the legacy `anon` key). Never use the `service_role`/secret key in the frontend.

### 6. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and
`VITE_PUBLIC_SITE_URL=http://localhost:5173`. Every `VITE_` value is public.
Restart `npm run dev`. The demo banner disappears and the header shows **Live**
once Realtime connects.

### 7. Apply the database migrations

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

No CLI? Run `npm run db:bundle`, open the generated `supabase/setup-all-in-one.sql`,
paste it into **Dashboard → SQL Editor** and click **Run** (once, on a fresh project).

### 8. Seed the initial world

Nothing to do: the last migration creates the six starting regions,
feature flags and the labelled "initial structure" discovery. For a local
Supabase stack (`npx supabase start`, needs Docker), `npx supabase db reset`
runs migrations and `supabase/seed.sql`.

### 9. Configure authentication and redirect URLs

In **Authentication**:
* enable **Anonymous sign-ins** (guests need it to leave traces),
* keep email confirmation on,
* set **Site URL** to your site and add redirect URLs `…/profile` and `…/reset-password`
  (for local development: `http://localhost:5173/profile` and `/reset-password`).
* Optional: enable an OAuth provider and list it in `VITE_AUTH_OAUTH_PROVIDERS`.

### 10. Deploy Edge Functions (optional)

Only needed for payments, or to trigger maintenance over HTTP:

```bash
npx supabase functions deploy world-tick --no-verify-jwt
npx supabase functions deploy create-checkout --no-verify-jwt
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

### 11. Configure secrets

```bash
npx supabase secrets set SITE_URL=https://your-domain WORLD_TICK_SECRET=<long random string>
# Payments only:
npx supabase secrets set STRIPE_SECRET_KEY=sk_... STRIPE_WEBHOOK_SECRET=whsec_...
```

Secrets live in Supabase only. Optionally enable `pg_cron` and schedule
maintenance (see [Deployment](docs/DEPLOYMENT.md#1-supabase-project)).

### 12. Connect the GitHub repository to Vercel

At <https://vercel.com/new> import the repository. `vercel.json` sets the build.

### 13. Configure production environment variables

The project's public Supabase URL and publishable key are already committed in
`.env.production` (they are safe to publish; RLS protects the data). In Vercel →
Settings → Environment Variables you can override them, and should add
`VITE_PUBLIC_SITE_URL` once you have a custom domain (until then the Vercel
production domain is used automatically),
`VITE_OPERATOR_NAME`, `VITE_CONTACT_EMAIL` and any optional ones from `.env.example`.

### 14. Deploy

Push to the main branch (or click **Deploy**). Vercel builds and publishes.

### 15. Test the live application

Follow [Deployment → Verify the live site](docs/DEPLOYMENT.md#4-verify-the-live-site).
Then make yourself an administrator:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com';
```

### 16. Configure a custom domain

Vercel → Project → Domains. Afterwards update `VITE_PUBLIC_SITE_URL`, Supabase's
Site URL and redirect URLs, and the `SITE_URL` secret, then redeploy.

### 17. Analytics or payments (only if you want them)

* Analytics are **off** by default. `VITE_ANALYTICS_PROVIDER=aggregate` counts a few
  events per day in your own database (no ids, no cookies; see `/admin`).
  `plausible` uses Plausible with `VITE_PLAUSIBLE_DOMAIN`.
* Payments: create a Stripe account, set the secrets (step 11), add the webhook
  endpoint `https://<ref>.supabase.co/functions/v1/stripe-webhook` for
  `checkout.session.completed`, then set `VITE_SUPPORT_CHECKOUT=true`. Until then
  `/support` honestly says that online support is not set up (or links to
  `VITE_SUPPORT_EXTERNAL_URL`).

### 18. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Demo banner on the live site | `VITE_SUPABASE_URL`/key missing in Vercel, or set after the build — redeploy. |
| "A secret Supabase key was configured… refused" | You used the service-role/secret key. Use the publishable/anon key. |
| "Guest contributions are not enabled" | Enable Anonymous sign-ins in Supabase Auth. |
| Header stays "Reconnecting" | Check Realtime is enabled and `world_events` is in the `supabase_realtime` publication; check the CSP if you use a custom Supabase domain. |
| Confirmation/reset emails link to localhost | Fix Site URL and redirect URLs in Supabase Auth. |
| `/admin` says no operator access | Insert your user into `public.user_roles` (step 15). |
| No daily Convergence | `community_events_enabled` flag off, or no visits yet today (it is created on the first visit or by maintenance). |
| Organism shows "2D view" | WebGL unavailable or too slow; change in Settings → Graphics quality. |
| Build fails: "Refusing to build: … looks like a secret" | Remove that `VITE_` variable; secrets never belong in the frontend. |

---

## Tests

| Command | What | Needs |
| --- | --- | --- |
| `npm run lint` | ESLint | — |
| `npm test` | Unit tests (Vitest + jsdom): formulas, validation, realtime dedupe/reconnect, demo engine limits & duplicates, routing, SEO helpers, webhook signatures, UI | — |
| `npm run test:db` | Migrations + RLS + world engine against **real PostgreSQL** with a Supabase stub: access rules, privilege escalation, rate limits, idempotency, concurrency, moderation, payments, SQL/JS formula parity | Local Postgres (`TEST_DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/postgres`) |
| `npm run test:e2e` | Playwright: full visitor journey, deep links, mobile navigation, 2D fallback, keyboard, reduced motion, axe WCAG 2.1 AA scan of 9 pages | Chromium (`npx playwright install chromium`); runs against a demo build. Set `E2E_BASE_URL` to test a live deployment (needs your Supabase project). |
| `npm run check:functions` | Type-checks the Deno Edge Functions | Downloads Deno via npm |

The DB tests do not use Supabase itself (no GoTrue/PostgREST/Realtime); they
switch Postgres roles and JWT claims exactly as PostgREST does. Realtime
delivery and email auth are only exercised against a real project.

---

## Implemented features

* Interactive 3D organism (Three.js): rotate, zoom, tap nodes or region names,
  fly to regions, pulses that propagate along filaments, lingering trace marks,
  breathing scaled by real energy; automatic quality scaling and a Canvas 2D fallback.
* Shared persistent world: regions, energy with decay, levels, stages, new
  regions, snapshots, discoveries, daily Convergence, energy milestones.
* Leave Your Trace without an account (anonymous guest session), with
  server-side validation, rate limits, idempotent retries, confirmation and a
  shareable PNG trace card.
* Live statistics with explicit time windows, realtime updates, presence,
  connection status, reconciliation after reconnect.
* Pages: `/`, `/explore`, `/explore/:slug`, `/discoveries`, `/discovery/:slug`,
  `/evolution`, `/about`, `/support`, `/profile`, `/reset-password`,
  `/settings`, `/privacy`, `/terms`, `/admin`, 404.
* Optional accounts: email sign-up/in, verification, password reset, OAuth
  (if configured), guest→account linking, pseudonym, trace history, saved
  discoveries, synced preferences, account deletion.
* Moderation and admin: reports, hide/redact, feature flags, maintenance,
  errors, rate-limit activity, world events, audit log — all server-authorised.
* Sharing: copy link, native share, trace and milestone cards, referral
  attribution (aggregate only), daily feature with a published rule.
* SEO: prerendered metadata, server-rendered metadata for discoveries/regions,
  sitemap, robots, OG image, icons, manifest.
* Accessibility: keyboard-reachable regions, text alternative of the world,
  live announcements, reduced motion, visible focus, labelled controls.
* Monetisation foundation: optional one-time support via Stripe Checkout
  (server-priced, signature-verified webhook), supporter wall (opt-in),
  feature-flagged membership entitlements.

## Known limitations

* Abuse controls are per session plus Supabase's per-IP limits on sign-ups;
  there is no CAPTCHA by default and a well-resourced bot farm can still create
  guest sessions (bounded by the global breaker and distinct-contributor
  thresholds).
* The `world_state` row serialises all traces (fine for hundreds per second).
* Hidden events are removed from other clients on their next reconciliation,
  not instantly.
* Per-discovery social images use the default OG image; cards are generated
  client-side for download/sharing.
* Membership (phase 3) has data model, webhook handling and a flag, but no
  subscription checkout UI.
* Display-name blocklist ships with impersonation terms only; extend
  `public.blocked_terms` for your community.
* Legal pages contain sections marked **Operator review required**.

## Launch checklist (requires you)

- [ ] Supabase project created; migrations pushed; anonymous sign-ins enabled
- [ ] Auth Site URL and redirect URLs set for the production domain
- [ ] Email sender configured (Supabase's default sender is rate-limited; set up custom SMTP)
- [ ] Vercel project with the production environment variables
- [ ] pg_cron maintenance scheduled (or world-tick wired to a cron)
- [ ] Yourself added as admin; `/admin` reachable
- [ ] Privacy policy and terms completed and reviewed (operator identity, jurisdiction, rights)
- [ ] `blocked_terms` extended for your community
- [ ] Optional: Stripe keys + webhook, `VITE_SUPPORT_CHECKOUT=true`
- [ ] Optional: analytics provider
- [ ] Custom domain and `VITE_PUBLIC_SITE_URL` updated
- [ ] Live verification and `E2E_BASE_URL=… npm run test:e2e`
