// Shared vector-CRT drawing kit: palette, type, glowing strokes, frames.
// Everything draws into K.ctx, which screens may point at an offscreen canvas.
(function () {
  'use strict';

  var canvas = document.getElementById('stage');

  // Screens are written in 1920x1080 coordinates but drawn at half resolution
  // when the WebGL layer is on: it resamples onto a 960x540 grid anyway, and
  // the TV draws, copies and uploads 4x fewer pixels (measured 16+23 ms/frame
  // at full size on the C5).
  var savedFx = null;
  try { savedFx = localStorage.getItem('unterface.fx'); } catch (e) {}
  var S = window.WebGL2RenderingContext && savedFx !== 'low' ? 0.5 : 1;

  function scaled(c) {
    c.width = 1920 * S;
    c.height = 1080 * S;
    c.getContext('2d').setTransform(S, 0, 0, S, 0, 0);
    return c;
  }
  scaled(canvas);
  if (S < 1) canvas.style.imageRendering = 'pixelated';

  var K = window.K = {
    W: 1920,
    H: 1080,
    S: S,
    canvas: canvas,
    ctx: canvas.getContext('2d'),
    // sampled from the Alien (1979) Nostromo frames: blue frames, cyan type
    // with near-white hot cores, green/yellow/red as the only other inks
    C: {
      bg: '#000000',
      line: '#2F8CE0',
      lineDim: '#1B4F80',
      text: '#5FE9F3',
      white: '#B9FFF8',
      cyan: '#4FF5D8',
      amber: '#E8DC6A',
      green: '#64FE9A',
      pink: '#D8A8E0',
      red: '#E2544A'
    },
    TITLE: '"Michroma", sans-serif',
    MONO: '"Share Tech Mono", monospace',
    halo: 1 // scales every soft glow; the FX layer turns it down
  };

  // Run draw() against another canvas (used to bake static layers).
  K.into = function (target, draw) {
    var real = K.ctx;
    K.ctx = target.getContext('2d');
    try { draw(); } finally { K.ctx = real; }
  };

  K.layer = function () { return scaled(document.createElement('canvas')); };

  // draw a whole layer, or one region of it, at its logical position
  K.blit = function (layer) { K.ctx.drawImage(layer, 0, 0, K.W, K.H); };
  K.blitRect = function (layer, x, y, w, h) {
    K.ctx.drawImage(layer, x * S, y * S, w * S, h * S, x, y, w, h);
  };

  // Redraw a full-screen layer only when its key changes, then blit it. The TV
  // can't afford to redraw a whole screen of text every frame (~20-50 ms), but
  // most of it only changes once a second or on a key press.
  var caches = {};
  K.cached = function (name, key, draw) {
    var c = caches[name] || (caches[name] = { layer: K.layer(), key: null });
    if (c.key !== key) {
      K.into(c.layer, draw);
      c.key = key;
    }
    K.blit(c.layer);
  };

  K.glowStroke = function (color, width) {
    var ctx = K.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha *= 0.16 * K.halo;
    ctx.lineWidth = width * 4;
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  function glowText(draw, color, glow) {
    var ctx = K.ctx;
    if (glow === false) { draw(); return; }
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = (glow || 10) * K.halo;
    draw();
    ctx.restore();
  }

  // Letter spacing: native ctx.letterSpacing where the engine has it (the C5's
  // Chromium 132 does), else one fillText per character, which is ~12x slower
  // on the TV. Native spacing also trails the last glyph, so it's subtracted.
  function nativeSpacing(ctx) { return 'letterSpacing' in ctx; }

  // Setting ctx.font parses the string every time, even to the same font, and
  // measureText is slow too: on the TV the two were half of a home screen frame.
  // A font is only set when it changed (checked against what the canvas reports,
  // so a save/restore or a direct ctx.font elsewhere can't fool it), and widths
  // are remembered.
  function setFont(ctx, font) {
    if (ctx.__font === font && ctx.font === ctx.__fontSeen) return;
    ctx.font = font;
    ctx.__font = font;
    ctx.__fontSeen = ctx.font;
  }

  function setSpacing(ctx, spacing) {
    if (!nativeSpacing(ctx)) return;
    var v = (spacing || 0) + 'px';
    if (ctx.letterSpacing !== v) ctx.letterSpacing = v;
  }

  var widths = new Map();

  // Symbols the interface fonts don't have (Share Tech Mono and Michroma stop
  // at Latin-1): the TV substituted another font or showed a box. They're
  // drawn as vector shapes instead, each taking one space's width.
  var SHAPES = /[▸◂▶◀►◄●○■□█▲▼↑↓←→]/;
  var SHAPES_ALL = /[▸◂▶◀►◄●○■□█▲▼↑↓←→]/g;

  function drawShape(ctx, ch, px, y, cw, s) {
    var mid = y - s * 0.35, lw = Math.max(1.5, s * 0.09);
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    switch (ch) {
      case '▸': case '▶': case '►':
        ctx.moveTo(px + cw * 0.22, mid - s * 0.26); ctx.lineTo(px + cw * 0.86, mid); ctx.lineTo(px + cw * 0.22, mid + s * 0.26);
        ctx.closePath(); ctx.fill(); return;
      case '◂': case '◀': case '◄':
        ctx.moveTo(px + cw * 0.78, mid - s * 0.26); ctx.lineTo(px + cw * 0.14, mid); ctx.lineTo(px + cw * 0.78, mid + s * 0.26);
        ctx.closePath(); ctx.fill(); return;
      case '▲':
        ctx.moveTo(px + cw * 0.15, mid + s * 0.2); ctx.lineTo(px + cw * 0.5, mid - s * 0.28); ctx.lineTo(px + cw * 0.85, mid + s * 0.2);
        ctx.closePath(); ctx.fill(); return;
      case '▼':
        ctx.moveTo(px + cw * 0.15, mid - s * 0.2); ctx.lineTo(px + cw * 0.5, mid + s * 0.28); ctx.lineTo(px + cw * 0.85, mid - s * 0.2);
        ctx.closePath(); ctx.fill(); return;
      case '●': ctx.arc(px + cw / 2, mid, s * 0.2, 0, Math.PI * 2); ctx.fill(); return;
      case '○': ctx.arc(px + cw / 2, mid, s * 0.2, 0, Math.PI * 2); ctx.stroke(); return;
      case '■': ctx.fillRect(px + cw * 0.18, mid - s * 0.24, cw * 0.64, s * 0.48); return;
      case '□': ctx.strokeRect(px + cw * 0.18, mid - s * 0.24, cw * 0.64, s * 0.48); return;
      case '█': ctx.fillRect(px, y - s * 0.78, cw, s * 0.92); return;
    }
    // arrows: a shaft and a head
    var h = s * 0.18, x0 = px + cw * 0.12, x1 = px + cw * 0.88, cxm = px + cw / 2, t = mid - s * 0.32, b = mid + s * 0.32;
    if (ch === '→') { ctx.moveTo(x0, mid); ctx.lineTo(x1, mid); ctx.moveTo(x1 - h, mid - h); ctx.lineTo(x1, mid); ctx.lineTo(x1 - h, mid + h); }
    if (ch === '←') { ctx.moveTo(x1, mid); ctx.lineTo(x0, mid); ctx.moveTo(x0 + h, mid - h); ctx.lineTo(x0, mid); ctx.lineTo(x0 + h, mid + h); }
    if (ch === '↑') { ctx.moveTo(cxm, b); ctx.lineTo(cxm, t); ctx.moveTo(cxm - h, t + h); ctx.lineTo(cxm, t); ctx.lineTo(cxm + h, t + h); }
    if (ch === '↓') { ctx.moveTo(cxm, t); ctx.lineTo(cxm, b); ctx.moveTo(cxm - h, b - h); ctx.lineTo(cxm, b); ctx.lineTo(cxm + h, b - h); }
    ctx.stroke();
  }

  K.measure = function (str, opts) {
    if (SHAPES.test(str)) str = str.replace(SHAPES_ALL, ' ');
    var ctx = K.ctx;
    var font = (opts.size || 22) + 'px ' + (opts.font || K.MONO);
    var spacing = opts.spacing || 0;
    setFont(ctx, font);
    setSpacing(ctx, spacing);
    var key = font + '|' + spacing + '|' + str;
    var w = widths.get(key);
    if (w !== undefined) return w;
    if (!spacing) w = ctx.measureText(str).width;
    else if (nativeSpacing(ctx)) w = ctx.measureText(str).width - spacing;
    else {
      w = 0;
      for (var i = 0; i < str.length; i++) w += ctx.measureText(str[i]).width + spacing;
      w -= spacing;
    }
    if (widths.size > 4000) widths.clear();
    widths.set(key, w);
    return w;
  };

  K.text = function (str, x, y, opts) {
    var ctx = K.ctx;
    opts = opts || {};
    var color = opts.color || K.C.text;
    var spacing = opts.spacing || 0;
    var align = opts.align || 'left';
    var width = K.measure(str, opts); // also sets font and spacing
    ctx.fillStyle = color;
    ctx.textBaseline = opts.baseline || 'alphabetic';
    var cx = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    ctx.textAlign = 'left';
    if (SHAPES.test(str)) {
      var plain = str.replace(SHAPES_ALL, ' '), size = opts.size || 22, cw = K.measure(' ', opts);
      K.text(plain, cx, y, { size: size, font: opts.font, spacing: spacing, color: color, glow: opts.glow, baseline: opts.baseline });
      glowText(function () {
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        for (var i = 0; i < str.length; i++) {
          if (!SHAPES.test(str[i])) continue;
          var px = cx + (i ? K.measure(plain.slice(0, i), opts) + spacing : 0);
          drawShape(ctx, str[i], px, y, cw, size);
        }
      }, color, opts.glow);
      return width;
    }
    if (!spacing || nativeSpacing(ctx)) {
      glowText(function () { ctx.fillText(str, cx, y); }, color, opts.glow);
      return width;
    }
    glowText(function () {
      var px = cx;
      for (var j = 0; j < str.length; j++) {
        ctx.fillText(str[j], px, y);
        px += ctx.measureText(str[j]).width + spacing;
      }
    }, color, opts.glow);
    return width;
  };

  // Shrink the size until the string fits maxWidth.
  K.fitText = function (str, x, y, maxWidth, opts) {
    var o = {};
    for (var k in opts) o[k] = opts[k];
    // shrink to no smaller than 55% (16 px at the least), then cut with an
    // ellipsis if it still doesn't fit
    var min = Math.max(16, Math.round(o.size * 0.55));
    while (o.size > min && K.measure(str, o) > maxWidth) o.size -= 1;
    while (str.length > 1 && K.measure(str, o) > maxWidth) str = str.slice(0, -2) + '…';
    return K.text(str, x, y, o);
  };

  K.box = function (x, y, w, h, color, width) {
    K.ctx.beginPath();
    K.ctx.rect(x + 0.5, y + 0.5, w, h);
    K.glowStroke(color || K.C.line, width || 2);
  };

  // double rule, like the Nostromo panel frames
  K.frame = function (x, y, w, h, color) {
    K.box(x, y, w, h, color || K.C.line, 2.5);
    K.box(x + 7, y + 7, w - 14, h - 14, K.C.lineDim, 2);
  };

  // target brackets just outside a rectangle
  K.brackets = function (x, y, w, h, color, arm, gap) {
    var ctx = K.ctx;
    arm = arm || 22;
    gap = gap || 10;
    var l = x - gap, t = y - gap, r = x + w + gap, b = y + h + gap;
    ctx.beginPath();
    ctx.moveTo(l, t + arm); ctx.lineTo(l, t); ctx.lineTo(l + arm, t);
    ctx.moveTo(r - arm, t); ctx.lineTo(r, t); ctx.lineTo(r, t + arm);
    ctx.moveTo(r, b - arm); ctx.lineTo(r, b); ctx.lineTo(r - arm, b);
    ctx.moveTo(l + arm, b); ctx.lineTo(l, b); ctx.lineTo(l, b - arm);
    K.glowStroke(color || K.C.pink, 3);
  };

  K.crosshair = function (x, y, r) {
    var ctx = K.ctx;
    ctx.beginPath();
    ctx.moveTo(x - r, y - 3); ctx.lineTo(x + r, y - 3);
    ctx.moveTo(x - r, y + 3); ctx.lineTo(x + r, y + 3);
    ctx.moveTo(x - 3, y - r); ctx.lineTo(x - 3, y + r);
    ctx.moveTo(x + 3, y - r); ctx.lineTo(x + 3, y + r);
    K.glowStroke(K.C.line, 2);
  };

  K.fillBar = function (x, y, w, h, color) {
    var ctx = K.ctx;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * K.halo;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  };

  K.pad = function (n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; };
  K.hhmm = function (d) { return K.pad(d.getHours()) + ':' + K.pad(d.getMinutes()); };
  K.hhmmss = function (d, utc) {
    return utc
      ? K.pad(d.getUTCHours()) + ':' + K.pad(d.getUTCMinutes()) + ':' + K.pad(d.getUTCSeconds())
      : K.pad(d.getHours()) + ':' + K.pad(d.getMinutes()) + ':' + K.pad(d.getSeconds());
  };

  // header strip shared by every screen
  K.header = function (title, now) {
    var W = K.W, x = 96;
    K.frame(x, 40, W - x * 2, 76);
    K.text(title, x + 34, 92, { font: K.TITLE, size: 28, spacing: 6, color: K.C.white });
    var w = K.text('UTC ' + K.hhmmss(now, true), W - x - 34, 90, { size: 30, align: 'right', spacing: 2, color: K.C.white });
    K.box(W - x - 34 - w - 18, 58, w + 36, 42, K.C.line, 2);
    K.text('LCL ' + K.hhmm(now), W - x - 34 - w - 50, 90, { size: 24, align: 'right', spacing: 2, color: K.C.text });
  };

  // Data from the app's own service. On the TV that's the webOS JS service
  // (nostromo-service/service.js) over the luna bus; anywhere else it's the
  // dev server standing in for it (nostromo-service/dev-server.js).
  // method: 'aircraft' | 'eds' ({ dataset, query }) | 'cam' ({ id }) | 'abyss'
  var SERVICE = 'luna://com.unterface.nostromo.service/';
  K.data = function (method, params) {
    if (typeof window.PalmServiceBridge !== 'undefined') {
      return K.luna(SERVICE + method, params).then(function (res) { return res.data; });
    }
    var url = method === 'eds' ? 'api/eds/' + params.dataset + '?' + params.query
      : 'api/' + method + (params ? '?' + Object.keys(params).map(function (k) {
        return k + '=' + encodeURIComponent(params[k]);
      }).join('&') : '');
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(method + ' HTTP ' + r.status);
      return r.json();
    });
  };

  // webOS system service call; rejects off-TV
  K.luna = function (uri, params) {
    return new Promise(function (resolve, reject) {
      if (typeof window.PalmServiceBridge === 'undefined') return reject(new Error('Not running on webOS'));
      var bridge = new window.PalmServiceBridge();
      bridge.onservicecallback = function (msg) {
        var res = JSON.parse(msg);
        if (res.returnValue === false) reject(res); else resolve(res);
      };
      bridge.call(uri, JSON.stringify(params || {}));
    });
  };
})();
