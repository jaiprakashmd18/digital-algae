/**
 * GLSL for the organism. Nodes and filaments share the same displacement
 * and pulse functions so filaments stay attached to the breathing nodes.
 */
export const MAX_REGIONS = 16;
export const MAX_PULSES = 24;

const common = /* glsl */ `
  #define MAX_REGIONS ${MAX_REGIONS}
  #define MAX_PULSES ${MAX_PULSES}
  uniform float uTime;
  uniform float uMotion;
  uniform float uSelected;
  uniform vec3 uColors[MAX_REGIONS];
  uniform float uEnergy[MAX_REGIONS];
  uniform vec3 uAnchors[MAX_REGIONS];
  uniform vec4 uPulses[MAX_PULSES];      // xyz origin, w start time
  uniform vec4 uPulseParams[MAX_PULSES]; // x speed, y width, z strength, w life
  uniform vec3 uPulseColors[MAX_PULSES];
  attribute float aRegion;
  attribute float aDepth;
  attribute float aPhase;

  vec3 displace(vec3 p, int r, float e) {
    vec3 dir = p - uAnchors[r];
    float len = length(dir) + 0.0001;
    float breath = sin(uTime * (0.5 + e * 1.5) + aPhase) * (0.035 + e * 0.11) * uMotion;
    float drift = sin(uTime * 0.21 + aPhase * 1.7 + p.y * 0.45) * 0.07 * uMotion;
    return p + dir / len * breath * (0.4 + aDepth) + vec3(drift, drift * 0.6, -drift * 0.8);
  }

  float pulseAt(vec3 p, out vec3 col) {
    float total = 0.0;
    col = vec3(0.0);
    for (int i = 0; i < MAX_PULSES; i++) {
      vec4 pl = uPulses[i];
      vec4 pp = uPulseParams[i];
      float age = uTime - pl.w;
      if (pp.w <= 0.0 || age < 0.0 || age > pp.w) continue;
      float d = distance(p, pl.xyz);
      float radius = age * pp.x;
      float x = (d - radius) / pp.y;
      float ring = exp(-x * x) * (1.0 - age / pp.w) * pp.z;
      col += ring * uPulseColors[i];
      total += ring;
    }
    return total;
  }

  float regionEmphasis(float region) {
    if (uSelected < 0.0) return 1.0;
    return abs(region - uSelected) < 0.5 ? 1.35 : 0.5;
  }
`;

export const nodeVertex = /* glsl */ `
  ${common}
  uniform float uPixelRatio;
  uniform float uScale;
  attribute float aSize;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    int r = int(aRegion + 0.5);
    float e = uEnergy[r];
    vec3 p = displace(position, r, e);
    vec3 pc;
    float pulse = pulseAt(p, pc);
    float wave = pow(0.5 + 0.5 * sin(aDepth * 9.0 - uTime * (1.1 + e * 2.4) * max(uMotion, 0.25)), 6.0) * (0.35 + e);
    float emph = regionEmphasis(aRegion);
    vColor = uColors[r] * (0.72 + e * 0.75 + wave * 0.45) * emph + pc * 1.3;
    vAlpha = clamp((0.7 + e * 0.4 + wave * 0.3) * emph + pulse, 0.0, 1.6);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (1.0 + e * 0.75 + pulse * 1.6 + wave * 0.45) * uPixelRatio * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const nodeFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float glow = pow(smoothstep(0.5, 0.0, d), 1.7);
    float core = smoothstep(0.14, 0.0, d);
    gl_FragColor = vec4(vColor * (glow + core * 0.9), glow * vAlpha);
  }
`;

export const lineVertex = /* glsl */ `
  ${common}
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    int r = int(aRegion + 0.5);
    float e = uEnergy[r];
    vec3 p = displace(position, r, e);
    vec3 pc;
    float pulse = pulseAt(p, pc);
    float wave = pow(0.5 + 0.5 * sin(aDepth * 11.0 - uTime * (1.3 + e * 3.0) * max(uMotion, 0.25)), 10.0) * (0.3 + e * 0.8);
    float emph = regionEmphasis(aRegion);
    vColor = uColors[r] * (0.75 + e * 0.5) + pc * 1.2;
    vAlpha = clamp((0.16 + e * 0.22 + wave * 0.5) * emph + pulse * 0.9, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const lineFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

export const markVertex = /* glsl */ `
  uniform float uTime;
  uniform float uNow;
  uniform float uPixelRatio;
  uniform float uMotion;
  attribute vec3 aColor;
  attribute float aBirth;
  attribute float aLife;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float age = uNow - aBirth;
    float life = clamp(1.0 - age / aLife, 0.0, 1.0);
    float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 40.0) * uMotion;
    vColor = aColor;
    vAlpha = life * twinkle;
    vec3 p = position + vec3(sin(uTime * 0.3 + aSeed * 9.0), cos(uTime * 0.25 + aSeed * 7.0), sin(uTime * 0.2 + aSeed * 5.0)) * 0.12 * uMotion;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (2.4 + life * 3.2) * uPixelRatio * 60.0 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const markFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float star = pow(smoothstep(0.5, 0.0, d), 2.2) + smoothstep(0.08, 0.0, abs(c.x)) * smoothstep(0.5, 0.0, abs(c.y)) * 0.5
               + smoothstep(0.08, 0.0, abs(c.y)) * smoothstep(0.5, 0.0, abs(c.x)) * 0.5;
    gl_FragColor = vec4(vColor * star, star * vAlpha);
  }
`;

export const dustVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vAlpha = 0.18 + 0.22 * sin(uTime * 0.4 + aSeed * 30.0);
    gl_PointSize = (0.8 + aSeed * 1.4) * uPixelRatio * 40.0 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const dustFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vec3(0.62, 0.78, 1.0), smoothstep(0.5, 0.0, d) * vAlpha);
  }
`;
