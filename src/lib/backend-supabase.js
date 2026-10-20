/**
 * Live backend: Supabase (PostgREST + RPC + Realtime + Auth).
 *
 * Reads use public tables filtered by RLS or SECURITY DEFINER read
 * functions. The only world mutation is the submit_trace RPC. Results from
 * RPCs are returned as-is ({ ok, code, ... }); transport failures are mapped
 * to { ok: false, code: 'network' } and NEVER reported as success.
 */
import { getSupabase } from './supabase.js';
import { config } from './config.js';
import { ApiError, codeFromError } from '../utils/errors.js';
import { ConnectionMonitor } from './realtime.js';
import { validateTrace } from './validation.js';

const EVENT_COLUMNS = 'id,event_type,origin,region_id,payload,state_version,created_at';
const DISCOVERY_COLUMNS = 'id,slug,kind,origin,title,description,triggered_by_alias,state_version,created_at,region_id,world_event_id';
const ADMIN_RPCS = new Set([
  'admin_overview', 'admin_list_reports', 'admin_set_event_hidden', 'admin_set_discovery_visibility', 'admin_redact_alias',
  'admin_resolve_report', 'admin_set_feature_flag', 'admin_run_maintenance', 'admin_list_errors', 'admin_list_rate_limits',
  'admin_list_audit', 'admin_list_events',
]);

