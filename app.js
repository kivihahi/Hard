/* WebGL2 host: HDR ping-pong accumulation (RGBA16F / RGBA32F), scene + display passes, camera, UI wiring. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const canvas = $('#gl');
  const errBox = $('#error');
  const hud = $('#hud');
  const panelEl = $('#panel');

  function fail(msg) {
    errBox.textContent = msg;
    errBox.hidden = false;
    console.error(msg);
  }

  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    preserveDrawingBuffer: true, powerPreference: 'high-performance'
  });
  if (!gl) { fail('WebGL2 is not available in this browser.'); return; }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    fail('This device cannot render to floating-point textures (EXT_color_buffer_float is missing).');
    return;
  }
  const canLinear32 = !!gl.getExtension('OES_texture_float_linear');

  // ---------- state ----------
  const state = Object.assign({}, window.DEFAULTS);
  const params = new URLSearchParams(location.search);
  if (params.has('preset') && window.PRESETS[params.get('preset')]) Object.assign(state, window.PRESETS[params.get('preset')]);
  params.forEach((v, k) => {
    if (!(k in window.DEFAULTS)) return;
    const t = typeof window.DEFAULTS[k];
    state[k] = t === 'number' ? parseFloat(v) : t === 'boolean' ? v === '1' || v === 'true' : v;
  });
  if (params.has('frames')) state.maxSamples = parseInt(params.get('frames'), 10);

  const cam = {
    yaw: parseFloat(params.get('yaw') || '0.30'),
    pitch: parseFloat(params.get('pitch') || '0.20'),
    dist: parseFloat(params.get('dist') || '4.7')
  };
  const CAM0 = Object.assign({}, cam);
  let panelHidden = params.get('panel') === '0';

  // ---------- programs ----------
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      throw new Error('Shader compile error:\n' + log);
    }
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error:\n' + gl.getProgramInfoLog(p));
    const U = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      U[name] = gl.getUniformLocation(p, name);
    }
    return { p, U };
  }

  let sceneProg, postProg;
  try {
    sceneProg = program(GLSL.vert, GLSL.header + GLSL.uniforms + GLSL.common + GLSL.scene);
    postProg = program(GLSL.vert, GLSL.header + GLSL.post);
  } catch (e) {
    fail(e.message);
    return;
  }
  const vao = gl.createVertexArray();

  // ---------- HDR targets ----------
  let W = 0, H = 0, targets = [null, null], readIdx = 0;
  let usedPrecision = state.precision;

  function makeTarget(w, h, is32) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, is32 ? gl.RGBA32F : gl.RGBA16F, w, h, 0, gl.RGBA,
      is32 ? gl.FLOAT : gl.HALF_FLOAT, null);
    const filt = (!is32 || canLinear32) ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, ok };
  }
  function freeTargets() {
    targets.forEach(t => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } });
    targets = [null, null];
  }
  function allocTargets() {
    freeTargets();
    let is32 = state.precision === '32';
    let a = makeTarget(W, H, is32), b = makeTarget(W, H, is32);
    if (!(a.ok && b.ok) && is32) {
      console.warn('RGBA32F is not renderable here, falling back to RGBA16F');
      state.precision = '16'; ui && ui.sync();
      a = makeTarget(W, H, false); b = makeTarget(W, H, false); is32 = false;
    }
    targets = [a, b];
    usedPrecision = is32 ? '32' : '16';
    readIdx = 0;
  }

  // ---------- camera / light ----------
  function camBasis() {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const tgt = [0, 0.02, 0];
    const pos = [tgt[0] + cam.dist * Math.sin(cam.yaw) * cp, tgt[1] + cam.dist * sp, tgt[2] + cam.dist * Math.cos(cam.yaw) * cp];
    let f = [tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]];
    const fl = Math.hypot(...f); f = f.map(v => v / fl);
    let r = [-f[2], 0, f[0]]; // cross(f, worldUp)
    const rl = Math.hypot(...r); r = r.map(v => v / rl);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]; // cross(r, f)
    return { pos, f, r, u };
  }

  // ---------- rendering ----------
  let samples = 0, frameIdx = 0, dirtyScene = true, dirtyDisplay = true, animTime = 0, reported = false;

  function setScene() {
    const s = state, U = sceneProg.U;
    const cb = camBasis();
    const rad = Math.PI / 180;
    const az = s.keyAz * rad, el = s.keyEl * rad;
    const keyDir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const kc = window.kelvinToLinearRGB(s.keyTemp);
    const tint = window.hexToLinear(s.tint);
    const core = window.hexToLinear(s.coreColor);

    const stepScale = Math.min(1, Math.max(0.35, 1 / (1 + s.wobble * s.wobbleFreq * 1.7 + Math.abs(s.twist) * 0.45))) * 0.95;
    const floorY = -(s.h + s.wobble);

    // floor shadow / caustic colouring derived from the glass
    const T = tint.map(v => Math.pow(v, s.density * 1.2));
    const tmax = Math.max(T[0], T[1], T[2], 1e-3);
    const shadowTint = T.map(v => (1 - s.shadow) + s.shadow * 0.28 * v);
    const causticColor = T.map(v => 0.35 + 0.65 * v / tmax);

    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uTime, animTime);
    gl.uniform1i(U.uFrame, frameIdx);
    gl.uniform1f(U.uSamples, samples);
    const panelW = (!panelHidden && innerWidth > 820) ? panelEl.offsetWidth + 16 : 0;
    gl.uniform1f(U.uShiftX, panelW / innerHeight);
    gl.uniform3fv(U.uCamPos, cb.pos);
    gl.uniform3fv(U.uCamR, cb.r);
    gl.uniform3fv(U.uCamU, cb.u);
    gl.uniform3fv(U.uCamF, cb.f);
    gl.uniform1f(U.uFocal, Math.tan(16 * rad));

    gl.uniform1f(U.uIor, s.ior);
    gl.uniform1f(U.uDisp, s.disp);
    gl.uniform1f(U.uDensity, s.density);
    gl.uniform1f(U.uFrost, s.frost);
    gl.uniform1f(U.uFrostScale, s.frostScale);
    gl.uniform3fv(U.uTint, tint);

    gl.uniform3f(U.uSize, s.w, s.h, s.d);
    gl.uniform1f(U.uRound, s.round);
    gl.uniform1f(U.uMorph, s.morph);
    gl.uniform1f(U.uTwist, s.twist);
    gl.uniform1f(U.uWobble, s.wobble);
    gl.uniform1f(U.uWobbleFreq, s.wobbleFreq);
    gl.uniform1f(U.uStep, stepScale);

    gl.uniform1f(U.uCore, s.core);
    gl.uniform1f(U.uCoreSize, s.coreSize);
    gl.uniform3fv(U.uCoreColor, core);

    gl.uniform3fv(U.uKeyDir, keyDir);
    gl.uniform3fv(U.uKeyColor, kc);
    gl.uniform1f(U.uKeyI, s.keyI);
    gl.uniform1f(U.uKeySize, s.keySize);
    gl.uniform1f(U.uKeySoft, s.keySoft);
    gl.uniform1f(U.uFill, s.fill);
    gl.uniform1f(U.uRim, s.rim);

    gl.uniform1f(U.uFloorY, floorY);
    gl.uniform1f(U.uCaustic, s.caustic * (1 - s.frost * 0.85));
    gl.uniform3fv(U.uShadowTint, shadowTint);
    gl.uniform3fv(U.uCausticColor, causticColor);
    gl.uniform1i(U.uBounces, s.bounces | 0);
  }

  function renderScene() {
    const src = targets[readIdx], dst = targets[1 - readIdx];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(sceneProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(sceneProg.U.uPrev, 0);
    setScene();
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    readIdx = 1 - readIdx;
    frameIdx++;
    samples++;
  }

  function renderDisplay() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(postProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[readIdx].tex);
    gl.uniform1i(postProg.U.uTex, 0);
    gl.uniform2f(postProg.U.uRes, W, H);
    gl.uniform1f(postProg.U.uExposure, state.exposure);
    gl.uniform1f(postProg.U.uBloom, state.bloom);
    gl.uniform1f(postProg.U.uVignette, state.vignette);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(8, Math.round(innerWidth * dpr * state.scale));
    const h = Math.max(8, Math.round(innerHeight * dpr * state.scale));
    if (w !== W || h !== H || usedPrecision !== state.precision || !targets[0]) {
      W = w; H = h;
      canvas.width = W; canvas.height = H;
      allocTargets();
      dirtyScene = true;
    }
  }

  // ---------- loop ----------
  let last = performance.now(), fpsAcc = 0, fpsN = 0, hudT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (state.autoOrbit) { cam.yaw += dt * 0.25; dirtyScene = true; }
    if (state.animate && state.wobble > 0.0001) { animTime += dt; dirtyScene = true; }
    resize();
    if (dirtyScene) { samples = 0; dirtyScene = false; reported = false; }
    if (samples < state.maxSamples) {
      renderScene();
      dirtyDisplay = true;
      fpsAcc += dt; fpsN++;
    }
    if (dirtyDisplay) { renderDisplay(); dirtyDisplay = false; }
    if (samples >= state.maxSamples && !reported) {
      reported = true;
      window.__glassReady = true;
      console.log('READY samples=' + samples + ' precision=' + usedPrecision + ' size=' + W + 'x' + H);
    }
    hudT += dt;
    if (hudT > 0.4) {
      const fps = fpsN ? Math.round(fpsN / fpsAcc) : 0;
      hud.textContent = samples + ' / ' + state.maxSamples + ' spp · ' + (samples < state.maxSamples ? fps + ' fps · ' : 'converged · ') +
        'RGBA' + usedPrecision + 'F · ' + W + '×' + H;
      hudT = 0; fpsAcc = 0; fpsN = 0;
    }
  }

  // ---------- input ----------
  const pointers = new Map();
  let pinchD = 0;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      cam.yaw -= dx * 0.006;
      cam.pitch = Math.min(1.35, Math.max(0.02, cam.pitch + dy * 0.005));
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD > 0) cam.dist = Math.min(9, Math.max(2.2, cam.dist * pinchD / d));
      pinchD = d;
    }
    dirtyScene = true;
  });
  const endPtr = e => { pointers.delete(e.pointerId); pinchD = 0; };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dist = Math.min(9, Math.max(2.2, cam.dist * Math.exp(e.deltaY * 0.001)));
    dirtyScene = true;
  }, { passive: false });
  canvas.addEventListener('dblclick', resetCamera);

  function resetCamera() { Object.assign(cam, CAM0); dirtyScene = true; }
  function screenshot() {
    renderDisplay();
    canvas.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'glass-sdf.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }
  function togglePanel() {
    panelHidden = !panelHidden;
    document.body.classList.toggle('no-panel', panelHidden);
    dirtyScene = true;
  }
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'h' || e.key === 'H') togglePanel();
    else if (e.key === 'r' || e.key === 'R') resetCamera();
    else if (e.key === 's' || e.key === 'S') screenshot();
  });
  $('#panelToggle').addEventListener('click', togglePanel);
  window.addEventListener('resize', () => { dirtyScene = true; });

  // ---------- UI ----------
  document.body.classList.toggle('no-panel', panelHidden);
  const ui = window.UI.build(panelEl, state, window.PRESETS, {
    change(key, displayOnly) {
      if (displayOnly) dirtyDisplay = true; else dirtyScene = true;
    },
    preset(name) {
      Object.assign(state, window.DEFAULTS, window.PRESETS[name], {
        precision: state.precision, scale: state.scale, maxSamples: state.maxSamples,
        exposure: state.exposure, bloom: state.bloom, vignette: state.vignette,
        autoOrbit: state.autoOrbit, animate: state.animate,
        keyAz: state.keyAz, keyEl: state.keyEl, keyI: state.keyI, keySize: state.keySize,
        keySoft: state.keySoft, keyTemp: state.keyTemp, fill: state.fill, rim: state.rim
      });
      dirtyScene = true;
    },
    resetCamera, screenshot
  });
  if (params.has('preset')) {
    ui.chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.textContent === params.get('preset')));
  } else {
    ui.chips.querySelector('.chip').classList.add('on');
  }

  requestAnimationFrame(loop);
})();
