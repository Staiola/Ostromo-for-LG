// Outpost monitor: public webcams at polar research stations, plus the newest
// deep-sea clip from Axial Seamount. Stills come through the app's service
// (the hosts send no CORS) as base64 JPEG and are drawn clean, on their own
// canvas above the CRT layer; the frames and text around them keep the look.
// The deep-sea clip is video, which on webOS plays on its own hardware plane,
// so it gets a clear window like the DR screen.
//
// Memory: the grid keeps only tile-sized thumbnails; the full picture is
// decoded only for the enlarged view and dropped when leaving it; leaving the
// screen releases everything.
(function () {
  'use strict';

  var W = K.W, C = K.C, TITLE = K.TITLE;
  var text = K.text, box = K.box, frame = K.frame;

  var USAP_MS = 2 * 60 * 1000, HOURLY_MS = 15 * 60 * 1000;
  var FEEDS = [
    { id: 'sp-aro', site: 'SOUTH POLE', cam: 'ATMOS. RESEARCH OBS', coord: "90°00'S", lat: -90, lon: 0, elev: '2835 M', src: 'USAP / NSF', every: '90 S', poll: USAP_MS },
    { id: 'sp-dark', site: 'SOUTH POLE', cam: 'DARK SECTOR LABS', coord: "90°00'S", lat: -90, lon: 0, elev: '2835 M', src: 'USAP / NSF', every: '90 S', poll: USAP_MS },
    { id: 'mcm-bore', site: 'MCMURDO', cam: 'BORESIGHT', coord: "77°51'S 166°40'E", lat: -77.85, lon: 166.67, elev: '24 M', src: 'USAP / NSF', every: '30 S', poll: USAP_MS },
    { id: 'oresund-east', site: 'ØRESUND', cam: 'PYLON EAST // DK-SE', coord: "55°34'N 12°53'E", lat: 55.574, lon: 12.876, elev: '200 M', src: 'ØRESUNDSBRON', every: '10 S', poll: USAP_MS },
    { id: 'mawson', site: 'MAWSON', cam: 'STATION // EAST ANTARCTICA', coord: "67°36'S 62°52'E", lat: -67.6, lon: 62.87, elev: '16 M', src: 'AUSTRALIAN ANTARCTIC DIV.', every: '30 MIN', poll: HOURLY_MS },
    { id: 'gemini-north', site: 'MAUNA KEA', cam: 'GEMINI NORTH OBS.', coord: "19°49'N 155°28'W", lat: 19.824, lon: -155.469, elev: '4200 M', src: 'GEMINI / NOIRLAB', every: '5 MIN', poll: 5 * 60 * 1000 },
    { id: 'svalbard-zeppelin', site: 'NY-ALESUND', cam: 'ZEPPELIN OBSERVATORY', coord: "78°54'N 11°53'E", lat: 78.9, lon: 11.88, elev: '474 M', src: 'NORSK POLARINSTITUTT', every: '1 H', poll: HOURLY_MS },
    { id: 'abyss', site: 'AXIAL SEAMOUNT', cam: 'MUSHROOM VENT // CAMHD', coord: "45°56'N 130°01'W", lat: 45.93, lon: -130.02, elev: '-1520 M', src: 'OOI / UW', every: 'CLIP / 3 H', video: true }
  ];
  var SCAN_MS = 1600; // a new image scanning in, top to bottom

  var COLS = 4, GAP = 24;
  var GRID = { x: 130, y: 196, w: 1660 };
  var TILE_W = (GRID.w - GAP * (COLS - 1)) / COLS, IMG_H = Math.round(TILE_W * 9 / 16), TILE_H = IMG_H + 66;
  var BIG = { x: 130, y: 196, w: 1216, h: 684 };
  var INFO = { x: 1380, y: 196, w: 410 };

  var selected = 0;
  var big = false;
  var on = false;
  var thumbs = {};    // id -> { canvas, at, arrived } or { failed: true }
  var large = null;   // { id, canvas, arrived } for the enlarged view only
  var clip = null;    // { url, start }
  var timers = {};    // id -> next poll timeout

  // the clean layer: full resolution, above the CRT canvas, only while open
  var clean = document.createElement('canvas');
  clean.width = W;
  clean.height = K.H;
  clean.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none;';
  var wrap = document.getElementById('wrap');
  wrap.appendChild(clean);
  var cctx = clean.getContext('2d');

  // --- fetching ------------------------------------------------------------------

  // decode a still, keep only a canvas of the size it's shown at
  function decode(jpeg, w, h, done) {
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      var s = Math.max(w / img.width, h / img.height); // cover the 16:9 box
      c.getContext('2d').drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
      img.onload = null;
      img.src = ''; // let the decoded JPEG go
      done(c);
    };
    // some feeds send PNG (labelled as JPEG); base64 PNG starts with iVBOR
    img.src = 'data:image/' + (jpeg.slice(0, 5) === 'iVBOR' ? 'png' : 'jpeg') + ';base64,' + jpeg;
  }

  function fetchThumb(feed) {
    return K.data('cam', { id: feed.id }).then(function (r) {
      var at = r.modified || r.fetched, prev = thumbs[feed.id];
      if (prev && prev.at === at) return;
      decode(r.jpeg, Math.round(TILE_W), IMG_H, function (canvas) {
        if (!on) return;
        thumbs[feed.id] = { canvas: canvas, at: at, arrived: Date.now() };
      });
    }).catch(function () {
      if (!thumbs[feed.id]) thumbs[feed.id] = { failed: true };
    });
  }

  function poll(feed, delay) {
    clearTimeout(timers[feed.id]);
    timers[feed.id] = setTimeout(function () {
      if (!on) return;
      fetchThumb(feed).then(function () { if (on) poll(feed, feed.poll); });
    }, delay);
  }

  // the enlarged view gets its own full-size decode, dropped when it closes
  function openLarge(feed) {
    large = null;
    if (feed.video) return;
    K.data('cam', { id: feed.id }).then(function (r) {
      decode(r.jpeg, BIG.w, BIG.h, function (canvas) {
        if (on && big && FEEDS[selected] === feed) large = { id: feed.id, canvas: canvas, arrived: Date.now() };
      });
    }).catch(function () {});
  }

  function fetchClip() {
    K.data('abyss').then(function (r) { clip = r; }).catch(function () {});
  }

  // --- the deep-sea video window ----------------------------------------------------

  var video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.setAttribute('playsinline', '');
  video.style.cssText = 'position:absolute;display:none;background:transparent;';
  wrap.insertBefore(video, wrap.firstChild);

  function showVideo(r) {
    if (!clip) return;
    if (video.getAttribute('src') !== clip.url) { video.src = clip.url; video.play(); }
    video.style.left = (r.x / W * 100) + '%';
    video.style.top = (r.y / K.H * 100) + '%';
    video.style.width = (r.w / W * 100) + '%';
    video.style.height = (r.h / K.H * 100) + '%';
    video.style.display = 'block';
    window.Fx.setHole(r);
  }

  function hideVideo() {
    if (video.style.display === 'none') return;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.style.display = 'none';
    window.Fx.setHole(null);
  }

  // --- drawing -------------------------------------------------------------------

  function ago(ms) {
    var m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    return m < 60 ? m + ' MIN AGO' : Math.floor(m / 60) + ' H ' + (m % 60) + ' MIN AGO';
  }

  // on the clean layer: the picture, scanning in with a beam line if it's new
  function drawClean(entry, x, y, w, h) {
    var p = Math.min(1, (Date.now() - entry.arrived) / SCAN_MS);
    var src = entry.canvas, rows = Math.max(1, Math.round(src.height * p));
    cctx.drawImage(src, 0, 0, src.width, rows, x, y, w, h * rows / src.height);
    if (p < 1) {
      cctx.fillStyle = C.cyan;
      cctx.fillRect(x, y + h * p - 2, w, 3);
    }
  }

  // a feed with nothing to show yet: static noise and a status (CRT layer)
  function drawNoSignal(x, y, w, h, msg) {
    var ctx = K.ctx;
    for (var i = 0; i < 90; i++) {
      ctx.fillStyle = 'rgba(95, 233, 243,' + (Math.random() * 0.25) + ')';
      ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 6, 3);
    }
    text(msg, x + w / 2, y + h / 2 + 8, { size: 22, color: C.text, spacing: 3, align: 'center' });
  }

  // the deep-sea tile has no thumbnail: sonar rings pulse instead
  function drawSonar(x, y, w, h, t) {
    var ctx = K.ctx, cx = x + w / 2, cy = y + h / 2 - 10;
    for (var i = 0; i < 3; i++) {
      var r = ((t / 1800 + i / 3) % 1) * h * 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.globalAlpha = 1 - r / (h * 0.55);
      K.glowStroke(C.cyan, 2);
    }
    ctx.globalAlpha = 1;
    text(clip ? 'CLIP ' + K.hhmm(new Date(clip.start)) + '  ·  OK' : 'LOCATING CLIP...',
      cx, y + h - 22, { size: 22, color: C.text, spacing: 2, align: 'center' });
  }

  function drawTile(feed, i, t) {
    var col = i % COLS, row = Math.floor(i / COLS);
    var x = GRID.x + col * (TILE_W + GAP), y = GRID.y + row * (TILE_H + GAP);
    var sel = i === selected, entry = thumbs[feed.id];
    if (sel) { frame(x - 8, y - 8, TILE_W + 16, TILE_H + 16, C.cyan); K.brackets(x - 8, y - 8, TILE_W + 16, TILE_H + 16, C.pink); }
    box(x, y, TILE_W, IMG_H, sel ? C.line : C.lineDim, 2);
    if (feed.video) drawSonar(x, y, TILE_W, IMG_H, t);
    else if (entry && entry.canvas) drawClean(entry, x, y, TILE_W, IMG_H);
    else drawNoSignal(x, y, TILE_W, IMG_H, entry && entry.failed ? 'NO SIGNAL' : 'AWAITING TX');
    K.fitText(feed.site, x + 4, y + IMG_H + 32, TILE_W * 0.6, { font: TITLE, size: 20, color: sel ? C.white : C.text, spacing: 2, glow: false });
    var status = feed.video ? feed.elev : entry && entry.at ? ago(entry.at) : '---';
    text(status, x + TILE_W - 4, y + IMG_H + 32, { size: 22, color: sel ? C.cyan : C.lineDim, align: 'right', spacing: 1 });
    text(feed.cam, x + 4, y + IMG_H + 60, { size: 22, color: C.lineDim, spacing: 2, glow: false });
  }

  function field(label, value, x, y, w) {
    text(label, x, y, { size: 22, color: C.text, spacing: 2 });
    var vw = text(value, x + w - 10, y, { size: 24, color: C.white, align: 'right' });
    box(x + w - vw - 22, y - 25, vw + 22, 34, C.line, 2);
  }

  function drawBig(t) {
    var feed = FEEDS[selected], entry = thumbs[feed.id];
    box(BIG.x - 6, BIG.y - 6, BIG.w + 12, BIG.h + 12, C.line, 2);
    if (feed.video) { if (clip) showVideo(BIG); else drawNoSignal(BIG.x, BIG.y, BIG.w, BIG.h, 'LOCATING CLIP...'); }
    else if (large && large.id === feed.id) drawClean(large, BIG.x, BIG.y, BIG.w, BIG.h);
    else drawNoSignal(BIG.x, BIG.y, BIG.w, BIG.h, entry && entry.failed ? 'NO SIGNAL' : 'RECEIVING...');

    var x = INFO.x, w = INFO.w;
    frame(x - 20, BIG.y - 6, w + 40, BIG.h + 12);
    K.fitText(feed.site, x, BIG.y + 56, w, { font: TITLE, size: 34, color: C.white, spacing: 3 });
    text(feed.cam, x, BIG.y + 96, { size: 22, color: C.amber, spacing: 2 });
    field('COORD', feed.coord, x, BIG.y + 170, w);
    field(feed.video ? 'DEPTH' : 'ELEV', feed.elev, x, BIG.y + 220, w);
    field('SOURCE', feed.src, x, BIG.y + 270, w);
    field('CYCLE', feed.every, x, BIG.y + 320, w);
    var last = feed.video ? (clip ? ago(clip.start) : '---') : entry && entry.at ? ago(entry.at) : '---';
    field('LAST TX', last, x, BIG.y + 370, w);
    K.cached('outpost-globe', feed.id, function () { drawGlobe(feed); });
    drawMarker(feed, t);
    var blink = Math.floor(t / 530) % 2;
    var live = feed.video ? !!clip : !!(entry && entry.at);
    text((blink ? '● ' : '  ') + (live ? (feed.video ? 'PLAYBACK // RELAY' : 'LINK ACTIVE') : 'NO CARRIER'),
      x, BIG.y + BIG.h - 30, { size: 22, color: live ? C.green : C.red, spacing: 3 });
  }

  // --- globe -------------------------------------------------------------------
  // An outline globe under the info panel, turned so the outpost faces us
  // (tilted a little, so the poles still read as a globe), with a marker on it.
  var GLOBE = { x: INFO.x + INFO.w / 2, y: 698, r: 106 };

  // the land outlines as runs of points, split where Natural Earth's polygons
  // run along the map edge (the 180° seam, Antarctica's bottom at -90°)
  var LAND = null;
  function land() {
    if (LAND) return LAND;
    LAND = [];
    (window.WORLD || []).forEach(function (arc) {
      var run = [];
      for (var i = 0; i < arc.length; i++) {
        var p = arc[i], q = arc[i - 1];
        var seam = p[1] < -89.5 || (q && Math.abs(p[0]) > 179.9 && Math.abs(q[0]) > 179.9);
        if (seam) { if (run.length > 1) LAND.push(run); run = []; continue; }
        run.push(p);
      }
      if (run.length > 1) LAND.push(run);
    });
    return LAND;
  }

  // orthographic projection about (lat0, lon0); null on the far side
  function project(lat, lon, lat0, lon0) {
    var R = Math.PI / 180, f = lat * R, l = (lon - lon0) * R, f0 = lat0 * R;
    var cosc = Math.sin(f0) * Math.sin(f) + Math.cos(f0) * Math.cos(f) * Math.cos(l);
    if (cosc < 0) return null;
    return {
      x: GLOBE.x + GLOBE.r * Math.cos(f) * Math.sin(l),
      y: GLOBE.y - GLOBE.r * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(l))
    };
  }

  function view(feed) { return { lat: feed.lat * 0.72, lon: feed.lon }; }

  // trace a list of [lon, lat] points, lifting the pen behind the globe
  function trace(points, v) {
    var ctx = K.ctx, down = false;
    for (var i = 0; i < points.length; i++) {
      var p = project(points[i][1], points[i][0], v.lat, v.lon);
      if (!p) { down = false; continue; }
      if (down) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      down = true;
    }
  }

  function drawGlobe(feed) {
    var ctx = K.ctx, v = view(feed), g, k;
    ctx.clearRect(0, 0, W, K.H); // the cached layer is reused from feed to feed
    // graticule every 30°
    ctx.beginPath();
    for (g = -60; g <= 60; g += 30) { var par = []; for (k = -180; k <= 180; k += 5) par.push([k, g]); trace(par, v); }
    for (g = -180; g < 180; g += 30) { var mer = []; for (k = -90; k <= 90; k += 5) mer.push([g, k]); trace(mer, v); }
    K.glowStroke(C.lineDim, 1);
    // land
    ctx.beginPath();
    land().forEach(function (run) { trace(run, v); });
    K.glowStroke(C.line, 1.5);
    // rim, with tick marks like a bezel
    ctx.beginPath();
    ctx.arc(GLOBE.x, GLOBE.y, GLOBE.r, 0, Math.PI * 2);
    for (k = 0; k < 36; k++) {
      var a = k * Math.PI / 18, r2 = GLOBE.r + (k % 3 ? 5 : 10);
      ctx.moveTo(GLOBE.x + Math.cos(a) * (GLOBE.r + 2), GLOBE.y + Math.sin(a) * (GLOBE.r + 2));
      ctx.lineTo(GLOBE.x + Math.cos(a) * r2, GLOBE.y + Math.sin(a) * r2);
    }
    K.glowStroke(C.line, 2);
  }

  // the outpost: a crosshair, and a ring going out from it
  function drawMarker(feed, t) {
    var v = view(feed), p = project(feed.lat, feed.lon, v.lat, v.lon), ctx = K.ctx;
    if (!p) return;
    ctx.beginPath();
    ctx.moveTo(p.x - 14, p.y); ctx.lineTo(p.x - 5, p.y);
    ctx.moveTo(p.x + 5, p.y); ctx.lineTo(p.x + 14, p.y);
    ctx.moveTo(p.x, p.y - 14); ctx.lineTo(p.x, p.y - 5);
    ctx.moveTo(p.x, p.y + 5); ctx.lineTo(p.x, p.y + 14);
    K.glowStroke(C.amber, 2);
    var ping = (t % 1800) / 1800;
    ctx.save();
    ctx.globalAlpha = 1 - ping;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 + ping * 22, 0, Math.PI * 2);
    K.glowStroke(C.amber, 1.5);
    ctx.restore();
    ctx.fillStyle = C.amber;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }

  function drawReadout() {
    var feed = FEEDS[selected], y = 900;
    box(GRID.x, y - 40, GRID.w, 74, C.line, 2);
    text('>FEED: ' + feed.site + ' // ' + feed.cam, GRID.x + 24, y + 8, { size: 26, color: C.white, spacing: 2 });
    text(feed.coord + '  ·  ' + feed.elev, GRID.x + GRID.w - 24, y + 8, { size: 22, color: C.amber, spacing: 2, align: 'right' });
  }

  function draw(t, now) {
    var ctx = K.ctx;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, K.H);
    cctx.clearRect(0, 0, W, K.H);
    // the switch animation still draws this screen after leave(): stay empty then
    clean.style.display = on ? 'block' : 'none';
    K.header('OUTPOST MONITOR // REMOTE NET', now);
    frame(96, 136, W - 192, 844);
    if (on && big) {
      drawBig(t);
      if (!FEEDS[selected].video) hideVideo();
    } else {
      hideVideo();
      FEEDS.forEach(function (f, i) { drawTile(f, i, t); });
      drawReadout();
    }
    text('STATUS: REMOTE NET  //  ' + FEEDS.length + ' FEEDS  //  SAT RELAY', 96, 1030, { size: 22, color: C.text, spacing: 2 });
    text(big ? '↑↓←→ FEED   BACK GRID' : '↑↓←→ FEED   OK ENLARGE   BACK HOME', W - 96, 1030,
      { size: 22, color: C.text, spacing: 2, align: 'right' });
    // the video window when the WebGL layer is off (low quality)
    if (on && big && FEEDS[selected].video && clip) ctx.clearRect(BIG.x, BIG.y, BIG.w, BIG.h);
  }

  function key(code) {
    var n = FEEDS.length, before = selected;
    switch (code) {
      case 37: selected = (selected + n - 1) % n; break;
      case 39: selected = (selected + 1) % n; break;
      case 38: selected = (selected + n - COLS) % n; break;
      case 40: selected = (selected + COLS) % n; break;
      case 13: if (!big) { big = true; openLarge(FEEDS[selected]); } break;
      case 461: case 27: case 8:
        if (!big) return false; // home
        big = false;
        large = null;
        break;
      default: return false;
    }
    if (big && selected !== before) openLarge(FEEDS[selected]);
    return true;
  }

  function reset() {
    on = true;
    big = false;
    window.Fx.override({ curv: 0 }); // flat glass, so the clean layer and video line up
    fetchClip();
    // every still once on the way in, staggered, then each on its own cycle
    FEEDS.forEach(function (f, i) { if (!f.video) poll(f, i * 400); });
  }

  // let go of everything this screen holds
  function leave() {
    on = false;
    big = false;
    Object.keys(timers).forEach(function (id) { clearTimeout(timers[id]); });
    timers = {};
    thumbs = {};
    large = null;
    clip = null;
    hideVideo();
    cctx.clearRect(0, 0, W, K.H);
    clean.style.display = 'none';
    window.Fx.override(null);
  }

  window.Outposts = { draw: draw, key: key, reset: reset, leave: leave };
})();
