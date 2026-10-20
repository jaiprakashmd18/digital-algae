/**
 * WebGL organism renderer (Three.js).
 * Animation runs locally; only meaningful world changes come from the
 * backend (setWorld / pulse / setTraceMarks).
 */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, LineSegments, PerspectiveCamera, Points, Scene,
  ShaderMaterial, Vector3, Vector4, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateOrganism, traceMarkPosition, mulberry32 } from './generator.js';
import {
  MAX_PULSES, MAX_REGIONS, dustFragment, dustVertex, lineFragment, lineVertex, markFragment, markVertex,
  nodeFragment, nodeVertex,
} from './shaders.js';
import { hexToRgb, hueToRgb, markLifeSeconds, pulsesForTrace } from './pulses.js';

const PIXEL_RATIO_CAP = { low: 1, medium: 1.5, high: 2 };
const DUST = { low: 250, medium: 600, high: 1100 };

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class ThreeOrganism {
  constructor(container, { quality = 'high', reducedMotion = false, onSelect, onHover, onFrame, onPerformance, onContextLost } = {}) {
    this.container = container;
    this.quality = quality;
    this.reducedMotion = reducedMotion;
    this.cb = { onSelect, onHover, onFrame, onPerformance, onContextLost };
    this.kind = 'webgl';
    this.selected = -1;
    this.structure = null;
    this.structureKey = '';
    this.regions = [];
    this.energyTarget = new Float32Array(MAX_REGIONS);
    this.energyNow = new Float32Array(MAX_REGIONS);
    this.pulseCursor = 0;
    this.clockStart = performance.now();
    this.markBase = Date.now();
    this.running = false;
    this.fly = null;
    this.frames = { count: 0, since: performance.now(), slowStreak: 0 };

    this.renderer = new WebGLRenderer({ antialias: quality === 'high', alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP[quality] ?? 1.5));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'organism-gl';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.append(this.canvas);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(50, 1, 0.1, 300);
    this.camera.position.set(0, 4, 20);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 46;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.autoRotate = !reducedMotion;
    this.controls.autoRotateSpeed = 0.28;
    this.controls.addEventListener('start', () => {
      this.fly = null;
      this.controls.autoRotate = false;
      clearTimeout(this.resumeRotate);
    });
    this.controls.addEventListener('end', () => {
      clearTimeout(this.resumeRotate);
      if (!this.reducedMotion) this.resumeRotate = setTimeout(() => (this.controls.autoRotate = true), 9000);
    });

    this.uniforms = {
      uTime: { value: 0 },
      uMotion: { value: reducedMotion ? 0.25 : 1 },
      uSelected: { value: -1 },
      uColors: { value: Array.from({ length: MAX_REGIONS }, () => new Vector3(0.4, 0.9, 1)) },
      uEnergy: { value: this.energyNow },
      uAnchors: { value: Array.from({ length: MAX_REGIONS }, () => new Vector3()) },
      uPulses: { value: Array.from({ length: MAX_PULSES }, () => new Vector4(0, 0, 0, -999)) },
      uPulseParams: { value: Array.from({ length: MAX_PULSES }, () => new Vector4(1, 1, 0, 0)) },
      uPulseColors: { value: Array.from({ length: MAX_PULSES }, () => new Vector3()) },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uScale: { value: 150 },
      uNow: { value: 0 },
    };

    this.nodeMaterial = new ShaderMaterial({
      uniforms: this.uniforms, vertexShader: nodeVertex, fragmentShader: nodeFragment,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.lineMaterial = new ShaderMaterial({
      uniforms: this.uniforms, vertexShader: lineVertex, fragmentShader: lineFragment,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.markMaterial = new ShaderMaterial({
      uniforms: this.uniforms, vertexShader: markVertex, fragmentShader: markFragment,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.dustMaterial = new ShaderMaterial({
      uniforms: this.uniforms, vertexShader: dustVertex, fragmentShader: dustFragment,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.buildDust();

    this.onPointerDown = (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    this.onPointerUp = (e) => {
      if (!this.down) return;
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      const quick = performance.now() - this.down.t < 600;
      this.down = null;
      if (moved < 7 && quick) {
        const hit = this.pick(e.clientX, e.clientY, e.pointerType === 'touch' ? 40 : 26);
        this.cb.onSelect?.(hit);
      }
    };
    this.onPointerMove = (e) => {
      if (e.pointerType === 'touch' || this.down) return;
      const now = performance.now();
      if (now - (this.lastHover ?? 0) < 90) return;
      this.lastHover = now;
      const hit = this.pick(e.clientX, e.clientY, 18);
      this.canvas.style.cursor = hit ? 'pointer' : 'grab';
      this.cb.onHover?.(hit);
    };
    this.onContextLost = (e) => {
      e.preventDefault();
      this.stop();
      this.cb.onContextLost?.();
    };
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
  }

  get time() {
    return (performance.now() - this.clockStart) / 1000;
  }

  buildDust() {
    const n = DUST[this.quality] ?? 600;
    const rand = mulberry32(7);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = 22 + rand() * 60;
      const u = rand() * 2 - 1;
      const t = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(t), r * u * 0.6, r * s * Math.sin(t)], i * 3);
      seed[i] = rand();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    this.dust = new Points(g, this.dustMaterial);
    this.scene.add(this.dust);
  }

  /** Update the world. Rebuilds geometry only when the structure changes. */
  setWorld({ regions, stage = 0 }) {
    this.regions = regions.slice(0, MAX_REGIONS);
    const key = `${this.quality}|${stage}|${this.regions.map((r) => `${r.slug}:${r.level}`).join(',')}`;
    if (key !== this.structureKey) {
      this.structureKey = key;
      this.build(stage);
    }
    this.regions.forEach((r, i) => {
      this.energyTarget[i] = Math.min(1, Number(r.energy ?? 0) / 100);
      const [cr, cg, cb] = hueToRgb(Number(r.hue) || 190, 0.85, 0.6);
      this.uniforms.uColors.value[i].set(cr, cg, cb);
      this.uniforms.uAnchors.value[i].set(...r.anchor.map(Number));
    });
  }

  build(stage) {
    this.disposeStructure();
    const s = generateOrganism(this.regions, { quality: this.quality, stage });
    this.structure = s;

    const nodes = new BufferGeometry();
    nodes.setAttribute('position', new BufferAttribute(s.positions, 3));
    nodes.setAttribute('aRegion', new BufferAttribute(s.region, 1));
    nodes.setAttribute('aDepth', new BufferAttribute(s.depth, 1));
    nodes.setAttribute('aPhase', new BufferAttribute(s.phase, 1));
    nodes.setAttribute('aSize', new BufferAttribute(s.size, 1));
    this.points = new Points(nodes, this.nodeMaterial);

    const m = s.edges.length;
    const lp = new Float32Array(m * 3);
    const lr = new Float32Array(m);
    const ld = new Float32Array(m);
    const lph = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const n = s.edges[i];
      lp[i * 3] = s.positions[n * 3];
      lp[i * 3 + 1] = s.positions[n * 3 + 1];
      lp[i * 3 + 2] = s.positions[n * 3 + 2];
      lr[i] = s.region[n];
      ld[i] = s.depth[n];
      lph[i] = s.phase[n];
    }
    const lines = new BufferGeometry();
    lines.setAttribute('position', new BufferAttribute(lp, 3));
    lines.setAttribute('aRegion', new BufferAttribute(lr, 1));
    lines.setAttribute('aDepth', new BufferAttribute(ld, 1));
    lines.setAttribute('aPhase', new BufferAttribute(lph, 1));
    this.lines = new LineSegments(lines, this.lineMaterial);

    this.scene.add(this.lines, this.points);
    this.controls.maxDistance = Math.max(46, s.radius * 3);
    if (this.pendingMarks) this.setTraceMarks(this.pendingMarks);
  }

  setTraceMarks(events) {
    this.pendingMarks = events;
    if (!this.structure) return;
    if (this.marks) {
      this.scene.remove(this.marks);
      this.marks.geometry.dispose();
      this.marks = null;
    }
    const list = events.filter((e) => this.regionIndex(e.payload?.region_slug) >= 0).slice(0, 200);
    if (!list.length) return;
    const pos = new Float32Array(list.length * 3);
    const col = new Float32Array(list.length * 3);
    const birth = new Float32Array(list.length);
    const life = new Float32Array(list.length);
    const seed = new Float32Array(list.length);
    list.forEach((e, i) => {
      const ri = this.regionIndex(e.payload.region_slug);
      pos.set(traceMarkPosition(this.structure, ri, e.id), i * 3);
      col.set(hexToRgb(e.payload.color), i * 3);
      birth[i] = (Date.parse(e.created_at) - this.markBase) / 1000;
      life[i] = markLifeSeconds(e.payload.persistence);
      seed[i] = (Number(e.id) % 997) / 997;
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    g.setAttribute('aBirth', new BufferAttribute(birth, 1));
    g.setAttribute('aLife', new BufferAttribute(life, 1));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    this.marks = new Points(g, this.markMaterial);
    this.scene.add(this.marks);
  }

  regionIndex(slug) {
    return this.regions.findIndex((r) => r.slug === slug);
  }

  /** Visualize a trace or event: rings of light travel through the region. */
  pulse({ regionSlug, color = '#5ee7ff', pattern = 'spark', intensity = 0.6, eventId = 0 }) {
    const ri = this.regionIndex(regionSlug);
    if (ri < 0 || !this.structure) return;
    const info = this.structure.regions[ri];
    const rand = mulberry32(Number(eventId) || Date.now());
    const span = info.end - info.start;
    const node = info.start + Math.floor(rand() * span);
    const origin = [this.structure.positions[node * 3], this.structure.positions[node * 3 + 1], this.structure.positions[node * 3 + 2]];
    const core = this.structure.regions[this.regionIndex('the-core')]?.anchor ?? null;
    const list = pulsesForTrace({ origin, coreOrigin: ri === this.regionIndex('the-core') ? null : core, color: hexToRgb(color), pattern, intensity, now: this.time, reducedMotion: this.reducedMotion });
    for (const p of list) {
      const i = this.pulseCursor++ % MAX_PULSES;
      this.uniforms.uPulses.value[i].set(p.origin[0], p.origin[1], p.origin[2], p.start);
      this.uniforms.uPulseParams.value[i].set(p.speed, p.width, p.strength, p.life);
      this.uniforms.uPulseColors.value[i].set(...p.color);
    }
    // Brief energy lift so the region visibly reacts before the next sync.
    this.energyNow[ri] = Math.min(1, this.energyNow[ri] + 0.08 * (0.5 + intensity));
  }

  select(slug, { focus = true } = {}) {
    const ri = slug ? this.regionIndex(slug) : -1;
    this.selected = ri;
    this.uniforms.uSelected.value = ri;
    if (ri >= 0 && focus) this.focus(ri);
  }

  focus(ri) {
    const anchor = new Vector3(...this.regions[ri].anchor.map(Number));
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = ri === this.regionIndex('the-core') ? 15 : 10.5;
    this.fly = { t: 0, fromTarget: this.controls.target.clone(), toTarget: anchor, fromPos: this.camera.position.clone(), toPos: anchor.clone().add(dir.multiplyScalar(dist)) };
    this.controls.autoRotate = false;
  }

  resetView() {
    this.fly = { t: 0, fromTarget: this.controls.target.clone(), toTarget: new Vector3(), fromPos: this.camera.position.clone(), toPos: new Vector3(0, 4, 20) };
    this.select(null, { focus: false });
  }

  zoom(factor) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    const len = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, dir.length() * factor));
    this.camera.position.copy(this.controls.target.clone().add(dir.setLength(len)));
  }

  rotate(radians) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new Vector3(0, 1, 0), radians);
    this.camera.position.copy(this.controls.target.clone().add(offset));
  }

  pick(clientX, clientY, radius) {
    if (!this.structure) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const v = new Vector3();
    const pos = this.structure.positions;
    let best = null;
    let bestD = radius * radius;
    for (let i = 0; i < this.structure.count; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(this.camera);
      if (v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * rect.width;
      const sy = ((1 - v.y) / 2) * rect.height;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best == null) return null;
    const ri = this.structure.region[best];
    return { regionSlug: this.regions[ri]?.slug, node: best };
  }

  /** Screen positions of region anchors (for the HTML label layer). */
  projectAnchors() {
    const rect = this.canvas.getBoundingClientRect();
    const v = new Vector3();
    return this.regions.map((r) => {
      v.set(...r.anchor.map(Number)).project(this.camera);
      return { slug: r.slug, x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1, depth: v.z };
    });
  }

  setReducedMotion(on) {
    this.reducedMotion = on;
    this.uniforms.uMotion.value = on ? 0.25 : 1;
    this.controls.autoRotate = !on;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back on narrow (portrait) screens so the whole organism fits.
    this.camera.fov = w / h < 0.8 ? 62 : 50;
    this.camera.updateProjectionMatrix();
    this.uniforms.uScale.value = h * 0.34;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.frames = { count: 0, since: performance.now(), slowStreak: 0 };
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const t = this.time;
    this.uniforms.uTime.value = t;
    this.uniforms.uNow.value = (Date.now() - this.markBase) / 1000;
    for (let i = 0; i < this.regions.length; i++) {
      this.energyNow[i] += (this.energyTarget[i] - this.energyNow[i]) * 0.02;
    }
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + (this.reducedMotion ? 1 : 0.025));
      const k = 1 - Math.pow(1 - this.fly.t, 3);
      this.controls.target.lerpVectors(this.fly.fromTarget, this.fly.toTarget, k);
      this.camera.position.lerpVectors(this.fly.fromPos, this.fly.toPos, k);
      if (this.fly.t >= 1) this.fly = null;
    }
    if (this.dust && !this.reducedMotion) this.dust.rotation.y = t * 0.004;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.cb.onFrame?.();
    this.measure();
  }

  measure() {
    const f = this.frames;
    f.count++;
    const now = performance.now();
    if (now - f.since < 2500) return;
    const fps = (f.count * 1000) / (now - f.since);
    f.count = 0;
    f.since = now;
    f.slowStreak = fps < 24 ? f.slowStreak + 1 : 0;
    if (f.slowStreak >= 2) {
      f.slowStreak = 0;
      this.cb.onPerformance?.(fps);
    }
  }

  disposeStructure() {
    for (const obj of [this.points, this.lines]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
    }
    this.points = null;
    this.lines = null;
  }

  dispose() {
    this.stop();
    clearTimeout(this.resumeRotate);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.disposeStructure();
    if (this.marks) this.marks.geometry.dispose();
    this.dust?.geometry.dispose();
    for (const m of [this.nodeMaterial, this.lineMaterial, this.markMaterial, this.dustMaterial]) m.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
