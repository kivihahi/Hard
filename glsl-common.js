/* Shared GLSL: uniforms, RNG, noise, SDF, sphere tracing. Classic script (works from file://). */
window.GLSL = window.GLSL || {};

GLSL.vert = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

GLSL.header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

GLSL.uniforms = `
uniform vec2  uRes;
uniform float uTime;
uniform int   uFrame;
uniform float uSamples;
uniform float uShiftX;
uniform sampler2D uPrev;

uniform vec3  uCamPos, uCamR, uCamU, uCamF;
uniform float uFocal;

uniform float uIor, uDisp, uDensity, uFrost, uFrostScale;
uniform vec3  uTint;

uniform vec3  uSize;
uniform float uRound, uMorph, uTwist, uWobble, uWobbleFreq, uStep;

uniform float uCore, uCoreSize;
uniform vec3  uCoreColor;

uniform vec3  uKeyDir, uKeyColor;
uniform float uKeyI, uKeySize, uKeySoft, uFill, uRim;

uniform float uFloorY, uCaustic;
uniform vec3  uShadowTint, uCausticColor;
uniform int   uBounces;

out vec4 fragColor;

vec3 gAbsorb;
uint gSeed;
`;

GLSL.common = `
// ---------- RNG (PCG) ----------
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd() {
  gSeed = pcg(gSeed);
  return float(gSeed) * (1.0 / 4294967296.0);
}
vec3 rndBall() {
  float z = rnd() * 2.0 - 1.0;
  float a = rnd() * 6.28318530718;
  float r = sqrt(max(1.0 - z * z, 0.0));
  return vec3(r * cos(a), r * sin(a), z) * pow(rnd(), 0.3333333);
}

// ---------- value noise ----------
float h31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
float fbm2(vec3 p) { return 0.65 * vnoise(p) + 0.35 * vnoise(p * 2.13 + 3.7); }

// ---------- SDF of the glass volume ----------
float sdRoundBox(vec3 p, vec3 h, float r) {
  vec3 q = abs(p) - (h - r);
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
float mapShape(vec3 p) {
  vec3 q = p;
  if (abs(uTwist) > 1e-4) {
    float a = uTwist * q.y;
    float c = cos(a), s = sin(a);
    q.xz = mat2(c, -s, s, c) * q.xz;
  }
  float r = min(uRound, min(uSize.x, min(uSize.y, uSize.z)) * 0.999);
  float box = sdRoundBox(q, uSize, r);
  float ell = sdEllipsoid(q, uSize);
  float d = mix(box, ell, uMorph);
  if (uWobble > 1e-4) {
    d += uWobble * sin(p.x * uWobbleFreq + uTime * 0.6)
                 * sin(p.y * uWobbleFreq * 1.1 - uTime * 0.5)
                 * sin(p.z * uWobbleFreq * 0.9 + uTime * 0.4);
  }
  return d;
}
vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0007;
  return normalize(k.xyy * mapShape(p + k.xyy * h) + k.yyx * mapShape(p + k.yyx * h) +
                   k.yxy * mapShape(p + k.yxy * h) + k.xxx * mapShape(p + k.xxx * h));
}

// ---------- pure sphere tracing ----------
const int   MAX_STEPS = 128;
const float HIT_EPS   = 0.0004;

float boundRadius() { return length(uSize) + uWobble + 0.05; }

bool traceOut(vec3 ro, vec3 rd, out float tHit) {
  float R = boundRadius();
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float disc = b * b - c;
  tHit = 0.0;
  if (disc < 0.0) return false;
  float sq = sqrt(disc);
  float t = max(-b - sq, 0.0);
  float tmax = -b + sq;
  if (tmax < 0.0) return false;
  float d = 1.0;
  for (int i = 0; i < MAX_STEPS; i++) {
    d = mapShape(ro + rd * t);
    if (d < HIT_EPS + 0.0001 * t) { tHit = t; return true; }
    t += d * uStep;
    if (t > tmax) return false;
  }
  tHit = t;
  return d < 0.0012;   // grazing ray that ran out of steps right at the silhouette
}

bool traceIn(vec3 ro, vec3 rd, out float tHit) {
  float t = 0.0;
  for (int i = 0; i < MAX_STEPS; i++) {
    float d = -mapShape(ro + rd * t);
    if (d < HIT_EPS + 0.0001 * t) { tHit = t; return true; }
    t += d * uStep;
    if (t > 8.0) { tHit = t; return false; }
  }
  // ran out of steps while skimming a wall from the inside: treat as a hit, never as an escape
  tHit = t;
  return true;
}
`;
