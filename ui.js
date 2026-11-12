/* Control panel built from a schema. onChange(key, displayOnly) is called on every edit. */
window.UI = (function () {
  const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2), f3 = v => v.toFixed(3);
  const deg = v => Math.round(v) + '°';

  const SCHEMA = [
    { title: 'Optics', open: true, controls: [
      { k: 'ior', label: 'Index of refraction', min: 1.0, max: 2.6, step: 0.001, fmt: f3 },
      { k: 'disp', label: 'Dispersion', min: 0, max: 0.09, step: 0.001, fmt: f3 },
      { k: 'density', label: 'Absorption', min: 0, max: 4, step: 0.01, fmt: f2 },
      { k: 'tint', label: 'Tint', type: 'color' },
      { k: 'bounces', label: 'Internal bounces', min: 2, max: 10, step: 1, fmt: v => v }
    ]},
    { title: 'Frost', open: true, controls: [
      { k: 'frost', label: 'Frost amount', min: 0, max: 1, step: 0.005, fmt: f2 },
      { k: 'frostScale', label: 'Grain scale', min: 2, max: 60, step: 0.5, fmt: f1 }
    ]},
    { title: 'Key light', open: true, controls: [
      { k: 'keyAz', label: 'Azimuth', min: -180, max: 180, step: 1, fmt: deg },
      { k: 'keyEl', label: 'Elevation', min: 4, max: 85, step: 1, fmt: deg },
      { k: 'keyI', label: 'Intensity', min: 0, max: 30, step: 0.1, fmt: f1 },
      { k: 'keySize', label: 'Size', min: 0.1, max: 1.4, step: 0.01, fmt: f2 },
      { k: 'keySoft', label: 'Softness', min: 0.0, max: 0.8, step: 0.01, fmt: f2 },
      { k: 'keyTemp', label: 'Temperature', min: 2500, max: 10000, step: 50, fmt: v => Math.round(v) + ' K' },
      { k: 'fill', label: 'Fill light', min: 0, max: 1.5, step: 0.01, fmt: f2 },
      { k: 'rim', label: 'Rim strips', min: 0, max: 1.5, step: 0.01, fmt: f2 }
    ]},
    { title: 'Volume', open: false, controls: [
      { k: 'w', label: 'Width', min: 0.2, max: 1.1, step: 0.005, fmt: f2 },
      { k: 'h', label: 'Height', min: 0.2, max: 1.3, step: 0.005, fmt: f2 },
      { k: 'd', label: 'Depth', min: 0.2, max: 1.1, step: 0.005, fmt: f2 },
      { k: 'round', label: 'Corner radius', min: 0, max: 0.6, step: 0.005, fmt: f2 },
      { k: 'morph', label: 'Box ↔ ellipsoid', min: 0, max: 1, step: 0.005, fmt: f2 },
      { k: 'twist', label: 'Twist', min: -2, max: 2, step: 0.01, fmt: f2 },
      { k: 'wobble', label: 'Wobble', min: 0, max: 0.12, step: 0.001, fmt: f3 },
      { k: 'wobbleFreq', label: 'Wobble frequency', min: 1, max: 12, step: 0.1, fmt: f1 },
      { k: 'core', label: 'Core haze', min: 0, max: 3, step: 0.01, fmt: f2 },
      { k: 'coreSize', label: 'Core size', min: 0.1, max: 1.0, step: 0.01, fmt: f2 },
      { k: 'coreColor', label: 'Core color', type: 'color' }
    ]},
    { title: 'Floor', open: false, controls: [
      { k: 'caustic', label: 'Caustics', min: 0, max: 3, step: 0.01, fmt: f2 },
      { k: 'shadow', label: 'Shadow depth', min: 0, max: 1, step: 0.01, fmt: f2 }
    ]},
    { title: 'Render', open: false, controls: [
      { k: 'precision', label: 'HDR buffer', type: 'select', options: [['16', '16-bit float (RGBA16F)'], ['32', '32-bit float (RGBA32F)']] },
      { k: 'scale', label: 'Resolution', type: 'select', options: [['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%']] },
      { k: 'maxSamples', label: 'Max samples', min: 1, max: 1024, step: 1, fmt: v => v },
      { k: 'exposure', label: 'Exposure', min: 0.2, max: 3, step: 0.01, fmt: f2, display: true },
      { k: 'bloom', label: 'Bloom', min: 0, max: 2, step: 0.01, fmt: f2, display: true },
      { k: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, fmt: f2, display: true },
      { k: 'autoOrbit', label: 'Auto orbit', type: 'check' },
      { k: 'animate', label: 'Animate wobble', type: 'check' }
    ]}
  ];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function build(root, state, presets, handlers) {
    const sync = [];
    root.innerHTML = '';

    const head = el('div', 'p-head');
    head.appendChild(el('div', 'p-title', 'Glass SDF'));
    head.appendChild(el('div', 'p-sub', 'sphere-traced · WebGL2 · HDR'));
    root.appendChild(head);

    // presets
    const chips = el('div', 'chips');
    Object.keys(presets).forEach(name => {
      const b = el('button', 'chip', name);
      b.type = 'button';
      b.addEventListener('click', () => {
        chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
        handlers.preset(name);
        sync.forEach(fn => fn());
      });
      chips.appendChild(b);
    });
    root.appendChild(el('div', 'p-label', 'Material presets'));
    root.appendChild(chips);

    SCHEMA.forEach(sec => {
      const det = el('details', 'sec');
      if (sec.open) det.open = true;
      det.appendChild(el('summary', null, sec.title));
      const body = el('div', 'sec-body');

      sec.controls.forEach(c => {
        const row = el('label', 'row');
        row.appendChild(el('span', 'lbl', c.label));
        let input, out;

        if (c.type === 'color') {
          input = el('input'); input.type = 'color';
          input.addEventListener('input', () => { state[c.k] = input.value; handlers.change(c.k, false); });
          sync.push(() => { input.value = state[c.k]; });
        } else if (c.type === 'select') {
          input = el('select');
          c.options.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; input.appendChild(o); });
          input.addEventListener('change', () => {
            state[c.k] = (c.k === 'scale') ? parseFloat(input.value) : input.value;
            handlers.change(c.k, false);
          });
          sync.push(() => { input.value = String(state[c.k]); });
        } else if (c.type === 'check') {
          input = el('input'); input.type = 'checkbox';
          input.addEventListener('change', () => { state[c.k] = input.checked; handlers.change(c.k, false); });
          sync.push(() => { input.checked = !!state[c.k]; });
        } else {
          input = el('input'); input.type = 'range';
          input.min = c.min; input.max = c.max; input.step = c.step;
          out = el('output', 'val');
          input.addEventListener('input', () => {
            state[c.k] = parseFloat(input.value);
            out.textContent = c.fmt(state[c.k]);
            handlers.change(c.k, !!c.display);
          });
          sync.push(() => { input.value = state[c.k]; out.textContent = c.fmt(state[c.k]); });
        }
        row.appendChild(input);
        if (out) row.appendChild(out);
        body.appendChild(row);
      });
      det.appendChild(body);
      root.appendChild(det);
    });

    const actions = el('div', 'actions');
    [['Reset camera', handlers.resetCamera], ['Save PNG', handlers.screenshot]].forEach(([t, fn]) => {
      const b = el('button', 'btn', t); b.type = 'button'; b.addEventListener('click', fn); actions.appendChild(b);
    });
    root.appendChild(actions);
    root.appendChild(el('div', 'hint', 'Drag — orbit · wheel / pinch — zoom · H — hide panel · R — reset · S — save'));

    sync.forEach(fn => fn());
    return { sync: () => sync.forEach(fn => fn()), chips };
  }

  return { build };
})();
