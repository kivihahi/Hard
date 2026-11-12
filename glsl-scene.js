/* Lighting, floor, glass shading (inside path with Fresnel-weighted bounces), main(). */
window.GLSL = window.GLSL || {};

GLSL.scene = `
// ---------- studio lighting ----------
float softbox(vec3 d, vec3 L, vec2 halfSize, float soft) {
  vec3 up = abs(L.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 T = normalize(cross(up, L));
  vec3 B = cross(L, T);
  float t = dot(d, L);
  if (t <= 0.05) return 0.0;
  vec2 q = vec2(dot(d, T), dot(d, B)) / t;
  vec2 e = abs(q) - halfSize;
  float sd = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  float s = max(soft, 0.004);
  float m = 1.0 - smoothstep(-s, s, sd);
  float grad = mix(0.72, 1.0, 1.0 - clamp(length(q / halfSize) * 0.6, 0.0, 1.0));
  return m * grad;
}

vec3 envStudio(vec3 d) {
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.009, 0.010, 0.014), vec3(0.030, 0.038, 0.056), smoothstep(0.15, 0.95, h));
  col += pow(max(dot(d, normalize(vec3(0.0, 0.12, -1.0))), 0.0), 3.0) * vec3(0.020, 0.034, 0.066);

  // key softbox (user controlled)
  col += uKeyColor * uKeyI * softbox(d, uKeyDir, vec2(uKeySize, uKeySize * 0.72), uKeySoft);

  // fill from the opposite side, cool and dim
  vec3 Lf = normalize(vec3(-uKeyDir.x, 0.28, -uKeyDir.z * 0.6 + 0.2));
  col += vec3(0.55, 0.72, 1.0) * (uFill * 3.2) * softbox(d, Lf, vec2(0.85, 0.5), 0.35);

  // overhead soft light
  col += vec3(0.85, 0.9, 1.0) * (uFill * 1.4) * softbox(d, vec3(0.0, 1.0, 0.0), vec2(0.9, 0.9), 0.5);

  // two tall rim strips: the classic glass-photography edge glints
  vec3 Lr1 = normalize(vec3( 1.0, 0.08, -0.15));
  vec3 Lr2 = normalize(vec3(-1.0, 0.08, -0.15));
  float s1 = softbox(d, Lr1, vec2(0.075, 0.95), 0.06);
  float s2 = softbox(d, Lr2, vec2(0.075, 0.95), 0.06);
  col += vec3(0.85, 0.93, 1.0) * uRim * 9.0 * s1 + vec3(1.0, 0.92, 0.82) * uRim * 7.0 * s2;
  return col;
}

// ---------- floor ----------
float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 0.03;
  for (int i = 0; i < 56; i++) {
    float h = mapShape(ro + rd * t);
    res = min(res, 7.0 * h / t);
    t += clamp(h, 0.012, 0.35);
    if (res < 0.002 || t > 7.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

// Elliptical footprint of the object projected along the key light onto the floor.
float footprint(vec3 p, out float ang) {
  vec3 L = uKeyDir;
  float ly = max(L.y, 0.12);
  vec2 c = -L.xz * ((0.0 - uFloorY) / ly);
  vec2 dp = p.xz - c;
  vec2 h = length(L.xz) > 1e-3 ? normalize(-L.xz) : vec2(1.0, 0.0);
  vec2 pr = vec2(-h.y, h.x);
  float s = max(uSize.x, uSize.z) * 0.95;
  float u = dot(dp, h) / (s * (1.0 + 0.9 / ly * 0.35));
  float v = dot(dp, pr) / s;
  ang = u;
  return length(vec2(u, v));
}

vec3 floorShade(vec3 p, vec3 rd, bool primary) {
  vec3 albedo = vec3(0.060, 0.064, 0.074);
  float r = length(p.xz);
  float ang;
  float e = footprint(p, ang);
  float occ;
  if (primary) occ = 1.0 - softShadow(p + vec3(0.0, 0.003, 0.0), uKeyDir);
  else occ = 1.0 - smoothstep(0.55, 1.25, e);
  vec3 lightF = mix(vec3(1.0), uShadowTint, occ);

  // contact ambient occlusion from the SDF itself
  float ao = 1.0;
  if (primary) {
    float a1 = clamp(mapShape(p + vec3(0.0, 0.10, 0.0)) / 0.10, 0.0, 1.0);
    float a2 = clamp(mapShape(p + vec3(0.0, 0.35, 0.0)) / 0.35, 0.0, 1.0);
    ao = mix(0.30, 1.0, a1) * mix(0.65, 1.0, a2);
  } else {
    ao = mix(0.45, 1.0, smoothstep(0.55, 1.05, e));
  }

  float spot = exp(-r * r * 0.040);
  vec3 keyL = uKeyColor * uKeyI * max(uKeyDir.y, 0.0) * 0.20 * spot;
  vec3 col = albedo * (vec3(0.30) * ao + keyL * lightF * mix(0.6, 1.0, ao));

  // caustic: light focused through the volume, inside and beside the shadow
  float cs = exp(-pow(e * 1.15, 2.0)) * (0.55 + 0.45 * exp(-pow((ang - 0.35) * 2.0, 2.0)));
  col += uKeyColor * uCausticColor * uKeyI * uCaustic * 0.16 * cs;

  // glossy reflection of the studio
  vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
  rr = normalize(rr + rndBall() * 0.07);
  float cv = clamp(-rd.y, 0.0, 1.0);
  float fres = 0.035 + 0.965 * pow(1.0 - cv, 5.0);
  col += envStudio(vec3(rr.x, abs(rr.y), rr.z)) * fres * 0.55 * mix(1.0, 0.5, occ) * ao;
  return col;
}

vec3 background(vec3 ro, vec3 rd, bool primary) {
  vec3 col = envStudio(rd);
  if (rd.y < -0.0005) {
    float t = (uFloorY - ro.y) / rd.y;
    if (t > 0.0) {
      vec3 p = ro + rd * t;
      float fade = exp(-max(t - 4.0, 0.0) * 0.11);
      col = mix(col, floorShade(p, rd, primary), fade);
    }
  }
  return col;
}

// ---------- frosted surface: static grain + stochastic micro-facets ----------
vec3 frostNormal(vec3 p, vec3 n, vec3 rd) {
  if (uFrost < 0.002) return n;
  vec3 q = p * uFrostScale;
  vec3 g = vec3(fbm2(q), fbm2(q + vec3(31.7, 11.3, 5.1)), fbm2(q + vec3(7.9, 41.1, 23.3))) - 0.43;
  vec3 pn = normalize(n + g * (uFrost * 1.6) + rndBall() * (uFrost * 0.5));
  float d = dot(pn, rd);
  if (d > -0.05) pn = normalize(pn - rd * (d + 0.1));
  return pn;
}

float schlick(float cosT, float f0) {
  float m = clamp(1.0 - cosT, 0.0, 1.0);
  float m2 = m * m;
  return f0 + (1.0 - f0) * m2 * m2 * m;
}

// Light that travelled inside the glass. At every boundary the energy splits into an
// exiting part (sampled from the environment) and an internally reflected part (followed).
vec3 insideTrace(vec3 ro, vec3 rd, float ior) {
  vec3 acc = vec3(0.0), thr = vec3(1.0);
  float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);

  for (int b = 0; b < 10; b++) {
    if (b >= uBounces) break;
    float t;
    bool hit = traceIn(ro, rd, t);
    vec3 p = ro + rd * t;

    // core haze: gaussian scattering blob integrated along this segment
    if (uCore > 0.001) {
      const int NS = 6;
      float dt = t / float(NS);
      float od = 0.0;
      float phase = 0.55 + 0.45 * pow(max(dot(rd, -uKeyDir), 0.0), 3.0);
      float lum = 0.5 + 0.12 * uKeyI;
      for (int s = 0; s < NS; s++) {
        float ts = (float(s) + rnd()) * dt;
        vec3 q = ro + rd * ts;
        float dens = uCore * exp(-dot(q, q) / (uCoreSize * uCoreSize));
        acc += thr * exp(-gAbsorb * ts) * dens * dt * uCoreColor * lum * phase;
        od += dens * dt;
      }
      thr *= exp(-od * 0.45);
    }
    thr *= exp(-gAbsorb * t);

    if (!hit) {
      acc += thr * background(p, rd, false);
      break;
    }

    vec3 nIn = -calcNormal(p);
    nIn = frostNormal(p, nIn, rd);
    float cosi = clamp(-dot(rd, nIn), 0.0, 1.0);
    vec3 rr = refract(rd, nIn, ior);
    bool tir = dot(rr, rr) < 1e-6;
    float F = 1.0;
    if (!tir) F = schlick(clamp(-dot(rr, nIn), 0.0, 1.0), f0);

    bool last = (b == uBounces - 1);
    if (!tir) acc += thr * (last ? 1.0 : (1.0 - F)) * background(p, rr, false);
    if (last) {
      if (tir) acc += thr * background(p, reflect(rd, nIn), false);
      break;
    }
    thr *= F;
    if (max(thr.r, max(thr.g, thr.b)) < 0.004) break;
    rd = reflect(rd, nIn);
    ro = p + nIn * 0.003;
  }
  return acc;
}

vec3 renderRay(vec3 ro, vec3 rd, float ior) {
  float t;
  if (!traceOut(ro, rd, t)) return background(ro, rd, true);
  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  n = frostNormal(p, n, rd);
  float cosi = clamp(-dot(rd, n), 0.0, 1.0);
  float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  float F = schlick(cosi, f0);
  vec3 col = F * background(p, reflect(rd, n), false);
  vec3 rr = refract(rd, n, 1.0 / ior);
  col += (1.0 - F) * insideTrace(p - n * 0.003, rr, ior);
  return col;
}

void main() {
  gSeed = pcg(uint(gl_FragCoord.x) + pcg(uint(gl_FragCoord.y) * 9781u + pcg(uint(uFrame) * 6271u + 1u)));
  vec2 jit = vec2(rnd(), rnd()) - 0.5;
  vec2 uv = ((gl_FragCoord.xy + jit) * 2.0 - uRes) / uRes.y;
  uv.x += uShiftX;
  vec3 rd = normalize(uCamF + (uv.x * uCamR + uv.y * uCamU) * uFocal);
  vec3 ro = uCamPos;
  gAbsorb = -log(max(uTint, vec3(1e-3))) * uDensity;

  uint s0 = gSeed;
  vec3 col;
  if (uDisp > 0.0005) {
    gSeed = s0; col.r = renderRay(ro, rd, uIor - uDisp).r;
    gSeed = s0; col.g = renderRay(ro, rd, uIor).g;
    gSeed = s0; col.b = renderRay(ro, rd, uIor + uDisp).b;
  } else {
    col = renderRay(ro, rd, uIor);
  }
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  col = min(col, vec3(60.0));

  vec3 prev = texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).rgb;
  fragColor = vec4(uSamples < 0.5 ? col : mix(prev, col, 1.0 / (uSamples + 1.0)), 1.0);
}
`;
