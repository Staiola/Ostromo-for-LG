// Radar screen: a NORAD-style view of air traffic around Copenhagen Airport.
// Traffic is simulated until a live feed is wired in.
(function () {
  'use strict';

  var W = K.W, H = K.H, C = K.C, TITLE = K.TITLE;
  var text = K.text, glowStroke = K.glowStroke, box = K.box, frame = K.frame, crosshair = K.crosshair;
  var pad = K.pad, hhmm = K.hhmm;


  var TIMESCALE = 3; // simulated traffic runs 3x real time so it visibly moves
  var CPH = { lon: 12.6508, lat: 55.6180 };
  var COS0 = Math.cos(CPH.lat * Math.PI / 180);
  var KM_PER_DEG = 111.2;

  var MAP = { x: 96, y: 136, w: 1140, h: 844 };
  var SIDE = { x: 1260, w: 564 };
  var SCALE = 470; // px per degree latitude
  var ORIGIN = { x: MAP.x + MAP.w * 0.6, y: MAP.y + MAP.h * 0.6 };

  // --- projection ------------------------------------------------------------

  function project(lon, lat) {
    return {
      x: ORIGIN.x + (lon - CPH.lon) * SCALE * COS0,
      y: ORIGIN.y - (lat - CPH.lat) * SCALE
    };
  }

  function offset(bearingDeg, km) {
    var b = bearingDeg * Math.PI / 180;
    return {
      lon: CPH.lon + km * Math.sin(b) / (KM_PER_DEG * COS0),
      lat: CPH.lat + km * Math.cos(b) / KM_PER_DEG
    };
  }

  function bearingTo(lon, lat) {
    var toRad = Math.PI / 180;
    var p1 = CPH.lat * toRad, p2 = lat * toRad, dl = (lon - CPH.lon) * toRad;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / toRad + 360) % 360;
  }

  // --- static map layer (drawn once, blitted every frame) --------------------

  var PLACES = [
    ['KØBENHAVN', 12.568, 55.676, 'r'], ['MALMÖ', 13.003, 55.605, 'r'],
    ['HELSINGØR', 12.592, 56.036, 'l'], ['HELSINGBORG', 12.694, 56.046, 'r'],
    ['ROSKILDE', 12.080, 55.642, 'l'], ['KØGE', 12.182, 55.458, 'l'],
    ['LUND', 13.191, 55.705, 'r'], ['TRELLEBORG', 13.157, 55.375, 'r'],
    ['LANDSKRONA', 12.830, 55.870, 'r'], ['HILLERØD', 12.310, 55.930, 'l'],
    ['YSTAD', 13.820, 55.430, 'r'],
    ['NÆSTVED', 11.760, 55.230, 'r']
  ];

  // rough Øresund median line, Kattegat to the Baltic
  var BORDER = [[12.50, 56.30], [12.62, 56.10], [12.70, 55.95], [12.79, 55.78],
    [12.84, 55.64], [12.78, 55.52], [12.82, 55.40], [12.95, 55.20], [13.20, 54.95]];

  function drawStatic(progress) {
    K.ctx.fillStyle = C.bg;
    K.ctx.fillRect(0, 0, W, H);

    K.ctx.save();
    K.ctx.beginPath();
    K.ctx.rect(MAP.x + 8, MAP.y + 8, MAP.w - 16, MAP.h - 16);
    K.ctx.clip();

    // coastline, drawn on progressively during boot
    K.ctx.beginPath();
    window.COASTLINE.forEach(function (line) {
      var n = Math.max(2, Math.floor(line.length * progress));
      for (var i = 0; i < n; i++) {
        var p = project(line[i][0], line[i][1]);
        if (i === 0) K.ctx.moveTo(p.x, p.y); else K.ctx.lineTo(p.x, p.y);
      }
    });
    K.ctx.lineJoin = 'round';
    glowStroke(C.line, 2);

    if (progress >= 1) {
      // national border through the Sound
      K.ctx.beginPath();
      BORDER.forEach(function (pt, i) {
        var p = project(pt[0], pt[1]);
        if (i === 0) K.ctx.moveTo(p.x, p.y); else K.ctx.lineTo(p.x, p.y);
      });
      K.ctx.setLineDash([2, 7]);
      glowStroke(C.green, 2);
      K.ctx.setLineDash([]);
      var dk = project(11.95, 55.80), se = project(13.45, 55.90);
      text('DANMARK', dk.x, dk.y, { color: C.green, size: 22, spacing: 4 });
      text('SVERIGE', se.x, se.y, { color: C.green, size: 22, spacing: 4 });

      // range rings: 25 km control zone in pink, 50/100/150 km dim
      [50, 100].forEach(function (km) {
        K.ctx.beginPath();
        K.ctx.arc(ORIGIN.x, ORIGIN.y, km / KM_PER_DEG * SCALE, 0, Math.PI * 2);
        K.ctx.setLineDash([3, 9]);
        glowStroke(C.lineDim, 2);
        K.ctx.setLineDash([]);
        var lp = { x: ORIGIN.x + 6, y: ORIGIN.y - km / KM_PER_DEG * SCALE - 8 };
        text(km + ' KM', lp.x, lp.y, { size: 22, color: C.lineDim, glow: false });
      });
      K.ctx.beginPath();
      K.ctx.arc(ORIGIN.x, ORIGIN.y, 25 / KM_PER_DEG * SCALE, 0, Math.PI * 2);
      glowStroke(C.pink, 2.5);

      // towns
      PLACES.forEach(function (pl) {
        var p = project(pl[1], pl[2]);
        K.ctx.beginPath();
        K.ctx.rect(p.x - 4, p.y - 4, 8, 8);
        glowStroke(C.amber, 2);
        var right = pl[3] === 'r';
        text(pl[0], p.x + (right ? 12 : -12), p.y + 6, { color: C.amber, size: 22, align: right ? 'left' : 'right', spacing: 1 });
      });

      // Kastrup: star + runways 04/22 and 12/30
      drawRunway(55.6045, 12.6290, 55.6290, 12.6620);
      drawRunway(55.5960, 12.6530, 55.6160, 12.6860);
      drawRunway(55.6280, 12.6280, 55.6160, 12.6680);
      drawStar(ORIGIN.x - 34, ORIGIN.y + 30, 13);
      text('EKCH', ORIGIN.x - 54, ORIGIN.y + 72, { color: C.white, size: 22, spacing: 3, align: 'center' });

      // corner crosshairs, Nostromo style
      crosshair(MAP.x + 70, MAP.y + 70, 26);
      crosshair(MAP.x + MAP.w - 70, MAP.y + MAP.h - 70, 26);

      // the big thin title, NORAD style
      text('KASTRUP', MAP.x + 48, MAP.y + 190, { font: TITLE, size: 58, color: C.text, spacing: 10, glow: 14 });
      text('TERMINAL AREA', MAP.x + 48, MAP.y + 262, { font: TITLE, size: 58, color: C.text, spacing: 10, glow: 14 });
    }
    K.ctx.restore();

    frame(MAP.x, MAP.y, MAP.w, MAP.h);
  }

  function drawRunway(lat1, lon1, lat2, lon2) {
    var a = project(lon1, lat1), b = project(lon2, lat2);
    K.ctx.beginPath();
    K.ctx.moveTo(a.x, a.y);
    K.ctx.lineTo(b.x, b.y);
    glowStroke(C.white, 3);
  }

  function drawStar(x, y, r) {
    K.ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rr = i % 2 ? r * 0.42 : r;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      K.ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    K.ctx.closePath();
    glowStroke(C.white, 2);
  }

  var staticLayer = null;

  function bakeStatic() {
    staticLayer = K.layer();
    K.into(staticLayer, function () { drawStatic(1); });
  }

  // --- simulated traffic -----------------------------------------------------

  var ROUTES = [
    ['OSLO', 'ENGM', 11.10, 60.19, ['SAS', 'NOZ'], 33000],
    ['STOCKHOLM', 'ESSA', 17.92, 59.65, ['SAS', 'NOZ'], 33000],
    ['HELSINKI', 'EFHK', 24.96, 60.32, ['FIN', 'SAS'], 36000],
    ['AALBORG', 'EKYT', 9.85, 57.09, ['SAS', 'NOZ'], 24000],
    ['RØNNE', 'EKRN', 14.76, 55.06, ['DTR'], 16000],
    ['LONDON', 'EGLL', -0.46, 51.47, ['SAS', 'BAW'], 37000],
    ['AMSTERDAM', 'EHAM', 4.76, 52.31, ['KLM', 'SAS'], 35000],
    ['FRANKFURT', 'EDDF', 8.57, 50.03, ['DLH', 'SAS'], 36000],
    ['MÜNCHEN', 'EDDM', 11.79, 48.35, ['DLH', 'SAS'], 37000],
    ['BERLIN', 'EDDB', 13.50, 52.36, ['EZY', 'SAS'], 33000],
    ['PARIS', 'LFPG', 2.55, 49.01, ['AFR', 'SAS'], 37000],
    ['WARSZAWA', 'EPWA', 20.97, 52.17, ['LOT'], 35000],
    ['REYKJAVIK', 'BIKF', -22.60, 63.98, ['ICE'], 38000],
    ['NEW YORK', 'KEWR', -74.17, 40.69, ['SAS', 'UAL'], 38000],
    ['ISTANBUL', 'LTFM', 28.75, 41.26, ['THY'], 39000],
    ['DUBAI', 'OMDB', 55.36, 25.25, ['UAE'], 39000],
    ['ALICANTE', 'LEAL', -0.56, 38.28, ['NOZ', 'SAS'], 37000]
  ].map(function (r) {
    return { city: r[0], icao: r[1], bearing: bearingTo(r[2], r[3]), airlines: r[4], cruise: r[5] };
  });

  var DEP_COUNT = 7, ARR_COUNT = 7;
  var SPAWN_KM = 185, DESPAWN_KM = 195;
  var flights = [];
  var usedCallsigns = {};

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function newCallsign(route) {
    var cs;
    do {
      cs = pick(route.airlines) + (100 + Math.floor(Math.random() * 1900));
    } while (usedCallsigns[cs]);
    usedCallsigns[cs] = true;
    return cs;
  }

  function speedAt(km) { return 150 + Math.min(km, 120) / 120 * 300; } // knots
  function altAt(f) { return Math.min(f.route.cruise, Math.round(f.dist * 330 / 100) * 100 + 200); }

  function spawn(dir, dist) {
    var route = pick(ROUTES);
    // fan arrivals and departures a little off the route line so they don't overlap
    var f = {
      cs: newCallsign(route),
      route: route,
      dir: dir,
      dist: dist,
      bearing: route.bearing + (Math.random() * 10 - 5),
      squawk: String(1000 + Math.floor(Math.random() * 6777)),
      trail: [],
      trailClock: 0
    };
    var avgKmPerMin = speedAt(dist / 2) * 1.852 / 60;
    var minutes = dist / avgKmPerMin / TIMESCALE;
    f.schedule = new Date(Date.now() + (dir === 'ARR' ? 1 : -1) * minutes * 60000);
    flights.push(f);
    return f;
  }

  function seedTraffic() {
    for (var i = 0; i < DEP_COUNT; i++) spawn('DEP', 4 + Math.random() * 170);
    for (var j = 0; j < ARR_COUNT; j++) spawn('ARR', 8 + Math.random() * 175);
  }

  function stepTraffic(dt) {
    flights.forEach(function (f) {
      var kmPerSec = speedAt(f.dist) * 1.852 / 3600 * TIMESCALE;
      f.dist += (f.dir === 'DEP' ? 1 : -1) * kmPerSec * dt;
      f.trailClock += dt;
      if (f.trailClock > 2) {
        f.trailClock = 0;
        f.trail.push(offset(f.bearing, f.dist));
        if (f.trail.length > 10) f.trail.shift();
      }
    });
    flights = flights.filter(function (f) {
      var gone = f.dir === 'ARR' ? f.dist <= 0.5 : f.dist >= DESPAWN_KM;
      if (gone) delete usedCallsigns[f.cs];
      return !gone;
    });
    while (count('DEP') < DEP_COUNT) spawn('DEP', 0.5);
    while (count('ARR') < ARR_COUNT) spawn('ARR', SPAWN_KM);
  }

  function count(dir) { return flights.filter(function (f) { return f.dir === dir; }).length; }

  function simStatus(f) {
    if (f.dir === 'ARR') return f.dist < 20 ? 'FINAL' : f.dist < 80 ? 'DESCENT' : 'INBOUND';
    return f.dist < 15 ? 'TAKEOFF' : f.dist < 90 ? 'CLIMB' : 'CRUISE';
  }

  // Every aircraft is drawn from one shape, whether simulated or live:
  // { id, cs, dir: DEP|ARR|OVR, lat, lon, alt, gs, hdg, distKm, city, icao,
  //   time, status, trail, source, type, reg }
  function simView(f) {
    var g = offset(f.bearing, f.dist);
    return {
      id: f.cs, cs: f.cs, dir: f.dir, lat: g.lat, lon: g.lon,
      alt: altAt(f), gs: speedAt(f.dist),
      hdg: ((f.dir === 'DEP' ? f.bearing : f.bearing + 180) + 360) % 360,
      distKm: f.dist, city: f.route.city, icao: f.route.icao,
      time: f.schedule, status: simStatus(f), trail: f.trail, source: 'SIM'
    };
  }

  // --- live feed (adsb.fi via the app's service) ----------------------------

  var POLL_MS = 5000;
  var LIVE_TIMEOUT_MS = 30000; // no good poll for this long -> back to sim
  var live = { on: false, at: 0, byId: {}, list: [] };

  function pollFeed() {
    K.data('aircraft')
      .then(ingest)
      .catch(function () {})
      .then(function () { setTimeout(pollFeed, POLL_MS); });
  }

  function ingest(data) {
    var now = Date.now(), seen = {};
    (data.aircraft || []).forEach(function (a) {
      seen[a.id] = true;
      var prev = live.byId[a.id];
      var fixAt = now - (a.seenPos || 0) * 1000;
      var trail = prev ? prev.trail : [];
      if (prev && (prev.fix.lat !== a.lat || prev.fix.lon !== a.lon)) {
        trail.push({ lat: prev.fix.lat, lon: prev.fix.lon });
        if (trail.length > 10) trail.shift();
      }
      live.byId[a.id] = {
        raw: a, trail: trail, fix: { lat: a.lat, lon: a.lon, at: fixAt },
        firstSeen: prev ? prev.firstSeen : new Date(now)
      };
    });
    Object.keys(live.byId).forEach(function (id) { if (!seen[id]) delete live.byId[id]; });
    live.at = now;
    live.on = true;
  }

  function liveStatus(a) {
    if (a.ground) return a.dir === 'ARR' ? 'LANDED' : a.dir === 'DEP' ? 'TAXI' : 'GROUND';
    if (a.dir === 'ARR') return a.distKm < 20 && a.alt < 5000 ? 'FINAL' : a.vs < -300 ? 'DESCENT' : 'INBOUND';
    if (a.dir === 'DEP') return a.vs > 300 ? 'CLIMB' : a.alt >= 18000 ? 'CRUISE' : 'LEVEL';
    return 'OVERFLY';
  }

  // dead-reckon each aircraft forward from its last fix so it glides between polls
  function liveView(entry, now) {
    var a = entry.raw;
    var dt = Math.min(15, Math.max(0, (now - entry.fix.at) / 1000));
    var km = a.ground ? 0 : a.gs * 1.852 / 3600 * dt;
    var h = a.hdg * Math.PI / 180;
    var lat = entry.fix.lat + km * Math.cos(h) / KM_PER_DEG;
    var lon = entry.fix.lon + km * Math.sin(h) / (KM_PER_DEG * Math.cos(lat * Math.PI / 180));
    var other = a.route ? (a.dir === 'DEP' ? a.route.to : a.route.from) : null;
    var eta = a.dir === 'ARR' && a.gs > 60 ? new Date(now + a.distKm / (a.gs * 1.852) * 3600000) : null;
    return {
      id: a.id, cs: a.cs, dir: a.dir, lat: lat, lon: lon,
      alt: a.alt, gs: a.gs, hdg: a.hdg, distKm: a.distKm,
      city: other && other.city ? other.city : '----', icao: other && other.icao ? other.icao : '----',
      time: a.dir === 'ARR' ? eta : entry.firstSeen,
      status: liveStatus(a), trail: entry.trail, source: a.mlat ? 'MLAT' : 'ADS-B',
      type: a.type, reg: a.reg, ground: a.ground
    };
  }

  function isLive() { return live.on && Date.now() - live.at < LIVE_TIMEOUT_MS; }

  var view = [];
  function step(dt) {
    if (isLive()) {
      var now = Date.now();
      view = Object.keys(live.byId).map(function (id) { return liveView(live.byId[id], now); });
    } else {
      stepTraffic(dt);
      view = flights.map(simView);
    }
  }

  function board(dir) {
    return view.filter(function (v) { return v.dir === dir; }).sort(function (a, b) { return a.distKm - b.distKm; });
  }

  // --- selection + input -----------------------------------------------------

  var activeBoard = 'DEP';
  var selectedId = null;
  var showAllTags = true;

  function selectedFlight() {
    var list = board(activeBoard);
    var f = list.filter(function (x) { return x.id === selectedId; })[0];
    if (!f) { f = list[0]; selectedId = f ? f.id : null; }
    return f;
  }

  function moveSelection(delta) {
    var list = board(activeBoard);
    if (!list.length) return;
    var i = list.indexOf(selectedFlight());
    i = Math.max(0, Math.min(list.length - 1, i + delta));
    selectedId = list[i].id;
  }

  function key(code) {
    switch (code) {
      case 38: moveSelection(-1); break;
      case 40: moveSelection(1); break;
      case 37: activeBoard = 'DEP'; selectedId = null; break;
      case 39: activeBoard = 'ARR'; selectedId = null; break;
      case 13: showAllTags = !showAllTags; break;
      default: return false;
    }
    return true;
  }

  // --- dynamic layer ---------------------------------------------------------


  function drawSweep(t) {
    var a = (t / 6000) * Math.PI * 2 - Math.PI / 2;
    var r = MAP.h * 0.9;
    K.ctx.save();
    K.ctx.beginPath();
    K.ctx.rect(MAP.x + 8, MAP.y + 8, MAP.w - 16, MAP.h - 16);
    K.ctx.clip();
    for (var i = 0; i < 14; i++) {
      var aa = a - i * 0.025;
      K.ctx.beginPath();
      K.ctx.moveTo(ORIGIN.x, ORIGIN.y);
      K.ctx.lineTo(ORIGIN.x + Math.cos(aa) * r, ORIGIN.y + Math.sin(aa) * r);
      K.ctx.strokeStyle = 'rgba(116, 219, 134,' + (0.22 * (1 - i / 14)) + ')';
      K.ctx.lineWidth = i === 0 ? 2 : 4;
      K.ctx.stroke();
    }
    K.ctx.restore();
    return a;
  }

  function inkFor(dir) { return dir === 'DEP' ? C.cyan : dir === 'ARR' ? C.green : C.lineDim; }

  // below the Danish transition altitude (5000 ft) altitude is given in feet
  function flightLevel(v) {
    if (v.ground) return 'GND';
    if (v.alt === null) return 'FL---';
    if (v.alt < 5000) return Math.max(0, Math.round(v.alt / 100) * 100) + ' FT';
    return 'FL' + pad(Math.round(v.alt / 100), 3);
  }

  function drawAircraft(v, sweepAngle, isSelected) {
    var p = project(v.lon, v.lat);
    if (p.x < MAP.x + 10 || p.x > MAP.x + MAP.w - 10 || p.y < MAP.y + 10 || p.y > MAP.y + MAP.h - 10) return null;
    var color = inkFor(v.dir);
    var ours = v.dir !== 'OVR';

    // brighten just after the sweep passes
    var ang = Math.atan2(p.y - ORIGIN.y, p.x - ORIGIN.x);
    var since = ((sweepAngle - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    var lit = 1 - Math.min(1, since / (Math.PI * 1.2));

    // trail
    v.trail.forEach(function (g, i) {
      var q = project(g.lon, g.lat);
      K.ctx.fillStyle = color;
      K.ctx.globalAlpha = 0.15 + 0.5 * (i / v.trail.length);
      K.ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    });
    K.ctx.globalAlpha = 1;

    // triangle pointing along the track; overflights smaller and dim
    var heading = v.hdg * Math.PI / 180;
    var s = ours ? 11 : 8;
    K.ctx.beginPath();
    K.ctx.moveTo(p.x + Math.sin(heading) * s, p.y - Math.cos(heading) * s);
    K.ctx.lineTo(p.x + Math.sin(heading + 2.5) * s * 0.8, p.y - Math.cos(heading + 2.5) * s * 0.8);
    K.ctx.lineTo(p.x + Math.sin(heading - 2.5) * s * 0.8, p.y - Math.cos(heading - 2.5) * s * 0.8);
    K.ctx.closePath();
    K.ctx.globalAlpha = (ours ? 0.6 : 0.35) + 0.4 * lit;
    glowStroke(ours ? C.white : C.text, 2);
    K.ctx.globalAlpha = 1;

    if ((showAllTags && ours) || isSelected) {
      text(v.cs, p.x + 16, p.y - 6, { size: 22, color: color, glow: 6 + lit * 10 });
      text(flightLevel(v), p.x + 16, p.y + 18, { size: 22, color: color, glow: false });
    }
    if (isSelected) {
      K.ctx.beginPath();
      K.ctx.rect(p.x - 20, p.y - 20, 40, 40);
      glowStroke(C.pink, 2);
    }
    return p;
  }

  // a curved leader from the selected aircraft to its readout panel
  function drawLeader(p) {
    var tx = SIDE.x, ty = MAP.y + 150;
    K.ctx.beginPath();
    K.ctx.moveTo(p.x + 20, p.y);
    K.ctx.bezierCurveTo(p.x + 220, p.y, tx - 200, ty, tx, ty);
    K.ctx.setLineDash([6, 6]);
    glowStroke(C.pink, 2);
    K.ctx.setLineDash([]);
  }

  function field(label, value, x, y, w) {
    text(label, x, y, { size: 22, color: C.text, spacing: 2 });
    var vw = text(value, x + w, y, { size: 24, color: C.white, align: 'right' });
    box(x + w - vw - 12, y - 24, vw + 22, 32, C.line, 2);
  }

  function drawSelected(v) {
    var x = SIDE.x, y = MAP.y, w = SIDE.w, h = 340;
    frame(x, y, w, h);
    if (!v) return;
    var color = inkFor(v.dir);
    var label = { DEP: 'DEPARTURE', ARR: 'ARRIVAL', OVR: 'OVERFLIGHT', GND: 'ON GROUND' }[v.dir];
    text(label, x + 30, y + 46, { size: 22, color: color, spacing: 5 });
    if (v.type) text(v.type + (v.reg ? '  ' + v.reg : ''), x + w - 30, y + 46, { size: 22, color: C.text, spacing: 2, align: 'right' });
    text(v.cs, x + 30, y + 112, { font: TITLE, size: 54, color: C.white, spacing: 6 });
    var route = v.dir === 'DEP' ? 'EKCH ▸ ' + v.icao : v.dir === 'ARR' ? v.icao + ' ▸ EKCH' : v.dir === 'GND' ? 'EKCH' : 'TRANSIT';
    text(route + '  ' + v.city, x + 30, y + 150, { size: 24, color: C.text, spacing: 1 });

    var col = w / 2 - 44;
    field('ALT', flightLevel(v), x + 30, y + 204, col);
    field('GS', Math.round(v.gs) + ' KT', x + w / 2 + 14, y + 204, col);
    field('HDG', pad(Math.round(v.hdg) % 360, 3) + '°', x + 30, y + 250, col);
    field('DIST', Math.round(v.distKm) + ' KM', x + w / 2 + 14, y + 250, col);

    // the "NOT DEEPNAV PRECISE" homage, and honest about where the track comes from
    var by = y + 296;
    if (v.source === 'SIM') {
      var nw = text('NOT', x + 42, by, { size: 22, color: C.red, spacing: 2 });
      text(' LIVE  ·  SIMULATED TRACK', x + 42 + nw, by, { size: 22, color: C.white, spacing: 1 });
    } else {
      var lw = text('LIVE', x + 42, by, { size: 22, color: C.green, spacing: 2 });
      text('  ·  ' + v.source + ' TRACK  ·  EST. RELATIVE', x + 42 + lw, by, { size: 22, color: C.white, spacing: 1 });
    }
    box(x + 30, by - 24, w - 60, 34, C.line, 2);
  }

  function drawBoard(dir, y, h, now) {
    var x = SIDE.x, w = SIDE.w;
    frame(x, y, w, h);
    var active = activeBoard === dir;
    var color = dir === 'DEP' ? C.cyan : C.green;
    var tw = text(dir === 'DEP' ? 'DEPARTURES' : 'ARRIVALS', x + 30, y + 44, { size: 22, color: active ? color : C.lineDim, spacing: 5 });
    K.ctx.fillStyle = active ? color : C.lineDim;
    K.ctx.fillRect(x + 30, y + 52, tw, 2);
    text(dir === 'DEP' ? '◂' : '▸', x + w - 30, y + 44, { size: 22, color: C.lineDim, align: 'right', glow: false });

    var rows = board(dir).slice(0, 4);
    rows.forEach(function (f, i) {
      var ry = y + 96 + i * 36;
      var sel = active && f.id === selectedId;
      // selection is a boxed row, like the boxed values on the Nostromo screens
      if (sel) box(x + 22, ry - 25, w - 44, 34, C.cyan, 2.5);
      var ink = sel ? C.white : C.text;
      var g = sel ? 10 : undefined;
      text(f.cs, x + 32, ry, { size: 22, color: C.white, glow: g });
      text(f.city.slice(0, 10), x + 160, ry, { size: 22, color: ink, glow: g });
      text(f.time ? hhmm(f.time) : '--:--', x + 340, ry, { size: 22, color: ink, glow: g });
      text(f.status, x + w - 32, ry, { size: 22, color: sel ? ink : color, align: 'right', glow: g, spacing: 1 });
    });
  }

  function drawStatusBar() {
    var y = 1030;
    var src = isLive() ? 'LIVE  //  DATA ADSB.FI + ADSBDB' : 'SIM FEED  //  55°37\'N 012°39\'E';
    text('STATUS: ' + src + '  //  TRAFFIC ' + pad(view.length), MAP.x, y, { size: 22, color: C.text, spacing: 2 });
    text('↑↓ SELECT   ←→ BOARD   OK TAGS   BACK HOME', W - MAP.x, y, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }


  function draw(t, now) {
    if (!staticLayer) bakeStatic();
    K.blit(staticLayer);
    K.header('EKCH // TERMINAL TRAFFIC MONITOR', now);
    var sweep = drawSweep(t);
    var sel = selectedFlight();
    var selPoint = null;
    K.ctx.save();
    K.ctx.beginPath();
    K.ctx.rect(MAP.x + 8, MAP.y + 8, MAP.w - 16, MAP.h - 16);
    K.ctx.clip();
    view.forEach(function (v) {
      var p = drawAircraft(v, sweep, v === sel);
      if (v === sel) selPoint = p;
    });
    K.ctx.restore();
    if (selPoint) drawLeader(selPoint);
    drawSelected(sel);
    drawBoard('DEP', MAP.y + 364, 228, now);
    drawBoard('ARR', MAP.y + 616, 228, now);
    drawStatusBar();
  }

  // --- mini radar for the home screen ---------------------------------------

  var MINI_KM = 90; // radius of the mini scope
  var miniLayer = null, miniKey = '';

  function bakeMini(cx, cy, r) {
    miniLayer = K.layer();
    miniKey = cx + ',' + cy + ',' + r;
    var k = r / (MINI_KM / KM_PER_DEG);
    K.into(miniLayer, function () {
      var ctx = K.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      window.COASTLINE.forEach(function (line) {
        line.forEach(function (pt, i) {
          var x = cx + (pt[0] - CPH.lon) * k * COS0, y = cy - (pt[1] - CPH.lat) * k;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
      });
      K.glowStroke(C.lineDim, 2);
      [1 / 3, 2 / 3].forEach(function (f) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * f, 0, Math.PI * 2);
        ctx.setLineDash([3, 9]);
        K.glowStroke(C.lineDim, 2);
        ctx.setLineDash([]);
      });
      ctx.beginPath();
      ctx.arc(cx, cy, 25 / MINI_KM * r, 0, Math.PI * 2);
      K.glowStroke(C.pink, 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      K.glowStroke(C.line, 2.5);
    });
  }

  function drawMini(cx, cy, r, t) {
    if (miniKey !== cx + ',' + cy + ',' + r) bakeMini(cx, cy, r);
    var ctx = K.ctx;
    // only the scope's square, not a full-screen copy
    K.blitRect(miniLayer, cx - r - 8, cy - r - 8, r * 2 + 16, r * 2 + 16);
    var k = r / (MINI_KM / KM_PER_DEG);
    var a = (t / 6000) * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    for (var i = 0; i < 10; i++) {
      var aa = a - i * 0.035;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(aa) * r, cy + Math.sin(aa) * r);
      ctx.strokeStyle = 'rgba(116, 219, 134,' + (0.25 * (1 - i / 10)) + ')';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    view.forEach(function (v) {
      var x = cx + (v.lon - CPH.lon) * k * COS0, y = cy - (v.lat - CPH.lat) * k;
      var ang = Math.atan2(y - cy, x - cx);
      var since = ((a - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      ctx.globalAlpha = 0.45 + 0.55 * (1 - Math.min(1, since / Math.PI));
      ctx.fillStyle = inkFor(v.dir);
      ctx.fillRect(x - 3, y - 3, 6, 6);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  seedTraffic();
  pollFeed();

  window.Radar = {
    draw: draw,
    drawMini: drawMini,
    step: step,
    key: key,
    flights: function () { return view; },
    board: board,
    isLive: isLive,
    drawStatic: drawStatic,
    bake: bakeStatic
  };
})();
