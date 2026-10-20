/**
 * Canvas 2D organism renderer — the fallback when WebGL is unavailable or
 * too slow. Same structure, same interactions (drag to rotate, wheel/pinch
 * to zoom, tap to select, pulses), simpler shading.
 */
import { generateOrganism, mulberry32, traceMarkPosition } from './generator.js';
import { hexToRgb, hueToRgb, markLifeSeconds, pulsesForTrace } from './pulses.js';

const MAX_NODES = { low: 0.45, medium: 0.6, high: 0.75 };

export class CanvasOrganism {
  constructor(container, { quality = 'medium', reducedMotion = false, onSelect, onHover, onFrame } = {}) {
    this.container = container;
    this.quality = quality in MAX_NODES ? quality : 'medium';
    this.reducedMotion = reducedMotion;
    this.cb = { onSelect, onHover, onFrame };
    this.kind = '2d';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'organism-2d';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.regions = [];
    this.energy = [];
    this.structureKey = '';
    this.structure = null;
    this.pulses = [];
    this.marks = [];
    this.yaw = 0.4;
    this.pitch = 0.22;
    this.distance = 20;
    this.target = [0, 0, 0];
    this.targetGoal = null;
    this.selected = -1;
    this.running = false;
    this.start0 = performance.now();
    this.markBase = Date.now();
    this.sprites = new Map();
    this.pointers = new Map();

    this.onDown = (e) => {
      this.canvas.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
    };
    this.onMove = (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (prev && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [c, d] = [...this.pointers.values()];
        const after = Math.hypot(c.x - d.x, c.y - d.y);
        if (before > 0) this.zoom(before / after);
        return;
      }
      if (prev) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.drag && this.pointers.size === 1) {
        this.yaw += (e.clientX - this.drag.x) * 0.006;
        this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + (e.clientY - this.drag.y) * 0.004));
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      } else if (e.pointerType !== 'touch') {
        const hit = this.pick(e.clientX, e.clientY, 18);
        this.canvas.style.cursor = hit ? 'pointer' : 'grab';
        this.cb.onHover?.(hit);
      }
    };
    this.onUp = (e) => {
      this.pointers.delete(e.pointerId);
      if (!this.drag) return;
      const moved = Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy);
      const quick = performance.now() - this.drag.t < 600;
      this.drag = null;
      if (moved < 7 && quick) this.cb.onSelect?.(this.pick(e.clientX, e.clientY, e.pointerType === 'touch' ? 40 : 26));
    };
    this.onWheel = (e) => {
      e.preventDefault();
      this.zoom(e.deltaY > 0 ? 1.08 : 0.92);
    };
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
  }

  get time() {
    return (performance.now() - this.start0) / 1000;
  }

  setWorld({ regions, stage = 0 }) {
    this.regions = regions;
    const key = `${stage}|${regions.map((r) => `${r.slug}:${r.level}`).join(',')}`;
    if (key !== this.structureKey) {
      this.structureKey = key;
      this.structure = generateOrganism(regions, { quality: this.quality === 'high' ? 'medium' : 'low', stage });
      this.energyNow = regions.map(() => 0);
      if (this.pendingMarks) this.setTraceMarks(this.pendingMarks);
    }
    this.energy = regions.map((r) => Math.min(1, Number(r.energy ?? 0) / 100));
    this.colors = regions.map((r) => hueToRgb(Number(r.hue) || 190, 0.85, 0.6));
  }

  regionIndex(slug) {
    return this.regions.findIndex((r) => r.slug === slug);
  }

  setTraceMarks(events) {
    this.pendingMarks = events;
    if (!this.structure) return;
    this.marks = events.filter((e) => this.regionIndex(e.payload?.region_slug) >= 0).slice(0, 120).map((e) => ({
      p: traceMarkPosition(this.structure, this.regionIndex(e.payload.region_slug), e.id),
      color: hexToRgb(e.payload.color),
      birth: Date.parse(e.created_at),
      life: markLifeSeconds(e.payload.persistence) * 1000,
    }));
  }

  pulse({ regionSlug, color = '#5ee7ff', pattern = 'spark', intensity = 0.6, eventId = 0 }) {
    const ri = this.regionIndex(regionSlug);
    if (ri < 0 || !this.structure) return;
    const info = this.structure.regions[ri];
    const rand = mulberry32(Number(eventId) || Date.now());
    const node = info.start + Math.floor(rand() * (info.end - info.start));
    const pos = this.structure.positions;
    const origin = [pos[node * 3], pos[node * 3 + 1], pos[node * 3 + 2]];
    const core = this.structure.regions[this.regionIndex('the-core')]?.anchor ?? null;
    this.pulses.push(...pulsesForTrace({ origin, coreOrigin: ri === this.regionIndex('the-core') ? null : core, color: hexToRgb(color), pattern, intensity, now: this.time, reducedMotion: this.reducedMotion }));
    if (this.pulses.length > 24) this.pulses.splice(0, this.pulses.length - 24);
    this.energyNow[ri] = Math.min(1, (this.energyNow[ri] ?? 0) + 0.08);
  }

  select(slug, { focus = true } = {}) {
    this.selected = slug ? this.regionIndex(slug) : -1;
    if (this.selected >= 0 && focus) {
      this.targetGoal = this.regions[this.selected].anchor.map(Number);
      this.distanceGoal = 13;
    }
  }

  resetView() {
    this.targetGoal = [0, 0, 0];
    this.distanceGoal = 20;
    this.select(null, { focus: false });
  }

  zoom(f) {
    this.distance = Math.max(6, Math.min(48, this.distance * f));
    this.distanceGoal = null;
  }

  rotate(r) {
    this.yaw += r;
  }

  setReducedMotion(on) {
    this.reducedMotion = on;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.container.clientWidth || 1;
    this.h = this.container.clientHeight || 1;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Project a world point with the current orbit camera. */
  project(p) {
    const x0 = p[0] - this.target[0];
    const y0 = p[1] - this.target[1];
    const z0 = p[2] - this.target[2];
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const x1 = x0 * cy - z0 * sy;
    const z1 = x0 * sy + z0 * cy;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const y2 = y0 * cp - z1 * sp;
    const z2 = y0 * sp + z1 * cp;
    const depth = this.distance - z2;
    if (depth <= 0.5) return null;
    const f = (Math.min(this.w, this.h) * 1.15) / depth;
    return { x: this.w / 2 + x1 * f, y: this.h / 2 - y2 * f, s: f / 40, depth };
  }

  pick(clientX, clientY, radius) {
    if (!this.structure) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const pos = this.structure.positions;
    let best = null;
    let bestD = radius * radius;
    for (let i = 0; i < this.structure.count; i++) {
      const q = this.project([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
      if (!q) continue;
      const d = (q.x - x) ** 2 + (q.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best == null) return null;
    return { regionSlug: this.regions[this.structure.region[best]]?.slug, node: best };
  }

  projectAnchors() {
    return this.regions.map((r) => {
      const q = this.project(r.anchor.map(Number));
      return { slug: r.slug, x: q?.x ?? -999, y: q?.y ?? -999, visible: Boolean(q), depth: q?.depth ?? 0 };
    });
  }

  sprite(rgb) {
    const key = rgb.map((c) => Math.round(c * 20)).join(',');
    let s = this.sprites.get(key);
    if (!s) {
      s = document.createElement('canvas');
      s.width = s.height = 32;
      const g = s.getContext('2d');
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      const [r, gg, b] = rgb.map((c) => Math.round(c * 255));
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.18, `rgba(${r},${gg},${b},0.95)`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      this.sprites.set(key, s);
    }
    return s;
  }

  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    this.draw();
    this.cb.onFrame?.();
  }

  draw() {
    const { ctx } = this;
    const t = this.time;
    if (!this.reducedMotion && !this.drag) this.yaw += 0.0012;
    if (this.targetGoal) {
      this.target = this.target.map((v, i) => v + (this.targetGoal[i] - v) * (this.reducedMotion ? 1 : 0.06));
      if (this.distanceGoal) this.distance += (this.distanceGoal - this.distance) * (this.reducedMotion ? 1 : 0.06);
    }
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.structure) return;
    for (let i = 0; i < this.energy.length; i++) this.energyNow[i] += ((this.energy[i] ?? 0) - (this.energyNow[i] ?? 0)) * 0.02;
    this.pulses = this.pulses.filter((p) => t - p.start < p.life);

    const s = this.structure;
    const pos = s.positions;
    const motion = this.reducedMotion ? 0.25 : 1;
    const proj = new Array(s.count);
    const glow = new Float32Array(s.count);
    for (let i = 0; i < s.count; i++) {
      const ri = s.region[i];
      const e = this.energyNow[ri] ?? 0;
      const breath = Math.sin(t * (0.5 + e * 1.5) + s.phase[i]) * (0.035 + e * 0.11) * motion;
      const a = s.regions[ri].anchor;
      const dx = pos[i * 3] - a[0];
      const dy = pos[i * 3 + 1] - a[1];
      const dz = pos[i * 3 + 2] - a[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const k = (breath * (0.4 + s.depth[i])) / len;
      const p = [pos[i * 3] + dx * k, pos[i * 3 + 1] + dy * k, pos[i * 3 + 2] + dz * k];
      let g = 0;
      for (const pl of this.pulses) {
        const age = t - pl.start;
        if (age < 0) continue;
        const d = Math.hypot(p[0] - pl.origin[0], p[1] - pl.origin[1], p[2] - pl.origin[2]);
        const x = (d - age * pl.speed) / pl.width;
        g += Math.exp(-x * x) * (1 - age / pl.life) * pl.strength;
      }
      glow[i] = g;
      proj[i] = this.project(p);
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    for (let k = 0; k < s.edges.length; k += 2) {
      const a = proj[s.edges[k]];
      const b = proj[s.edges[k + 1]];
      if (!a || !b) continue;
      const ri = s.region[s.edges[k + 1]];
      const e = this.energyNow[ri] ?? 0;
      const [r, g, bl] = this.colors[ri] ?? [0.4, 0.9, 1];
      const emph = this.selected < 0 ? 1 : this.selected === ri ? 1.35 : 0.5;
      const alpha = Math.min(1, (0.16 + e * 0.22) * emph + glow[s.edges[k + 1]] * 0.7);
      ctx.strokeStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(bl * 255) | 0},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let i = 0; i < s.count; i++) {
      const q = proj[i];
      if (!q) continue;
      const ri = s.region[i];
      const e = this.energyNow[ri] ?? 0;
      const emph = this.selected < 0 ? 1 : this.selected === ri ? 1.35 : 0.5;
      const size = s.size[i] * q.s * 9 * (1 + e * 0.7 + glow[i] * 1.5);
      ctx.globalAlpha = Math.min(1, (0.68 + e * 0.32) * emph + glow[i]);
      ctx.drawImage(this.sprite(this.colors[ri] ?? [0.4, 0.9, 1]), q.x - size / 2, q.y - size / 2, size, size);
    }
    const now = Date.now();
    for (const m of this.marks) {
      const life = 1 - (now - m.birth) / m.life;
      if (life <= 0) continue;
      const q = this.project(m.p);
      if (!q) continue;
      const size = (5 + life * 6) * q.s * 1.4;
      ctx.globalAlpha = life;
      ctx.drawImage(this.sprite(m.color), q.x - size / 2, q.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.sprites.clear();
    this.canvas.remove();
  }
}

/** Draw a static, small rendering of a structure (used on detail pages). */
export function drawStaticRegion(canvas, regions, focusSlug, { stage = 0 } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 320;
  const h = canvas.clientHeight || 200;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = generateOrganism(regions, { quality: 'low', stage });
  const fi = regions.findIndex((r) => r.slug === focusSlug);
  const center = fi >= 0 ? regions[fi].anchor.map(Number) : [0, 0, 0];
  const scale = (Math.min(w, h) / (fi >= 0 ? 7 : s.radius * 1.6));
  const px = (i) => [w / 2 + (s.positions[i * 3] - center[0] + (s.positions[i * 3 + 2] - center[2]) * 0.35) * scale, h / 2 - (s.positions[i * 3 + 1] - center[1]) * scale];
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < s.edges.length; k += 2) {
    const ri = s.region[s.edges[k + 1]];
    const [r, g, b] = hueToRgb(Number(regions[ri].hue) || 190);
    const a = fi < 0 || ri === fi ? 0.32 : 0.08;
    ctx.strokeStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;
    const [x1, y1] = px(s.edges[k]);
    const [x2, y2] = px(s.edges[k + 1]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  for (let i = 0; i < s.count; i++) {
    const ri = s.region[i];
    const [r, g, b] = hueToRgb(Number(regions[ri].hue) || 190);
    const a = fi < 0 || ri === fi ? 0.9 : 0.2;
    const [x, y] = px(i);
    const rad = s.size[i] * 1.6;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rad * 2);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.3, `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a * 0.8})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - rad * 2, y - rad * 2, rad * 4, rad * 4);
  }
  ctx.globalCompositeOperation = 'source-over';
}
