// RLS and authorization tests. Requires a local PostgreSQL (see harness.js).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, anon, guest, service, setupDb } from './harness.js';

let db;
let alice;
let bob;
let admin;
let moderator;
let aliceTrace;

beforeAll(async () => {
  db = await setupDb();
  alice = await db.createUser();
  bob = await db.createUser();
  admin = await db.createUser({ roles: ['admin'] });
  moderator = await db.createUser({ roles: ['moderator'] });
  aliceTrace = await db.trace(account(alice), { region: 'the-pulse' });
});
afterAll(async () => {
  await db?.close();
});

const q = (who, sql, params) => db.as(who, async (c) => (await c.query(sql, params)).rows);

describe('public reads', () => {
  it('anonymous visitors can read public world data', async () => {
    expect((await q(anon, 'select slug from public.regions')).length).toBe(6);
    expect((await q(anon, 'select id from public.world_events')).length).toBeGreaterThan(0);
    expect((await q(anon, 'select slug from public.discoveries')).length).toBeGreaterThan(0);
    expect((await q(anon, 'select * from public.world_state')).length).toBe(1);
    expect((await q(anon, 'select * from public.feature_flags')).length).toBeGreaterThan(0);
  });

  it('hidden events, hidden discoveries and hidden regions are not readable', async () => {
    await db.pool.query('update public.world_events set hidden = true where id = $1', [aliceTrace.event_id]);
    await db.pool.query("update public.discoveries set visibility = 'hidden' where slug = 'the-first-trace'");
    expect(await q(anon, 'select id from public.world_events where id = $1', [aliceTrace.event_id])).toEqual([]);
    expect(await q(anon, "select slug from public.discoveries where slug = 'the-first-trace'")).toEqual([]);
    await db.pool.query('update public.world_events set hidden = false where id = $1', [aliceTrace.event_id]);
    await db.pool.query("update public.discoveries set visibility = 'public' where slug = 'the-first-trace'");
  });

  it('anonymous visitors cannot read personal or operational tables', async () => {
    for (const table of ['traces', 'profiles', 'user_preferences', 'user_discoveries', 'entitlements', 'user_roles',
      'reports', 'admin_audit_logs', 'rate_limit_events', 'system_errors', 'analytics_daily', 'payment_events', 'supporters', 'blocked_terms']) {
      await expect(q(anon, `select * from public.${table}`), table).rejects.toThrow(/permission denied/);
    }
  });
});

describe('world mutations are server-only', () => {
  it('no API role can write world tables directly', async () => {
    for (const who of [anon, account(alice), guest(alice)]) {
      await expect(q(who, 'update public.world_state set total_traces = 999999')).rejects.toThrow(/permission denied/);
      await expect(q(who, "update public.regions set energy = 100 where slug = 'the-core'")).rejects.toThrow(/permission denied/);
      await expect(q(who, "insert into public.world_events (event_type, origin, state_version) values ('trace','participant',1)")).rejects.toThrow(/permission denied/);
      await expect(q(who, "insert into public.discoveries (slug, kind, origin, title, description, state_version) values ('fake','first_trace','participant','Fake','x',1)")).rejects.toThrow(/permission denied/);
      await expect(q(who, 'delete from public.world_events')).rejects.toThrow(/permission denied/);
    }
  });

  it('users cannot insert traces directly (bypassing validation and limits)', async () => {
    await expect(q(account(alice), `insert into public.traces (region_id, actor_id, client_nonce, trace_type, color, intensity, persistence, energy_gain, alias)
      select id, $1, gen_random_uuid(), 'spark', '#ffffff', 1, 'lasting', 100, 'x' from public.regions limit 1`, [alice])).rejects.toThrow(/permission denied/);
  });

  it('internal helpers and maintenance are not callable by API roles', async () => {
    for (const fn of ['run_world_maintenance()', "emit_event('trace','participant',null,'{}',1)", "record_snapshot('x')",
      'seed_initial_world()', "birth_region_for_stage(3::smallint)", "ensure_daily_community_event(now())",
      "record_payment_event('evt','donation_completed','{}')"]) {
      await expect(q(account(alice), `select public.${fn}`), fn).rejects.toThrow(/permission denied/);
    }
  });

  it('the service role can run maintenance and record payments', async () => {
    const r = await q(service, 'select public.run_world_maintenance() as r');
    expect(r[0].r.ok).toBe(true);
  });
});

