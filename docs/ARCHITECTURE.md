# Architecture

Internet Organism is a static, client-rendered web app (vanilla JS + Three.js,
built with Vite, hosted on Vercel) backed by Supabase (Postgres, Auth,
Realtime, Edge Functions). The **database is authoritative**; the browser
only animates and displays the state it is given.

```
 Browser (Vite build)                       Supabase
 ┌─────────────────────────────┐            ┌────────────────────────────────────┐
 │ router → pages/*            │  RPC/REST  │ PostgREST                          │
 │ services/world-service ─────┼───────────▶│  get_world_snapshot()  (read)      │
 │   EventLedger (dedupe)      │            │  submit_trace()        (ONLY write)│
 │ organism/ Three.js | 2D     │            │  public tables under RLS           │
 │                             │  Realtime  │ Realtime: INSERTs on world_events, │
 │                     ◀───────┼────────────│   community_events; presence       │
 │ lib/backend-supabase.js     │            │ Auth: optional email accounts      │
 │ lib/backend-demo.js (local) │            │ Edge Functions: stripe-webhook,    │
 └─────────────────────────────┘            │   create-checkout, world-tick      │
 Vercel: static dist/ + /api/page-meta,     │ pg_cron (optional) → maintenance   │
 /api/sitemap (public metadata only)        └────────────────────────────────────┘
```

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/main.js`, `src/router.js` | Boot, History-API router with lazily loaded pages |
| `src/pages/*` | One module per route (`render(ctx) → { el, title, description, cleanup }`) |
| `src/components/*` | Navigation, statistics, region panel, trace dialog, share/cards, organism canvas, toasts |
| `src/organism/*` | Deterministic generator, GLSL shaders, Three.js renderer, Canvas 2D fallback, pulse choreography |
| `src/lib/world-model.js` | The world formulas (mirrors SQL; tested for parity) |
| `src/lib/backend-*.js`, `api.js` | Backend interface: live Supabase or local demo |
| `src/lib/realtime.js` | `EventLedger` (dedupe/ordering) and `ConnectionMonitor` |
| `src/services/*` | World store, trace submission, discovery reads, analytics, profile sync |
| `supabase/migrations/*` | Schema, world engine, admin/payments, RLS, initial world |
| `supabase/functions/*` | Deno Edge Functions (payments, maintenance) |
| `api/*` | Vercel functions for server-side link metadata and sitemap |
| `tests/unit`, `tests/db`, `tests/e2e` | Vitest (jsdom), Vitest + real Postgres, Playwright |

Deviation from the suggested structure: `region-detail.js`, `legal.js`,
`support.js`, `not-found.js` pages and the `src/organism/` folder were added;
`organism-canvas.js` stays in `components/` as the integration point.

## World model

* **Regions** hold `energy` (0–100) *as of* `energy_at`. Readers apply
  exponential decay: `E(t) = E₀ · 0.5^(Δt / half_life)`. Decay therefore needs
  no scheduler, and the stored value is only rewritten on a trace or during
  maintenance.
* **A trace** adds `(2 + 4·intensity) · gain_multiplier · 0.6ⁿ · (1 + bonus)`
  where *n* is the actor's traces in that region in the last hour and the
  resonance bonus applies when the previous trace there (≤10 min old, by a
  different visitor) used the same pattern. Energy is capped at 100.
* **States**: dormant < 5 ≤ stirring < 20 ≤ active < 45 ≤ surging < 75 ≤ resonant.
* **Levels** (new branches) at 10/40/120/400/1200 all-time region traces.
* **Stages** need both traces and distinct contributors
  (1/1, 20/5, 120/15, 600/60, 2500/200) and never regress. Stages 2–5 each grow
  one new, deterministically seeded region.
* **Community events**: one *Convergence* per UTC day in a region chosen by
  `md5(slug ‖ region)`, target = clamp(ceil(0.6 · 7-day avg daily contributors), 3, 25).
* **Energy milestones** at 25/50/75 mean energy, at most once per level per UTC day.

All of this is implemented once in SQL (`…_world_engine.sql`) and mirrored in
`src/lib/world-model.js` / `demo-engine.js`. `tests/db/formulas.test.js`
asserts the two agree.

### Seeded vs observed

The initial six regions, the `world_seeded` event and the `initial-structure`
discovery have `origin = 'seeded'`. Regions grown at stages are
`origin = 'system'`. Discoveries caused by a trace are `origin = 'participant'`
and reference the triggering trace (`trigger_trace_id`). The UI shows these
labels everywhere; no statistic is computed from anything but real rows.

### Reproducible history

Every structural change (stage, level, new region) bumps
`world_state.state_version` and stores a `world_snapshots` row containing the
region seeds, levels and anchors. `src/organism/generator.js` is a pure
function of that structure (seeded PRNG), so `/evolution?v=N` re-renders any
historical version exactly. No animation frames are ever stored.

## The write path: `submit_trace()`

One `SECURITY DEFINER` function, callable by anyone (`anon` and `authenticated`):

1. Identity via `current_actor()`: the verified JWT's user id, or — with no
   session — a keyed hash of the client IP (see SECURITY.md). Unidentifiable
   callers are refused.
2. Feature flag `traces_enabled`.
3. Parameter validation (pattern enum, `#rrggbb`, intensity 0.10–1.00, persistence enum, nonce, region exists and is public).
4. `pg_advisory_xact_lock(actor)` — serialises one actor's submissions.
5. Idempotency: `(actor_id, client_nonce)` is unique; a repeat returns the original result with `duplicate: true`.
6. Rate limits (cooldown / hour / UTC day; anonymous-per-connection vs account) and a global 600/min circuit breaker. Rejections are counted in `rate_limit_events`.
7. Region row lock → compute decay, gain, state, level → update region.
8. World row lock → totals, unique contributors, stage; on structural change bump version + snapshot (+ grow a region).
9. Emit the public `trace` event (lightweight payload, no account id) and insert the private trace row.
10. Milestones, community event progress, energy milestones → events + discoveries.
11. Any unexpected error is logged to `system_errors` and returned as `internal_error` (the transaction's world changes are rolled back; success is never reported).

### Concurrency strategy

The lock order is always *actor advisory lock → region row → world_state
row*; maintenance takes region rows in id order before the world row, so no
two transactions can deadlock. Region and world updates are
read-modify-write under row locks, so no update is lost. The world row is a
deliberate single serialisation point; each trace holds it for well under a
millisecond, which supports hundreds of traces per second — far above the
global circuit breaker. `tests/db/world.test.js` fires concurrent
submissions (including duplicate nonces) and checks the totals add up.

## Realtime and reconciliation

* Clients subscribe to `INSERT` on `world_events` and changes on
  `community_events` (Realtime applies the RLS `select` policies — hidden
  events are not delivered). A separate presence channel counts connected tabs
  ("Connected now").
* Events carry the region's new stored energy, state, level and world totals,
  so the client can update immediately without a refetch.
* `EventLedger` applies each event id once (realtime, catch-up pages and the
  submitter's own optimistic copy all pass through it).
* On reconnect (`ConnectionMonitor` sees SUBSCRIBED after an error), on tab
  re-focus after > 60 s and every 5 minutes, the store fetches events
  `id > lastId` (paged) and then refreshes the authoritative snapshot.
  Structural events (or a higher `state_version`) trigger a debounced snapshot
  refresh. The organism keeps rendering from the last known state while
  offline; the header shows Live / Reconnecting / Offline / Unavailable.
* Animation is entirely local. Nothing per-frame is sent anywhere.

## Rendering

* `ThreeOrganism` draws nodes (Points) and filaments (LineSegments) with
  shared GLSL: breathing displacement scaled by region energy, travelling
  waves along branch depth, up to 24 simultaneous pulse rings (trace patterns
  map to ring choreographies), trace "marks" that linger 1 h or 24 h, dust.
  Additive blending; no post-processing to keep mobile fast.
* Quality (node count, pixel ratio, antialiasing) is chosen from device hints;
  sustained < 24 fps steps quality down and finally switches to
  `CanvasOrganism` (2D) — also used when WebGL is missing or the context is
  lost. Rendering pauses when the tab is hidden; everything is disposed on
  navigation.
* Region names are real `<button>`s positioned over the canvas, so keyboard
  and screen-reader users can select regions; "The world as text" lists every
  region's live state; events are announced through a throttled live region.

## Demo mode

Without `VITE_SUPABASE_URL`/key (or with `VITE_DEMO_MODE=true`) the app uses
`backend-demo.js`: the same engine in JS, persisted in `localStorage`, with
"realtime" via `BroadcastChannel` between tabs of one browser. A banner and
the connection label say "Demo — local only". Demo data never touches a
database.

## SEO

* `index.html` contains real explanatory text (shown before JS runs).
* `scripts/prerender.js` writes per-route `index.html` files with correct
  title/description/canonical/OG tags for static routes, plus `robots.txt`.
* `/discovery/:slug` and `/explore/:slug` go through `api/page-meta.js`, which
  fetches the public record with the publishable key and injects metadata
  into the shell (404 + noindex if missing). `api/sitemap.js` lists public
  regions and discoveries.
