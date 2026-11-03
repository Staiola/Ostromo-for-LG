// Setup screen: choose what is on this TV. ↑↓ picks a line, ←→ changes it,
// OK on SAVE writes it to the TV and restarts the app. OK on a channel opens
// a grid of every app it can launch, nine to a page.
(function () {
  'use strict';

  var W = K.W, C = K.C;
  var text = K.text, box = K.box, frame = K.frame;
  var S = window.Settings;

  var LIST = { x: 96, y: 136, w: 1060, h: 844 };
  var INFO = { x: 1180, y: 136, w: 644, h: 844 };
  var ROW_H = 42;

  var draft = null;
  var sel = 0;
  var warned = false;   // BACK with unsaved changes asks once
  // the app grid while it's open: the slot it fills, its choices, which is lit
  var picker = null;
  var PICK = { cols: 3, rows: 3, gap: 22, top: 120 };

  // the grid cell each viewing slot lands on, for the CH number beside it
  var VIEW_CH = [1, 2, 3, 6, 7, 8];

  // the TV's other apps, { id, name }, after the known ones in a viewing slot's
  // choices; asked for each time SETUP opens (none off the TV)
  var others = [];

  function listOthers() {
    K.luna('luna://com.webos.applicationManager/listLaunchPoints', {})
      .then(function (res) {
        var known = {};
        S.APP_CHOICES.forEach(function (k) {
          var a = S.APPS[k];
          if (!a) return;
          if (a.id) known[a.id] = true;
          (a.android || []).forEach(function (pkg) { known[pkg] = true; });
        });
        var seen = {};
        others = (res.launchPoints || [])
          .filter(function (p) {
            var keep = p.id && p.title && !known[p.id] && !seen[p.id] && p.id !== 'com.unterface.nostromo' &&
              !/^com\.webos\.app\.hdmi/.test(p.id);
            seen[p.id] = true;
            return keep;
          })
          .map(function (p) { return { id: p.id, name: String(p.title).slice(0, 80) }; })
          .sort(function (a, b) { return a.name.localeCompare(b.name); });
      })
      .catch(function () { others = []; });
  }

  // a slot's value as one string, to find it among the choices
  function keyOf(v) { return typeof v === 'string' ? v : 'app:' + v.id; }

  // what a viewing slot can be: the known apps, then the TV's others, and
  // whatever it holds now even if that app has gone from the TV
  function appChoices(cur) {
    var list = S.APP_CHOICES.concat(others);
    if (typeof cur !== 'string' && list.map(keyOf).indexOf(keyOf(cur)) < 0) list.push(cur);
    return list;
  }

  // the grid has the apps first and clearing the channel last
  function openPicker(i) {
    var list = appChoices(draft.viewing[i]).filter(function (v) { return v !== 'none'; }).concat(['none']);
    var at = list.map(keyOf).indexOf(keyOf(draft.viewing[i]));
    picker = { i: i, list: list, at: Math.max(0, at) };
  }

  // ↑↓ within the page; ←→ along a row, and off its end onto the next page
  function movePicker(dRow, dCol) {
    var per = PICK.cols * PICK.rows, n = picker.list.length;
    var page = Math.floor(picker.at / per), cell = picker.at % per;
    var row = Math.floor(cell / PICK.cols), col = cell % PICK.cols;
    var pages = Math.ceil(n / per);
    if (dRow) row = Math.max(0, Math.min(PICK.rows - 1, row + dRow));
    if (dCol) {
      col += dCol;
      if (col < 0) { if (page === 0) return; page--; col = PICK.cols - 1; }
      if (col >= PICK.cols || page * per + row * PICK.cols + col >= n) {
        if (dCol < 0 || page === pages - 1) return;
        page++; col = 0;
      }
    }
    picker.at = Math.min(n - 1, page * per + row * PICK.cols + col);
  }

  function pick() {
    var v = picker.list[picker.at];
    draft.viewing[picker.i] = typeof v === 'string' ? v : { id: v.id, name: v.name };
    picker = null;
    warned = false;
  }

  function cycleApp(cur, dir) {
    var list = appChoices(cur), keys = list.map(keyOf);
    var i = keys.indexOf(keyOf(cur));
    var next = list[(i + dir + list.length) % list.length];
    return typeof next === 'string' ? next : { id: next.id, name: next.name };
  }

  function rows() {
    var list = [];
    draft.viewing.forEach(function (k, i) {
      list.push({ group: i === 0 ? 'VIEWING' : null, label: 'CH ' + K.pad(VIEW_CH[i]), kind: 'app', i: i });
    });
    draft.inputs.forEach(function (inp, i) {
      var name = i === 0 ? 'A' : 'B';
      list.push({ group: i === 0 ? 'INPUTS' : null, label: 'SOURCE ' + name, kind: 'device', i: i });
      list.push({ label: 'PORT ' + name, kind: 'port', i: i });
    });
    list.push({ group: 'TELEMETRY', label: 'POWER PRICES', kind: 'power' });
    list.push({ label: 'RADAR AIRPORT', kind: 'airport' });
    list.push({ group: 'SYSTEMS', label: 'TELETEXT', kind: 'teletext' });
    list.push({ label: 'SOUNDS', kind: 'sound' });
    list.push({ group: ' ', label: 'SAVE & RESTART', kind: 'save' });
    return list;
  }

  function value(r) {
    switch (r.kind) {
      case 'app':
        var app = S.appFor(draft.viewing[r.i]);
        if (!app) return '-- EMPTY --';
        return app.name.length > 30 ? app.name.slice(0, 29) + '…' : app.name;
      case 'device': var d = draft.inputs[r.i].device; return d === 'off' ? '-- OFF --' : d;
      case 'port': return 'HDMI ' + draft.inputs[r.i].port;
      case 'power': return S.POWER[draft.power].label;
      case 'airport': var ap = window.AIRPORTS[draft.airport]; return ap.city + ' · ' + ap.iata;
      case 'teletext': return S.TELETEXT[draft.teletext].label;
      case 'sound': return S.SOUND_LABELS[draft.sound];
    }
    return '';
  }

  function cycle(list, cur, dir) {
    var i = list.indexOf(cur);
    return list[(i + dir + list.length) % list.length];
  }

  function change(r, dir) {
    warned = false;
    switch (r.kind) {
      case 'app': draft.viewing[r.i] = cycleApp(draft.viewing[r.i], dir); break;
      case 'device': draft.inputs[r.i].device = cycle(S.DEVICES, draft.inputs[r.i].device, dir); break;
      case 'port': draft.inputs[r.i].port = cycle([1, 2, 3, 4], draft.inputs[r.i].port, dir); break;
      case 'power': draft.power = cycle(S.POWER_CHOICES, draft.power, dir); break;
      case 'airport': draft.airport = cycle(window.AIRPORT_CHOICES, draft.airport, dir); break;
      case 'teletext': draft.teletext = cycle(S.TELETEXT_CHOICES, draft.teletext, dir); break;
      case 'sound': draft.sound = cycle(S.SOUND_CHOICES, draft.sound, dir); break;
    }
  }

  // a TV that has never saved counts as changed, so the defaults can be kept
  function dirty() { return !S.configured() || JSON.stringify(draft) !== JSON.stringify(S.get()); }

  // about what a viewing slot holds, or would hold
  function appHelp(v) {
    var a = S.appFor(v);
    var more = picker ? [] : ['', 'OK SHOWS ALL ' + (S.APP_CHOICES.length - 1 + others.length) + ' APPS.'];
    if (!a) return ['AN EMPTY CHANNEL.', 'IT SHOWS AS NO CARRIER.'].concat(more);
    if (a.screen) return ['DR LIVE TV, BUILT IN.', 'DR1, DR2, DR TVA, RAMASJANG.', 'WORKS IN DENMARK ONLY.'];
    var appId = window.OstromoAndroid && a.android ? a.android[0] : a.id;
    if (a.other) {
      var here = others.some(function (o) { return o.id === a.id; });
      return ['LAUNCHES THE TV APP', 'APP ID  ' + appId.toUpperCase(),
        here ? 'FOUND ON THIS TV.' : 'NOT FOUND ON THIS TV NOW.'];
    }
    return ['LAUNCHES THE TV APP', 'APP ID  ' + appId.toUpperCase(), 'THE APP HAS TO BE INSTALLED.'].concat(more);
  }

  // a line or two about whatever is selected
  function help(r) {
    switch (r.kind) {
      case 'app': return appHelp(draft.viewing[r.i]);
      case 'device': return ['WHAT IS PLUGGED IN.', 'NAMES THE INPUT TILE.', 'OFF LEAVES THE TILE EMPTY.'];
      case 'port': return ['THE HDMI SOCKET ON THE TV', 'IT IS PLUGGED INTO.'];
      case 'power':
        var p = S.POWER[draft.power];
        if (p.off) return ['NO PRICE DATA.', 'PRICES COVER DENMARK, SWEDEN,', 'NORWAY, GERMANY, LONDON,', 'NEW YORK CITY AND', 'EASTERN AUSTRALIA.'];
        if (p.source === 'elpris') return ['NORD POOL SPOT FOR ' + p.area + ',', 'IN ' + (p.country === 'NO' ? 'ØRE' : 'ÖRE') + ', BEFORE TAXES,', 'GRID FEE AND VAT.'];
        if (p.source === 'aemo') return ['NEM 5-MINUTE PRICE FOR ' + p.area + ',', 'IN CENTS, WHOLESALE, BEFORE', 'NETWORK, RETAIL AND GST.', 'WHAT AMBER CUSTOMERS PAY ON.'];
        if (p.source === 'nyiso') return ['NYISO DAY-AHEAD, ZONE J,', 'IN CENTS, WHOLESALE, BEFORE', 'DELIVERY CHARGES AND TAX.'];
        if (p.source === 'eds-eur') return ['EPEX DAY-AHEAD FOR GERMANY,', 'IN CENT, BEFORE GRID FEES,', 'LEVIES AND VAT.'];
        if (p.source === 'agile') return ['OCTOPUS AGILE, REGION ' + p.region + '.', 'WHAT A KWH COSTS ON THE', 'TARIFF, PENCE INCL. VAT.'];
        if (p.gridOwner) return ['SPOT PRICE FOR ' + p.area, 'PLUS ' + p.gridName + ' NETTARIF,', p.supplierName + ' MARKUP, TAXES, VAT.'];
        return ['SPOT PRICE FOR ' + p.area, 'PLUS STATE TARIFFS, TAX, VAT.', 'NO GRID COMPANY NETTARIF.'];
      case 'airport':
        var a = window.AIRPORTS[draft.airport];
        return ['LIVE TRAFFIC AROUND ' + a.icao, a.title[0] + ', ' + a.city + '.', 'RADAR, BOARDS AND THE', 'HOME SCREEN FOLLOW IT.'];
      case 'teletext':
        if (draft.teletext === 'off') return ['NO TELETEXT.', 'OFF LEAVES THE CELL EMPTY.'];
        return [S.TELETEXT[draft.teletext].name + ' IN THE', 'SYSTEMS GROUP, LIVE PAGES', 'FROM THE BROADCASTER.'];
      case 'sound':
        if (draft.sound === 'a') return ['RECORDED SOUNDS,', 'ON THIS TV ONLY.'];
        if (draft.sound === 'b') return ['SYNTHESISED SOUNDS:', 'TYPING, TRACKER, GUN.'];
        return ['NO SOUND EFFECTS.', 'RADIO AND TV STILL PLAY.'];
      case 'save': return dirty() ? ['WRITES THE SETUP TO THE TV', 'AND RESTARTS OSTROMO.'] : ['NO CHANGES TO SAVE.'];
    }
    return [];
  }

  function draw(t, now) {
    var ctx = K.ctx, list = rows();
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, K.H);
    K.header('SETUP // SYSTEM CONFIGURATION', now);

    frame(LIST.x, LIST.y, LIST.w, LIST.h);
    var x = LIST.x + 40, y = LIST.y + 40, vx = LIST.x + 330, vw = LIST.w - 330 - 40;
    list.forEach(function (r, i) {
      if (r.group) {
        if (r.group.trim()) {
          var gw = text(r.group, x, y + 24, { size: 22, color: C.amber, spacing: 5 });
          ctx.fillStyle = C.amber;
          ctx.fillRect(x, y + 31, gw, 2);
        }
        y += 34;
      }
      var on = i === sel, top = y, h = ROW_H - 8;
      if (r.kind === 'save') {
        var bw = 420;
        if (on) { ctx.fillStyle = 'rgba(79,245,216,0.16)'; ctx.fillRect(x, top, bw, h); }
        box(x, top, bw, h, on ? C.cyan : dirty() ? C.line : C.lineDim, on ? 2.5 : 2);
        text('▸ SAVE & RESTART', x + 22, top + 27, { size: 24, color: on ? C.white : dirty() ? C.text : C.lineDim, spacing: 3 });
        if (warned) text('UNSAVED CHANGES · BACK AGAIN TO DISCARD', x + bw + 24, top + 27, { size: 20, color: C.red, spacing: 2 });
        y += ROW_H;
        return;
      }
      text(r.label, x, top + 27, { size: 24, color: on ? C.white : C.text, spacing: 2 });
      if (on) { ctx.fillStyle = 'rgba(79,245,216,0.14)'; ctx.fillRect(vx, top, vw, h); }
      box(vx, top, vw, h, on ? C.cyan : C.line, on ? 2.5 : 2);
      text(value(r), vx + vw / 2, top + 27, { size: 24, color: on ? C.white : C.text, spacing: 2, align: 'center' });
      text('◂', vx + 18, top + 27, { size: 24, color: on ? C.cyan : C.lineDim });
      text('▸', vx + vw - 18, top + 27, { size: 24, color: on ? C.cyan : C.lineDim, align: 'right' });
      y += ROW_H;
    });

    if (picker) drawPicker(list[sel]);

    frame(INFO.x, INFO.y, INFO.w, INFO.h);
    var ix = INFO.x + 34;
    text('NOTES', ix, INFO.y + 58, { size: 22, color: C.amber, spacing: 5 });
    var r = list[sel];
    text(r.label, ix, INFO.y + 120, { font: K.TITLE, size: 30, color: C.white, spacing: 3 });
    (picker ? appHelp(picker.list[picker.at]) : help(r)).forEach(function (line, i) {
      text(line, ix, INFO.y + 180 + i * 40, { size: 22, color: C.text, spacing: 2 });
    });
    text('SAVED ON THIS TV ONLY.', ix, INFO.y + INFO.h - 44, { size: 20, color: C.lineDim, spacing: 2, glow: false });

    text('STATUS: ' + (dirty() ? 'CHANGES PENDING' : 'CONFIGURATION LOADED'), 96, 1030,
      { size: 22, color: dirty() ? C.amber : C.text, spacing: 2 });
    var keys = picker ? '←→↑↓ SELECT   OK CHOOSE   BACK'
      : list[sel].kind === 'app' ? '↑↓ SELECT   ←→ CHANGE   OK ALL APPS   BACK' : '↑↓ SELECT   ←→ CHANGE   OK SAVE   BACK';
    text(keys, W - 96, 1030, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }

  function drawPicker(r) {
    var ctx = K.ctx;
    var per = PICK.cols * PICK.rows, n = picker.list.length;
    var page = Math.floor(picker.at / per), pages = Math.ceil(n / per);
    ctx.fillStyle = C.bg;
    ctx.fillRect(LIST.x, LIST.y, LIST.w, LIST.h);
    frame(LIST.x, LIST.y, LIST.w, LIST.h, C.cyan);
    var x0 = LIST.x + 40, y0 = LIST.y + 40;
    var gw = text(r.label + ' // SELECT APP', x0, y0 + 24, { size: 22, color: C.amber, spacing: 5 });
    ctx.fillStyle = C.amber;
    ctx.fillRect(x0, y0 + 31, gw, 2);
    text('PAGE ' + (page + 1) + '/' + pages + '  ·  ' + n + ' CHOICES', LIST.x + LIST.w - 40, y0 + 24,
      { size: 22, color: C.lineDim, spacing: 2, align: 'right', glow: false });

    var gridW = LIST.w - 80, gridH = LIST.h - PICK.top - 90;
    var tw = (gridW - PICK.gap * (PICK.cols - 1)) / PICK.cols;
    var th = (gridH - PICK.gap * (PICK.rows - 1)) / PICK.rows;
    var cur = keyOf(draft.viewing[picker.i]);
    for (var c = 0; c < per; c++) {
      var idx = page * per + c;
      if (idx >= n) break;
      var v = picker.list[idx], a = S.appFor(v), on = idx === picker.at;
      var tx = x0 + (c % PICK.cols) * (tw + PICK.gap);
      var ty = LIST.y + PICK.top + Math.floor(c / PICK.cols) * (th + PICK.gap);
      if (on) {
        ctx.fillStyle = 'rgba(79,245,216,0.14)';
        ctx.fillRect(tx, ty, tw, th);
        frame(tx, ty, tw, th, C.cyan);
      } else {
        K.box(tx, ty, tw, th, C.lineDim, 2);
      }
      var name = a ? a.name : 'LEAVE EMPTY';
      var foot = !a ? 'NO CARRIER' : a.screen ? 'BUILT IN' : a.other ? 'ON THIS TV' : 'STREAMING';
      if (keyOf(v) === cur) foot = '● NOW ON ' + r.label;
      text(a ? a.code : '--', tx + tw - 20, ty + 38, { size: 22, color: C.lineDim, spacing: 2, align: 'right', glow: false });
      K.fitText(name, tx + 20, ty + th / 2 + 14, tw - 40, { font: K.TITLE, size: 30, color: on ? C.white : a ? C.text : C.lineDim, spacing: 3, glow: on ? 14 : 6 });
      text(foot, tx + 20, ty + th - 20, { size: 20, color: keyOf(v) === cur ? C.amber : C.lineDim, spacing: 2, glow: false });
    }
    // more pages: arrows at the sides
    if (page > 0) text('◂', LIST.x + 20, LIST.y + PICK.top + gridH / 2, { size: 30, color: C.cyan });
    if (page < pages - 1) text('▸', LIST.x + LIST.w - 20, LIST.y + PICK.top + gridH / 2, { size: 30, color: C.cyan, align: 'right' });
  }

  function key(code) {
    var list = rows(), r = list[sel];
    if (picker) {
      switch (code) {
        case 37: movePicker(0, -1); return true;
        case 39: movePicker(0, 1); return true;
        case 38: movePicker(-1, 0); return true;
        case 40: movePicker(1, 0); return true;
        case 13: pick(); return true;
        case 461: case 27: case 8: picker = null; return true;
      }
      return true;
    }
    switch (code) {
      case 38: sel = Math.max(0, sel - 1); warned = false; return true;
      case 40: sel = Math.min(list.length - 1, sel + 1); warned = false; return true;
      case 37: if (r.kind !== 'save') change(r, -1); return true;
      case 39: if (r.kind !== 'save') change(r, 1); return true;
      case 13:
        if (r.kind === 'save') { if (dirty()) S.save(draft); }
        else if (r.kind === 'app') openPicker(r.i);
        else change(r, 1);
        return true;
      case 461: case 27: case 8:
        if (dirty() && !warned) { warned = true; sel = list.length - 1; return true; }
        return false; // home, changes dropped
    }
    return false;
  }

  function reset() {
    listOthers();
    picker = null;
    draft = S.get();
    sel = 0;
    warned = false;
  }

  window.Setup = { draw: draw, key: key, reset: reset };
})();
