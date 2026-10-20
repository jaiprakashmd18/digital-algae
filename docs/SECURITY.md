# Security

This document describes the controls that are actually implemented, and
their limits.

## Principles

* The browser holds only the **publishable (anon) key**. `src/lib/config.js`
  refuses `sb_secret_…` and legacy `service_role` JWTs at runtime, and
  `vite.config.js` refuses to build if a `VITE_` variable name contains
  `SECRET` or `SERVICE_ROLE`.
* Every privileged decision happens in Postgres (RLS + `SECURITY DEFINER`
  functions with `search_path = ''`) or in Edge Functions using secrets that
  never leave Supabase.
* Nothing the browser sends is trusted for energy, totals, stage, roles,
  prices or entitlements.

## Access model (RLS)

RLS is enabled on every table in `public`. Table write privileges are revoked
from `anon` and `authenticated`; only these direct writes exist:

| Table | Who | What |
| --- | --- | --- |
| `profiles` | owner | `UPDATE (display_name, avatar_preferences)` — column grant + `id = auth.uid()` policy + name validation trigger (blocked terms) |
| `user_discoveries` | owner | `INSERT`/`DELETE` own rows; insert only for public discoveries |
| `user_preferences` | owner | `INSERT`/`UPDATE` own row |

Reads:

| Data | Policy |
| --- | --- |
| regions, world events, discoveries | anyone, only `visibility = 'public'` / `not hidden` |
| world state, snapshots, community events, archetypes, feature flags | anyone |
| traces, profile, roles, saved discoveries, preferences, entitlements | owner only; no access for signed-out requests |
| reports, audit logs, rate-limit counters, errors, analytics, payments, supporters, blocked terms | no API access at all |

All other access goes through functions:

* **Public API**: `get_world_snapshot`, `get_region_detail`, `get_daily_feature`, `get_supporter_wall`, `track_event` (allow-list), `log_client_error` (bounded, globally capped), pure formula helpers.
* **Session required** (`authenticated`, includes guests): `submit_trace`, `submit_report`, `get_my_account`, `delete_my_account`.
* **Moderator/admin** (re-checked inside each function via `public.user_roles`, audited in `admin_audit_logs`): `admin_*`.
* **Service role only**: `run_world_maintenance`, `record_payment_event`.

Internal helpers (`emit_event`, `record_snapshot`, `birth_region_for_stage`, …)
have EXECUTE revoked from every API role. `tests/db/security.test.js` verifies
each of these rules against a real Postgres.

## Identity and guests

Guests use **Supabase anonymous sign-in**: a server-issued, signed session
with a random user id. The id is never chosen by the client, so it can be
used for rate limiting and ownership. A guest can link an email later and
keep their traces. Supabase rate-limits anonymous sign-ups per IP
(`[auth.rate_limit] anonymous_users`, default 30/hour; configure in the
dashboard) — this is the main brake on session farming.

Public pages show only a pseudonym (deterministic `alias_for(id)` or a
chosen display name). Account ids, emails and IPs never appear in public
data or Realtime payloads.

## Abuse prevention (implemented)

* Per-actor cooldown / hourly / daily limits (guests 20 s / 12 / 40; accounts
  10 s / 30 / 120), diminishing energy returns, 600 traces/min global breaker.
* Idempotency keys prevent duplicate and replayed submissions.
* Strict server validation of every parameter; payloads have size checks.
* No free text in traces. Only display names are user text: length/charset
  check constraint plus a blocked-terms table; rendered as text nodes only.
* Reports (5/hour/user, one open report per target), moderator actions:
  hide event/discovery, redact a pseudonym everywhere, all audited.
* `traces_enabled` / `reports_enabled` kill switches for operators.
* PostgREST `max_rows = 100` caps scraping per request; listings paginate.
* Rejections aggregated per actor/hour (no IPs) for the admin view, which
  shows only a shortened hash of the actor id.

**Not implemented / limits:** no CAPTCHA, no IP-based limits in our own
database (Supabase applies its own per-IP limits on auth), no device
fingerprinting. A determined attacker with many IPs can create many guest
sessions; the global breaker, diminishing returns and stage thresholds that
require *distinct* contributors bound the impact, and operators can pause
contributions. If needed, add Supabase's CAPTCHA (hCaptcha/Turnstile) for
anonymous sign-ins in the dashboard.

## Payments

* `create-checkout` computes amounts from a server-side table; the browser
  sends only a tier key. Idempotency key on the Stripe request.
* `stripe-webhook` verifies the `Stripe-Signature` HMAC over the raw body with
  a 5-minute tolerance and constant-time comparison before parsing, and
  records events idempotently by Stripe event id. No card data is ever seen.
* Membership entitlements are written only by the webhook; the
  `membership_enabled` flag is off by default.

## Web headers

`vercel.json` sets CSP (self + Supabase + optional Plausible), HSTS,
`X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and
`noindex` for private routes.

## Granting operator access

There is no default admin. Run in the Supabase SQL editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com';
```

Use `moderator` for people who should only handle reports and visibility.

## Reporting a vulnerability

Contact the operator listed in the privacy policy. Do not test against
production data without permission.
