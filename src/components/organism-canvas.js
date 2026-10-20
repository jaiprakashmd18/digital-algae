/**
 * The interactive organism: picks the WebGL renderer when possible and the
 * Canvas 2D renderer otherwise (no WebGL, lost context, sustained low frame
 * rate, or the visitor chose 2D). Adds an accessible HTML label layer so
 * regions are reachable by keyboard, plus zoom/rotate/reset buttons.
 */
import { h, icon } from '../utils/dom.js';
import { onWorldChange, onWorldEvent, world } from '../services/world-service.js';
import { liveRegionEnergy } from '../lib/world-model.js';
import { getPreference, onPreferencesChange, setPreferences } from '../utils/preferences.js';
import { prefersReducedMotion } from '../utils/accessibility.js';
import { notify } from './notifications.js';
import { CanvasOrganism } from '../organism/renderer-2d.js';
import { playPulse } from '../utils/sound.js';

function autoQuality() {
  const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 720;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = navigator.deviceMemory ?? 4;
  if (mobile) return cores >= 6 && memory >= 4 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}

export function createOrganismCanvas({ onSelectRegion, onFirstInteraction } = {}) {
  const stage = h('div', { class: 'organism-stage' });
  const labels = h('div', { class: 'region-labels', role: 'group', 'aria-label': 'Regions of the organism' });
  const controls = h('div', { class: 'view-controls', role: 'toolbar', 'aria-label': 'View controls' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => renderer?.zoom(0.8) }, icon('zoom-in')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => renderer?.zoom(1.25) }, icon('zoom-out')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Rotate', title: 'Rotate', onclick: () => renderer?.rotate(0.5) }, icon('orbit')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Reset view', title: 'Reset view', onclick: () => { renderer?.resetView(); onSelectRegion?.(null); } }, icon('reset')));
  const badge = h('p', { class: 'renderer-badge muted', hidden: true });
  const el = h('div', { class: 'organism' }, stage, labels, controls, badge);

  let renderer = null;
  let labelEls = new Map();
  let interacted = false;
  let destroyed = false;
  let qualityLevel = null;
  let selected = null;

  const reduced = () => prefersReducedMotion();

  async function mount(kind) {
    renderer?.dispose();
    renderer = null;
    const pref = getPreference('quality');
    qualityLevel = qualityLevel ?? (pref === 'auto' || pref === '2d' ? autoQuality() : pref);
    const common = {
      quality: qualityLevel,
      reducedMotion: reduced(),
      onSelect: (hit) => {
        markInteraction();
        onSelectRegion?.(hit?.regionSlug ?? null);
      },
      onHover: (hit) => {
        for (const [slug, l] of labelEls) l.classList.toggle('hover', slug === hit?.regionSlug);
      },
      onFrame: positionLabels,
    };
    if (kind === 'webgl') {
      try {
        const { ThreeOrganism, webglAvailable } = await import('../organism/renderer-three.js');
        if (destroyed) return;
        if (!webglAvailable()) throw new Error('webgl unavailable');
        renderer = new ThreeOrganism(stage, {
          ...common,
          onPerformance: degrade,
          onContextLost: () => {
            notify('3D rendering stopped. Switched to the 2D view.');
            mount('2d');
          },
        });
      } catch (e) {
        console.warn('Falling back to 2D renderer:', e?.message);
        badge.hidden = false;
        badge.textContent = '2D view (3D graphics are not available on this device)';
        renderer = new CanvasOrganism(stage, common);
      }
    } else {
      badge.hidden = false;
      badge.textContent = '2D view';
      renderer = new CanvasOrganism(stage, common);
    }
    if (destroyed) {
      renderer.dispose();
      return;
    }
    el.dataset.renderer = renderer.kind;
    sync(world());
    renderer.setTraceMarks(world().traceMarks);
    if (selected) renderer.select(selected, { focus: false });
    if (document.visibilityState === 'visible') renderer.start();
  }

  function degrade(fps) {
    if (getPreference('quality') !== 'auto') return;
    const order = ['high', 'medium', 'low'];
    const i = order.indexOf(qualityLevel);
    if (i >= 0 && i < order.length - 1) {
      qualityLevel = order[i + 1];
      mount('webgl');
    } else {
      notify(`Graphics were running slowly (${Math.round(fps)} fps), so the organism switched to the lighter 2D view.`, { action: { label: 'Keep 3D', run: () => { setPreferences({ quality: 'low' }); mount('webgl'); } } });
      mount('2d');
    }
  }

  function markInteraction() {
    if (interacted) return;
    interacted = true;
    onFirstInteraction?.();
  }
  stage.addEventListener('pointerdown', markInteraction, { once: true });

  function sync(s) {
    if (!renderer) return;
    const regions = s.regions.map((r) => ({ ...r, energy: liveRegionEnergy(r) }));
    renderer.setWorld({ regions, stage: s.snapshot?.world.evolution_stage ?? 0 });
    // Rebuild label buttons when the set of regions changes.
    const key = regions.map((r) => r.slug).join(',');
    if (labels.dataset.key !== key) {
      labels.dataset.key = key;
      labelEls = new Map();
      labels.replaceChildren(...regions.map((r) => {
        const b = h('button', { type: 'button', class: 'region-label', style: { '--hue': r.hue }, dataset: { slug: r.slug } },
          h('span', { class: 'region-label-dot', 'aria-hidden': 'true' }), h('span', {}, r.name));
        b.addEventListener('click', () => {
          markInteraction();
          onSelectRegion?.(r.slug);
        });
        labelEls.set(r.slug, b);
        return b;
      }));
    }
    for (const r of regions) {
      const l = labelEls.get(r.slug);
      if (l) l.setAttribute('aria-label', `${r.name}: ${r.state ?? 'dormant'}, energy ${Math.round(r.energy)} of 100. Open details.`);
    }
  }

  function positionLabels() {
    if (!renderer || !getPreference('labels')) {
      labels.hidden = !getPreference('labels');
      return;
    }
    labels.hidden = false;
    for (const p of renderer.projectAnchors()) {
      const l = labelEls.get(p.slug);
      if (!l) continue;
      l.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      l.classList.toggle('offscreen', !p.visible);
      l.classList.toggle('selected', p.slug === selected);
    }
  }

  const offChange = onWorldChange(sync);
  const offEvent = onWorldEvent((e) => {
    if (!renderer) return;
    const p = e.payload ?? {};
    const slug = p.region_slug ?? world().regions.find((r) => r.id === e.region_id)?.slug;
    if (e.event_type === 'trace') {
      renderer.pulse({ regionSlug: slug, color: p.color, pattern: p.pattern, intensity: Number(p.intensity) || 0.6, eventId: e.id });
      renderer.setTraceMarks(world().traceMarks);
      if (getPreference('sound')) playPulse(p.pattern, Number(p.intensity) || 0.6);
    } else if (slug) {
      renderer.pulse({ regionSlug: slug, color: '#ffffff', pattern: 'bloom', intensity: 1, eventId: e.id });
    }
  });
  const offPrefs = onPreferencesChange((p) => {
    renderer?.setReducedMotion(reduced());
    const wanted = p.quality === '2d' ? '2d' : 'webgl';
    if (p.quality !== 'auto' && p.quality !== '2d') qualityLevel = p.quality;
    if ((wanted === '2d') !== (renderer?.kind === '2d') || (renderer?.kind === 'webgl' && renderer.quality !== qualityLevel)) mount(wanted);
  });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const onMotion = () => renderer?.setReducedMotion(reduced());
  motionQuery.addEventListener('change', onMotion);
  const onVisibility = () => (document.visibilityState === 'visible' ? renderer?.start() : renderer?.stop());
  document.addEventListener('visibilitychange', onVisibility);
  const energyTimer = setInterval(() => sync(world()), 5000);

  mount(getPreference('quality') === '2d' ? '2d' : 'webgl');

  return {
    el,
    select(slug) {
      selected = slug;
      renderer?.select(slug);
    },
    destroy() {
      destroyed = true;
      offChange();
      offEvent();
      offPrefs();
      motionQuery.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(energyTimer);
      renderer?.dispose();
      renderer = null;
    },
  };
}
