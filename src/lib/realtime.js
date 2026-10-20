/**
 * Realtime reconciliation primitives.
 *
 * The backend broadcasts lightweight world events. Delivery can be delayed,
 * duplicated (realtime + catch-up fetch overlap) or missed (disconnects), so
 * the client keeps an EventLedger: every event id is applied at most once,
 * and after a reconnect the client fetches everything after the highest id
 * it has seen and refreshes the authoritative snapshot.
 */

export class EventLedger {
  constructor({ capacity = 3000 } = {}) {
    this.capacity = capacity;
    this.lastId = 0;
    this.seen = new Set();
  }

  /** Mark the baseline from a snapshot: events up to this id are already reflected. */
  setBaseline(latestEventId) {
    const id = Number(latestEventId) || 0;
    if (id > this.lastId) this.lastId = id;
  }

  /** Returns true if the event is new and should be applied. */
  accept(event) {
    const id = Number(event?.id);
    if (!Number.isFinite(id) || id <= 0) return false;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > this.capacity) {
      // Sets iterate in insertion order: drop the oldest entries.
      const drop = this.seen.size - this.capacity;
      let i = 0;
      for (const old of this.seen) {
        if (i++ >= drop) break;
        this.seen.delete(old);
      }
    }
    if (id > this.lastId) this.lastId = id;
    return true;
  }

  /** Accept a batch, returning only new events in ascending id order. */
  acceptMany(events) {
    return [...(events ?? [])].sort((a, b) => Number(a.id) - Number(b.id)).filter((e) => this.accept(e));
  }
}

/**
 * Tracks connection status from Supabase channel callbacks and browser
 * online/offline signals, and asks for reconciliation after recovery.
 */
export class ConnectionMonitor {
  constructor({ onStatus, onRecovered }) {
    this.status = 'connecting';
    this.onStatus = onStatus;
    this.onRecovered = onRecovered;
    this.hasConnected = false;
    this.wasDisconnected = false;
  }

  /** Feed Supabase channel subscribe statuses: SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED. */
  channelStatus(status) {
    if (status === 'SUBSCRIBED') {
      const recovered = this.hasConnected && this.wasDisconnected;
      this.hasConnected = true;
      this.wasDisconnected = false;
      this.set('live');
      if (recovered) this.onRecovered?.();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (this.hasConnected) this.wasDisconnected = true;
      this.set(globalThis.navigator?.onLine === false ? 'offline' : 'reconnecting');
    }
  }

  browserOffline() {
    if (this.hasConnected) this.wasDisconnected = true;
    this.set('offline');
  }

  browserOnline() {
    if (this.status === 'offline') this.set('reconnecting');
  }

  set(status) {
    if (status === this.status) return;
    this.status = status;
    this.onStatus?.(status);
  }
}

export const CONNECTION_LABELS = Object.freeze({
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  demo: 'Demo — local only',
  unavailable: 'Live updates unavailable',
});
