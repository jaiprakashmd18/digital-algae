/**
 * Database test harness. Creates a throwaway database, loads the Supabase
 * stub, every migration and the seed, then runs queries as anonymous
 * visitors, guest users, accounts or the service role — the way PostgREST
 * switches role and JWT claims per request.
 *
 * Requires a local PostgreSQL (no Supabase credentials). Configure with
 * TEST_DATABASE_URL (default postgres://postgres:postgres@localhost:5432/postgres).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const anon = { kind: 'anon' };
export const service = { kind: 'service' };
export const guest = (id) => ({ kind: 'user', id, anonymous: true });
export const account = (id) => ({ kind: 'user', id, anonymous: false });

export async function setupDb() {
  const dbName = `io_test_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
  // Silence the expected "wal_level" publication warning from the stub.
  pool.on('notice', () => {});

  const files = [
    join(root, 'supabase/tests/supabase-stub.sql'),
    ...readdirSync(join(root, 'supabase/migrations')).sort().map((f) => join(root, 'supabase/migrations', f)),
    join(root, 'supabase/seed.sql'),
  ];
  for (const f of files) {
    try {
      await pool.query(readFileSync(f, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to apply ${f}: ${e.message}`, { cause: e });
    }
  }

  async function asIdentity(who, fn, { commit = false } = {}) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      if (who.kind === 'anon') {
        await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
        await c.query('set local role anon');
      } else if (who.kind === 'user') {
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who.id, role: 'authenticated', is_anonymous: who.anonymous })]);
        await c.query('set local role authenticated');
      } else if (who.kind === 'service') {
        await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
        await c.query('set local role service_role');
      }
      const out = await fn(c);
      await c.query(commit ? 'commit' : 'rollback');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  return {
    pool,
    as: asIdentity,
    /** Run fn as identity and commit. */
    commit: (who, fn) => asIdentity(who, fn, { commit: true }),
    async createUser({ anonymous = false, roles = [] } = {}) {
      const id = randomUUID();
      await pool.query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [id, anonymous ? null : `${id}@example.test`, anonymous]);
      for (const r of roles) await pool.query('insert into public.user_roles (user_id, role) values ($1, $2)', [id, r]);
      return id;
    },
    /** Submit a trace as `who` and commit; returns the JSON result. */
    async trace(who, overrides = {}) {
      const p = { region: 'the-core', type: 'spark', color: '#5ee7ff', intensity: 0.6, persistence: 'lasting', nonce: randomUUID(), ...overrides };
      return asIdentity(who, async (c) => {
        const { rows } = await c.query('select public.submit_trace($1, $2, $3, $4, $5, $6) as r', [p.region, p.type, p.color, p.intensity, p.persistence, p.nonce]);
        return rows[0].r;
      }, { commit: true });
    },
    /** Move an actor's traces into the past to get past cooldowns/limits. */
    async age(actorId, interval) {
      await pool.query(`update public.traces set created_at = created_at - $2::interval where actor_id = $1`, [actorId, interval]);
    },
    async close() {
      await pool.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${dbName} with (force)`);
      await a.end();
    },
  };
}
