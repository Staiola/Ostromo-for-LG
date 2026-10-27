// Home screen: streaming apps, HDMI inputs and a telemetry column with a mini
// radar. The launcher itself, MU-TH-UR style.
(function () {
  'use strict';

  var W = K.W, C = K.C;
  var text = K.text;

  // The grid, row by row (5 per row): three viewing apps from SETUP, then
  // two of the system's own screens. An empty slot is null.
  var SETUP = window.Settings.get();
  function viewing(i) { var k = SETUP.viewing[i]; return k === 'none' ? null : window.Settings.APPS[k]; }
  var APPS = [
    viewing(0), viewing(1), viewing(2),
    { name: 'COMMS', code: 'NTS', screen: 'radio', foot: 'NTS LIVE' },
    { name: 'OUTPOSTS', code: 'SAT', screen: 'outposts', foot: 'ICE · CITY · ABYSS' },
    viewing(3), viewing(4), viewing(5),
    SETUP.teletext !== 'off' ? { name: 'TELETEXT', code: 'TXT', screen: 'teletext', foot: window.Settings.TELETEXT[SETUP.teletext].name } : null,
    { name: 'SENTRY', code: 'LD', screen: 'sentry', foot: 'LD 567-C' }
  ];
  var VIEW_COLS = 3; // columns 0-2 are viewing apps, 3-4 the system's screens
  var LINKED = APPS.filter(function (a, i) { return a && i % 5 < VIEW_COLS; }).length;
  // two input tiles; one switched off in SETUP is null
  var INPUTS = SETUP.inputs.map(function (inp) {
    if (inp.device === 'off') return null;
    return { name: inp.device, port: 'HDMI ' + inp.port, id: 'com.webos.app.hdmi' + inp.port };
  });
  var POWER_AREA = (window.UNTERFACE_POWER && window.UNTERFACE_POWER.area) || 'OFF';
  var IATA = (window.UNTERFACE_AIRPORT || window.AIRPORTS.EKCH).iata;
  // which grid columns each input tile covers (the row has 5 columns)
  var INPUT_COLS = [[0, 1], [2, 3, 4]];

  var LEFT = { x: 96, y: 136, w: 410, h: 844 };
  var MAIN = { x: 530, y: 136, w: 1294, h: 844 };
  var COLS = 5, GAP = 22, PADX = 34;
  var INPUT_W = (MAIN.w - PADX * 2 - GAP) / 2;
  var SPLIT = 36; // extra space between the viewing and system groups
  var TILE_W = (MAIN.w - PADX * 2 - GAP * (COLS - 1) - SPLIT) / COLS;
  var TILE_H = 150;
  var GRID_X = MAIN.x + PADX;
  var ROW_Y = [MAIN.y + 86, MAIN.y + 86 + TILE_H + GAP, MAIN.y + 494];
  var MINI = { x: LEFT.x + LEFT.w / 2, y: LEFT.y + 554, r: 150 };
  var POWER = { x: LEFT.x + 20, y: LEFT.y + 234, w: LEFT.w - 40, h: 152 };

  // focus: row 0-1 apps, row 2 inputs; col -1 is the telemetry column
  // (row 0 the power block, below it the mini radar)
  var focus = { row: 0, col: 0 };
  var ghost = null; // where focus just was, for a one-frame phosphor trail
  var exec = null;  // the running EXECUTE overlay
  var bootedAt = Date.now();

  function itemAt(row, col) {
    if (row < 0) return { kind: 'settings' };
    if (col < 0) return { kind: row === 0 ? 'power' : 'radar' };
    if (row < 2) {
      var a = APPS[row * COLS + col];
      if (!a) return { kind: 'empty' };
      return { kind: a.screen || 'app', item: a, index: row * COLS + col };
    }
    var i = inputAt(col);
    if (!INPUTS[i]) return { kind: 'empty' };
    return { kind: 'input', item: INPUTS[i], index: i };
  }

  // the two input tiles split the row in half: cols 0-1 and 2-4
  function inputAt(col) {
    for (var i = 0; i < INPUT_COLS.length; i++) if (INPUT_COLS[i].indexOf(col) >= 0) return i;
    return 0;
  }

  // the SETUP chip, top right of the main panel; ↑ from the top row
  var CHIP = { x: MAIN.x + MAIN.w - PADX - 170, y: MAIN.y + 26, w: 170, h: 44 };

  function rectOf(row, col) {
    if (row < 0) return CHIP;
    if (col < 0 && row === 0) return POWER;
    if (col < 0) return { x: MINI.x - MINI.r, y: MINI.y - MINI.r, w: MINI.r * 2, h: MINI.r * 2 };
    if (row < 2) return { x: GRID_X + col * (TILE_W + GAP) + (col >= VIEW_COLS ? SPLIT : 0), y: ROW_Y[row], w: TILE_W, h: TILE_H };
    var i = inputAt(col);
    return { x: GRID_X + i * (INPUT_W + GAP), y: ROW_Y[2], w: INPUT_W, h: TILE_H };
  }

  function moveFocus(dRow, dCol) {
    var before = rectOf(focus.row, focus.col);
    var row = focus.row, col = focus.col;
    if (dCol) {
      if (row < 0) return;
      if (row === 2 && col >= 0) {
        var to = inputAt(col) + dCol;
        col = to < 0 ? -1 : to >= INPUTS.length ? col : INPUT_COLS[to][0];
      }
      else col += dCol;
      col = Math.max(-1, Math.min(COLS - 1, col));
    }
    if (col < 0) row = Math.min(row, 1);
    if (dRow) row = Math.max(col < 0 ? 0 : -1, Math.min(col < 0 ? 1 : 2, row + dRow));
    if (row === focus.row && col === focus.col) return;
    focus = { row: row, col: col };
    ghost = { rect: before, at: Date.now() };
  }

  // --- launching -------------------------------------------------------------

  function resolveAppIds() {
    K.luna('luna://com.webos.applicationManager/listLaunchPoints', {})
      .then(function (res) {
        var points = res.launchPoints || [];
        APPS.forEach(function (app) {
          if (!app || !app.match || points.some(function (p) { return p.id === app.id; })) return;
          var found = points.filter(function (p) { return app.match.test(p.title || ''); })[0];
          if (found) app.id = found.id;
        });
      })
      .catch(function () {});
  }

  function execute(target) {
    if (target.kind === 'empty') return;
    if (target.kind !== 'app' && target.kind !== 'input') { window.Shell.go(target.kind); return; }
    var item = target.item;
    exec = { name: item.name, id: item.id, at: Date.now(), result: null };
    setTimeout(function () {
      K.luna('luna://com.webos.applicationManager/launch', { id: item.id })
        .then(function () { if (exec) exec.result = 'OK'; })
        .catch(function (err) {
          if (!exec) return;
          exec.result = err instanceof Error ? 'SIM' : 'FAIL';
        });
    }, 900);
  }

  function key(code) {
    if (exec) {
      if (code === 461 || code === 27 || code === 8) { exec = null; return true; }
      return true;
    }
    switch (code) {
      case 37: moveFocus(0, -1); break;
      case 39: moveFocus(0, 1); break;
      case 38: moveFocus(-1, 0); break;
      case 40: moveFocus(1, 0); break;
      case 13: execute(itemAt(focus.row, focus.col)); break;
      default: return false;
    }
    return true;
  }

  // --- drawing ---------------------------------------------------------------

  function sectionLabel(str, count, x, y) {
    var w = text(str, x, y, { size: 22, color: C.amber, spacing: 5 });
    K.ctx.fillStyle = C.amber;
    K.ctx.fillRect(x, y + 8, w, 2);
    text(count, x + w + 24, y, { size: 22, color: C.lineDim, spacing: 2, glow: false });
  }

  function hdmiGlyph(x, y) {
    var ctx = K.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + 70, y); ctx.lineTo(x + 70, y + 16);
    ctx.lineTo(x + 60, y + 28); ctx.lineTo(x + 10, y + 28); ctx.lineTo(x, y + 16);
    ctx.closePath();
    K.glowStroke(C.line, 2);
    ctx.beginPath();
    for (var i = 0; i < 6; i++) { ctx.moveTo(x + 14 + i * 8.5, y + 8); ctx.lineTo(x + 14 + i * 8.5, y + 16); }
    K.glowStroke(C.lineDim, 2);
  }

  // vacant: an empty channel slot, dim and with nothing to execute
  function tile(r, focused, top, topRight, name, foot, t, vacant) {
    var bright = vacant ? C.lineDim : focused ? C.white : C.text;
    if (focused) {
      K.frame(r.x, r.y, r.w, r.h, C.cyan);
      K.brackets(r.x, r.y, r.w, r.h, C.pink);
    } else {
      K.box(r.x, r.y, r.w, r.h, C.lineDim, 2);
    }
    text(top, r.x + 22, r.y + 40, { size: 22, color: focused ? C.amber : C.lineDim, spacing: 2, glow: focused ? 8 : false });
    if (topRight) text(topRight, r.x + r.w - 22, r.y + 40, { size: 22, color: C.lineDim, align: 'right', spacing: 2, glow: false });
    K.fitText(name, r.x + 22, r.y + 98, r.w - 44, { font: K.TITLE, size: 30, color: bright, spacing: 3, glow: focused ? 14 : 6 });
    if (focused && !vacant) {
      var eo = { size: 22, color: C.cyan, spacing: 3 };
      var lw = text('▸ EXECUTE', r.x + 26, r.y + r.h - 20, eo);
      blinks.push({ str: '█', x: r.x + 26 + lw + 3, y: r.y + r.h - 20, opts: eo });
      K.box(r.x + 16, r.y + r.h - 44, K.measure('▸ EXECUTE█', eo) + 22, 32, C.cyan, 2);
    } else {
      text(foot, r.x + 22, r.y + r.h - 18, { size: 22, color: C.lineDim, spacing: 2, glow: false });
    }
  }

  function drawLeft(now, t) {
    K.frame(LEFT.x, LEFT.y, LEFT.w, LEFT.h);
    var x = LEFT.x + 34;
    sectionLabel('TELEMETRY', '', x, LEFT.y + 58);

    var hm = K.hhmm(now);
    var w = text(hm, x, LEFT.y + 160, { font: K.TITLE, size: 64, color: C.white, spacing: 4, glow: 14 });
    text(':' + K.pad(now.getSeconds()), x + w + 6, LEFT.y + 160, { size: 34, color: C.text });
    var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    text(days[now.getDay()] + ' ' + K.pad(now.getDate()) + ' ' + months[now.getMonth()] + ' ' + now.getFullYear(),
      x, LEFT.y + 206, { size: 24, color: C.text, spacing: 3 });

    var power = window.Power.summary();
    var ink = !power ? C.text : power.band === 'HIGH' ? C.red : power.band === 'LOW' ? C.green : C.white;
    field(window.Power.UNIT, power ? window.Power.format(power.now) : '----', x, LEFT.y + 268, ink);
    field('OPTIMAL', power && power.cheapest ? power.cheapest : '--:--', x, LEFT.y + 316, C.green);
    field('TRAFFIC', K.pad(window.Radar.flights().length) + ' AC', x, LEFT.y + 364);
    if (focus.col < 0 && focus.row === 0) K.brackets(POWER.x, POWER.y, POWER.w, POWER.h, C.pink, 22, 6);

    var focused = focus.col < 0 && focus.row > 0;
    if (focused) K.brackets(MINI.x - MINI.r, MINI.y - MINI.r, MINI.r * 2, MINI.r * 2, C.pink, 26, 14);
    text(IATA + ' TRAFFIC', MINI.x, MINI.y + MINI.r + 52, { size: 22, color: focused ? C.white : C.text, spacing: 4, align: 'center' });
    text(focused ? '▸ OPEN RADAR' : 'RADAR · BLUE', MINI.x, MINI.y + MINI.r + 88,
      { size: 22, color: focused ? C.cyan : C.lineDim, spacing: 3, align: 'center', glow: focused ? 10 : false });
  }

  function field(label, value, x, y, color) {
    text(label, x, y, { size: 22, color: C.text, spacing: 2 });
    var right = LEFT.x + LEFT.w - 34;
    var vw = text(value, right - 10, y, { size: 24, color: color || C.white, align: 'right' });
    K.box(right - vw - 22, y - 25, vw + 22, 34, C.line, 2);
  }

  function drawMain(t) {
    K.frame(MAIN.x, MAIN.y, MAIN.w, MAIN.h);
    var sys = rectOf(0, VIEW_COLS);
    sectionLabel('VIEWING', '// ' + K.pad(LINKED) + ' LINKED', GRID_X, MAIN.y + 58);
    var chipOn = focus.row < 0;
    if (chipOn) { K.frame(CHIP.x, CHIP.y, CHIP.w, CHIP.h, C.cyan); K.brackets(CHIP.x, CHIP.y, CHIP.w, CHIP.h, C.pink, 14, 6); }
    else K.box(CHIP.x, CHIP.y, CHIP.w, CHIP.h, C.lineDim, 2);
    text('SETUP', CHIP.x + CHIP.w / 2, CHIP.y + 30, { size: 22, color: chipOn ? C.white : C.text, spacing: 4, align: 'center' });
    sectionLabel('SYSTEMS', '', sys.x, MAIN.y + 58);
    // a dashed rule between the two groups
    var ctx = K.ctx, dx = sys.x - (SPLIT + GAP) / 2;
    ctx.setLineDash([3, 9]);
    ctx.beginPath(); ctx.moveTo(dx, ROW_Y[0]); ctx.lineTo(dx, ROW_Y[1] + TILE_H);
    K.glowStroke(C.lineDim, 2);
    ctx.setLineDash([]);
    for (var i = 0; i < COLS * 2; i++) {
      var row = Math.floor(i / COLS), col = i % COLS;
      var app = APPS[i], on = focus.row === row && focus.col === col;
      if (!app) { tile(rectOf(row, col), on, 'CH ' + K.pad(i + 1), '', 'NO CARRIER', '------', t, true); continue; }
      var foot = app.screen === 'radio' && window.Radio.nowPlaying() ? 'RX LOCKED' : app.foot || 'SVC READY';
      tile(rectOf(row, col), on, 'CH ' + K.pad(i + 1), app.code, app.name, foot, t);
    }

    sectionLabel('INPUTS', '// HDMI', GRID_X, ROW_Y[2] - 28);
    INPUTS.forEach(function (input, i) {
      var r = rectOf(2, INPUT_COLS[i][0]);
      var focused = focus.row === 2 && focus.col >= 0 && inputAt(focus.col) === i;
      if (!input) { tile(r, focused, 'HDMI --', '', 'NO SOURCE', 'SET IN SETUP', t, true); return; }
      tile(r, focused, input.port, '', input.name, 'SOURCE ' + input.port.replace(' ', ''), t);
      hdmiGlyph(r.x + r.w - 110, r.y + 70);
    });

    drawReadout(t);
  }

  // Nostromo-style status line for whatever has focus
  function drawReadout(t) {
    var y = ROW_Y[2] + TILE_H + 40, x = GRID_X, w = MAIN.w - PADX * 2, h = 110;
    K.box(x, y, w, h, C.line, 2);
    var target = itemAt(focus.row, focus.col);
    var NAMES = { settings: 'SYSTEM SETUP', radar: IATA + ' RADAR', power: 'POWER GRID ' + POWER_AREA, radio: 'COMMS // NTS LIVE', outposts: 'OUTPOST MONITOR',
      teletext: 'TELETEXT // ' + (window.Settings.TELETEXT[SETUP.teletext].short || ''), tv: 'VISUAL FEED // DR', sentry: 'SENTRY // LD 567-C', empty: 'NO CARRIER' };
    var IDS = { settings: 'CONFIG', radar: 'SCREEN 02', power: 'SCREEN 03', radio: 'BROADCAST RX', outposts: 'REMOTE NET',
      teletext: window.Settings.TELETEXT[SETUP.teletext].name || 'TELETEXT', tv: 'DR BROADCAST NET', sentry: 'PERIMETER DEFENCE', empty: '----' };
    var name = NAMES[target.kind] || target.item.name;
    var id = IDS[target.kind] || target.item.id;
    var io = { size: 30, color: C.white, spacing: 2 };
    var iw = text('>INQUIRY: ' + name, x + 26, y + 48, io);
    blinks.push({ str: '_', x: x + 26 + iw + 2, y: y + 48, opts: io });
    text('TARGET ID  ' + id.toUpperCase(), x + 26, y + 86, { size: 22, color: C.text, spacing: 2 });
    var kind = { settings: 'CONFIGURATION', app: 'STREAMING SERVICE', input: 'EXTERNAL SOURCE', power: 'GRID MONITOR', radar: 'TRAFFIC DISPLAY',
      radio: 'SIGNAL INTERCEPT', outposts: 'REMOTE FEEDS', teletext: 'TEXT SERVICE', tv: 'LIVE BROADCAST', sentry: 'DEFENCE GRID',
      empty: 'CHANNEL VACANT' }[target.kind];
    text(kind, x + w - 26, y + 48, { size: 22, color: C.amber, spacing: 3, align: 'right' });
    text('OK ▸ EXECUTE', x + w - 26, y + 86, { size: 22, color: C.cyan, spacing: 3, align: 'right' });
  }

  function drawGhost() {
    if (!ghost) return;
    var age = Date.now() - ghost.at;
    if (age > 140) { ghost = null; return; }
    var r = ghost.rect;
    K.ctx.save();
    K.ctx.globalAlpha = 0.5 * (1 - age / 140);
    K.brackets(r.x, r.y, r.w, r.h, C.pink);
    K.ctx.restore();
  }

  var ticker = null;
  function tickerStrip(line) {
    var w = K.measure(line, { size: 22, spacing: 2 });
    var c = document.createElement('canvas');
    c.width = Math.ceil((w * 2 + 40) * K.S);
    c.height = Math.ceil(44 * K.S);
    c.getContext('2d').setTransform(K.S, 0, 0, K.S, 0, 0);
    K.into(c, function () { text(line + line, 0, 30, { size: 22, color: C.text, spacing: 2, glow: false }); });
    return { line: line, w: w, canvas: c };
  }

  function drawTicker(t) {
    var deps = window.Radar.board('DEP').slice(0, 3).map(function (f) {
      return 'DEP ' + f.cs + ' ▸ ' + f.city + ' ' + (f.time ? K.hhmm(f.time) : '--:--') + ' ' + f.status;
    });
    var arrs = window.Radar.board('ARR').slice(0, 3).map(function (f) {
      return 'ARR ' + f.cs + ' ◂ ' + f.city + ' ' + (f.time ? K.hhmm(f.time) : '--:--') + ' ' + f.status;
    });
    var line = deps.concat(arrs).join('   //   ') + '   //   ';
    var x0 = 96, clipW = 1130, y = 1030;
    // the line is drawn once into a strip and the strip slides; drawing a
    // few thousand pixels of spaced text every frame cost a frame's worth
    if (!ticker || ticker.line !== line) ticker = tickerStrip(line);
    var off = (t * 0.06) % ticker.w;
    var ctx = K.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y - 30, clipW, 44);
    ctx.clip();
    ctx.drawImage(ticker.canvas, x0 - off, y - 30, ticker.canvas.width / K.S, 44);
    ctx.restore();
    text('OK EXECUTE   ● GREEN POWER   ● BLUE RADAR', W - 96, y, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }

  function drawExec() {
    if (!exec) return;
    var age = Date.now() - exec.at;
    var ctx = K.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.fillRect(0, 0, W, K.H);
    ctx.restore();
    var w = 860, h = 300, x = (W - w) / 2, y = (K.H - h) / 2;
    ctx.fillStyle = C.bg;
    ctx.fillRect(x, y, w, h);
    K.frame(x, y, w, h, C.cyan);
    var line = '>EXECUTE ' + exec.name;
    var count = Math.min(line.length, Math.floor(age / 42)); // one letter per writing blip
    if (count > (exec.typed || 0)) { exec.typed = count; window.Sound.key(); }
    if (exec.result && !exec.chimed) { exec.chimed = true; window.Sound.done(); }
    var shown = line.slice(0, count);
    var cursor = Math.floor(age / 530) % 2 ? '█' : '';
    text(shown + cursor, x + 50, y + 92, { font: K.TITLE, size: 34, color: C.white, spacing: 4, glow: 12 });
    text('TARGET ' + exec.id.toUpperCase(), x + 50, y + 140, { size: 22, color: C.text, spacing: 2 });
    // block progress bar
    var blocks = 24, filled = Math.min(blocks, Math.floor(age / 900 * blocks));
    for (var i = 0; i < blocks; i++) {
      var bx = x + 50 + i * 32;
      if (i < filled) K.fillBar(bx, y + 168, 24, 26, C.cyan);
      else K.box(bx, y + 168, 24, 26, C.lineDim, 2);
    }
    var msg = 'TRANSFERRING CONTROL...', color = C.text;
    if (exec.result === 'OK') { msg = 'CONTROL TRANSFERRED'; color = C.green; }
    if (exec.result === 'SIM') { msg = 'NOT ON WEBOS // SIMULATION ONLY'; color = C.red; }
    if (exec.result === 'FAIL') { msg = 'TARGET NOT FOUND ON THIS UNIT'; color = C.red; }
    text(msg, x + 50, y + 250, { size: 24, color: color, spacing: 3 });
    if (exec.result && age > 3200) exec = null;
  }

  // everything that only changes per second, per blink or per key press
  // blinking cursors, drawn over the cached layer so the blink doesn't redraw it
  var blinks = [];

  function drawStill(t, now) {
    var ctx = K.ctx;
    blinks = [];
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, K.H);
    K.header('>OSTROMO // MA-TH-OR 6200', now);
    drawLeft(now, t);
    drawMain(t);
  }

  function draw(t, now) {
    var power = window.Power.summary();
    var key = [focus.row, focus.col, Math.floor(now.getTime() / 1000),
      power ? power.now.toFixed(2) + power.cheapest : '', window.Radar.flights().length,
      window.Radio.nowPlaying() || ''].join('|');
    K.cached('home', key, function () { drawStill(t, now); });
    // moving parts, every frame
    if (Math.floor(t / 530) % 2) blinks.forEach(function (b) { text(b.str, b.x, b.y, b.opts); });
    window.Radar.drawMini(MINI.x, MINI.y, MINI.r, t);
    drawGhost();
    drawTicker(t);
    drawExec();
  }

  resolveAppIds();

  window.Home = { draw: draw, key: key };
})();