describe('personal data', () => {
  it('users see only their own traces', async () => {
    const mine = await q(account(alice), 'select actor_id from public.traces');
    expect(mine.length).toBe(1);
    expect(mine.every((t) => t.actor_id === alice)).toBe(true);
    expect(await q(account(bob), 'select * from public.traces')).toEqual([]);
  });

  it('users can read and edit only their own profile, and only allowed columns', async () => {
    expect((await q(account(bob), 'select id from public.profiles')).map((r) => r.id)).toEqual([bob]);
    await db.commit(account(bob), (c) => c.query("update public.profiles set display_name = 'Bob Bright' where id = $1", [bob]));
    const r = await db.pool.query('select display_name from public.profiles where id = $1', [bob]);
    expect(r.rows[0].display_name).toBe('Bob Bright');
    // Updating someone else's profile silently affects zero rows.
    const n = await db.as(account(bob), async (c) => (await c.query("update public.profiles set display_name = 'Hacked' where id = $1", [alice])).rowCount);
    expect(n).toBe(0);
    await expect(q(account(bob), "update public.profiles set id = gen_random_uuid() where id = $1", [bob])).rejects.toThrow(/permission denied/);
    await expect(q(account(bob), "update public.profiles set created_at = now() where id = $1", [bob])).rejects.toThrow(/permission denied/);
  });

  it('rejects impersonating or malformed display names', async () => {
    await expect(q(account(bob), "update public.profiles set display_name = 'Official Admin' where id = $1", [bob])).rejects.toThrow(/display_name_rejected/);
    await expect(q(account(bob), "update public.profiles set display_name = '<b>x</b>' where id = $1", [bob])).rejects.toThrow(/check/);
    await expect(q(account(bob), "update public.profiles set display_name = 'x' where id = $1", [bob])).rejects.toThrow(/check/);
  });

  it('saved discoveries and preferences are private and owner-scoped', async () => {
    const d = (await db.pool.query("select id from public.discoveries where slug = 'initial-structure'")).rows[0].id;
    await db.commit(account(alice), (c) => c.query('insert into public.user_discoveries (user_id, discovery_id) values ($1, $2)', [alice, d]));
    await expect(q(account(bob), 'insert into public.user_discoveries (user_id, discovery_id) values ($1, $2)', [alice, d])).rejects.toThrow(/row-level security/);
    expect(await q(account(bob), 'select * from public.user_discoveries')).toEqual([]);
    await db.commit(account(alice), (c) => c.query(`insert into public.user_preferences (user_id, preferences) values ($1, '{"motion":"reduce"}')
      on conflict (user_id) do update set user_id = excluded.user_id, preferences = excluded.preferences`, [alice]));
    expect(await q(account(bob), 'select * from public.user_preferences')).toEqual([]);
    await expect(q(account(bob), `insert into public.user_preferences (user_id, preferences) values ($1, '{}')`, [alice])).rejects.toThrow(/row-level security/);
  });

  it('cannot save hidden discoveries', async () => {
    const d = (await db.pool.query("select id from public.discoveries where slug = 'the-first-trace'")).rows[0].id;
    await db.pool.query("update public.discoveries set visibility = 'hidden' where id = $1", [d]);
    await expect(q(account(bob), 'insert into public.user_discoveries (user_id, discovery_id) values ($1, $2)', [bob, d])).rejects.toThrow(/row-level security/);
    await db.pool.query("update public.discoveries set visibility = 'public' where id = $1", [d]);
  });
});

