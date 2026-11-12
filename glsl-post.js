/* Display pass: reads the HDR (RGBA16F / RGBA32F) accumulation buffer, bloom + ACES + dither. */
window.GLSL = window.GLSL || {};

GLSL.post = `
uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uExposure, uBloom, uVignette;
uniform float uShiftXPost;
in vec2 vUv;
out vec4 outColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 c = texture(uTex, vUv).rgb;

  // cheap bloom of over-bright highlights (golden-angle disk)
  vec3 bl = vec3(0.0);
  if (uBloom > 0.001) {
    float aspect = uRes.x / uRes.y;
    const int N = 28;
    for (int i = 0; i < N; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / float(N));
      float a = fi * 2.39996323;
      vec2 off = vec2(cos(a) / aspect, sin(a)) * r * 0.045;
      vec3 s = texture(uTex, vUv + off).rgb;
      bl += max(s - 1.1, 0.0) * (1.0 - r * 0.6);
    }
    bl /= float(N) * 0.55;
  }
  c = (c + bl * uBloom) * uExposure;
  c = aces(c);

  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  c *= 1.0 - uVignette * smoothstep(0.25, 1.05, length(q));

  c = pow(c, vec3(1.0 / 2.2));
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}
`;
