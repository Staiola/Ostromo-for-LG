// Setup screen: choose what is on this TV. ↑↓ picks a line, ←→ changes it,
// OK on SAVE writes it to the TV and restarts the app.
(function () {
  'use strict';

  var W = K.W, C = K.C;
  var text = K.text, box = K.box, frame = K.frame;
  var S = window.Settings;

  var LIST = { x: 96, y: 136, w: 1060, h: 844 };
  var INFO = { x: 1180, y: 136, w: 644, h: 844 };
  var ROW_H = 44;

  var draft = null;
  var sel = 0;
  var warned = false;   // BACK with unsaved changes asks once

  // the grid cell each viewing slot lands on, for the CH number beside it
  var VIEW_CH = [1, 2, 3, 6, 7, 8];

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
    list.push({ group: 'SYSTEMS', label: 'TELETEXT', kind: 'teletext' });
    list.push({ label: 'SOUNDS', kind: 'sound' });
    list.push({ group: ' ', label: 'SAVE & RESTART', kind: 'save' });
    return list;
  }

  function value(r) {
    switch (r.kind) {
      case 'app': var k = draft.viewing[r.i]; return k === 'none' ? '-- EMPTY --' : S.APPS[k].name;
      case 'device': var d = draft.inputs[r.i].device; return d === 'off' ? '-- OFF --' : d;
      case 'port': return 'HDMI ' + draft.inputs[r.i].port;
      case 'power': return S.POWER[draft.power].label;
      case 'teletext': return draft.teletext ? 'ON' : 'OFF';
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
      case 'app': draft.viewing[r.i] = cycle(S.APP_CHOICES, draft.viewing[r.i], dir); break;
      case 'device': draft.inputs[r.i].device = cycle(S.DEVICES, draft.inputs[r.i].device, dir); break;
      case 'port': draft.inputs[r.i].port = cycle([1, 2, 3, 4], draft.inputs[r.i].port, dir); break;
      case 'power': draft.power = cycle(S.POWER_CHOICES, draft.power, dir); break;
      case 'teletext': draft.teletext = !draft.teletext; break;
      case 'sound': draft.sound = cycle(S.SOUND_CHOICES, draft.sound, dir); break;
    }
  }

  // a TV that has never saved counts as changed, so the defaults can be kept
  function dirty() { return !S.configured() || JSON.stringify(draft) !== JSON.stringify(S.get()); }

  // a line or two about whatever is selected
  function help(r) {
    switch (r.kind) {
      case 'app':
        var k = draft.viewing[r.i], a = S.APPS[k];
        if (!a) return ['AN EMPTY CHANNEL.', 'IT SHOWS AS NO CARRIER.'];
        if (a.screen) return ['DR LIVE TV, BUILT IN.', 'DR1, DR2, DR TVA, RAMASJANG.', 'WORKS IN DENMARK ONLY.'];
        return ['LAUNCHES THE TV APP', 'APP ID  ' + a.id.toUpperCase(), 'THE APP HAS TO BE INSTALLED.'];
      case 'device': return ['WHAT IS PLUGGED IN.', 'NAMES THE INPUT TILE.', 'OFF LEAVES THE TILE EMPTY.'];
      case 'port': return ['THE HDMI SOCKET ON THE TV', 'IT IS PLUGGED INTO.'];
      case 'power':
        var p = S.POWER[draft.power];
        if (p.off) return ['NO PRICE DATA.', 'PRICES COME FROM ENERGINET', 'AND COVER DENMARK ONLY.'];
        if (p.gridOwner) return ['SPOT PRICE FOR ' + p.area, 'PLUS ' + p.gridName + ' NETTARIF,', p.supplierName + ' MARKUP, TAXES, VAT.'];
        return ['SPOT PRICE FOR ' + p.area, 'PLUS STATE TARIFFS, TAX, VAT.', 'NO GRID COMPANY NETTARIF.'];
      case 'teletext': return ['DR TEKST-TV IN THE', 'SYSTEMS GROUP. DANISH.', 'OFF LEAVES THE CELL EMPTY.'];
      case 'sound':
        if (draft.sound === 'a') return ['RECORDED SOUNDS,', 'ON THIS TV ONLY.'];
        if (draft.sound === 'b') return ['SYNTHESISED SOUNDS:', 'TYPING, TRACKER, GUN.'];
        return ['NO SOUND EFFECTS.', 'RADIO AND TV STILL PLAY.'];
      case 'save': return dirty() ? ['WRITES THE SETUP TO THE TV', 'AND RESTARTS UNTERFACE.'] : ['NO CHANGES TO SAVE.'];
    }
    return [];
  }

  function draw(t, now) {
    var ctx = K.ctx, list = rows();
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, K.H);
    K.header('SETUP // SYSTEM CONFIGURATION', now);

    frame(LIST.x, LIST.y, LIST.w, LIST.h);
    var x = LIST.x + 40, y = LIST.y + 50, vx = LIST.x + 330, vw = LIST.w - 330 - 40;
    list.forEach(function (r, i) {
      if (r.group) {
        if (r.group.trim()) {
          var gw = text(r.group, x, y + 24, { size: 22, color: C.amber, spacing: 5 });
          ctx.fillStyle = C.amber;
          ctx.fillRect(x, y + 31, gw, 2);
        }
        y += 38;
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

    frame(INFO.x, INFO.y, INFO.w, INFO.h);
    var ix = INFO.x + 34;
    text('NOTES', ix, INFO.y + 58, { size: 22, color: C.amber, spacing: 5 });
    var r = list[sel];
    text(r.label, ix, INFO.y + 120, { font: K.TITLE, size: 30, color: C.white, spacing: 3 });
    help(r).forEach(function (line, i) {
      text(line, ix, INFO.y + 180 + i * 40, { size: 22, color: C.text, spacing: 2 });
    });
    text('SAVED ON THIS TV ONLY.', ix, INFO.y + INFO.h - 110, { size: 20, color: C.lineDim, spacing: 2, glow: false });
    text('THE RADAR AIRPORT IS FIXED', ix, INFO.y + INFO.h - 74, { size: 20, color: C.lineDim, spacing: 2, glow: false });
    text('TO KASTRUP FOR NOW.', ix, INFO.y + INFO.h - 44, { size: 20, color: C.lineDim, spacing: 2, glow: false });

    text('STATUS: ' + (dirty() ? 'CHANGES PENDING' : 'CONFIGURATION LOADED'), 96, 1030,
      { size: 22, color: dirty() ? C.amber : C.text, spacing: 2 });
    text('↑↓ SELECT   ←→ CHANGE   OK SAVE   BACK', W - 96, 1030, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }

  function key(code) {
    var list = rows(), r = list[sel];
    switch (code) {
      case 38: sel = Math.max(0, sel - 1); warned = false; return true;
      case 40: sel = Math.min(list.length - 1, sel + 1); warned = false; return true;
      case 37: if (r.kind !== 'save') change(r, -1); return true;
      case 39: if (r.kind !== 'save') change(r, 1); return true;
      case 13:
        if (r.kind === 'save') { if (dirty()) S.save(draft); }
        else change(r, 1);
        return true;
      case 461: case 27: case 8:
        if (dirty() && !warned) { warned = true; sel = list.length - 1; return true; }
        return false; // home, changes dropped
    }
    return false;
  }

  function reset() {
    draft = S.get();
    sel = 0;
    warned = false;
  }

  window.Setup = { draw: draw, key: key, reset: reset };
})();
