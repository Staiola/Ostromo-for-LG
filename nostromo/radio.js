// Radio screen: NTS Radio's two live channels, worded like Colonial Marines
// comms. The streams and NTS's "live" API both allow browser requests
// (including the TV's null origin), so this needs no service. Playing the
// stream through Web Audio gives a real oscilloscope and spectrum.
(function () {
  'use strict';

  var W = K.W, C = K.C, TITLE = K.TITLE;
  var text = K.text, box = K.box, frame = K.frame, pad = K.pad;

  // NTS's own stream-relay-geo.ntslive.net/stream(2) redirects here without
  // CORS headers, which would stop the analyser; this hop sends them.
  var CHANNELS = [
    { name: 'NTS 1', stream: 'https://streams.radiomast.io/nts1' },
    { name: 'NTS 2', stream: 'https://streams.radiomast.io/nts2' }
  ];
  var LIVE_API = 'https://www.nts.live/api/v2/live';
  var LIVE_REFRESH_MS = 60 * 1000;
  var TYPE_MS = 42; // one letter per writing blip (see sound.js)

  var selected = 0;
  var playing = false;
  var tunedAt = 0;   // when the current channel was selected, for the type-out
  var live = [null, null]; // per channel: { title, city, desc, start, end, next }

  // --- audio -----------------------------------------------------------------

  var audio = new Audio();
  audio.crossOrigin = 'anonymous'; // lets the analyser read the samples
  audio.preload = 'none';
  var analyser = null, wave = null, spectrum = null;

  function connect() {
    var ctx = window.Sound.context;
    if (analyser || !ctx) return;
    var source = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    wave = new Uint8Array(analyser.fftSize);
    spectrum = new Uint8Array(analyser.frequencyBinCount);
  }

  function play(i) {
    connect();
    window.Sound.unlock();
    selected = i;
    tunedAt = Date.now();
    audio.src = CHANNELS[i].stream;
    var p = audio.play();
    if (p && p.catch) p.catch(function () { playing = false; });
    playing = true;
  }

  function stop() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    playing = false;
  }

  // --- now playing -----------------------------------------------------------

  function refreshLive() {
    fetch(LIVE_API, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        (json.results || []).forEach(function (ch, i) {
          if (i > 1) return;
          var now = ch.now || {}, det = (now.embeds && now.embeds.details) || {};
          live[i] = {
            title: (now.broadcast_title || 'UNKNOWN TRANSMISSION').toUpperCase(),
            city: (det.location_long || '').toUpperCase(),
            desc: (det.description || '').replace(/\s+/g, ' ').trim().toUpperCase(),
            start: new Date(now.start_timestamp),
            end: new Date(now.end_timestamp),
            next: ch.next ? (ch.next.broadcast_title || '').toUpperCase() : ''
          };
        });
      })
      .catch(function () {})
      .then(function () { setTimeout(refreshLive, LIVE_REFRESH_MS); });
  }

  // --- drawing ---------------------------------------------------------------

  var LEFT = { x: 96, y: 136, w: 520, h: 844 };
  var MAIN = { x: 640, y: 136, w: 1184, h: 844 };
  var SCOPE = { x: MAIN.x + 34, y: MAIN.y + 548, w: 760, h: 262 };
  var SPEC = { x: SCOPE.x + SCOPE.w + 24, y: SCOPE.y, w: MAIN.w - 68 - SCOPE.w - 24, h: 262 };

  function wrap(str, width, maxLines) {
    var words = str.split(' '), lines = [], line = '';
    words.forEach(function (w) {
      if ((line + ' ' + w).trim().length > width) { lines.push(line.trim()); line = w; }
      else line += ' ' + w;
    });
    if (line.trim()) lines.push(line.trim());
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + ' ...';
    }
    return lines;
  }

  function label(str, x, y) {
    var w = text(str, x, y, { size: 22, color: C.amber, spacing: 5 });
    K.ctx.fillStyle = C.amber;
    K.ctx.fillRect(x, y + 8, w, 2);
  }

  function drawChannels(t) {
    frame(LEFT.x, LEFT.y, LEFT.w, LEFT.h);
    var x = LEFT.x + 34;
    label('CHANNELS', x, LEFT.y + 58);
    CHANNELS.forEach(function (ch, i) {
      var y = LEFT.y + 96 + i * 250, w = LEFT.w - 68, h = 220;
      var on = i === selected, info = live[i];
      if (on) { frame(x, y, w, h, C.cyan); K.brackets(x, y, w, h, C.pink); }
      else box(x, y, w, h, C.lineDim, 2);
      text('CH-' + (i + 1) + ' // ' + ch.name, x + 22, y + 42, { size: 22, color: on ? C.amber : C.lineDim, spacing: 3 });
      if (on && playing && Math.floor(t / 530) % 2) text('● RX', x + w - 22, y + 42, { size: 22, color: C.green, align: 'right', spacing: 2 });
      if (!info) { text('ACQUIRING...', x + 22, y + 110, { size: 24, color: C.text, spacing: 2 }); return; }
      K.fitText(info.title, x + 22, y + 104, w - 44, { font: TITLE, size: 30, color: on ? C.white : C.text, spacing: 2, glow: on ? 10 : false });
      text(info.city || 'LOCATION UNKNOWN', x + 22, y + 148, { size: 22, color: C.text, spacing: 2 });
      text(K.hhmm(info.start) + '-' + K.hhmm(info.end), x + 22, y + 186, { size: 22, color: on ? C.cyan : C.lineDim, spacing: 2 });
    });
    text('SIGNAL SOURCE: NTS.LIVE', x, LEFT.y + LEFT.h - 34, { size: 22, color: C.lineDim, spacing: 2, glow: false });
  }

  function drawIntercept(t) {
    frame(MAIN.x, MAIN.y, MAIN.w, MAIN.h);
    var x = MAIN.x + 34, w = MAIN.w - 68;
    var info = live[selected];
    label('INTERCEPT // ' + CHANNELS[selected].name, x, MAIN.y + 58);
    if (!info) { text('ACQUIRING SIGNAL...', x, MAIN.y + 160, { font: TITLE, size: 40, color: C.text, spacing: 4 }); return; }

    K.fitText(info.title, x, MAIN.y + 146, w, { font: TITLE, size: 56, color: C.white, spacing: 4, glow: 12 });
    text((info.city ? info.city + '  //  ' : '') + K.hhmm(info.start) + '-' + K.hhmm(info.end) + ' LCL',
      x, MAIN.y + 194, { size: 24, color: C.text, spacing: 2 });

    // how far into the show: a row of blocks
    var frac = Math.max(0, Math.min(1, (Date.now() - info.start) / (info.end - info.start)));
    var blocks = 32, bw = (w - (blocks - 1) * 6) / blocks;
    for (var b = 0; b < blocks; b++) {
      var bx = x + b * (bw + 6);
      if (b < Math.round(frac * blocks)) K.fillBar(bx, MAIN.y + 222, bw, 20, C.cyan);
      else box(bx, MAIN.y + 222, bw, 20, C.lineDim, 2);
    }

    // the description types out after each tune, block cursor ahead of it
    var lines = wrap(info.desc || 'NO TRANSMISSION LOG', 64, 5);
    var shown = Math.floor((Date.now() - tunedAt) / TYPE_MS), cursor = null;
    lines.forEach(function (line, i) {
      if (shown <= 0) return;
      var n = Math.min(line.length, shown);
      shown -= line.length;
      var ly = MAIN.y + 300 + i * 38;
      var lw = text(line.slice(0, n), x, ly, { size: 24, color: C.text, spacing: 2 });
      cursor = { x: x + lw + 4, y: ly };
    });
    if (cursor && (shown < 0 || Math.floor(t / 530) % 2)) {
      K.ctx.fillStyle = C.text;
      K.ctx.fillRect(cursor.x, cursor.y - 21, 13, 25);
    }

    if (info.next) text('NEXT // ' + info.next, x, MAIN.y + 482, { size: 22, color: C.amber, spacing: 3 });
  }

  // HP-analyser style scope: dashed graticule, the live waveform on top
  function drawScope() {
    var s = SCOPE, ctx = K.ctx;
    box(s.x, s.y, s.w, s.h, C.line, 2);
    ctx.setLineDash([3, 8]);
    for (var gx = 1; gx < 10; gx++) {
      ctx.beginPath(); ctx.moveTo(s.x + s.w * gx / 10, s.y); ctx.lineTo(s.x + s.w * gx / 10, s.y + s.h);
      K.glowStroke(C.lineDim, 2);
    }
    for (var gy = 1; gy < 4; gy++) {
      ctx.beginPath(); ctx.moveTo(s.x, s.y + s.h * gy / 4); ctx.lineTo(s.x + s.w, s.y + s.h * gy / 4);
      K.glowStroke(C.lineDim, 2);
    }
    ctx.setLineDash([]);
    text('CH A  ·  WAVEFORM', s.x + 12, s.y - 12, { size: 22, color: C.text, spacing: 2, glow: false });

    ctx.beginPath();
    if (analyser && playing) {
      analyser.getByteTimeDomainData(wave);
      var n = 512;
      for (var i = 0; i < n; i++) {
        var v = (wave[i * 2] - 128) / 128;
        var px = s.x + i / (n - 1) * s.w, py = s.y + s.h / 2 - v * s.h * 0.45;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    } else {
      ctx.moveTo(s.x, s.y + s.h / 2); ctx.lineTo(s.x + s.w, s.y + s.h / 2);
    }
    K.glowStroke(C.green, 2);
  }

  function drawSpectrum() {
    var s = SPEC, ctx = K.ctx, bars = 24;
    box(s.x, s.y, s.w, s.h, C.line, 2);
    text('CH B  ·  SPECTRUM', s.x + 12, s.y - 12, { size: 22, color: C.text, spacing: 2, glow: false });
    if (!(analyser && playing)) return;
    analyser.getByteFrequencyData(spectrum);
    var bw = (s.w - 24) / bars;
    for (var b = 0; b < bars; b++) {
      // log-ish bands: more resolution in the low end
      var from = Math.floor(Math.pow(b / bars, 2) * 380), to = Math.max(from + 1, Math.floor(Math.pow((b + 1) / bars, 2) * 380));
      var sum = 0;
      for (var k = from; k < to; k++) sum += spectrum[k];
      var v = sum / (to - from) / 255;
      var bh = Math.max(2, v * (s.h - 24));
      ctx.beginPath();
      ctx.rect(s.x + 12 + b * bw + 2, s.y + s.h - 12 - bh, bw - 4, bh);
      K.glowStroke(v > 0.75 ? C.amber : C.cyan, 2);
    }
  }

  function drawStatusBar() {
    var y = 1030;
    var st = playing ? 'RX LOCKED  //  ' + CHANNELS[selected].name + ' LIVE  //  256 KBPS MP3' : 'RX IDLE  //  OK TO OPEN CHANNEL';
    text('STATUS: ' + st, 96, y, { size: 22, color: C.text, spacing: 2 });
    text('↑↓ CHANNEL   OK RX ON/OFF   BACK HOME', W - 96, y, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }

  function draw(t, now) {
    var info = live[selected];
    var typing = Math.floor((Date.now() - tunedAt) / TYPE_MS);
    var key = [selected, playing, info ? info.title : '', live[1 - selected] ? live[1 - selected].title : '',
      Math.floor(now.getTime() / 1000), Math.floor(t / 530) % 2, Math.min(typing, 400)].join('|');
    K.cached('radio', key, function () {
      var ctx = K.ctx;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, K.H);
      K.header('COMMS // BROADCAST INTERCEPT', now);
      drawChannels(t);
      drawIntercept(t);
      drawStatusBar();
    });
    drawScope();
    drawSpectrum();
  }

  function key(code) {
    switch (code) {
      case 38: if (selected > 0) play(selected - 1); break;
      case 40: if (selected < CHANNELS.length - 1) play(selected + 1); break;
      case 13: if (playing) stop(); else play(selected); break;
      default: return false;
    }
    return true;
  }

  // entering the screen tunes in if nothing is playing yet
  function reset() { if (!playing) play(selected); else tunedAt = Date.now(); }

  function nowPlaying() {
    if (!playing || !live[selected]) return null;
    return CHANNELS[selected].name + ' ▸ ' + live[selected].title;
  }

  refreshLive();

  window.Radio = { draw: draw, key: key, reset: reset, nowPlaying: nowPlaying, stop: function () { if (playing) stop(); } };
})();
