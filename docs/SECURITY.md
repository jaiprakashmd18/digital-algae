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
* **Anyone, identified server-side** (`anon` and `authenticated`): `submit_trace`, `submit_report`.
* **Session required** (`authenticated`): `get_my_account`, `delete_my_account`.
* **Moderator/admin** (re-checked inside each function via `public.user_roles`, audited in `admin_audit_logs`): `admin_*`.
* **Service role only**: `run_world_maintenance`, `record_payment_event`.

Internal helpers (`emit_event`, `record_snapshot`, `birth_region_for_stage`, …)
have EXECUTE revoked from every API role. `tests/db/security.test.js` verifies
each of these rules against a real Postgres.

## Identity: completely anonymous visitors

Participation needs **no sign-in of any kind** (migration
`20261020000006_anonymous_participation.sql`). `public.current_actor()`
decides who is calling:

* With a verified JWT: the auth user id (`account`, or `session_guest` for any
  legacy Supabase anonymous session).
* Without a session: a **pseudonymous connection key** =
  `md5(HMAC-SHA256(client_ip, secret_salt))` as a UUID. The client IP comes
  from the request headers the API gateway passes to PostgREST
  (`cf-connecting-ip`, then `x-real-ip`, then the leftmost `x-forwarded-for`).
  The salt is generated in the database (`public.app_secrets`, unreadable by
  any API role). The IP itself is never stored, and the key cannot be
  recomputed from an IP without the salt. If no IP header is present, the
  trace is refused (`no_identity`) — it never falls through to "unlimited".

The key is never chosen by the client, so it is a sound basis for rate
limits, idempotency and "distinct visitor" counts. Trade-offs:

* Everyone behind one connection (office, school, mobile carrier NAT)
  shares one key and one allowance, and counts as one distinct visitor.
* Someone controlling many IP addresses can act as many visitors.
* **Verify on your live project** that `cf-connecting-ip` (or `x-real-ip`)
  reaches the database — this was tested against plain Postgres only. The
  quickest check: leave two traces from two different networks and confirm
  `unique_contributors` increases by two.

Operators can turn anonymous traces off with the `anonymous_traces_enabled`
flag in `/admin`; signed-in accounts keep working.

Public pages show only a pseudonym (deterministic `alias_for(id)` or a
chosen display name). Account ids, emails and IPs never appear in public
data or Realtime payloads.

## Abuse prevention (implemented)

* Per-actor cooldown / hourly / daily limits (anonymous, per connection 15 s / 20 / 60; accounts
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

**Not implemented / limits:** no CAPTCHA and no device fingerprinting.
Anonymous limits are per connection, so a determined attacker with many IP
addresses can bypass them; the global breaker, diminishing returns, stage
thresholds that require *distinct* contributors and the
`anonymous_traces_enabled` kill switch bound the impact.

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
