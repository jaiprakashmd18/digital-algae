// UI behaviour in jsdom: mobile navigation and the world store's dedupe.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/api.js', () => ({
  api: () => ({ mode: 'demo', getSnapshot: async () => { throw new Error('offline'); }, listEvents: async () => [] }),
  initApi: async () => {},
}));

const { createNavigation } = await import('../../src/components/navigation.js');
const { applyEvents, onWorldEvent, world } = await import('../../src/services/world-service.js');

describe('mobile navigation', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('toggles the menu with aria-expanded and closes on Escape', () => {
    const nav = createNavigation();
    document.body.append(nav.el);
    const btn = nav.el.querySelector('.nav-toggle');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(nav.el.classList.contains('menu-open')).toBe(true);
    nav.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Open menu');
  });

  it('marks the current route', () => {
    const nav = createNavigation();
    nav.setActive('discovery');
    expect(nav.el.querySelector('[aria-current="page"]').textContent).toBe('Discoveries');
  });

  it('has an accessible connection status', () => {
    const nav = createNavigation();
    expect(nav.el.querySelector('[role="status"]').textContent).toMatch(/Connecting|Offline|Live|Demo|unavailable/i);
  });
});

describe('world store', () => {
  it('applies an event once even when it arrives from several sources', () => {
    vi.useFakeTimers();
    const seen = [];
    const off = onWorldEvent((e) => seen.push(e.id));
    world().regions = [{ slug: 'the-core', id: 'r1', type: 'core', stored_energy: 0, energy_at: new Date().toISOString(), trace_count: 0 }];
    const e = { id: 101, event_type: 'trace', region_id: 'r1', created_at: new Date().toISOString(), state_version: 1, payload: { region_slug: 'the-core', region_energy: 12, region_state: 'stirring', region_trace_count: 1 } };
    applyEvents([e]);
    applyEvents([e, { ...e }]);
    expect(seen).toEqual([101]);
    expect(world().regions[0]).toMatchObject({ stored_energy: 12, state: 'stirring', trace_count: 1 });
    off();
    vi.useRealTimers();
  });
});
