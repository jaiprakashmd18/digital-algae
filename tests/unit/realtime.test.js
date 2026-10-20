import { describe, expect, it, vi } from 'vitest';
import { ConnectionMonitor, EventLedger } from '../../src/lib/realtime.js';

describe('EventLedger', () => {
  it('applies each event once, regardless of source or order', () => {
    const l = new EventLedger();
    expect(l.accept({ id: 5 })).toBe(true);
    expect(l.accept({ id: 5 })).toBe(false);
    expect(l.accept({ id: 3 })).toBe(true); // delayed event still applied once
    expect(l.lastId).toBe(5);
    expect(l.acceptMany([{ id: 7 }, { id: 5 }, { id: 6 }, { id: 7 }]).map((e) => e.id)).toEqual([6, 7]);
  });

  it('ignores malformed ids', () => {
    const l = new EventLedger();
    expect(l.accept({ id: 'x' })).toBe(false);
    expect(l.accept({})).toBe(false);
    expect(l.accept(null)).toBe(false);
  });

  it('baseline from a snapshot sets the catch-up cursor', () => {
    const l = new EventLedger();
    l.setBaseline(40);
    expect(l.lastId).toBe(40);
    l.setBaseline(10);
    expect(l.lastId).toBe(40);
  });

  it('bounds memory', () => {
    const l = new EventLedger({ capacity: 10 });
    for (let i = 1; i <= 50; i++) l.accept({ id: i });
    expect(l.seen.size).toBe(10);
    expect(l.lastId).toBe(50);
  });
});

describe('ConnectionMonitor', () => {
  it('reports status and requests reconciliation only after a real recovery', () => {
    const onStatus = vi.fn();
    const onRecovered = vi.fn();
    const m = new ConnectionMonitor({ onStatus, onRecovered });
    m.channelStatus('SUBSCRIBED');
    expect(onStatus).toHaveBeenLastCalledWith('live');
    expect(onRecovered).not.toHaveBeenCalled();
    m.channelStatus('CHANNEL_ERROR');
    expect(onStatus).toHaveBeenLastCalledWith('reconnecting');
    m.channelStatus('SUBSCRIBED');
    expect(onRecovered).toHaveBeenCalledTimes(1);
    m.channelStatus('SUBSCRIBED');
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it('tracks browser offline/online', () => {
    const onStatus = vi.fn();
    const onRecovered = vi.fn();
    const m = new ConnectionMonitor({ onStatus, onRecovered });
    m.channelStatus('SUBSCRIBED');
    m.browserOffline();
    expect(m.status).toBe('offline');
    m.browserOnline();
    expect(m.status).toBe('reconnecting');
    m.channelStatus('SUBSCRIBED');
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });
});
