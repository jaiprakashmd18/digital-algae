// Completely anonymous participation (no session at all). Requires a local
// PostgreSQL (see harness.js). The client IP arrives in request.headers, as
// Supabase's API gateway provides it to PostgREST.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { account, setupDb, visitor } from './harness.js';

let db;
beforeAll(async () => {
  db = await setupDb();
});
afterAll(async () => {
  await db?.close();
});

describe('anonymous traces', () => {
  it('accepts a trace from a signed-out visitor without any session', async () => {
    const r = await db.trace(visitor('203.0.113.7'), { region: 'the-pulse' });
    expect(r.ok).toBe(true);
    expect(r.alias).toMatch(/^[A-Za-z]+-[0-9A-F]{4}$/);
    const t = await db.pool.query('select actor_kind, actor_id from public.traces where id = $1', [r.trace_id]);
    expect(t.rows[0].actor_kind).toBe('anonymous');
    expect(t.rows[0].actor_id).toMatch(/^[0-9a-f-]{36}$/);
    const ws = await db.pool.query('select total_traces::int as t, unique_contributors as u from public.world_state');
    expect(ws.rows[0]).toEqual({ t: 1, u: 1 });
  });

  it('never stores the IP address anywhere', async () => {
    const tables = (await db.pool.query("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename);
    for (const t of tables) {
      const hit = await db.pool.query(`select count(*)::int as n from public.${t} x where x::text like '%203.0.113.7%'`);
      expect(hit.rows[0].n, t).toBe(0);
    }
  });

  it('derives a stable pseudonymous key per connection that is not the raw IP hash', async () => {
    const a = await db.trace(visitor('198.51.100.20'));
    await db.age((await db.pool.query('select actor_id from public.traces where id = $1', [a.trace_id])).rows[0].actor_id, '1 minute');
    const b = await db.trace(visitor('198.51.100.20'));
    expect(b.ok).toBe(true);
    const ids = (await db.pool.query('select distinct actor_id from public.traces where id = any($1)', [[a.trace_id, b.trace_id]])).rows;
    expect(ids).toHaveLength(1);
    expect(a.alias).toBe(b.alias);
    // Without the secret salt the key cannot be recomputed from the IP.
    const plain = (await db.pool.query("select md5(encode(extensions.digest('198.51.100.20', 'sha256'), 'hex'))::uuid as k")).rows[0].k;
    expect(ids[0].actor_id).not.toBe(plain);
  });

  it('shares limits per connection and counts different connections as distinct visitors', async () => {
    const ip = '192.0.2.44';
    expect((await db.trace(visitor(ip))).ok).toBe(true);
    expect(await db.trace(visitor(ip))).toMatchObject({ ok: false, code: 'cooldown' });
    const before = (await db.pool.query('select unique_contributors as u from public.world_state')).rows[0].u;
    expect((await db.trace(visitor('192.0.2.45'))).ok).toBe(true);
    const after = (await db.pool.query('select unique_contributors as u from public.world_state')).rows[0].u;
    expect(after).toBe(before + 1);
  });

  it('applies the anonymous hourly limit', async () => {
    const ip = '192.0.2.99';
    expect((await db.trace(visitor(ip))).ok).toBe(true);
    const key = (await db.pool.query("select actor_id from public.traces where actor_kind = 'anonymous' order by created_at desc limit 1")).rows[0].actor_id;
    for (let i = 0; i < 19; i++) {
      await db.pool.query(
        `insert into public.traces (region_id, actor_id, actor_kind, client_nonce, trace_type, color, intensity, persistence, energy_gain, alias, created_at)
         select id, $1, 'anonymous', gen_random_uuid(), 'spark', '#ffffff', 0.5, 'lasting', 1, 'x', now() - make_interval(mins => $2) from public.regions where slug = 'the-core'`,
        [key, 1 + i * 2]);
    }
    await db.age(key, '30 seconds');
    expect(await db.trace(visitor(ip))).toMatchObject({ ok: false, code: 'hourly_limit' });
    await db.pool.query("delete from public.traces where actor_id = $1 and alias = 'x'", [key]);
  });

  it('is idempotent for retried requests', async () => {
    const nonce = randomUUID();
    const a = await db.trace(visitor('192.0.2.200'), { nonce });
    const b = await db.trace(visitor('192.0.2.200'), { nonce });
    expect(b).toMatchObject({ ok: true, duplicate: true, trace_id: a.trace_id });
  });

  it('can be switched off by operators while accounts keep working', async () => {
    await db.pool.query("update public.feature_flags set enabled = false where key = 'anonymous_traces_enabled'");
    expect(await db.trace(visitor('192.0.2.201'))).toMatchObject({ ok: false, code: 'anonymous_paused' });
    const id = await db.createUser();
    expect((await db.trace(account(id))).ok).toBe(true);
    await db.pool.query("update public.feature_flags set enabled = true where key = 'anonymous_traces_enabled'");
  });

  it('anonymous visitors still cannot read traces or write world tables', async () => {
    await expect(db.as(visitor('192.0.2.7'), (c) => c.query('select * from public.traces'))).rejects.toThrow(/permission denied/);
    await expect(db.as(visitor('192.0.2.7'), (c) => c.query('update public.world_state set total_traces = 0'))).rejects.toThrow(/permission denied/);
    await expect(db.as(visitor('192.0.2.7'), (c) => c.query('select public.current_actor()'))).rejects.toThrow(/permission denied/);
    await expect(db.as(visitor('192.0.2.7'), (c) => c.query('select * from public.app_secrets'))).rejects.toThrow(/permission denied/);
  });

  it('anonymous visitors can report content, rate limited per connection', async () => {
    const ev = (await db.pool.query("select id from public.world_events where event_type = 'trace' order by id desc limit 6")).rows;
    const results = [];
    for (const e of ev) {
      results.push(await db.commit(visitor('192.0.2.88'), async (c) => (await c.query("select public.submit_report('world_event', $1, 'spam', null) as r", [String(e.id)])).rows[0].r));
    }
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.at(-1).code).toBe('hourly_limit');
    const stored = (await db.pool.query('select reporter_id, reporter_key from public.reports limit 1')).rows[0];
    expect(stored.reporter_id).toBeNull();
    expect(stored.reporter_key).toMatch(/^[0-9a-f-]{36}$/);
  });
});
