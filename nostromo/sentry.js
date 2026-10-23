// Sentry screen: a motion tracker and an LD 567-C remote sentry readout. Mostly
// nothing happens. Sometimes, while you're watching, contacts show up at the
// edge of the tracker and creep in, and there's about a minute to get the gun
// ready: order ammo, send a loader out (the gun must be on SAFE for that), arm
// it again, and swap to the second magazine when the first runs dry.
// The gun's state (magazines, depot, armed) is kept between visits.
(function () {
  'use strict';

  var W = K.W, C = K.C, TITLE = K.TITLE;
  var text = K.text, box = K.box, frame = K.frame;

  var STORE = 'nostromo.sentry';
  var MAG_SIZE = 500;
  var FIRE_RATE = 15;            // rounds per second: 500 rounds in 33.33 s
  var ORDER_MS = 12 * 1000;      // requisition to depot
  var WALK_MS = 7 * 1000;        // loader, each way
  var LOAD_MS = 4 * 1000;
  var HIT_RATE = 0.6;            // share of rounds that find a target
  var CHANCE = 0.35;             // chance a visit brings contacts
  var COOLDOWN_MS = 2 * 60 * 1000;
  var RANGE = 75;                // tracker range, metres
  var GUN_RANGE = 42;            // sentry opens up inside this
  var BREACH = 4;                // contacts this close are inside
  var PULSE = 1.6;               // seconds between tracker pulses, always
  var BEEP_FAR = 1.6, BEEP_NEAR = 0.45;   // the contact beep's own beat, far out and on top of you
  var PAST_GUN = 18;             // closer than this, the gun can't swing onto them
  // the feed dying: static, then the tube collapsing to a line and a dot
  var DIE = { static: 2400, line: 450, dot: 1300, dark: 1500 };
  var LOADERS = ['PFC OKAFOR', 'PVT LINDQVIST', 'CPL REYES', 'PFC MARSH', 'PVT ADEYEMI', 'CPL HALVORSEN'];

  // tracker: a half disc with ops at the centre, the sentry out along a corridor
  var TR = { x: 96, y: 160, w: 834, h: 700 };
  var CX = TR.x + TR.w / 2, CY = 780, R = 390;
  var SENTRY_AT = { d: 24, a: -112 };   // metres, degrees (-90 is straight up)
  // sentry panel
  var SP = { x: 970, y: 160, w: 854, h: 700 };
  var ACTIONS = ['order', 'dispatch', 'mag', 'arm'];

  var st = load();
  var focus = 0;
  var enc = null;            // the current incursion, if any
  var pendingAt = null;      // sim time an incursion starts
  var sim = 0, lastNow = 0;  // seconds on this screen (pauses while away)
  var lastPulse = 0, lastBeep = 0, firing = false, temp = 0, flash = null;
  // the gun fires in bursts: 0.4-1.8 s on, then a short breath
  var burst = { on: true, until: 0 };
  var log = [];              // [{ at, text, color }]
  var dead = null;           // { at } once the feed is cut
  var on = false;

  // --- state ---------------------------------------------------------------------

  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE)); } catch (e) { /* private mode etc. */ }
    return s && s.mags ? s : { mags: [140, 0], active: 0, armed: false, depot: 0, order: 0, loader: null, last: 0 };
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) { /* not essential */ }
  }

  function say(msg, color) {
    log.push({ at: Date.now(), text: msg, color: color || C.text });
    if (log.length > 5) log.shift();
  }

  function rounds() { return st.mags[st.active]; }

  // wall-clock jobs: the requisition and the loader keep going while you're away
  function tickJobs(now) {
    if (st.order && now >= st.order) {
      st.order = 0;
      st.depot += 2;
      say('DEPOT: 2 MAGAZINES RECEIVED', C.green);
      save();
    }
    var L = st.loader;
    if (L && !L.loaded && now - L.start >= WALK_MS + LOAD_MS) {
      L.loaded = 0;
      // fill the emptiest magazines first
      [0, 1].sort(function (a, b) { return st.mags[a] - st.mags[b]; }).forEach(function (i) {
        if (st.depot > 0 && st.mags[i] < MAG_SIZE) { st.mags[i] = MAG_SIZE; st.depot--; L.loaded++; }
      });
      L.loaded = L.loaded || -1;
      say(L.name + ': ' + (L.loaded > 0 ? L.loaded + ' MAG LOADED, RETURNING' : 'NOTHING TO LOAD, RETURNING'));
      save();
    }
    if (L && now - L.start >= WALK_MS * 2 + LOAD_MS) {
      st.loader = null;
      say(L.name + ': BACK INSIDE. SENTRY IS ' + (st.armed ? 'ARMED' : 'ON SAFE'), st.armed ? C.text : C.amber);
      save();
    }
  }

  // where the loader is: metres out along the sentry's bearing
  function loaderPos(now) {
    var L = st.loader;
    if (!L) return null;
    var e = now - L.start;
    var f = e < WALK_MS ? e / WALK_MS : e < WALK_MS + LOAD_MS ? 1 : 1 - (e - WALK_MS - LOAD_MS) / WALK_MS;
    return { d: Math.max(0, f) * SENTRY_AT.d, a: SENTRY_AT.a + 4 };
  }

  // --- the incursion -------------------------------------------------------------

  function startIncursion() {
    var n = 16 + Math.floor(Math.random() * 7);
    var aliens = [];
    var centre = -90 + (Math.random() - 0.5) * 70;
    for (var i = 0; i < n; i++) {
      aliens.push({
        spawn: Math.random() * 40,                      // they don't all come at once
        d: RANGE + Math.random() * 6,
        a: centre + (Math.random() - 0.5) * 60,
        speed: 0.7 + Math.random() * 0.5,
        hp: 12 + Math.random() * 12,                    // hits to stop one
        dead: false
      });
    }
    // the first one shows at once, so MOVEMENT in the log always has a blip behind it
    aliens[0].spawn = 0;
    enc = { t: 0, aliens: aliens, kills: 0, total: n, warned: false };
    say('MOVEMENT. ' + n + ' SIGNALS, CLOSING', C.red);
    if (window.Fx) Fx.glitch(250);
  }

  function endIncursion(breached) {
    if (breached) {
      // from far away all we see is the feed dying
      dead = { at: Date.now() };
      firing = false;
      if (window.Sound && Sound.gun) Sound.gun(false);
      if (window.Sound && Sound.static) Sound.static(DIE.static / 1000);
    } else say('ALL ' + enc.total + ' CONTACTS STOPPED. NO MOVEMENT', C.green);
    enc = null;
    st.last = Date.now();
    save();
  }

  function stepIncursion(dt) {
    enc.t += dt;
    firing = false;
    var live = enc.aliens.filter(function (a) { return !a.dead && enc.t >= a.spawn; });
    var target = null;
    // the gun covers the corridor out front; anything past it is out of its arc
    live.forEach(function (a) { if (a.d > PAST_GUN && (!target || a.d < target.d)) target = a; });
    if (enc.t >= burst.until) {
      burst.on = !burst.on;
      burst.until = enc.t + (burst.on ? 0.4 + Math.random() * 1.4 : 0.15 + Math.random() * 0.55);
    }
    if (target && target.d <= GUN_RANGE && st.armed && rounds() > 0 && burst.on) {
      var shots = Math.min(rounds(), FIRE_RATE * dt);
      st.mags[st.active] = Math.max(0, rounds() - shots);
      target.hp -= shots * HIT_RATE;
      target.hit = enc.t;
      firing = true;
      if (target.hp <= 0) { target.dead = true; enc.kills++; }
      if (rounds() <= 0) {
        say('MAG ' + (st.active + 1) + ' EMPTY. ' + (st.mags[1 - st.active] > 0 ? 'SWITCH MAGAZINE' : 'NO ROUNDS LEFT'), C.red);
        save();
      }
    } else if (target && target.d <= GUN_RANGE && !enc.warned && burst.on) {
      enc.warned = true;
      say(!st.armed ? 'CONTACTS IN RANGE. SENTRY IS ON SAFE' : 'CONTACTS IN RANGE. NO ROUNDS', C.red);
    }
    live.forEach(function (a) {
      // under fire they slow to a crawl; once past the gun they rush
      var slow = a.hit && enc.t - a.hit < 0.3 ? 0.2 : 1;
      if (a.d <= PAST_GUN) slow = 2.2;
      if (a.d <= PAST_GUN && !enc.passed) { enc.passed = true; say('CONTACT PAST THE GUN. INSIDE THE PERIMETER', C.red); }
      a.d -= a.speed * slow * dt;
    });
    if (live.some(function (a) { return a.d <= BREACH; })) { endIncursion(true); return; }
    if (enc.aliens.every(function (a) { return a.dead; })) endIncursion(false);
  }

  function nearest() {
    if (!enc) return null;
    var n = null;
    enc.aliens.forEach(function (a) { if (!a.dead && enc.t >= a.spawn && (n === null || a.d < n)) n = a.d; });
    return n;
  }

  // --- actions -------------------------------------------------------------------

  function act(name, now) {
    if (name === 'order') {
      if (st.order) say('REQUISITION ALREADY IN TRANSIT');
      else if (st.depot >= 4) say('DEPOT FULL');
      else { st.order = now + ORDER_MS; say('REQUISITION: 2 MAGAZINES, ETA 0:' + K.pad(ORDER_MS / 1000)); }
    } else if (name === 'dispatch') {
      if (st.loader) say(st.loader.name + ' IS ALREADY OUT');
      else if (st.armed) say('SENTRY IS ARMED. SAFE IT BEFORE SENDING ANYONE OUT', C.amber);
      else if (!st.depot) say('NOTHING IN THE DEPOT TO LOAD');
      else {
        var name2 = LOADERS[Math.floor(Math.random() * LOADERS.length)];
        st.loader = { name: name2, start: now, loaded: 0 };
        say(name2 + ': MOVING TO SENTRY A');
      }
    } else if (name === 'mag') {
      st.active = 1 - st.active;
      say('MAG ' + (st.active + 1) + ' SELECTED, ' + Math.floor(rounds()) + ' ROUNDS');
    } else if (name === 'arm') {
      if (!st.armed && st.loader) say('LOADER DOWNRANGE. CANNOT ARM', C.amber);
      else { st.armed = !st.armed; say('SENTRY A ' + (st.armed ? 'ARMED' : 'ON SAFE'), st.armed ? C.amber : C.text); }
    }
    flash = { name: name, at: now };
    save();
  }

  // --- drawing -------------------------------------------------------------------

  function polar(d, a) {
    var r = d / RANGE * R, rad = a * Math.PI / 180;
    return { x: CX + Math.cos(rad) * r, y: CY + Math.sin(rad) * r };
  }

  function arc(r, a0, a1, color, width) {
    var ctx = K.ctx;
    ctx.beginPath();
    ctx.arc(CX, CY, r, a0 * Math.PI / 180, a1 * Math.PI / 180);
    K.glowStroke(color, width);
  }

  // the parts of the tracker and sentry panel that never change
  function drawStatic() {
    var ctx = K.ctx, blue = C.line;
    frame(TR.x, TR.y, TR.w, TR.h);
    frame(SP.x, SP.y, SP.w, SP.h, C.amber);

    // tracker: outer rim in bracketed segments, inner rings, spokes with studs
    for (var s = 0; s < 6; s++) {
      var a0 = -180 + s * 30 + 2, a1 = a0 + 26;
      arc(R, a0, a1, blue, 2.5);
      arc(R - 18, a0 + 3, a1 - 3, C.lineDim, 1.5);
      [a0, a1].forEach(function (a) {
        var p = polar(RANGE, a), q = polar(RANGE * (R - 18) / R, a);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); K.glowStroke(blue, 2);
      });
    }
    arc(R * 0.62, -180, 0, C.lineDim, 1.5);
    for (var s2 = 0; s2 < 4; s2++) arc(R * 0.42, -165 + s2 * 40, -140 + s2 * 40, blue, 2);
    arc(R * 0.16, -180, 0, blue, 2);
    [-150, -120, -90, -60, -30].forEach(function (a) {
      var p = polar(RANGE * 0.16, a), q = polar(RANGE * 0.96, a);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); K.glowStroke(C.lineDim, 1.5);
      var m = polar(RANGE * 0.62, a);
      ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, Math.PI * 2); K.glowStroke(blue, 1.5);
    });
    // the gun's field, dashed
    ctx.save();
    ctx.setLineDash([6, 10]);
    arc(GUN_RANGE / RANGE * R, -180, 0, C.amber, 1);
    ctx.restore();
    var gl = polar(GUN_RANGE, -178);
    text('GUN', gl.x + 6, gl.y - 8, { size: 18, color: C.amber, spacing: 2, glow: false });

    // the bottom band, like the tracker's own readout strip
    ctx.fillStyle = 'rgba(47,140,224,0.22)';
    ctx.fillRect(TR.x + 2, CY + 6, TR.w - 4, 60);
    box(TR.x + 2, CY + 6, TR.w - 4, 60, C.lineDim, 1);
    text('F.R.M.S. 4.217.09', TR.x + 30, CY + 46, { size: 22, color: C.white, spacing: 2 });
    text('CX. 7/31.6', TR.x + TR.w - 30, CY + 46, { size: 22, color: C.white, spacing: 2, align: 'right' });

    // sentry title band
    var amber = C.amber;
    ctx.beginPath(); ctx.moveTo(SP.x, SP.y + 120); ctx.lineTo(SP.x + SP.w, SP.y + 120); K.glowStroke(amber, 2.5);
    ctx.beginPath(); ctx.arc(SP.x + 70, SP.y + 60, 42, 0, Math.PI * 2); K.glowStroke(amber, 2);
    text('A', SP.x + 70, SP.y + 78, { font: TITLE, size: 46, color: amber, align: 'center' });
    text('LD 567-C', SP.x + SP.w / 2 + 30, SP.y + 52, { size: 34, color: amber, spacing: 4, align: 'center' });
    text('REMOTE SENTRY WEAPON SYSTEM', SP.x + SP.w / 2 + 30, SP.y + 96, { size: 30, color: amber, spacing: 3, align: 'center' });

    text('ROUNDS', SP.x + 40, SP.y + 340, { size: 30, color: amber, spacing: 2 });
    text('REMAINING', SP.x + 40, SP.y + 376, { size: 30, color: amber, spacing: 2 });
    text('TIME AT 100%', SP.x + 40, SP.y + 494, { size: 28, color: amber, spacing: 2 });
    text('(SECS)', SP.x + 80, SP.y + 530, { size: 28, color: amber, spacing: 2 });

    // TEMP and R(M) scales
    [['TEMP', SP.x + 640], ['R(M)', SP.x + 770]].forEach(function (b) {
      text(b[0], b[1] + 10, SP.y + 170, { size: 26, color: amber, spacing: 2, align: 'center' });
      var top = SP.y + 190, bot = SP.y + 660;
      ctx.beginPath();
      ctx.moveTo(b[1] + 34, top); ctx.lineTo(b[1] + 34, bot); ctx.lineTo(b[1] - 30, bot);
      for (var i = 0; i <= 10; i++) {
        var y = top + (bot - top) * i / 10;
        ctx.moveTo(b[1] + 34, y); ctx.lineTo(b[1] + (i % 5 ? 24 : 16), y);
      }
      K.glowStroke(amber, 2);
    });
  }

  function drawTracker(t, now) {
    var ctx = K.ctx;
    // pulse ring
    var since = (sim - lastPulse);
    if (since < 0.9) {
      ctx.save();
      ctx.globalAlpha = 1 - since / 0.9;
      arc(R * since / 0.9, -180, 0, C.cyan, 2);
      ctx.restore();
    }
    // sentry
    var sp = polar(SENTRY_AT.d, SENTRY_AT.a);
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y - 12); ctx.lineTo(sp.x + 11, sp.y + 8); ctx.lineTo(sp.x - 11, sp.y + 8); ctx.closePath();
    if (firing && Math.floor(t / 60) % 2) { ctx.fillStyle = C.amber; ctx.fill(); }
    K.glowStroke(C.amber, 2);
    text('A', sp.x - 26, sp.y + 8, { size: 18, color: C.amber });
    // loader: a hollow square, friendly
    var lp = loaderPos(now);
    if (lp) {
      var p = polar(lp.d, lp.a);
      box(p.x - 7, p.y - 7, 14, 14, C.green, 2);
    }
    // contacts light up as the pulse passes and fade until the next one
    if (enc) {
      enc.aliens.forEach(function (a) {
        if (a.dead || enc.t < a.spawn || a.d > RANGE) return;
        var age = (sim - lastPulse) - a.d / RANGE * 0.9;
        if (age < 0) age += PULSE;
        var alpha = Math.max(0.15, 1 - age / PULSE);
        var q = polar(a.seen === undefined ? a.d : a.seen, a.a);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = C.white;
        ctx.shadowBlur = 30 * K.halo;
        ctx.fillStyle = C.white;
        ctx.beginPath(); ctx.arc(q.x, q.y, 16, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
    }
    // range readout
    var n = nearest();
    var label = n === null ? '--.--' : n.toFixed(2);
    ctx.fillStyle = '#000';
    ctx.fillRect(CX - 110, CY + 10, 220, 52);
    box(CX - 110, CY + 10, 220, 52, C.lineDim, 1);
    text(label, CX + 40, CY + 50, { font: TITLE, size: 30, color: n === null ? C.lineDim : C.red, align: 'right' });
    text('M', CX + 52, CY + 50, { size: 20, color: n === null ? C.lineDim : C.red });

    // log
    var y = TR.y + 50;
    text(enc ? 'MOVEMENT' : pendingAt !== null ? 'TRACKING' : 'NO MOVEMENT', TR.x + 30, y,
      { size: 26, spacing: 5, color: enc ? C.red : C.green });
    log.slice(-4).forEach(function (l, i) {
      K.fitText(l.text, TR.x + 30, y + 44 + i * 34, TR.w - 60, { size: 22, color: l.color, spacing: 1 });
    });
  }

  function drawSentry(t, now) {
    var ctx = K.ctx, amber = C.amber, x = SP.x, y = SP.y;
    // SAFE / ARMED: the live word sits in a solid band
    [['SAFE', !st.armed], ['ARMED', st.armed]].forEach(function (s, i) {
      var by = y + 150 + i * 70;
      if (s[1]) { ctx.fillStyle = amber; ctx.fillRect(x + 30, by, 420, 64); }
      text(s[0], x + 60, by + 52, { font: TITLE, size: 42, spacing: 8, color: s[1] ? '#000' : 'rgba(232,220,106,0.35)', glow: false });
    });

    var r = Math.ceil(rounds());
    // arrow + rounds box
    ctx.beginPath(); ctx.moveTo(x + 300, y + 316); ctx.lineTo(x + 340, y + 342); ctx.lineTo(x + 300, y + 368); ctx.closePath();
    ctx.fillStyle = amber; ctx.fill();
    box(x + 350, y + 296, 220, 100, amber, 2.5);
    var empty = r <= 0 && Math.floor(t / 400) % 2;
    text(K.pad(r, 3), x + 460, y + 374, { font: TITLE, size: 60, color: empty ? C.red : amber, align: 'center' });
    box(x + 350, y + 450, 220, 100, amber, 2.5);
    text((r / FIRE_RATE).toFixed(2), x + 460, y + 524, { font: TITLE, size: 50, color: amber, align: 'center' });

    // magazines
    [0, 1].forEach(function (i) {
      var my = y + 610 + i * 40, act = st.active === i;
      text((act ? '▶ ' : '  ') + 'MAG ' + (i + 1), x + 40, my, { size: 26, color: act ? C.white : amber, spacing: 2 });
      text(K.pad(Math.ceil(st.mags[i]), 3), x + 300, my, { size: 26, color: st.mags[i] > 0 ? (act ? C.white : amber) : C.red, align: 'right' });
    });
    text('DEPOT ' + st.depot, x + 560, y + 650, { size: 24, color: amber, spacing: 2, align: 'right' });

    // TEMP and R(M) bars
    var top = y + 190, bot = y + 660;
    K.fillBar(x + 618, bot - (bot - top) * temp, 40, (bot - top) * temp, amber);
    var rm = firing ? 0.85 + Math.random() * 0.1 : 0;
    if (rm) K.fillBar(x + 748, bot - (bot - top) * rm, 40, (bot - top) * rm, amber);
  }

  function status(name, now) {
    if (name === 'order') return st.order ? 'ETA 0:' + K.pad(Math.ceil((st.order - now) / 1000)) : 'DEPOT ' + st.depot;
    if (name === 'dispatch') {
      var L = st.loader;
      if (!L) return st.armed ? 'SAFE FIRST' : st.depot ? 'READY' : 'DEPOT EMPTY';
      var e = now - L.start;
      return e < WALK_MS ? 'MOVING OUT' : e < WALK_MS + LOAD_MS ? 'LOADING' : 'RETURNING';
    }
    if (name === 'mag') return 'MAG ' + (st.active + 1) + ' ACTIVE';
    return st.armed ? 'ARMED' : 'ON SAFE';
  }

  function drawActions(now) {
    var labels = { order: 'ORDER AMMO', dispatch: 'DISPATCH LOADER', mag: 'SWITCH MAG', arm: st.armed ? 'SAFE SENTRY' : 'ARM SENTRY' };
    var bw = (W - 192 - (ACTIONS.length - 1) * 24) / ACTIONS.length;
    ACTIONS.forEach(function (a, i) {
      var bx = 96 + i * (bw + 24), by = 890, foc = focus === i;
      var hit = flash && flash.name === a && now - flash.at < 150;
      if (foc) { K.ctx.fillStyle = hit ? 'rgba(79,245,216,0.4)' : 'rgba(79,245,216,0.14)'; K.ctx.fillRect(bx, by, bw, 92); }
      box(bx, by, bw, 92, foc ? C.cyan : C.line, foc ? 2.5 : 2);
      text(labels[a], bx + 24, by + 40, { size: 26, color: foc ? C.white : C.text, spacing: 3 });
      text(status(a, now), bx + 24, by + 76, { size: 20, color: a === 'arm' && st.armed ? C.amber : C.lineDim, spacing: 2, glow: false });
    });
  }

  // TV static: a few pre-made noise frames, smeared sideways like a weak
  // signal, flicked between, with broad bright bands sliding across
  var noise = null;
  function noiseFrames() {
    if (noise) return noise;
    noise = [];
    for (var f = 0; f < 5; f++) {
      var c = document.createElement('canvas');
      c.width = 240; c.height = 135;
      var g = c.getContext('2d'), img = g.createImageData(c.width, c.height), d = img.data;
      for (var y = 0; y < c.height; y++) {
        var v = 0, run = 0;
        for (var x = 0; x < c.width; x++) {
          if (run-- <= 0) { v = Math.random() * 255; run = Math.random() * 7; }
          var i = (y * c.width + x) * 4;
          d[i] = v * 0.55; d[i + 1] = v * 0.95; d[i + 2] = v * 0.85; d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      noise.push(c);
    }
    return noise;
  }

  function drawDead(wall) {
    var ctx = K.ctx, H = K.H, e = wall - dead.at;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    var frames = noiseFrames(), frame = frames[Math.floor(Math.random() * frames.length)];
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (e < DIE.static) {
      // full static, with tilted bands of brighter signal tearing through
      // smeared on a slant, like the film's dead monitors; the slant drifts
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-0.16 + Math.sin(e / 700) * 0.06);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(frame, -W * 0.7 + Math.random() * 40, -H * 0.8 + Math.random() * 20, W * 1.4, H * 1.6);
      ctx.restore();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#BFFFF0';
      for (var b = 0; b < 4; b++) {
        var y0 = ((e * (0.4 + b * 0.17) + b * 300) % (H + 600)) - 300, tilt = 160 + b * 40;
        ctx.beginPath();
        ctx.moveTo(0, y0); ctx.lineTo(W, y0 - tilt); ctx.lineTo(W, y0 - tilt + 90 + b * 30); ctx.lineTo(0, y0 + 90 + b * 30);
        ctx.fill();
      }
    } else if (e < DIE.static + DIE.line) {
      // the picture folds down into a bright horizontal line
      var p = (e - DIE.static) / DIE.line, h = Math.max(4, H * Math.pow(1 - p, 3));
      ctx.drawImage(frame, 0, H / 2 - h / 2, W, h);
      ctx.globalAlpha = Math.min(1, p * 2);
      ctx.fillStyle = '#E8FFFA';
      ctx.shadowColor = '#BFFFF0';
      ctx.shadowBlur = 30;
      ctx.fillRect(W * 0.04 * p, H / 2 - 3, W * (1 - 0.08 * p), 6);
    } else if (e < DIE.static + DIE.line + DIE.dot) {
      // the line pulls in to a dot that lingers and fades
      var q = (e - DIE.static - DIE.line) / DIE.dot;
      var lw = W * 0.92 * Math.max(0, 1 - q * 5);
      ctx.fillStyle = '#E8FFFA';
      ctx.shadowColor = '#BFFFF0';
      ctx.shadowBlur = 40;
      if (lw > 8) ctx.fillRect(W / 2 - lw / 2, H / 2 - 2, lw, 4);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, q - 0.2) / 0.8);
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, 7 * (1 - q * 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else if (e > DIE.static + DIE.line + DIE.dot + DIE.dark) {
      text('NO CARRIER', W / 2, H / 2, { size: 28, color: C.lineDim, spacing: 8, align: 'center', glow: false });
      text('OK  RECONNECT', W / 2, H / 2 + 50, { size: 20, color: C.lineDim, spacing: 4, align: 'center', glow: false });
    }
    ctx.restore();
  }

  function reconnect() {
    dead = null;
    log = [];
    say('FEED RESTORED. PERIMETER WAS BREACHED', C.red);
    say('SENTRY A ' + (st.armed ? 'ARMED' : 'ON SAFE') + '. ' + Math.ceil(rounds()) + ' ROUNDS IN MAG ' + (st.active + 1));
  }

  function draw(t, now) {
    var ctx = K.ctx, wall = Date.now();
    if (dead) { lastNow = wall; drawDead(wall); return; }
    var dt = lastNow ? Math.min(0.1, (wall - lastNow) / 1000) : 0;
    lastNow = wall;
    sim += dt;
    tickJobs(wall);
    if (pendingAt !== null && sim >= pendingAt) { pendingAt = null; startIncursion(); }
    if (enc) stepIncursion(dt); else firing = false;
    if (dead) { drawDead(wall); return; }
    if (window.Sound && Sound.gun) Sound.gun(on && firing);   // not during the transition out
    temp = Math.max(0, Math.min(1, temp + (firing ? 0.026 : -0.012) * dt));   // ~85% after a full magazine

    // the tracker pings at a steady beat; the contact beep keeps its own,
    // quicker and higher the closer the nearest one is
    if (sim - lastPulse >= PULSE) {
      lastPulse = sim;
      // each contact is drawn where it was when the pulse found it
      if (enc) enc.aliens.forEach(function (a) { a.seen = a.d; });
      if (on && window.Sound && Sound.trackerPing) Sound.trackerPing();
    }
    var nn = nearest();
    if (nn !== null) {
      var near = Math.max(0, Math.min(1, 1 - nn / RANGE));
      if (sim - lastBeep >= BEEP_FAR - (BEEP_FAR - BEEP_NEAR) * near) {
        lastBeep = sim;
        if (on && window.Sound && Sound.trackerContact) Sound.trackerContact(near);
      }
    }

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, K.H);
    K.header('SENTRY // LD 567-C', now);
    K.cached('sentry', 'static', drawStatic);
    drawTracker(t, wall);
    drawSentry(t, wall);
    drawActions(wall);
    text('STATUS: PERIMETER ' + (enc ? 'CONTACT' : 'QUIET') + '  //  SENTRY A ' + (st.armed ? 'ARMED' : 'SAFE'),
      96, 1030, { size: 22, color: enc ? C.red : C.text, spacing: 2 });
    text('←→ SELECT   OK EXECUTE   BACK', W - 96, 1030, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }

  function key(code) {
    if (dead) {
      if (code === 13 && Date.now() - dead.at > DIE.static + DIE.line + DIE.dot) { reconnect(); return true; }
      return code === 37 || code === 39 || code === 13;   // BACK still leaves
    }
    switch (code) {
      case 37: focus = (focus + ACTIONS.length - 1) % ACTIONS.length; return true;
      case 39: focus = (focus + 1) % ACTIONS.length; return true;
      case 13: act(ACTIONS[focus], Date.now()); return true;
    }
    return false;
  }

  function reset() {
    on = true;
    lastNow = 0;
    st = load();
    if (!log.length) say('SENTRY A ONLINE. ' + Math.ceil(rounds()) + ' ROUNDS IN MAG ' + (st.active + 1));
    // contacts only come while someone's watching, and not too often
    if (!enc && pendingAt === null && Date.now() - st.last > COOLDOWN_MS && Math.random() < CHANCE) {
      pendingAt = sim + 6 + Math.random() * 18;
    }
  }

  function leave() {
    on = false;
    firing = false;
    if (window.Sound && Sound.gun) Sound.gun(false);
    save();
  }

  window.Sentry = { draw: draw, key: key, reset: reset, leave: leave };
})();
