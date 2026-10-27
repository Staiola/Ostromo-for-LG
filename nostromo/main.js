// Shell: boot sequence, screen switching (CRT collapse) and key routing.
(function () {
  'use strict';

  var W = K.W, H = K.H, C = K.C;
  var SCREENS = { home: window.Home, radar: window.Radar, power: window.Power, radio: window.Radio, outposts: window.Outposts, teletext: window.Teletext, tv: window.Tv, sentry: window.Sentry, settings: window.Setup };
  var KEY = { ENTER: 13, BACK: 461, ESC: 27, BACKSPACE: 8, BLUE: 406, B: 66, YELLOW: 405, Q: 81, GREEN: 404, G: 71 };

  var current = 'home';
  var transition = null; // { to, at }
  var TRANSITION_MS = 320;
  var buffer = K.layer();

  // --- boot ------------------------------------------------------------------

  // Boot card after the Nostromo's ident screen in Alien: hollow white block
  // letters in double-ruled bands on hot pink, with the ship's profile on top.
  // Everything is plotted on like a vector display: each line is a single
  // dash that grows to its full length, with a bright beam head at the tip.
  // A tactical read-out in the style of the Colonial Marines' gear in Aliens,
  // typed under the card with a solid block cursor one character wide. The
  // numbers are live, filled in the moment typing starts.
  var LEADER_WIDTH = 30;
  // one letter per writing blip (sfx/writing_a_veryshort_1, 42 ms long, so at
  // 32 ms a letter neighbouring blips just overlap)
  var TYPE_START = 1190, CHAR_MS = 32, LINE_PAUSE = 70, TYPE_SIZE = 28, TYPE_SPACING = 3;

  // 'LABEL ....... VALUE', always LEADER_WIDTH characters
  function leader(label, value) {
    var dots = Math.max(3, LEADER_WIDTH - label.length - value.length - 2);
    return label + ' ' + new Array(dots + 1).join('.') + ' ' + value;
  }

  function readout() {
    var contacts = window.Radar.flights().length;
    var power = window.Power.summary(), cfg = window.UNTERFACE_POWER || { off: true };
    return [
      cfg.off ? leader('GRID', 'OFFLINE') : leader('GRID ' + cfg.area, power ? window.Power.format(power.now) + ' ' + window.Power.UNIT : 'ACQUIRING'),
      leader('PERIMETER HDMI', 'SECURE'),
      'STAND BY'
    ];
  }

  // line lengths are fixed (leaders pad to width), so the timing can be too
  var TYPE_LENGTHS = [LEADER_WIDTH, LEADER_WIDTH, 8];
  var typeSchedule = (function () {
    var at = TYPE_START;
    return TYPE_LENGTHS.map(function (len) {
      var start = at;
      at += len * CHAR_MS + LINE_PAUSE;
      return start;
    });
  })();
  var TYPE_END = typeSchedule[TYPE_LENGTHS.length - 1] + TYPE_LENGTHS[TYPE_LENGTHS.length - 1] * CHAR_MS;
  var BOOT_MS = TYPE_END + 490;
  var typeLines = null;
  var bootSound = { power: false, thinking: false, typed: 0, lines: 0 };
  // straight in after saving SETUP, without the boot card again
  var booting = !window.Settings.skipBoot();

  var LOGO = { name: 'OSTROMO', number: '23006000' };
  // field = background (and the cut-out inside letters), frame = bands and
  // ship, text = letter outlines. ?boot=<name> in the URL previews a theme.
  var BOOT_THEMES = {
    film: { field: '#EC2C5E', frame: '#FFF2F6', text: '#FFF2F6' },
    system: { field: '#000000', frame: C.line, text: C.text },
    blue: { field: '#0A2647', frame: '#5FE9F3', text: '#E4FFFB' }
  };
  var BOOT_THEME = 'system';
  var urlTheme = /[?&]boot=(\w+)/.exec(location.search);
  var TH = BOOT_THEMES[urlTheme && BOOT_THEMES[urlTheme[1]] ? urlTheme[1] : BOOT_THEME];
  var TEXT_SIZE = 150, CONDENSE = 0.74;
  var GLYPH_CONTOUR = 900; // longer than any letter outline at this size

  // 0..1 progress of t through the window [from, to]
  function phase(t, from, to) { return Math.max(0, Math.min(1, (t - from) / (to - from))); }

  // draw only the first p of a path (per subpath for text), or all of it
  function plotted(ctx, length, p) { ctx.setLineDash(p >= 1 ? [] : [length * p, length * 2 + 1]); }

  function textSetup(ctx) {
    ctx.font = TEXT_SIZE + 'px ' + K.TITLE;
    if ('letterSpacing' in ctx) ctx.letterSpacing = Math.round(TEXT_SIZE * 0.06) + 'px';
  }

  function textWidth(str) {
    var ctx = K.ctx;
    ctx.save();
    textSetup(ctx);
    var w = ctx.measureText(str).width * CONDENSE;
    ctx.restore();
    return w;
  }

  // fat hollow letters: a wide white stroke, then pink cut out of its middle
  // and the glyph body, leaving a white rule just outside every letter.
  // Dashes restart on every glyph contour, so all letters plot on together.
  function hollowText(str, cx, baseline, p) {
    if (p <= 0) return;
    var ctx = K.ctx;
    ctx.save();
    textSetup(ctx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.translate(cx, baseline);
    ctx.scale(CONDENSE, 1); // condensed, like the film's block face
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 2; // no spikes off sharp corners like the M's crotch
    plotted(ctx, GLYPH_CONTOUR, p);
    ctx.lineWidth = 21;
    ctx.strokeStyle = TH.text;
    ctx.strokeText(str, 0, 0);
    ctx.lineWidth = 18;
    ctx.strokeStyle = TH.field;
    ctx.strokeText(str, 0, 0);
    ctx.fillStyle = TH.field;
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }

  // point at distance d along a rectangle's outline, clockwise from top-left
  function alongRect(x, y, w, h, d) {
    if (d < w) return [x + d, y];
    d -= w;
    if (d < h) return [x + w, y + d];
    d -= h;
    if (d < w) return [x + w - d, y + h];
    return [x, y + h - (d - w)];
  }

  function beamHead(ctx, pt) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = TH.text;
    ctx.fillRect(pt[0] - 3, pt[1] - 3, 6, 6);
    ctx.restore();
  }

  function plotRect(x, y, w, h, width, p) {
    if (p <= 0) return;
    var ctx = K.ctx, len = 2 * (w + h);
    ctx.save();
    ctx.strokeStyle = TH.frame;
    ctx.lineWidth = width;
    plotted(ctx, len, p);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
    ctx.restore();
    if (p < 1) beamHead(ctx, alongRect(x, y, w, h, len * p));
  }

  // a band: a heavy rule, then a thin rule just inside it, slightly behind
  function band(x, y, w, h, p) {
    plotRect(x, y, w, h, 2.5, p);
    plotRect(x + 10, y + 10, w - 20, h - 20, 1.5, phase(p, 0.25, 1));
  }

  // a polyline [[x, y], ...] plotted from its first point
  function plotLine(points, width, p) {
    if (p <= 0) return;
    var ctx = K.ctx, len = 0, i;
    for (i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    ctx.save();
    ctx.strokeStyle = TH.frame;
    ctx.lineWidth = width;
    plotted(ctx, len, p);
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoot(t) {
    var ctx = K.ctx;
    ctx.fillStyle = TH.field;
    ctx.fillRect(0, 0, W, H);

    drawCard(t);
    var typed = drawTyping(t, W / 2 - textWidth(LOGO.name) / 2 - 56, 800);

    // sound follows the picture: thump, a tone under the plotting, a chirp
    // for every character that appears
    if (!bootSound.power) { bootSound.power = true; window.Sound.powerOn(); }
    // the machine "thinks" while the card plots (both take ~1.6 s)
    if (!bootSound.thinking && t >= 105) { bootSound.thinking = true; window.Sound.thinking(1.3); }
    if (typed > bootSound.typed) { bootSound.typed = typed; window.Sound.key(); }
    var writing = false;
    for (var w = 0; w < TYPE_LENGTHS.length; w++) {
      if (t >= typeSchedule[w] && t < typeSchedule[w] + TYPE_LENGTHS[w] * CHAR_MS) writing = true;
    }
    window.Sound.typing('boot', writing);
    // a deeper blip as each line completes, the double blip after the last
    var lines = 0;
    for (var i = 0; i < TYPE_LENGTHS.length; i++) if (t >= typeSchedule[i] + TYPE_LENGTHS[i] * CHAR_MS) lines++;
    if (lines > bootSound.lines) {
      bootSound.lines = lines;
      if (lines === TYPE_LENGTHS.length) window.Sound.done(); else window.Sound.lineEnd();
    }
  }

  // returns how many characters are showing
  function drawTyping(t, x, y) {
    var ctx = K.ctx, opts = { size: TYPE_SIZE, spacing: TYPE_SPACING, color: TH.text, glow: false };
    var cell = K.measure('M', { size: TYPE_SIZE }) + TYPE_SPACING;
    var shown = 0, cursor = null;
    if (t < TYPE_START) return 0;
    if (!typeLines) typeLines = readout();
    typeLines.forEach(function (line, i) {
      var n = Math.max(0, Math.min(line.length, Math.floor((t - typeSchedule[i]) / CHAR_MS)));
      if (t < typeSchedule[i]) return;
      var by = y + i * 46;
      var w = n ? K.text(line.slice(0, n), x, by, opts) + TYPE_SPACING : 0;
      shown += n;
      cursor = { x: x + w, y: by };
    });
    if (!cursor) return 0;
    // the block runs ahead while typing, then blinks once everything is out
    if (t < TYPE_END || Math.floor(t / 400) % 2 === 0) {
      ctx.fillStyle = TH.text;
      ctx.fillRect(cursor.x, cursor.y - TYPE_SIZE * 0.82, cell - TYPE_SPACING, TYPE_SIZE * 0.98);
    }
    return shown;
  }

  function drawCard(t) {
    var cx = W / 2, bandH = 196;
    var top = 320, bottom = top + bandH - 7;
    var nameW = textWidth(LOGO.name), numW = textWidth(LOGO.number);
    var nb = { x: cx - nameW / 2 - 56, w: nameW + 112 };
    var mb = { x: cx - numW / 2 - 48, w: numW + 96 };

    // timeline (ms): everything plots on fast, then holds until BOOT_MS
    band(nb.x, top, nb.w, bandH, phase(t, 105, 490));
    band(mb.x, bottom, mb.w, bandH, phase(t, 175, 560));

    // the ship's profile riding on the top band, right-hand end
    var r = nb.x + nb.w, th = 78, ship = phase(t, 455, 700);
    plotLine([[r - 470, top], [r - 400, top - th], [r, top - th], [r, top]], 2.5, ship);
    var detail = phase(ship, 0.5, 1);
    plotLine([[r - 372, top - th + 18], [r - 16, top - th + 18]], 1.5, detail);
    plotLine([[r - 392, top - th + 46], [r - 230, top - th + 46], [r - 230, top]], 1.5, detail);
    plotLine([[r - 16, top - th + 46], [r - 200, top - th + 46], [r - 200, top]], 1.5, detail);

    hollowText(LOGO.name, cx, top + bandH / 2 + TEXT_SIZE * 0.37, phase(t, 630, 1050));
    hollowText(LOGO.number, cx, bottom + bandH / 2 + TEXT_SIZE * 0.37, phase(t, 770, 1190));
  }

  // --- screen switching ------------------------------------------------------

  function go(name) {
    if (transition || name === current || !SCREENS[name]) return;
    if (SCREENS[current].leave) SCREENS[current].leave();
    if (SCREENS[name].reset) SCREENS[name].reset();
    transition = { to: name, at: performance.now() };
    window.Fx.glitch(TRANSITION_MS);
  }

  // collapse the old screen to a bright line, swap, expand the new one
  function drawTransition(t, now, ts) {
    var p = (ts - transition.at) / TRANSITION_MS;
    if (p >= 1) { current = transition.to; transition = null; SCREENS[current].draw(t, now); return; }
    var name = p < 0.5 ? current : transition.to;
    var s = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
    s = Math.max(0.004, s * s);
    K.into(buffer, function () { SCREENS[name].draw(t, now); });
    var ctx = K.ctx;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(buffer, 0, 0, buffer.width, buffer.height, 0, H / 2 - H * s / 2, W, H * s);
    ctx.save();
    ctx.globalAlpha = 1 - s;
    ctx.fillStyle = C.white;
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur = 20;
    ctx.fillRect(W * 0.1 * (1 - s), H / 2 - 2, W * (1 - 0.2 * (1 - s)), 4);
    ctx.restore();
  }

  // --- standby -----------------------------------------------------------------
  // webOS asks running apps before it starts its clock screensaver; Ostromo
  // says no and, after STANDBY_MS without a key, shows its own instead: nearly
  // black, one dim line drifting so nothing burns into the OLED. Any key wakes
  // it. Never while DR TV is playing.
  var STANDBY_MS = 10 * 60 * 1000;
  var lastInput = Date.now();
  var keepAlive = [];   // service bridges must stay referenced to keep answering

  function idle() { return !booting && current !== 'tv' && Date.now() - lastInput > STANDBY_MS; }

  (function vetoScreensaver() {
    if (typeof window.PalmServiceBridge === 'undefined') return;
    var sub = new window.PalmServiceBridge();
    sub.onservicecallback = function (msg) {
      var m; try { m = JSON.parse(msg); } catch (e) { return; }
      if (!m.timestamp) return;   // the subscription's own ack, not a request
      var reply = new window.PalmServiceBridge();
      reply.call('luna://com.webos.service.tvpower/power/responseScreenSaverRequest',
        JSON.stringify({ clientName: 'unterface', ack: false, timestamp: m.timestamp }));
      keepAlive = [sub, reply];
    };
    sub.call('luna://com.webos.service.tvpower/power/registerScreenSaverRequest',
      JSON.stringify({ subscribe: true, clientName: 'unterface' }));
    keepAlive = [sub];
  })();

  function drawStandby(t, now) {
    var ctx = K.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, K.H);
    // a slow Lissajous drift across most of the screen
    var x = W / 2 + Math.sin(t / 23000) * 560, y = K.H / 2 + Math.sin(t / 31000) * 330;
    K.text(K.hhmm(now), x, y, { font: K.TITLE, size: 54, color: K.C.lineDim, spacing: 6, align: 'center', glow: false });
    K.text('MA-TH-OR // STANDBY', x, y + 50, { size: 22, color: K.C.lineDim, spacing: 6, align: 'center', glow: false });
  }

  // the Magic Remote's pointer counts as someone being there
  document.addEventListener('mousemove', function () { lastInput = Date.now(); });

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    // the first key out of standby only wakes it
    var wasIdle = idle();
    lastInput = Date.now();
    if (wasIdle) { e.preventDefault(); return; }
    if (booting) { endBoot(); e.preventDefault(); return; }
    if (transition) { e.preventDefault(); return; }
    var handled = SCREENS[current].key(code);
    if (!handled) {
      if (code === KEY.YELLOW || code === KEY.Q) { window.Fx.cycle(); handled = true; }
      else if (code === KEY.BLUE || code === KEY.B) { go(current === 'radar' ? 'home' : 'radar'); handled = true; }
      else if (code === KEY.GREEN || code === KEY.G) { go(current === 'power' ? 'home' : 'power'); handled = true; }
      else if (code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE) {
        // appinfo's disableBackHistoryAPI hands BACK to us instead of webOS's
        // "quit app?" prompt; on home it does nothing, the Home button leaves.
        // Android TV expects BACK on an app's first screen to leave it.
        if (current !== 'home') go('home');
        else if (window.OstromoAndroid) window.OstromoAndroid.leave();
        handled = true;
      }
    }
    if (handled) e.preventDefault();
  });

  // degauss-style glitch as the CRT "warms up"
  function endBoot() {
    booting = false;
    window.Sound.typing('boot', false);
    window.Fx.glitch(350);
    // a TV that has never been set up starts in SETUP
    if (!window.Settings.configured()) go('settings');
  }

  // --- burn-in: pixel orbit --------------------------------------------------

  // nudge the whole picture a few pixels along a slow Lissajous path
  var ORBIT_EVERY_MS = 90000;
  var orbitStep = 0;
  setInterval(function () {
    orbitStep++;
    var wrap = document.getElementById('wrap');
    var x = Math.round(6 * Math.sin(orbitStep * 0.7));
    var y = Math.round(4 * Math.sin(orbitStep * 1.1));
    wrap.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
  }, ORBIT_EVERY_MS);

  // --- quality badge ---------------------------------------------------------

  function drawFxBadge(ts) {
    var age = ts - window.Fx.changedAt();
    if (age > 2600) return;
    var label = 'FX ' + window.Fx.quality().toUpperCase() + '  ·  ' + window.Fx.fps() + ' FPS';
    if (!window.Fx.available()) label = 'FX LOW  ·  NO WEBGL2';
    var w = K.measure(label, { size: 24, spacing: 3 }) + 48;
    var x = (W - w) / 2, y = 150;
    var ctx = K.ctx;
    ctx.fillStyle = C.bg;
    ctx.fillRect(x, y, w, 52);
    K.frame(x, y, w, 52, C.amber);
    K.text(label, W / 2, y + 35, { size: 24, color: C.amber, spacing: 3, align: 'center' });
  }

  // --- loop ------------------------------------------------------------------

  var start = null, last = null;

  function loop(ts) {
    if (start === null) { start = ts; last = ts; }
    var t = ts - start;
    var dtMs = ts - last;
    var dt = Math.min(0.1, dtMs / 1000);
    last = ts;
    var now = new Date();

    window.Radar.step(dt);
    if (booting && t > BOOT_MS) endBoot();
    if (booting) {
      drawBoot(t);
    } else if (transition) {
      drawTransition(t, now, ts);
    } else if (idle()) {
      // full-screen pictures sit above the canvas, so go home underneath first
      if (current === 'outposts') { SCREENS.outposts.leave(); current = 'home'; SCREENS.home.reset && SCREENS.home.reset(); }
      drawStandby(t, now);
    } else {
      SCREENS[current].draw(t, now);
    }
    drawFxBadge(ts);
    window.Fx.measure(dtMs);
    window.Fx.render(ts);
    requestAnimationFrame(loop);
  }

  window.Shell = { go: go };

  // canvas text only triggers a webfont load on first use, so load both
  // up front: otherwise the first frames and baked layers use a fallback
  var fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('30px "Michroma"'), document.fonts.load('22px "Share Tech Mono"'), document.fonts.load('30px "Bedstead"')])
    : Promise.resolve();
  fontsReady.then(begin, begin);
  function begin() { requestAnimationFrame(loop); }
})();
