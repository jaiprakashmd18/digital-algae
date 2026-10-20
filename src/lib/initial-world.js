/**
 * The seeded starting structure, identical to migration
 * 20261020000005_initial_world.sql. Used by the demo backend and as the
 * offline fallback structure. tests/db/formulas.test.js checks that both
 * copies match.
 */
export const WORLD_SEED = 2026102001;

export const INITIAL_REGIONS = Object.freeze([
  {
    slug: 'the-core', name: 'The Core', type: 'core', seed: 91823, hue: 188, anchor: [0, 0, 0], parent: null,
    description: 'The dense heart of the organism, where every filament eventually returns. Traces here travel outward to every other region.',
  },
  {
    slug: 'the-pulse', name: 'The Pulse', type: 'pulse', seed: 44017, hue: 296, anchor: [6.6, 1.6, -2.2], parent: 'the-core',
    description: 'A restless cluster that flares at the slightest touch and calms just as fast. It shows what is happening right now.',
  },
  {
    slug: 'the-quiet-zone', name: 'The Quiet Zone', type: 'quiet', seed: 70331, hue: 214, anchor: [-6.2, -1.4, 2.9], parent: 'the-core',
    description: 'A slow, deep region that barely reacts — but remembers every disturbance for half a day.',
  },
  {
    slug: 'the-memory-garden', name: 'The Memory Garden', type: 'memory', seed: 15559, hue: 142, anchor: [-2.8, 4.8, -5.1], parent: 'the-core',
    description: 'Branches that hold their glow for days. Milestones of the organism settle here like rings in a tree.',
  },
  {
    slug: 'the-frontier', name: 'The Frontier', type: 'frontier', seed: 60601, hue: 168, anchor: [3.6, -5.0, 4.6], parent: 'the-core',
    description: 'The newest growth at the edge of the structure, quick to respond and eager to branch.',
  },
  {
    slug: 'the-resonance-field', name: 'The Resonance Field', type: 'resonance', seed: 38183, hue: 262, anchor: [1.4, 5.6, 5.0], parent: 'the-core',
    description: 'A lattice tuned to repetition. When different visitors leave the same pattern in quick succession, it resonates.',
  },
]);

/** Regions created when the organism reaches stages 2–5 (mirrors birth_region_for_stage). */
export const BORN_REGIONS = Object.freeze({
  2: { name: 'The Mycelial Reach', type: 'frontier', hue: 154, description: 'Thin threads that appeared when the organism first branched beyond its seed. They reach outward, testing the dark.' },
  3: { name: 'The Bloom Expanse', type: 'resonance', hue: 274, description: 'A field that opened when enough distinct visitors had touched the world. Repeated patterns echo here longer than anywhere else.' },
  4: { name: 'The Canopy Drift', type: 'pulse', hue: 200, description: 'A fast, shifting layer that grew over the older regions once the organism matured. Energy moves through it quickly.' },
  5: { name: 'The Sentient Shoal', type: 'memory', hue: 120, description: 'The newest and deepest structure: a dense shoal of nodes that keeps its shape long after activity fades.' },
});
