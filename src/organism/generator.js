/**
 * Deterministic organism structure.
 *
 * Given the list of regions (slug, type, seed, level, anchor, hue) the
 * generator always produces the same nodes and filaments, so any stored
 * world snapshot can be re-rendered exactly. Nothing per-frame is stored.
 *
 * Output (flat typed arrays for GPU upload):
 *   positions  Float32Array(n*3)   node positions
 *   region     Float32Array(n)     region index per node
 *   depth      Float32Array(n)     0..1 distance from the region root (for waves)
 *   phase      Float32Array(n)     random phase for breathing
 *   size       Float32Array(n)     base point size
 *   edges      Uint32Array(m*2)    node index pairs
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUALITY_SCALE = { low: 0.45, medium: 0.75, high: 1 };

const TYPE_SHAPE = {
  core: { nodes: 90, branches: 7, spread: 2.3, jitter: 0.55, halo: 0.35 },
  pulse: { nodes: 54, branches: 6, spread: 1.7, jitter: 0.8, halo: 0.2 },
  quiet: { nodes: 50, branches: 4, spread: 2.0, jitter: 0.3, halo: 0.45 },
  memory: { nodes: 56, branches: 5, spread: 1.9, jitter: 0.4, halo: 0.25 },
  frontier: { nodes: 50, branches: 6, spread: 2.2, jitter: 0.95, halo: 0.1 },
  resonance: { nodes: 54, branches: 6, spread: 1.8, jitter: 0.25, halo: 0.4 },
};

function randomUnit(rand) {
  const u = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(t), u, s * Math.sin(t)];
}

function add(a, b, k = 1) {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function generateOrganism(regions, { quality = 'high', stage = 0 } = {}) {
  const scale = QUALITY_SCALE[quality] ?? 1;
  const pos = [];
  const reg = [];
  const dep = [];
  const pha = [];
  const siz = [];
  const edges = [];
  const regionInfo = [];

  const pushNode = (p, r, d, ph, s) => {
    pos.push(p[0], p[1], p[2]);
    reg.push(r);
    dep.push(d);
    pha.push(ph);
    siz.push(s);
    return reg.length - 1;
  };

  const bySlug = new Map(regions.map((r, i) => [r.slug, i]));

  regions.forEach((region, ri) => {
    const rand = mulberry32(Number(region.seed) || 1);
    const shape = TYPE_SHAPE[region.type] ?? TYPE_SHAPE.core;
    const level = Number(region.level) || 0;
    const anchor = region.anchor.map(Number);
    const target = Math.max(14, Math.round((shape.nodes + level * 24) * scale));
    const spread = shape.spread * (1 + level * 0.12) * (1 + stage * 0.03);
    const start = reg.length;
    const root = pushNode(anchor, ri, 0, rand() * 6.283, 2.4);
    const tips = [];

    // Branching growth: each branch walks outward, occasionally forking.
    const branchCount = shape.branches + Math.min(level, 4);
    const queue = [];
    for (let b = 0; b < branchCount; b++) {
      queue.push({ from: root, at: anchor, dir: randomUnit(rand), len: spread / 3.2, depth: 1, steps: 3 + Math.floor(rand() * 3) });
    }
    const budget = Math.round(target * (1 - shape.halo));
    while (queue.length && reg.length - start < budget) {
      const br = queue.shift();
      let prev = br.from;
      let at = br.at;
      let dir = br.dir;
      for (let s = 0; s < br.steps && reg.length - start < budget; s++) {
        dir = norm(add(dir, randomUnit(rand), shape.jitter * 0.6));
        at = add(at, dir, br.len * (0.75 + rand() * 0.5));
        const d = Math.min(1, (br.depth + s) / 7);
        const n = pushNode(at, ri, d, rand() * 6.283, 1.1 + rand() * 0.9 - d * 0.4);
        edges.push(prev, n);
        prev = n;
        if (rand() < 0.28 && br.depth < 5) {
          queue.push({ from: n, at, dir: norm(add(dir, randomUnit(rand), 1.2)), len: br.len * 0.8, depth: br.depth + s + 1, steps: 2 + Math.floor(rand() * 3) });
        }
      }
      tips.push(prev);
    }

    // Halo: a loose membrane of cells around the region, tethered to tips.
    const haloCount = target - (reg.length - start);
    const radius = spread * 1.05;
    for (let h = 0; h < haloCount; h++) {
      const u = randomUnit(rand);
      const r = radius * (0.8 + rand() * 0.35);
      const p = add(anchor, u, r);
      const n = pushNode(p, ri, 1, rand() * 6.283, 0.7 + rand() * 0.6);
      if (tips.length && rand() < 0.55) {
        const tip = tips[Math.floor(rand() * tips.length)];
        edges.push(tip, n);
      }
    }

    // Local mesh: link a few nearby nodes for a cellular look.
    const end = reg.length;
    for (let i = start + 1; i < end; i++) {
      if (rand() > 0.22) continue;
      const j = start + 1 + Math.floor(rand() * (end - start - 1));
      if (j === i) continue;
      const dx = pos[i * 3] - pos[j * 3];
      const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
      const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < spread * spread * 0.5) edges.push(i, j);
    }

    regionInfo.push({ slug: region.slug, index: ri, root, start, end, anchor, hue: Number(region.hue) || 190 });
  });

  // Nerves: curved filaments from each region to its parent (or the core).
  const coreIndex = bySlug.get('the-core') ?? 0;
  regions.forEach((region, ri) => {
    const parentIndex = region.parent ? bySlug.get(region.parent) ?? coreIndex : ri === coreIndex ? null : coreIndex;
    if (parentIndex == null || parentIndex === ri) return;
    const rand = mulberry32((Number(region.seed) || 1) ^ 0x9e3779b9);
    const a = regionInfo[parentIndex];
    const b = regionInfo[ri];
    const ctrl = add(
      [(a.anchor[0] + b.anchor[0]) / 2, (a.anchor[1] + b.anchor[1]) / 2, (a.anchor[2] + b.anchor[2]) / 2],
      randomUnit(rand),
      1.6 + rand() * 1.4,
    );
    const strands = 2 + (Number(region.level) >= 2 ? 1 : 0) + (stage >= 3 ? 1 : 0);
    for (let s = 0; s < strands; s++) {
      const off = randomUnit(rand);
      const steps = Math.max(8, Math.round(16 * scale));
      let prev = a.root;
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const it = 1 - t;
        const wobble = Math.sin(t * Math.PI) * (0.35 + s * 0.25);
        const p = [
          it * it * a.anchor[0] + 2 * it * t * ctrl[0] + t * t * b.anchor[0] + off[0] * wobble,
          it * it * a.anchor[1] + 2 * it * t * ctrl[1] + t * t * b.anchor[1] + off[1] * wobble,
          it * it * a.anchor[2] + 2 * it * t * ctrl[2] + t * t * b.anchor[2] + off[2] * wobble,
        ];
        // Nerve nodes belong to the child region so its energy lights them.
        const n = pushNode(p, ri, t, rand() * 6.283, 0.55);
        edges.push(prev, n);
        prev = n;
      }
      edges.push(prev, b.root);
    }
  });

  // From the Mycelium stage on, neighbouring regions grow cross-links.
  if (stage >= 2 && regionInfo.length > 2) {
    const rand = mulberry32(0x51ed ^ regions.length ^ (stage << 8));
    const links = Math.min(regionInfo.length, 2 + stage);
    for (let l = 0; l < links; l++) {
      const a = regionInfo[(l + 1) % regionInfo.length];
      const b = regionInfo[(l + 2) % regionInfo.length];
      if (a === b) continue;
      const ia = a.start + Math.floor(rand() * (a.end - a.start));
      const ib = b.start + Math.floor(rand() * (b.end - b.start));
      edges.push(ia, ib);
    }
  }

  return {
    count: reg.length,
    positions: new Float32Array(pos),
    region: new Float32Array(reg),
    depth: new Float32Array(dep),
    phase: new Float32Array(pha),
    size: new Float32Array(siz),
    edges: new Uint32Array(edges),
    regions: regionInfo,
    radius: Math.max(8, ...regions.map((r) => Math.hypot(...r.anchor.map(Number)) + 3)),
  };
}

/** Deterministic position near a region for a trace mark, from its event id. */
export function traceMarkPosition(structure, regionIndex, eventId) {
  const info = structure.regions[regionIndex];
  if (!info) return [0, 0, 0];
  const rand = mulberry32(Number(eventId) * 2654435761);
  const u = randomUnit(rand);
  return add(info.anchor, u, 0.6 + rand() * 1.9);
}