describe('privilege escalation', () => {
  it('users cannot grant themselves roles', async () => {
    await expect(q(account(alice), "insert into public.user_roles (user_id, role) values ($1, 'admin')", [alice])).rejects.toThrow(/permission denied/);
  });

  it('admin functions refuse non-operators (even with forged claims in the payload)', async () => {
    await expect(q(account(alice), 'select public.admin_overview()')).rejects.toThrow(/forbidden/);
    await expect(q(guest(alice), "select public.admin_set_feature_flag('traces_enabled', false)")).rejects.toThrow(/forbidden/);
    // A JWT claiming an admin role in user metadata does not matter: roles live in user_roles.
    await expect(db.as({ kind: 'user', id: alice, anonymous: false }, async (c) => {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: alice, role: 'authenticated', app_metadata: { role: 'admin' } })]);
      return c.query('select public.admin_overview()');
    })).rejects.toThrow(/forbidden/);
    await expect(q(anon, 'select public.admin_overview()')).rejects.toThrow(/permission denied/);
  });

  it('moderators can moderate; only admins can change flags; actions are audited', async () => {
    const ov = await q(account(moderator), 'select public.admin_overview() as o');
    expect(ov[0].o.is_admin).toBe(false);
    await expect(q(account(moderator), "select public.admin_set_feature_flag('traces_enabled', false)")).rejects.toThrow(/forbidden/);
    const r = await db.commit(account(admin), async (c) => (await c.query("select public.admin_set_feature_flag('reports_enabled', true) as r")).rows[0].r);
    expect(r.ok).toBe(true);
    const audit = await db.pool.query("select admin_id, action from public.admin_audit_logs where action = 'set_feature_flag'");
    expect(audit.rows[0].admin_id).toBe(admin);
  });

  it('audit logs are never readable through the API', async () => {
    await expect(q(account(admin), 'select * from public.admin_audit_logs')).rejects.toThrow(/permission denied/);
    await expect(q(account(moderator), 'select public.admin_list_audit(10)')).rejects.toThrow(/forbidden/);
    expect((await q(account(admin), 'select public.admin_list_audit(10) as a'))[0].a.length).toBeGreaterThan(0);
  });
});

describe('reports and moderation workflow', () => {
  it('a user reports an event, a moderator redacts the pseudonym everywhere', async () => {
    const before = (await db.pool.query('select payload from public.world_events where id = $1', [aliceTrace.event_id])).rows[0].payload.alias;
    const rep = await db.commit(account(bob), async (c) => (await c.query("select public.submit_report('world_event', $1, 'offensive_name', 'rude') as r", [String(aliceTrace.event_id)])).rows[0].r);
    expect(rep).toMatchObject({ ok: true, duplicate: false });
    // Duplicate open report from the same user is not stored twice.
    const dup = await db.commit(account(bob), async (c) => (await c.query("select public.submit_report('world_event', $1, 'offensive_name', null) as r", [String(aliceTrace.event_id)])).rows[0].r);
    expect(dup.duplicate).toBe(true);
    const reports = (await q(account(moderator), "select public.admin_list_reports('open', 10) as r"))[0].r;
    expect(reports).toHaveLength(1);
    const res = await db.commit(account(moderator), async (c) => (await c.query("select public.admin_resolve_report($1, 'redact_alias') as r", [reports[0].id])).rows[0].r);
    expect(res.ok).toBe(true);
    const after = (await db.pool.query('select payload from public.world_events where id = $1', [aliceTrace.event_id])).rows[0].payload.alias;
    expect(before).not.toBe('Redacted visitor');
    expect(after).toBe('Redacted visitor');
    const trace = (await db.pool.query('select alias from public.traces where actor_id = $1', [alice])).rows[0];
    expect(trace.alias).toBe('Redacted visitor');
  });

  it('report submission is rate limited and validated', async () => {
    expect((await db.trace(account(bob), {})).ok).toBe(true);
    const bad = await db.commit(account(bob), async (c) => (await c.query("select public.submit_report('world_event', 'abc', 'spam', null) as r")).rows[0].r);
    expect(bad.code).toBe('not_found');
    const events = (await db.pool.query("select id from public.world_events where not hidden order by id desc limit 7")).rows;
    const results = [];
    for (const e of events) results.push(await db.commit(account(alice), async (c) => (await c.query("select public.submit_report('world_event', $1, 'spam', null) as r", [String(e.id)])).rows[0].r));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.at(-1).code).toBe('hourly_limit');
  });
});

