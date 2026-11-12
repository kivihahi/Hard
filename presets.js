/* Defaults, material presets, small color helpers. */
window.DEFAULTS = {
  // optics
  ior: 1.52, disp: 0.012, tint: '#f2fbf7', density: 0.35,
  // frost
  frost: 0.0, frostScale: 14,
  // volume
  w: 0.62, h: 0.86, d: 0.62, round: 0.22, morph: 0.0, twist: 0.0,
  wobble: 0.0, wobbleFreq: 4.0, core: 0.0, coreSize: 0.42, coreColor: '#8fd3ff',
  // key light
  keyAz: -38, keyEl: 36, keyI: 9.0, keySize: 0.55, keySoft: 0.18, keyTemp: 6200,
  fill: 0.35, rim: 0.55,
  // floor
  caustic: 0.8, shadow: 0.85,
  // render
  bounces: 6, precision: '16', scale: 1.0, maxSamples: 192,
  exposure: 1.0, bloom: 0.55, vignette: 0.45,
  autoOrbit: false, animate: false
};

window.PRESETS = {
  'Clear glass': {
    ior: 1.52, disp: 0.012, tint: '#f2fbf7', density: 0.35, frost: 0, core: 0,
    morph: 0.0, round: 0.22, wobble: 0
  },
  'Water': {
    ior: 1.333, disp: 0.006, tint: '#8fd6e8', density: 0.55, frost: 0, core: 0,
    morph: 0.88, round: 0.3, wobble: 0.035, wobbleFreq: 4.5
  },
  'Frosted': {
    ior: 1.5, disp: 0.008, tint: '#f6f9ff', density: 0.25, frost: 0.55, frostScale: 16,
    core: 0.25, coreColor: '#d6e6ff', morph: 0.0, round: 0.26, wobble: 0
  },
  'Crystal': {
    ior: 2.42, disp: 0.07, tint: '#fbfdff', density: 0.15, frost: 0, core: 0,
    morph: 0.0, round: 0.06, wobble: 0, bounces: 8
  },
  'Ice': {
    ior: 1.31, disp: 0.004, tint: '#b7e2ff', density: 0.6, frost: 0.38, frostScale: 9,
    core: 0.7, coreColor: '#bfe6ff', coreSize: 0.5, morph: 0.15, round: 0.2, wobble: 0.02
  },
  'Amber': {
    ior: 1.55, disp: 0.01, tint: '#ff9d2e', density: 1.5, frost: 0.08, frostScale: 20,
    core: 0.35, coreColor: '#ffb347', morph: 0.35, round: 0.3, wobble: 0.015
  },
  'Emerald': {
    ior: 1.58, disp: 0.02, tint: '#25d97a', density: 1.8, frost: 0, core: 0.2,
    coreColor: '#7dffb8', morph: 0.0, round: 0.1, wobble: 0
  },
  'Aether': {
    ior: 1.6, disp: 0.03, tint: '#a98bff', density: 1.1, frost: 0.12, frostScale: 24,
    core: 1.1, coreColor: '#6fe7ff', coreSize: 0.36, morph: 0.55, round: 0.25, twist: 0.7, wobble: 0
  }
};

window.hexToLinear = function (hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.pow(v / 255, 2.2));
};

window.kelvinToLinearRGB = function (k) {
  k = Math.min(Math.max(k, 1000), 40000) / 100;
  let r, g, b;
  if (k <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(k) - 161.1195681661;
    b = k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(k - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(k - 60, -0.0755148492);
    b = 255;
  }
  return [r, g, b].map(v => Math.pow(Math.min(Math.max(v, 0), 255) / 255, 2.2));
};
