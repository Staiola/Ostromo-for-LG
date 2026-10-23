// Power screen: what a kWh costs right now in DK2, today and tomorrow.
// Spot price (15-min) and every tariff come from Energi Data Service, fetched
// through the app's service because the API doesn't answer browsers directly.
(function () {
  'use strict';

  var W = K.W, C = K.C, TITLE = K.TITLE;
  var text = K.text, box = K.box, frame = K.frame, pad = K.pad;

  // The region, grid company and supplier come from SETUP (settings.js). With
  // power switched off there is nothing to fetch and the screen says so.
  var CFG = window.UNTERFACE_POWER || { off: true };

  var SPOT_REFRESH_MS = 30 * 60 * 1000;  // tomorrow's prices land around 13:00
  var TARIFF_REFRESH_MS = 12 * 3600 * 1000;
  var WINDOW_SLOTS = 12; // 3 hours of 15-minute slots

  var spot = [];        // [{ t: Date, kwh: spot kr/kWh }]
  var tariffs = [];     // DatahubPricelist records we care about
  var slots = [];       // [{ t, spot, grid, energinet, tax, markup, vat, total, peak }]
  var lastError = null;
  var cursor = null;    // a slot index the viewer has scrubbed to, or null for now

  // --- data ------------------------------------------------------------------

  function q(dataset, params) {
    var query = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return K.data('eds', { dataset: dataset, query: query }).then(function (j) { return j.records || []; });
  }

  function dayString(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function loadSpot() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var end = new Date(today.getTime() + 2 * 86400000);
    return q('DayAheadPrices', {
      start: dayString(today) + 'T00:00', end: dayString(end) + 'T00:00',
      filter: JSON.stringify({ PriceArea: [CFG.area] }), sort: 'TimeUTC asc', limit: 400
    }).then(function (rows) {
      spot = rows.map(function (r) { return { t: new Date(r.TimeUTC + 'Z'), kwh: r.DayAheadPriceDKK / 1000 }; });
    });
  }

  function loadTariffs() {
    // without a grid company there is no nettarif to look up
    var gridQuery = CFG.gridOwner ? q('DatahubPricelist', {
      filter: JSON.stringify({ ChargeOwner: [CFG.gridOwner], ChargeTypeCode: [CFG.gridCode] }),
      sort: 'ValidFrom desc', limit: 12
    }) : Promise.resolve([]);
    return gridQuery.then(function (grid) {
      return q('DatahubPricelist', {
        filter: JSON.stringify({ ChargeTypeCode: ['40000', '41000', 'EA-001'] }),
        sort: 'ValidFrom desc', limit: 20
      }).then(function (state) { tariffs = grid.concat(state); });
    });
  }

  // the record of this code valid at time t, priced for that local hour
  function tariffAt(code, owner, t) {
    for (var i = 0; i < tariffs.length; i++) {
      var r = tariffs[i];
      if (r.ChargeTypeCode !== code || (owner && r.ChargeOwner !== owner)) continue;
      var from = new Date(r.ValidFrom), to = r.ValidTo ? new Date(r.ValidTo) : null;
      if (t < from || (to && t >= to)) continue;
      var p = r['Price' + (t.getHours() + 1)];
      return p === null || p === undefined ? r.Price1 : p;
    }
    return 0;
  }

  var version = 0; // bumps whenever slots change, so the cached screen redraws

  function rebuild() {
    version++;
    slots = spot.map(function (s) {
      var grid = tariffAt(CFG.gridCode, CFG.gridOwner, s.t);
      var energinet = tariffAt('40000', null, s.t) + tariffAt('41000', null, s.t);
      var tax = tariffAt('EA-001', null, s.t);
      var ex = s.kwh + grid + energinet + tax + CFG.supplierMarkup;
      var h = s.t.getHours();
      return {
        t: s.t, spot: s.kwh, grid: grid, energinet: energinet, tax: tax,
        markup: CFG.supplierMarkup, vat: ex * CFG.vat, total: ex * (1 + CFG.vat),
        peak: !!CFG.gridOwner && h >= 17 && h < 21   // the grid company's peak hours
      };
    });
  }

  function refreshSpot() {
    loadSpot().then(function () { lastError = null; rebuild(); })
      .catch(function (e) { lastError = e; })
      .then(function () { setTimeout(refreshSpot, SPOT_REFRESH_MS); });
  }

  function refreshTariffs() {
    loadTariffs().then(rebuild)
      .catch(function (e) { lastError = e; })
      .then(function () { setTimeout(refreshTariffs, TARIFF_REFRESH_MS); });
  }

  // --- derived numbers -------------------------------------------------------

  function nowIndex() {
    var now = Date.now();
    for (var i = slots.length - 1; i >= 0; i--) if (slots[i].t.getTime() <= now) return i;
    return -1;
  }

  // cheapest 3-hour block that hasn't started yet (or starts now)
  function cheapestWindow() {
    var from = Math.max(0, nowIndex());
    var best = null;
    for (var i = from; i + WINDOW_SLOTS <= slots.length; i++) {
      var sum = 0;
      for (var j = 0; j < WINDOW_SLOTS; j++) sum += slots[i + j].total;
      if (!best || sum < best.sum) best = { start: i, sum: sum };
    }
    if (!best) return null;
    return { start: best.start, end: best.start + WINDOW_SLOTS, avg: best.sum / WINDOW_SLOTS };
  }

  // Derived numbers only change with new data or the clock, but the home
  // screen asks every frame: recomputing them cost ~12 ms a frame on the TV.
  var memo = {};
  function memoized(name, compute) {
    var k = version + ':' + Math.floor(Date.now() / 60000);
    if (!memo[name] || memo[name].k !== k) memo[name] = { k: k, v: compute() };
    return memo[name].v;
  }

  function todayStats() { return memoized('today', computeTodayStats); }

  function computeTodayStats() {
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var from = d0.getTime(), to = from + 86400000;
    var list = slots.filter(function (s) { var ms = s.t.getTime(); return ms >= from && ms < to; });
    if (!list.length) return null;
    var min = list[0], max = list[0], sum = 0;
    list.forEach(function (s) { if (s.total < min.total) min = s; if (s.total > max.total) max = s; sum += s.total; });
    return { min: min, max: max, avg: sum / list.length, sorted: list.map(function (s) { return s.total; }).sort(function (a, b) { return a - b; }) };
  }

  // where a price sits within today's spread: 'LOW' | 'MID' | 'HIGH'
  function band(price) {
    var st = todayStats();
    if (!st) return 'MID';
    var lo = st.sorted[Math.floor(st.sorted.length * 0.25)], hi = st.sorted[Math.floor(st.sorted.length * 0.75)];
    return price <= lo ? 'LOW' : price >= hi ? 'HIGH' : 'MID';
  }

  function kr(v) { return v.toFixed(2); }
  function hm(d) { return K.hhmm(d); }

  // --- drawing ---------------------------------------------------------------

  var LEFT = { x: 96, y: 136, w: 540, h: 844 };
  var CHART = { x: 660, y: 136, w: 1164, h: 844 };
  var PLOT = { x0: CHART.x + 110, x1: CHART.x + CHART.w - 46, y0: CHART.y + 120, y1: CHART.y + CHART.h - 170 };

  function field(label, value, x, y, w, color) {
    text(label, x, y, { size: 22, color: C.text, spacing: 2 });
    var vw = text(value, x + w - 10, y, { size: 24, color: color || C.white, align: 'right' });
    box(x + w - vw - 22, y - 25, vw + 22, 34, C.line, 2);
  }

  function drawReadout() {
    frame(LEFT.x, LEFT.y, LEFT.w, LEFT.h);
    var x = LEFT.x + 34, w = LEFT.w - 68;
    var i = cursor !== null ? cursor : nowIndex();
    var s = slots[i];
    var label = cursor !== null ? 'SLOT ' + hm(s.t) + ' // ' + CFG.area : 'NOW // ' + CFG.area;
    var lw = text(label, x, LEFT.y + 58, { size: 22, color: C.amber, spacing: 5 });
    K.ctx.fillStyle = C.amber;
    K.ctx.fillRect(x, LEFT.y + 66, lw, 2);
    if (!s) {
      text(lastError ? 'NO SIGNAL' : 'ACQUIRING...', x, LEFT.y + 200, { font: TITLE, size: 48, color: C.text, spacing: 4 });
      return;
    }

    var pw = text(kr(s.total), x, LEFT.y + 196, { font: TITLE, size: 104, color: C.white, spacing: 4, glow: 14 });
    text('KR/KWH', x + pw + 16, LEFT.y + 196, { size: 26, color: C.text, spacing: 3 });
    var next = slots[i + 1];
    if (next) {
      var arrow = next.total > s.total + 0.005 ? '▲' : next.total < s.total - 0.005 ? '▼' : '■';
      text(arrow + ' NEXT 15 MIN  ' + kr(next.total), x, LEFT.y + 244, { size: 24, color: C.text, spacing: 2 });
    }

    var y = LEFT.y + 316;
    field('SPOT', kr(s.spot), x, y, w);
    field(s.peak ? 'NETTARIF  PEAK' : 'NETTARIF', kr(s.grid), x, y + 46, w, s.peak ? C.red : null);
    field('ENERGINET', kr(s.energinet), x, y + 92, w);
    field('ELAFGIFT', kr(s.tax), x, y + 138, w);
    field(CFG.supplierName, CFG.supplierMarkup ? kr(s.markup) : 'N/A', x, y + 184, w);
    field('MOMS 25%', kr(s.vat), x, y + 230, w);

    // status pill, "NOT DEEPNAV PRECISE" style
    var by = LEFT.y + 610, b = band(s.total);
    box(x, by - 26, w, 36, b === 'HIGH' ? C.red : C.line, 2);
    if (b === 'HIGH') {
      var nw = text('NOT', x + 14, by, { size: 22, color: C.red, spacing: 2 });
      text(' ECONOMICAL // DEFER LOAD', x + 14 + nw, by, { size: 22, color: C.white, spacing: 1 });
    } else if (b === 'LOW') {
      text('OPTIMAL // RUN LOADS', x + 14, by, { size: 22, color: C.green, spacing: 2 });
    } else {
      text('NOMINAL // STANDARD RATE', x + 14, by, { size: 22, color: C.text, spacing: 2 });
    }

    var win = cheapestWindow(), st = todayStats();
    if (win) field('OPTIMAL 3H', hm(slots[win.start].t) + '-' + hm(new Date(slots[win.end - 1].t.getTime() + 900000)), x, LEFT.y + 690, w, C.green);
    if (st) {
      field('PEAK TODAY', hm(st.max.t) + '  ' + kr(st.max.total), x, LEFT.y + 736, w);
      field('AVG TODAY', kr(st.avg), x, LEFT.y + 782, w);
    }
  }

  function drawChart(t) {
    frame(CHART.x, CHART.y, CHART.w, CHART.h);
    var x = CHART.x + 34;
    var tw = text('KR/KWH INCL. TARIFFS + MOMS', x, CHART.y + 58, { size: 22, color: C.amber, spacing: 4 });
    K.ctx.fillStyle = C.amber;
    K.ctx.fillRect(x, CHART.y + 66, tw, 2);
    text('— TOTAL', CHART.x + CHART.w - 280, CHART.y + 58, { size: 22, color: C.text, spacing: 2 });
    text('— SPOT', CHART.x + CHART.w - 130, CHART.y + 58, { size: 22, color: C.lineDim, spacing: 2, glow: false });
    if (!slots.length) return;

    var t0 = slots[0].t.getTime(), t1 = slots[slots.length - 1].t.getTime() + 900000;
    var maxP = 0;
    slots.forEach(function (s) { maxP = Math.max(maxP, s.total); });
    var top = Math.max(1, Math.ceil(maxP * 2) / 2);
    var X = function (ms) { return PLOT.x0 + (ms - t0) / (t1 - t0) * (PLOT.x1 - PLOT.x0); };
    var Y = function (p) { return PLOT.y1 - Math.max(0, p) / top * (PLOT.y1 - PLOT.y0); };
    var ctx = K.ctx;

    // graticule, HP-analyser style
    ctx.setLineDash([3, 8]);
    for (var p = 0; p <= top + 0.001; p += 0.5) {
      ctx.beginPath(); ctx.moveTo(PLOT.x0, Y(p)); ctx.lineTo(PLOT.x1, Y(p));
      K.glowStroke(C.lineDim, 2);
      text(p.toFixed(2), PLOT.x0 - 16, Y(p) + 8, { size: 22, color: C.text, align: 'right', glow: false });
    }
    var hour = 3600000;
    for (var ms = t0; ms <= t1; ms += 3 * hour) {
      ctx.beginPath(); ctx.moveTo(X(ms), PLOT.y0); ctx.lineTo(X(ms), PLOT.y1);
      K.glowStroke(C.lineDim, 2);
      text(pad(new Date(ms).getHours()), X(ms), PLOT.y1 + 36, { size: 22, color: C.text, align: 'center', glow: false });
    }
    ctx.setLineDash([]);

    // day split
    var midnight = new Date(t0 + 86400000 / 2); midnight.setHours(24, 0, 0, 0);
    if (midnight.getTime() < t1) {
      ctx.beginPath(); ctx.moveTo(X(midnight.getTime()), PLOT.y0 - 30); ctx.lineTo(X(midnight.getTime()), PLOT.y1);
      K.glowStroke(C.line, 2);
      text('TOMORROW', X(midnight.getTime()) + 12, PLOT.y0 - 10, { size: 22, color: C.text, spacing: 3 });
    }
    text('TODAY', PLOT.x0 + 12, PLOT.y0 - 10, { size: 22, color: C.text, spacing: 3 });

    // peak tariff hours, marked under the axis
    slots.forEach(function (s) {
      if (!s.peak) return;
      var a = X(s.t.getTime());
      ctx.beginPath(); ctx.moveTo(a, PLOT.y1 + 54); ctx.lineTo(a + (PLOT.x1 - PLOT.x0) * 900000 / (t1 - t0), PLOT.y1 + 54);
      K.glowStroke(C.red, 4);
    });
    if (CFG.gridOwner) text('PEAK TARIFF', PLOT.x0, PLOT.y1 + 92, { size: 22, color: C.red, spacing: 3 });

    // spot only, dim, then the total as a stepped trace
    function trace(get, color, width) {
      ctx.beginPath();
      slots.forEach(function (s, i) {
        var a = X(s.t.getTime()), b = X(s.t.getTime() + 900000), y = Y(get(s));
        if (i === 0) ctx.moveTo(a, y); else ctx.lineTo(a, y);
        ctx.lineTo(b, y);
      });
      K.glowStroke(color, width);
    }
    trace(function (s) { return s.spot; }, C.lineDim, 2);
    trace(function (s) { return s.total; }, C.text, 3);

    // cheapest window bracket
    var win = cheapestWindow();
    if (win) {
      var wa = X(slots[win.start].t.getTime()), wb = X(slots[win.end - 1].t.getTime() + 900000);
      var wy = Y(win.avg) + 40;
      ctx.beginPath();
      ctx.moveTo(wa, wy - 14); ctx.lineTo(wa, wy); ctx.lineTo(wb, wy); ctx.lineTo(wb, wy - 14);
      K.glowStroke(C.green, 3);
      text('OPTIMAL ' + kr(win.avg), (wa + wb) / 2, wy + 30, { size: 22, color: C.green, align: 'center', spacing: 2 });
    }

    // now line, and the scrub cursor
    var ni = nowIndex();
    if (ni >= 0) {
      var nx = X(Date.now());
      ctx.beginPath(); ctx.moveTo(nx, PLOT.y0); ctx.lineTo(nx, PLOT.y1);
      K.glowStroke(C.pink, 2);
      text('NOW', nx + 10, PLOT.y1 - 14, { size: 22, color: C.pink, spacing: 2 });
      var blink = Math.floor(t / 530) % 2;
      if (blink) { ctx.beginPath(); ctx.arc(nx, Y(slots[ni].total), 7, 0, Math.PI * 2); K.glowStroke(C.pink, 2); }
    }
    if (cursor !== null && slots[cursor]) {
      var cs = slots[cursor], cx = X(cs.t.getTime() + 450000);
      K.brackets(cx - 10, Y(cs.total) - 10, 20, 20, C.cyan, 10, 6);
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(cx, Y(cs.total) + 18); ctx.lineTo(cx, PLOT.y1);
      K.glowStroke(C.cyan, 2);
      ctx.setLineDash([]);
    }
  }

  function drawStatusBar() {
    var y = 1030;
    var src = lastError && !slots.length ? 'NO SIGNAL' : 'DATA ENERGI DATA SERVICE  //  ' + CFG.gridName + '  //  ' + slots.length + ' SLOTS';
    text('STATUS: ' + src, 96, y, { size: 22, color: C.text, spacing: 2 });
    text('←→ SCRUB   OK NOW   BACK HOME', W - 96, y, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }

  function drawOff() {
    frame(LEFT.x, LEFT.y, CHART.x + CHART.w - LEFT.x, LEFT.h);
    text('GRID MONITOR OFFLINE', W / 2, 520, { font: K.TITLE, size: 40, color: C.text, spacing: 6, align: 'center' });
    text('PRICES COVER DENMARK ONLY. CHOOSE A REGION IN SETUP.', W / 2, 590, { size: 24, color: C.lineDim, spacing: 3, align: 'center' });
    text('BACK HOME', W - 96, 1030, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }

  function draw(t, now) {
    // nothing here moves faster than the clock, the cursor or the NOW blink
    var key = [version, cursor, Math.floor(now.getTime() / 1000), Math.floor(t / 530) % 2].join('|');
    K.cached('power', key, function () {
      var ctx = K.ctx;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, K.H);
      K.header((CFG.area || 'GRID') + ' // POWER DISTRIBUTION MONITOR', now);
      if (CFG.off) { drawOff(); return; }
      drawReadout();
      drawChart(t);
      drawStatusBar();
    });
  }

  function key(code) {
    if (!slots.length) return false;
    var base = cursor !== null ? cursor : Math.max(0, nowIndex());
    switch (code) {
      case 37: cursor = Math.max(0, base - 4); break;          // an hour back
      case 39: cursor = Math.min(slots.length - 1, base + 4); break; // an hour on
      case 13: cursor = null; break;
      default: return false;
    }
    return true;
  }

  // compact numbers for the home screen
  function summary() { return memoized('summary', computeSummary); }

  function computeSummary() {
    var i = nowIndex();
    if (i < 0) return null;
    var win = cheapestWindow();
    return {
      now: slots[i].total,
      band: band(slots[i].total),
      cheapest: win ? hm(slots[win.start].t) + '-' + hm(new Date(slots[win.end - 1].t.getTime() + 900000)) : null
    };
  }

  if (!CFG.off) {
    refreshTariffs();
    refreshSpot();
  }

  window.Power = { draw: draw, key: key, summary: summary, reset: function () { cursor = null; } };
})();
