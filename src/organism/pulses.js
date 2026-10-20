/**
 * Pulse choreography for trace patterns, shared by both renderers.
 * Each pattern expands into one or more rings of light that travel through
 * nearby nodes and filaments.
 */
export const PATTERN_PULSES = Object.freeze({
  spark: [{ delay: 0, speed: 6.5, width: 0.5, strength: 1.25, life: 1.6 }],
  ripple: [
    { delay: 0, speed: 3.6, width: 0.35, strength: 0.85, life: 2.6 },
    { delay: 0.35, speed: 3.6, width: 0.35, strength: 0.7, life: 2.6 },
    { delay: 0.7, speed: 3.6, width: 0.35, strength: 0.55, life: 2.6 },
  ],
  spiral: [
    { delay: 0, speed: 2.4, width: 0.8, strength: 0.9, life: 3.2, offset: 0.9 },
    { delay: 0.5, speed: 2.4, width: 0.8, strength: 0.8, life: 3.2, offset: -0.9 },
  ],
  bloom: [{ delay: 0, speed: 1.7, width: 1.35, strength: 1.05, life: 4.2 }],
  filament: [{ delay: 0, speed: 9.5, width: 0.3, strength: 1.5, life: 2.2 }],
});

/**
 * Expand a trace into concrete pulses.
 * @returns {{origin:number[], start:number, speed:number, width:number, strength:number, life:number, color:number[]}[]}
 */
export function pulsesForTrace({ origin, coreOrigin, color, pattern, intensity = 0.6, now, reducedMotion = false }) {
  const defs = PATTERN_PULSES[pattern] ?? PATTERN_PULSES.spark;
  const k = 0.55 + intensity * 0.75;
  const out = defs.map((d) => ({
    origin: d.offset ? [origin[0] + d.offset, origin[1], origin[2] - d.offset] : origin,
    start: now + d.delay,
    speed: reducedMotion ? d.speed * 0.5 : d.speed,
    width: reducedMotion ? d.width * 1.8 : d.width,
    strength: d.strength * k,
    life: d.life,
    color,
  }));
  // The change propagates to the Core after a short delay.
  if (coreOrigin && !reducedMotion) {
    const dist = Math.hypot(origin[0] - coreOrigin[0], origin[1] - coreOrigin[1], origin[2] - coreOrigin[2]);
    if (dist > 1) out.push({ origin: coreOrigin, start: now + Math.min(2.5, dist / 6), speed: 4, width: 0.6, strength: 0.45 * k, life: 2.2, color });
  }
  return out;
}

export function hexToRgb(hex) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(v)) return [0.4, 0.9, 1];
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function hueToRgb(hue, s = 0.85, l = 0.6) {
  const h = (((hue % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/** Trace marks linger: fleeting for an hour, lasting for a day. */
export function markLifeSeconds(persistence) {
  return persistence === 'fleeting' ? 3600 : 86400;
}