describe('account deletion', () => {
  it('deletes the account, keeps the world consistent and anonymises the pseudonym', async () => {
    const carol = await db.createUser();
    const t = await db.trace(account(carol), { region: 'the-quiet-zone' });
    const total = (await db.pool.query('select total_traces from public.world_state')).rows[0].total_traces;
    const r = await db.commit(account(carol), async (c) => (await c.query('select public.delete_my_account() as r')).rows[0].r);
    expect(r.ok).toBe(true);
    expect((await db.pool.query('select 1 from auth.users where id = $1', [carol])).rowCount).toBe(0);
    const trace = (await db.pool.query('select actor_id, alias from public.traces where id = $1', [t.trace_id])).rows[0];
    expect(trace).toEqual({ actor_id: null, alias: 'Former visitor' });
    const ev = (await db.pool.query('select payload from public.world_events where id = $1', [t.event_id])).rows[0];
    expect(ev.payload.alias).toBe('Former visitor');
    expect((await db.pool.query('select total_traces from public.world_state')).rows[0].total_traces).toBe(total);
  });
});

describe('payments', () => {
  it('records payment events idempotently, only via the service role', async () => {
    const data = { payment_id: 'pi_123', amount_cents: 500, currency: 'EUR', user_id: alice, public_acknowledgment: true, public_name: 'Alice' };
    const a = await db.commit(service, async (c) => (await c.query("select public.record_payment_event('evt_1', 'donation_completed', $1) as r", [data])).rows[0].r);
    const b = await db.commit(service, async (c) => (await c.query("select public.record_payment_event('evt_1', 'donation_completed', $1) as r", [data])).rows[0].r);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect((await db.pool.query('select count(*)::int as n from public.supporters')).rows[0].n).toBe(1);
    const wall = (await q(anon, 'select public.get_supporter_wall() as w'))[0].w;
    expect(wall.map((s) => s.name)).toEqual(['Alice']);
    expect(JSON.stringify(wall)).not.toMatch(/500|pi_123/);
  });

  it('entitlements are readable only by their owner and not writable by users', async () => {
    await db.commit(service, (c) => c.query("select public.record_payment_event('evt_2', 'membership_updated', $1)", [{ user_id: alice, subscription_id: 'sub_1', status: 'active', current_period_end: 2000000000 }]));
    expect((await q(account(alice), 'select status from public.entitlements')).map((r) => r.status)).toEqual(['active']);
    expect(await q(account(bob), 'select * from public.entitlements')).toEqual([]);
    await expect(q(account(bob), "insert into public.entitlements (user_id, entitlement, status) values ($1, 'supporter_membership', 'active')", [bob])).rejects.toThrow(/permission denied/);
  });
});

describe('analytics and client errors', () => {
  it('only allow-listed events are counted, as daily aggregates', async () => {
    await q(anon, "select public.track_event('trace_submitted')");
    await db.commit(anon, (c) => c.query("select public.track_event('trace_submitted'), public.track_event('evil'), public.track_event('trace_submitted')"));
    const r = await db.pool.query('select event, count from public.analytics_daily');
    expect(r.rows).toEqual([{ event: 'trace_submitted', count: '2' }]);
  });

  it('client error logs are bounded', async () => {
    await db.commit(anon, (c) => c.query('select public.log_client_error($1, $2, $3)', ['x'.repeat(500), 'y'.repeat(5000), '/']));
    const r = await db.pool.query("select length(code) as c, length(message) as m from public.system_errors where source = 'client'");
    expect(r.rows[0]).toEqual({ c: 60, m: 300 });
  });
});