function unwrap({ data, error }) {
  if (error) throw new ApiError(codeFromError(error), error);
  return data;
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function createSupabaseBackend() {
  const sb = getSupabase();
  let presenceCount = null;

  async function rpcResult(name, args) {
    try {
      const { data, error } = await sb.rpc(name, args);
      if (error) return { ok: false, code: codeFromError(error) };
      return data ?? { ok: true };
    } catch (e) {
      return { ok: false, code: codeFromError(e) };
    }
  }

  const backend = {
    mode: 'live',

    // ---------------------------------------------------------------- world
    async getSnapshot() {
      return unwrap(await sb.rpc('get_world_snapshot'));
    },

    async listEvents({ afterId = null, beforeId = null, limit = 30, types = null, regionId = null, excludeTypes = null } = {}) {
      let q = sb.from('world_events').select(EVENT_COLUMNS).limit(Math.min(limit, 100));
      if (afterId != null) q = q.gt('id', afterId).order('id', { ascending: true });
      else q = q.order('id', { ascending: false });
      if (beforeId != null) q = q.lt('id', beforeId);
      if (types?.length) q = q.in('event_type', types);
      if (excludeTypes?.length) q = q.not('event_type', 'in', `(${excludeTypes.join(',')})`);
      if (regionId) q = q.eq('region_id', regionId);
      return unwrap(await q);
    },

    async listDiscoveries({ page = 1, pageSize = 12, kind = null, origin = null, search = '', regionId = null } = {}) {
      const from = (page - 1) * pageSize;
      let q = sb.from('discoveries').select(DISCOVERY_COLUMNS, { count: 'exact' })
        .order('created_at', { ascending: false }).range(from, from + pageSize - 1);
      if (kind) q = q.eq('kind', kind);
      if (origin) q = q.eq('origin', origin);
      if (regionId) q = q.eq('region_id', regionId);
      const term = search.trim().slice(0, 60);
      if (term) q = q.ilike('title', `%${escapeLike(term)}%`);
      const { data, error, count } = await q;
      if (error) throw new ApiError(codeFromError(error), error);
      return { items: data, total: count ?? data.length };
    },

    async getDiscovery(slug) {
      const d = unwrap(await sb.from('discoveries').select(DISCOVERY_COLUMNS).eq('slug', slug).maybeSingle());
      if (!d) return null;
      let event = null;
      if (d.world_event_id) {
        event = unwrap(await sb.from('world_events').select(EVENT_COLUMNS).eq('id', d.world_event_id).maybeSingle());
      }
      return { ...d, event };
    },

    async discoveriesForEvents(eventIds) {
      if (!eventIds.length) return [];
      return unwrap(await sb.from('discoveries').select('slug,world_event_id').in('world_event_id', eventIds.slice(0, 100)));
    },

    async getRegion(slug) {
      return unwrap(await sb.rpc('get_region_detail', { p_slug: slug }));
    },

    async listSnapshots() {
      return unwrap(await sb.from('world_snapshots').select('state_version,evolution_stage,reason,created_at')
        .order('state_version', { ascending: false }).limit(100));
    },

    async getWorldSnapshotVersion(version) {
      return unwrap(await sb.from('world_snapshots').select('*').eq('state_version', version).maybeSingle());
    },

    async listCommunityEvents({ limit = 14 } = {}) {
      return unwrap(await sb.from('community_events')
        .select('slug,title,description,region_id,goal_target,starts_at,ends_at,status,completed_at')
        .order('starts_at', { ascending: false }).limit(limit));
    },

    async getDailyFeature() {
      return unwrap(await sb.rpc('get_daily_feature'));
    },

    async submitTrace(draft) {
      const v = validateTrace(draft);
      if (!v.ok) return { ok: false, code: 'invalid_parameters', field: v.field };
      // No sign-in needed: without a session the server identifies the
      // visitor by a keyed hash of their connection (see migration 6).
      const result = await rpcResult('submit_trace', {
        p_region_slug: v.value.regionSlug,
        p_trace_type: v.value.pattern,
        p_color: v.value.color,
        p_intensity: v.value.intensity,
        p_persistence: v.value.persistence,
        p_client_nonce: v.value.nonce,
      });
      if (result && !result.ok && result.retry_after) result.retryAfter = Number(result.retry_after);
      return result;
    },

    // ------------------------------------------------------------- realtime
    subscribe({ onEvent, onCommunityEvent, onStatus, onRecovered, onPresence }) {
      const monitor = new ConnectionMonitor({ onStatus, onRecovered });
      onStatus?.('connecting');
      const events = sb.channel('world-events')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'world_events' }, (p) => onEvent?.(p.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'community_events' }, (p) => onCommunityEvent?.(p.new))
        .subscribe((status) => monitor.channelStatus(status));

      const tabKey = crypto.randomUUID();
      const presence = sb.channel('organism-presence', { config: { presence: { key: tabKey } } });
      presence
        .on('presence', { event: 'sync' }, () => {
          presenceCount = Object.keys(presence.presenceState()).length;
          onPresence?.(presenceCount);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') await presence.track({ since: new Date().toISOString().slice(0, 13) });
          else if (status !== 'SUBSCRIBED') onPresence?.(null);
        });

      const offline = () => monitor.browserOffline();
      const online = () => monitor.browserOnline();
      window.addEventListener('offline', offline);
      window.addEventListener('online', online);
      return () => {
        window.removeEventListener('offline', offline);
        window.removeEventListener('online', online);
        sb.removeChannel(events);
        sb.removeChannel(presence);
      };
    },

    // ----------------------------------------------------------------- auth
    async getUser() {
      const { data } = await sb.auth.getSession();
      return data.session?.user ?? null;
    },

    onAuthChange(fn) {
      const { data } = sb.auth.onAuthStateChange((event, session) => fn(event, session?.user ?? null));
      return () => data.subscription.unsubscribe();
    },

    /** Personal features (saving discoveries) need an account; traces never do. */
    async ensureSession() {
      try {
        const { data } = await sb.auth.getSession();
        if (data.session) return { ok: true, user: data.session.user };
        return { ok: false, code: 'account_required' };
      } catch (e) {
        return { ok: false, code: codeFromError(e) };
      }
    },

    async signUp(email, password) {
      const redirect = `${config.siteUrl}/profile`;
      const user = await backend.getUser();
      try {
        if (user?.is_anonymous) {
          // Link an email to the existing guest so its traces are kept.
          const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: redirect });
          if (error) return { ok: false, code: codeFromError(error), message: error.message };
          return { ok: true, linked: true, needsPassword: true };
        }
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) return { ok: false, code: codeFromError(error), message: error.message };
        return { ok: true, needsConfirmation: !data.session };
      } catch (e) {
        return { ok: false, code: codeFromError(e) };
      }
    },

    async signIn(email, password) {
      try {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        return error ? { ok: false, code: codeFromError(error) } : { ok: true };
      } catch (e) {
        return { ok: false, code: codeFromError(e) };
      }
    },

    async signInWithOAuth(provider) {
      if (!config.oauthProviders.includes(provider)) return { ok: false, code: 'forbidden' };
      const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: `${config.siteUrl}/profile` } });
      return error ? { ok: false, code: codeFromError(error) } : { ok: true };
    },

    async signOut() {
      const { error } = await sb.auth.signOut();
      return error ? { ok: false, code: codeFromError(error) } : { ok: true };
    },

    async requestPasswordReset(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${config.siteUrl}/reset-password` });
      return error ? { ok: false, code: codeFromError(error) } : { ok: true };
    },

    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      return error ? { ok: false, code: codeFromError(error), message: error.message } : { ok: true };
    },

    // -------------------------------------------------------------- profile
    async getAccount() {
      return unwrap(await sb.rpc('get_my_account'));
    },

    async updateProfile({ displayName }) {
      const user = await backend.getUser();
      if (!user) return { ok: false, code: 'no_session' };
      const { error } = await sb.from('profiles').update({ display_name: displayName }).eq('id', user.id);
      return error ? { ok: false, code: codeFromError(error) } : { ok: true };
    },

    async listMyTraces({ limit = 50 } = {}) {
      return unwrap(await sb.from('traces')
        .select('id,region_id,trace_type,color,intensity,persistence,energy_gain,alias,created_at')
        .order('created_at', { ascending: false }).limit(limit));
    },

    async listSaved() {
      return unwrap(await sb.from('user_discoveries')
        .select('discovery_id,created_at,discoveries(slug,title,kind,origin,created_at)')
        .order('created_at', { ascending: false }).limit(200));
    },

    async saveDiscovery(discoveryId) {
      const session = await backend.ensureSession();
      if (!session.ok) return session;
      const { error } = await sb.from('user_discoveries').insert({ user_id: session.user.id, discovery_id: discoveryId });
      if (error && error.code !== '23505') return { ok: false, code: codeFromError(error) };
      return { ok: true };
    },

    async unsaveDiscovery(discoveryId) {
      const user = await backend.getUser();
      if (!user) return { ok: false, code: 'no_session' };
      const { error } = await sb.from('user_discoveries').delete().eq('user_id', user.id).eq('discovery_id', discoveryId);
      return error ? { ok: false, code: codeFromError(error) } : { ok: true };
    },

    async getRemotePreferences() {
      const user = await backend.getUser();
      if (!user) return null;
      const row = unwrap(await sb.from('user_preferences').select('preferences').eq('user_id', user.id).maybeSingle());
      return row?.preferences ?? null;
    },

    async saveRemotePreferences(preferences) {
      const user = await backend.getUser();
      if (!user || user.is_anonymous) return { ok: false, code: 'no_session' };
      const { error } = await sb.from('user_preferences').upsert({ user_id: user.id, preferences });
      return error ? { ok: false, code: codeFromError(error) } : { ok: true };
    },

    async deleteAccount() {
      const result = await rpcResult('delete_my_account');
      if (result.ok) await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      return result;
    },

    // ----------------------------------------------------------- moderation
    async submitReport({ targetType, targetId, reason, details }) {
      const r = await rpcResult('submit_report', { p_target_type: targetType, p_target_id: String(targetId), p_reason: reason, p_details: details ?? null });
      if (!r.ok && r.code === 'hourly_limit') r.code = 'hourly_limit_report';
      return r;
    },

    async admin(name, args = {}) {
      if (!ADMIN_RPCS.has(name)) throw new ApiError('forbidden');
      return unwrap(await sb.rpc(name, args));
    },

    // ------------------------------------------------------ telemetry, misc
    logError(code, message, route) {
      sb.rpc('log_client_error', { p_code: code, p_message: message, p_route: route }).then(() => {}, () => {});
    },

    track(event) {
      sb.rpc('track_event', { p_event: event }).then(() => {}, () => {});
    },

    async getSupporterWall() {
      return unwrap(await sb.rpc('get_supporter_wall'));
    },

    async startCheckout({ tier, publicName, acknowledge }) {
      try {
        const { data, error } = await sb.functions.invoke('create-checkout', { body: { tier, publicName, acknowledge } });
        if (error || !data?.url) return { ok: false, code: 'payment_failed' };
        return { ok: true, url: data.url };
      } catch {
        return { ok: false, code: 'payment_failed' };
      }
    },

    get presence() {
      return presenceCount;
    },
  };
  return backend;
}
