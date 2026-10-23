// CRT post-processing in WebGL2. The screens draw into the 2D #stage canvas as
// before; each frame that canvas is uploaded and run through:
//   phosphor persistence -> bright pass -> 2-level bloom -> composite
// (curvature, chromatic aberration, scanlines, vignette, grain, glitch).
// Quality 'low' skips WebGL entirely and shows #stage with the CSS overlay.
(function () {
  'use strict';

  var LEVELS = ['low', 'medium', 'high'];
  var GRID_ROWS = 540; // the picture is resampled onto a grid this many rows tall
  // sat: 1 = full colour. levels: colour steps per channel (0 = off).
  // smear: how much the phosphor trails right of the beam (0-1).
  // drive: how hard the tube is overdriven. white: how far hot cores go white.
  // uneven: patchy stroke density. lift: teal glass-black above zero.
  // bloom is kept in the pipeline but off: the film look has no haze.
  var PRESETS = {
    medium: {
      persist: 0, bloom: 0, bloom2: 0, ca: 0.0008, curv: 8.0, scan: 0.14, vig: 0.45, grain: 0.07,
      sat: 0.95, levels: 0, smear: 0.35, drive: 1.7, white: 0.3, uneven: 0.4, lift: 0.025
    },
    high: {
      persist: 0.6, bloom: 0, bloom2: 0, ca: 0.0012, curv: 6.5, scan: 0.16, vig: 0.5, grain: 0.08,
      sat: 0.95, levels: 0, smear: 0.35, drive: 1.7, white: 0.3, uneven: 0.45, lift: 0.025
    }
  };
  // how much of the 2D canvas's own soft halo survives under the shader
  var HALO = { low: 0.6, medium: 0, high: 0 };
  var SLOW_FRAME_MS = 25; // average above this (~40 fps) steps high down to medium
  var STORE_KEY = 'unterface.fx';

  var stage = document.getElementById('stage');
  var out = document.getElementById('fx');
  var crt = document.getElementById('crt');
  // alpha: the TV screen cuts a see-through window for video, which on webOS
  // plays on a hardware plane behind the page and can't be drawn into WebGL
  var gl = out.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: false });

  var quality = 'low';
  var userChose = false;
  var glitchUntil = 0, glitchLen = 1;
  var unevenScale = 1; // the patchy density looks blotchy on big colour fields
  var override = null; // preset values to force for a while, e.g. during boot
  var hole = [0, 0, 0, 0]; // video window in 0..1 screen uv (x0, y0, x1, y1); empty = none
  var timing = { frames: 0, total: 0, warm: 0 };
  var fps = 60;

  // --- GL plumbing -----------------------------------------------------------

  var VERT = '#version 300 es\n' +
    'out vec2 v_uv;\n' +
    'void main() {\n' +
    '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);\n' +
    '  v_uv = p;\n' +
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n' +
    '}\n';

  var HEAD = '#version 300 es\nprecision highp float;\nin vec2 v_uv;\nout vec4 o;\n' +
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n';

  var FRAG = {
    // keep the brighter of this frame and the decayed last one: phosphor afterglow
    persist: HEAD +
      'uniform sampler2D u_src, u_prev; uniform float u_decay;\n' +
      'void main() { o = vec4(max(texture(u_src, v_uv).rgb, texture(u_prev, v_uv).rgb * u_decay), 1.0); }\n',

    bright: HEAD +
      'uniform sampler2D u_src; uniform vec2 u_texel; uniform float u_thr;\n' +
      'void main() {\n' +
      '  vec3 c = texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb + texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb\n' +
      '         + texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb + texture(u_src, v_uv + u_texel * vec2(1.0, 1.0)).rgb;\n' +
      '  c *= 0.25;\n' +
      '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));\n' +
      '  o = vec4(c * smoothstep(u_thr, u_thr + 0.35, l), 1.0);\n' +
      '}\n',

    blur: HEAD +
      'uniform sampler2D u_src; uniform vec2 u_dir;\n' +
      'void main() {\n' +
      '  vec3 c = texture(u_src, v_uv).rgb * 0.2270;\n' +
      '  c += (texture(u_src, v_uv + u_dir * 1.3846).rgb + texture(u_src, v_uv - u_dir * 1.3846).rgb) * 0.3162;\n' +
      '  c += (texture(u_src, v_uv + u_dir * 3.2308).rgb + texture(u_src, v_uv - u_dir * 3.2308).rgb) * 0.0703;\n' +
      '  o = vec4(c, 1.0);\n' +
      '}\n',

    // one trip through the "TV" at grid resolution. Sampling the 1920 picture
    // at grid-cell centres averages the 2x2 pixels under each cell, so thin
    // lines get chunky without vanishing. The phosphor then trails right of
    // the beam and a little onto the row below, which fattens every stroke.
    tube: HEAD +
      'uniform sampler2D u_src; uniform vec2 u_texel; uniform float u_smear;\n' +
      'void main() {\n' +
      '  float k = u_smear;\n' +
      '  vec3 c = texture(u_src, v_uv).rgb;\n' +
      '  c = max(c, texture(u_src, v_uv - vec2(u_texel.x, 0.0)).rgb * k);\n' +
      '  c = max(c, texture(u_src, v_uv - vec2(u_texel.x * 2.0, 0.0)).rgb * k * k);\n' +
      '  c = max(c, texture(u_src, v_uv - vec2(u_texel.x * 3.0, 0.0)).rgb * k * k * k);\n' +
      '  c = max(c, texture(u_src, v_uv + vec2(0.0, u_texel.y)).rgb * k * 0.8);\n' +
      '  o = vec4(c, 1.0);\n' +
      '}\n',

    copy: HEAD +
      'uniform sampler2D u_src;\n' +
      'void main() { o = texture(u_src, v_uv); }\n',

    // value noise, used once at start-up to bake the stroke-density map
    densemap: HEAD +
      'uniform vec2 u_size;\n' +
      'float vnoise(vec2 p) {\n' +
      '  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n' +
      '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);\n' +
      '}\n' +
      'void main() {\n' +
      '  vec2 cell = floor(v_uv * u_size);\n' +
      '  o = vec4(vnoise(cell / 7.0) * 0.6 + vnoise(cell / 23.0) * 0.4, 0.0, 0.0, 1.0);\n' +
      '}\n',

    // The film-era signal chain, graded per grid cell (960x540, not 1080p):
    // overdriven phosphor -> uneven exposure -> grain/snow on 35mm.
    grade: HEAD +
      'uniform sampler2D u_src, u_dense;\n' +
      'uniform vec2 u_size; uniform float u_time, u_drive, u_white, u_sat, u_uneven, u_grain, u_glitch, u_levels;\n' +
      'void main() {\n' +
      '  vec3 col = texture(u_src, v_uv).rgb;\n' +
      // compress brightness, not each channel, so the hue survives; hot cores go white
      '  float raw = max(col.r, max(col.g, col.b));\n' +
      '  col *= (1.0 - exp(-raw * u_drive)) / max(raw, 1e-4);\n' +
      '  float peak = max(col.r, max(col.g, col.b));\n' +
      '  col = mix(col, vec3(peak), smoothstep(0.55, 1.0, peak) * u_white);\n' +
      '  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, u_sat);\n' +
      // uneven exposure: fixed patchy density plus a slow drift across the tube
      '  float dense = texture(u_dense, v_uv).r;\n' +
      '  float drift = texture(u_dense, v_uv * 0.12 + vec2(u_time * 0.004, 0.0)).r;\n' +
      '  col *= mix(1.0, 0.55 + 0.75 * dense * (0.75 + 0.5 * drift), u_uneven);\n' +
      '  vec2 cell = floor(v_uv * u_size);\n' +
      // glitch snow: sparse single-cell specks
      '  if (u_glitch > 0.0) col += step(1.0 - 0.025 * u_glitch, hash(cell + floor(u_time * 60.0))) * 0.55;\n' +
      // multiplicative grain keeps black black
      '  col *= 1.0 + (hash(cell + fract(u_time * 7.13) * 97.0) - 0.5) * u_grain * 2.0;\n' +
      '  if (u_levels > 0.0) col = floor(col * u_levels + 0.5) / u_levels;\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n',

    // full resolution: only the glass (curvature, fringing, scanlines, vignette)
    composite: HEAD +
      'uniform sampler2D u_scene, u_bloom, u_bloom2;\n' +
      'uniform vec2 u_res; uniform float u_time, u_curv, u_ca, u_bloomAmt, u_bloom2Amt, u_scan, u_vig, u_glitch, u_lowres, u_lift;\n' +
      'uniform float u_wobble, u_hum;\n' +
      'uniform vec4 u_hole;\n' +
      'vec2 curve(vec2 uv) {\n' +
      '  uv = uv * 2.0 - 1.0;\n' +
      '  vec2 off = abs(uv.yx) / u_curv;\n' +
      '  uv += uv * off * off;\n' +
      '  return uv * 0.5 + 0.5;\n' +
      '}\n' +
      'void main() {\n' +
      // inside the video window: fully clear, so the hardware video plane
      // (where webOS plays video) shows through untouched
      '  if (v_uv.x > u_hole.x && v_uv.x < u_hole.z && v_uv.y > u_hole.y && v_uv.y < u_hole.w) { o = vec4(0.0); return; }\n' +
      '  vec2 uv = u_curv > 0.0 ? curve(v_uv) : v_uv;\n' +
      // worn sync: rows drift sideways in a slow wave
      '  if (u_wobble > 0.0) uv.x += sin(uv.y * 38.0 + u_time * 2.3) * 0.0012 * u_wobble + sin(uv.y * 151.0 - u_time * 7.0) * 0.0004 * u_wobble;\n' +
      '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }\n' +
      // glitch: fine scanline jitter, single grid rows slip a few pixels sideways
      '  if (u_glitch > 0.0) {\n' +
      '    float row = floor(uv.y * u_lowres), tick = floor(u_time * 60.0);\n' +
      '    if (hash(vec2(row, tick)) < u_glitch * 0.35) uv.x += (hash(vec2(tick, row)) - 0.5) * 0.02 * u_glitch;\n' +
      '  }\n' +
      '  vec2 d = uv - 0.5;\n' +
      '  float ca = u_ca * dot(d, d) * 4.0 + u_glitch * 0.004;\n' +
      '  vec3 col = vec3(texture(u_scene, uv + d * ca).r, texture(u_scene, uv).g, texture(u_scene, uv - d * ca).b);\n' +
      '  if (u_bloomAmt > 0.0) col += texture(u_bloom, uv).rgb * u_bloomAmt + texture(u_bloom2, uv).rgb * u_bloom2Amt;\n' +
      // scanlines sit between the coarse rows
      '  float line = 0.5 + 0.5 * cos(uv.y * u_lowres * 6.2831853);\n' +
      '  col *= 1.0 - u_scan * (1.0 - line);\n' +
      // hum bar: a soft brighter band rolling down the tube
      '  if (u_hum > 0.0) col *= 1.0 + u_hum * smoothstep(0.75, 1.0, sin(uv.y * 3.14159 - u_time * 0.9) * 0.5 + 0.5);\n' +
      '  col *= mix(1.0, smoothstep(1.05, 0.3, length(d * vec2(1.0, 1.15)) * 1.2), u_vig);\n' +
      // filmed glass: blacks sit a hair above zero, teal-tinted
      '  col = col + vec3(0.35, 0.8, 0.9) * u_lift * (1.0 - col);\n' +
      '  vec2 q = abs(uv - 0.5) * 2.0;\n' +
      '  col *= smoothstep(1.0, 0.6, length(max(q - 0.97, 0.0)) / 0.03);\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n'
  };

  var programs = {}, tex = {}, fbo = {};

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function program(name) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG[name]));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var uniforms = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      uniforms[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: uniforms };
  }

  function target(name, w, h, filter) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    tex[name] = { t: t, w: w, h: h };
    fbo[name] = f;
  }

  function init() {
    Object.keys(FRAG).forEach(function (name) { programs[name] = program(name); });
    var W = stage.width, H = stage.height;
    tex.src = { t: gl.createTexture(), w: W, h: H };
    gl.bindTexture(gl.TEXTURE_2D, tex.src.t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // the coarse grid: every look-defining pass runs here, not at 1080p
    var gw = Math.round(GRID_ROWS * W / H), gh = GRID_ROWS;
    target('tube', gw, gh, gl.NEAREST);
    target('persistA', gw, gh, gl.NEAREST);
    target('persistB', gw, gh, gl.NEAREST);
    target('graded', gw, gh, gl.NEAREST);
    target('dense', gw, gh);
    gl.bindTexture(gl.TEXTURE_2D, tex.dense.t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    target('b1', W / 4, H / 4);
    target('b2', W / 4, H / 4);
    target('c1', W / 8, H / 8);
    target('c2', W / 8, H / 8);
    gl.bindVertexArray(gl.createVertexArray());
    pass('densemap', 'dense', { u_size: [gw, gh] });
  }

  function pass(name, dest, uniforms) {
    var prog = programs[name];
    gl.useProgram(prog.p);
    var unit = 0;
    Object.keys(uniforms).forEach(function (k) {
      var loc = prog.u[k];
      if (!loc) return;
      var v = uniforms[k];
      if (v && v.t) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v.t);
        gl.uniform1i(loc, unit++);
      } else if (v.length === 4) {
        gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
      } else if (v.length === 2) {
        gl.uniform2f(loc, v[0], v[1]);
      } else {
        gl.uniform1f(loc, v);
      }
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest ? fbo[dest] : null);
    var t = dest ? tex[dest] : { w: out.width, h: out.height };
    gl.viewport(0, 0, t.w, t.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function blur(a, b) {
    var t = tex[a];
    pass('blur', b, { u_src: tex[a], u_dir: [1 / t.w, 0] });
    pass('blur', a, { u_src: tex[b], u_dir: [0, 1 / t.h] });
  }

  // --- per frame -------------------------------------------------------------

  var flip = false;

  function render(ts) {
    if (quality === 'low') return;
    var P = PRESETS[quality];
    if (override) {
      var merged = {};
      Object.keys(P).forEach(function (k) { merged[k] = P[k]; });
      Object.keys(override).forEach(function (k) { merged[k] = override[k]; });
      P = merged;
    }

    gl.bindTexture(gl.TEXTURE_2D, tex.src.t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage);

    pass('tube', 'tube', { u_src: tex.src, u_texel: [1 / tex.tube.w, 1 / tex.tube.h], u_smear: P.smear });
    var scene = tex.tube;
    if (P.persist > 0) {
      var write = flip ? 'persistA' : 'persistB', read = flip ? 'persistB' : 'persistA';
      pass('persist', write, { u_src: tex.tube, u_prev: tex[read], u_decay: P.persist });
      scene = tex[write];
      flip = !flip;
    }

    if (P.bloom > 0) {
      pass('bright', 'b1', { u_src: scene, u_texel: [1 / stage.width, 1 / stage.height], u_thr: 0.2 });
      blur('b1', 'b2');
    }
    if (P.bloom2 > 0) {
      pass('copy', 'c1', { u_src: tex.b1 });
      blur('c1', 'c2');
      blur('c1', 'c2');
    }

    var glitch = Math.max(0, (glitchUntil - ts) / glitchLen);
    pass('grade', 'graded', {
      u_src: scene, u_dense: tex.dense, u_size: [tex.graded.w, tex.graded.h], u_time: ts / 1000,
      u_drive: P.drive, u_white: P.white, u_sat: P.sat, u_uneven: P.uneven * unevenScale,
      u_grain: P.grain, u_glitch: glitch * glitch, u_levels: P.levels
    });
    pass('composite', null, {
      u_scene: tex.graded, u_bloom: tex.b1, u_bloom2: tex.c1,
      u_res: [out.width, out.height], u_time: ts / 1000,
      u_curv: P.curv, u_ca: P.ca, u_bloomAmt: P.bloom, u_bloom2Amt: P.bloom2,
      u_scan: P.scan, u_vig: P.vig, u_glitch: glitch * glitch,
      u_lowres: GRID_ROWS, u_lift: P.lift, u_wobble: P.wobble || 0, u_hum: P.hum || 0,
      u_hole: hole
    });
  }

  // average frame time after warm-up; step down if the TV can't keep up
  function measure(dt) {
    fps = fps * 0.95 + (dt > 0 ? 1000 / dt : 60) * 0.05;
    if (userChose || quality === 'low') return;
    // a paused or hidden tab is not a slow GPU
    if (document.hidden || dt > 100) { timing.warm = 0; timing.frames = 0; timing.total = 0; return; }
    timing.warm += dt;
    if (timing.warm < 1500) return;
    timing.frames++;
    timing.total += dt;
    if (timing.frames < 120) return;
    var avg = timing.total / timing.frames;
    timing.frames = 0;
    timing.total = 0;
    // never auto-drop to low: that throws the whole look away
    if (avg > SLOW_FRAME_MS && quality === 'high') {
      setQuality(LEVELS[LEVELS.indexOf(quality) - 1], false);
      timing.warm = 0;
    }
  }

  // --- quality ---------------------------------------------------------------

  var changedAt = 0;

  function setQuality(q, byUser) {
    if (q !== 'low' && !gl) q = 'low';
    quality = q;
    K.halo = HALO[q];
    if (byUser) {
      userChose = true;
      try { localStorage.setItem(STORE_KEY, q); } catch (e) {}
    }
    var on = q !== 'low';
    out.style.display = on ? 'block' : 'none';
    stage.style.visibility = on ? 'hidden' : 'visible';
    crt.style.display = on ? 'none' : 'block';
    changedAt = performance.now();
  }

  function cycle() {
    var next = LEVELS[(LEVELS.indexOf(quality) + 1) % LEVELS.length];
    setQuality(next, true);
  }

  function glitch(ms) {
    glitchLen = ms;
    glitchUntil = performance.now() + ms;
  }

  // --- start -----------------------------------------------------------------

  // medium: full sharpness without the afterglow trail, which cost the C5
  // enough to make the radar sweep stutter. YELLOW still cycles to high.
  var initial = 'medium';
  try {
    var saved = localStorage.getItem(STORE_KEY);
    if (LEVELS.indexOf(saved) >= 0) { initial = saved; userChose = true; }
  } catch (e) {}

  if (gl) {
    try { init(); } catch (e) { console.error('FX disabled:', e); gl = null; }
  }
  setQuality(gl ? initial : 'low', false);
  changedAt = -Infinity; // no badge for the starting level

  window.Fx = {
    render: render,
    measure: measure,
    cycle: cycle,
    glitch: glitch,
    setUneven: function (s) { unevenScale = s; },
    override: function (o) { override = o; },
    // a see-through rectangle in 1920x1080 coordinates, or null for none
    setHole: function (r) {
      hole = r ? [r.x / K.W, 1 - (r.y + r.h) / K.H, (r.x + r.w) / K.W, 1 - r.y / K.H] : [0, 0, 0, 0];
    },
    available: function () { return !!gl; },
    quality: function () { return quality; },
    fps: function () { return Math.round(fps); },
    changedAt: function () { return changedAt; }
  };
})();
