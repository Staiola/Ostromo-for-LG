// Teletext screen: DR Tekst-TV (via the app's service) on a 40-column grid in
// Bedstead, a CC0 recreation of the SAA5050 teletext character generator.
// DR's source is text only, so the classic colours are put back by rule:
// headings yellow, page numbers cyan, channel names green, the rest white.
(function () {
  'use strict';

  var W = K.W, C = K.C, TITLE = K.TITLE;
  var text = K.text, box = K.box, frame = K.frame;

  var FONT = '"Bedstead", monospace';
  var TT = { white: '#FFFFFF', yellow: '#FFFF00', cyan: '#00FFFF', green: '#00FF00', red: '#FF2020', blue: '#2040FF', magenta: '#FF00FF' };
  var INDEX = [[100, 'FORSIDE'], [110, 'NYHEDER'], [200, 'SPORT'], [300, 'TV'], [600, 'RADIO']];
  var REFRESH_MS = 60 * 1000;

  // the teletext screen: 40 columns x 25 rows, cells stretched to 4:3 shape
  var SIZE = 30, STRETCH = 1.35;
  var CELL_W = SIZE * 0.6 * STRETCH, ROW_H = SIZE;
  var PANEL = { w: Math.round(CELL_W * 40) + 48, h: ROW_H * 25 + 48 };
  PANEL.x = Math.round((W - PANEL.w) / 2);
  PANEL.y = 160;

  var page = 100;
  var typed = '';          // digits keyed so far
  var history = [];
  var pages = {};          // page -> { lines, links, at }
  var loading = null;      // page being fetched
  var linkIndex = -1;      // which spot (page number on screen) is selected
  var timer = null;
  var on = false;
  var focus = 'page';      // 'page' (links on the page) or 'side' (index + keypad)
  var sideIndex = 0;       // which side item is focused
  var pressed = { id: null, at: 0 };  // keypad key sinking after a press

  // left column: the quick index, a readout of the digits keyed, and a keypad
  // of outlined 3D keys. Reached by going left off the page.
  var SIDE = { x: 96, w: PANEL.x - 96 - 30 };
  var KEY = { w: 82, h: 66, gap: 12, depth: 8, top: 600 };
  var SIDE_ITEMS = INDEX.map(function (it, i) {
    return { id: 'i' + it[0], page: it[0], x: SIDE.x + 14, y: PANEL.y + 74 + i * 56, w: SIDE.w - 28, h: 50 };
  });
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'DEL'].forEach(function (k, i) {
    var col = i < 9 ? i % 3 : i === 9 ? 0 : 2, r = i < 9 ? Math.floor(i / 3) : 3;
    var span = k === '0' ? 2 : 1;
    var x0 = SIDE.x + Math.round((SIDE.w - (KEY.w * 3 + KEY.gap * 2)) / 2);
    SIDE_ITEMS.push({ id: 'k' + k, key: k, x: x0 + col * (KEY.w + KEY.gap), y: KEY.top + r * (KEY.h + KEY.gap),
      w: KEY.w * span + KEY.gap * (span - 1), h: KEY.h });
  });

  // --- data --------------------------------------------------------------------

  function load(p, push) {
    if (push && p !== page) history.push(page);
    page = p;
    typed = '';
    linkIndex = -1;
    loading = p;
    K.data('teletext', { page: p }).then(function (r) {
      var spots = findSpots(r.lines, r.links);
      pages[p] = { lines: r.lines, links: r.links, spots: spots, at: Date.now() };
      // start on the first page number, so OK or a direction works at once
      if (page === p && linkIndex < 0 && spots.length) linkIndex = 0;
      // only the current page and a few neighbours stay in memory
      Object.keys(pages).forEach(function (k) { if (Math.abs(k - page) > 5 && history.indexOf(+k) < 0) delete pages[k]; });
    }).catch(function () {
      pages[p] = { lines: [], links: [], spots: [], at: Date.now(), failed: true };
    }).then(function () {
      if (loading === p) loading = null;
    });
    clearTimeout(timer);
    timer = setTimeout(function () { if (on) load(page, false); }, REFRESH_MS);
  }

  // where each linked page number sits on screen, in reading order
  function findSpots(lines, links) {
    var spots = [];
    for (var r = 1; r < Math.min(lines.length, 25); r++) {
      var re = /\b([1-8]\d\d)\b/g, m;
      while ((m = re.exec(lines[r]))) {
        if (links.indexOf(+m[1]) >= 0) spots.push({ page: +m[1], row: r, col: m.index });
      }
    }
    return spots;
  }

  // move the selection around the page like a cursor: up/down to the nearest
  // page number above/below (closest column), left/right along the line
  function move(dir) {
    var data = pages[page];
    if (!data || !data.spots.length) return;
    var spots = data.spots, cur = spots[linkIndex];
    if (!cur) { linkIndex = 0; return; }
    var best = -1, bestScore = Infinity;
    spots.forEach(function (s, i) {
      if (i === linkIndex) return;
      var score;
      if (dir === 'down' && s.row > cur.row) score = (s.row - cur.row) * 1000 + Math.abs(s.col - cur.col);
      else if (dir === 'up' && s.row < cur.row) score = (cur.row - s.row) * 1000 + Math.abs(s.col - cur.col);
      else if (dir === 'right' && s.row === cur.row && s.col > cur.col) score = s.col - cur.col;
      else if (dir === 'left' && s.row === cur.row && s.col < cur.col) score = cur.col - s.col;
      else return;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    // nothing further along the line: carry on in reading order
    if (best < 0 && dir === 'right' && linkIndex < spots.length - 1) best = linkIndex + 1;
    if (best < 0 && dir === 'left' && linkIndex > 0) best = linkIndex - 1;
    if (best >= 0) linkIndex = best;
    // nothing further left: over to the index and keypad
    else if (dir === 'left') enterSide(cur.row);
  }

  // step onto the side column at the item nearest the given teletext row
  function enterSide(r) {
    var y = PANEL.y + 24 + (r + 0.5) * ROW_H, best = 0, d = Infinity;
    SIDE_ITEMS.forEach(function (it, i) {
      var dd = Math.abs(it.y + it.h / 2 - y);
      if (dd < d) { d = dd; best = i; }
    });
    focus = 'side';
    sideIndex = best;
  }

  // spatial move inside the side column; off its right edge goes back to the page
  function moveSide(dir) {
    var cur = SIDE_ITEMS[sideIndex], cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    var best = -1, bestScore = Infinity;
    SIDE_ITEMS.forEach(function (it, i) {
      if (i === sideIndex) return;
      var dx = it.x + it.w / 2 - cx, dy = it.y + it.h / 2 - cy, along, across;
      if (dir === 'down') { along = dy; across = dx; }
      else if (dir === 'up') { along = -dy; across = dx; }
      else if (dir === 'right') { along = dx; across = dy; }
      else { along = -dx; across = dy; }
      if (along <= 4) return;
      var score = along + Math.abs(across) * 2;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) sideIndex = best;
    else if (dir === 'right') {
      focus = 'page';
      var data = pages[page];
      if (data && data.spots.length) {
        // land on the page number nearest this height
        var r = (cy - PANEL.y - 24) / ROW_H, d = Infinity;
        data.spots.forEach(function (s, i) {
          var dd = Math.abs(s.row - r) * 100 + s.col;
          if (dd < d) { d = dd; linkIndex = i; }
        });
      }
    }
  }

  function digit(n) {
    typed += String(n);
    pressed = { id: 'k' + n, at: Date.now() };
    if (typed.length === 1 && typed === '0') typed = '';
    if (typed.length === 3) load(+typed, true);
  }

  function activateSide() {
    var it = SIDE_ITEMS[sideIndex];
    if (it.page) { load(it.page, true); return; }
    if (it.key === 'DEL') { typed = typed.slice(0, -1); pressed = { id: it.id, at: Date.now() }; return; }
    digit(+it.key);
  }

  // --- drawing -------------------------------------------------------------------

  // one teletext row: the font stretched sideways, text in colour runs
  function row(str, r, runs) {
    var ctx = K.ctx;
    ctx.save();
    ctx.font = SIZE + 'px ' + FONT;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.translate(PANEL.x + 24, PANEL.y + 24 + (r + 1) * ROW_H - 6);
    ctx.scale(STRETCH, 1);
    runs.forEach(function (run) {
      if (run.bg) {
        ctx.fillStyle = run.bg;
        ctx.fillRect(run.from * SIZE * 0.6, -ROW_H + 6, (run.to - run.from) * SIZE * 0.6, ROW_H);
      }
      ctx.fillStyle = run.color;
      ctx.fillText(str.slice(run.from, run.to), run.from * SIZE * 0.6, 0);
    });
    ctx.restore();
  }

  // colour a line the way DR's teletext did, as far as the text tells us
  function runsFor(line, r, sel) {
    var runs = [], base = TT.white;
    var letters = line.replace(/[^A-Za-zÆØÅæøå]/g, '');
    if (r === 0) base = TT.white;
    else if (/^\s*(DR1|DR2|DR P\d|DR RADIO)/.test(line)) base = TT.green;
    else if (letters.length > 3 && letters === letters.toUpperCase()) base = TT.yellow;
    var re = /\b([1-8]\d\d)\b/g, m, at = 0;
    while ((m = re.exec(line))) {
      if (r === 0) break;
      if (m.index > at) runs.push({ from: at, to: m.index, color: base });
      var on = sel && sel.row === r && sel.col === m.index;
      runs.push({ from: m.index, to: m.index + 3, color: on ? '#000000' : TT.cyan, bg: on ? TT.cyan : null });
      at = m.index + 3;
    }
    if (at < line.length) runs.push({ from: at, to: line.length, color: base });
    return runs;
  }

  function drawPage(t) {
    var data = pages[page];
    var lines = data && data.lines.length ? data.lines.slice() : [];
    // the header: the page being keyed, or a counter rolling while it searches
    var header = lines[0] || '        DR   S' + page + '                    ';
    var keyed = typed ? 'P' + (typed + '___').slice(0, 3) : loading ? 'P' + (100 + Math.floor(t / 60) % 800) : 'P' + page;
    header = (keyed + '    ' + header.slice(8)).slice(0, 40);
    row(header, 0, [{ from: 0, to: 4, color: typed || loading ? TT.yellow : TT.white }, { from: 4, to: 40, color: TT.white }]);
    if (!data) return;
    if (!lines.length || data.failed) {
      row('   SIDEN FINDES IKKE ELLER ER TOM', 10, [{ from: 0, to: 40, color: TT.red }]);
      return;
    }
    var link = focus === 'page' ? data.spots[linkIndex] : null;
    for (var r = 1; r < Math.min(lines.length, 25); r++) {
      var line = (lines[r] + '                                        ').slice(0, 40);
      row(line, r, runsFor(line, r, link));
    }
  }

  // an outlined key with depth: the face sits up-left, its sides run down-right
  // to the base. Pressed, the face sinks onto the base.
  function key3d(it, focused, down) {
    var ctx = K.ctx, d = KEY.depth, s = down ? d - 2 : 0;
    var fx = it.x + s, fy = it.y + s, fw = it.w - d, fh = it.h - d;
    var color = focused ? C.cyan : C.line;
    ctx.beginPath();
    // base outline (right and bottom) and the corner edges
    ctx.moveTo(fx + fw, fy); ctx.lineTo(it.x + it.w, it.y + d);
    ctx.lineTo(it.x + it.w, it.y + it.h); ctx.lineTo(it.x + d, it.y + it.h);
    ctx.lineTo(fx, fy + fh);
    ctx.moveTo(fx + fw, fy + fh); ctx.lineTo(it.x + it.w, it.y + it.h);
    K.glowStroke(color, 2);
    if (focused) { ctx.fillStyle = 'rgba(79,245,216,0.16)'; ctx.fillRect(fx, fy, fw, fh); }
    // the face, with a second inset rule like a keycap's dish
    box(fx, fy, fw, fh, color, 2);
    box(fx + 6, fy + 6, fw - 12, fh - 12, focused ? C.cyan : C.lineDim, 1.5);
    var label = it.key === 'DEL' ? '\u2190' : it.key;
    text(label, fx + fw / 2, fy + fh / 2 + 12, { font: FONT, size: 32, color: focused ? C.white : C.text, align: 'center' });
  }

  function drawSide(now) {
    var data = pages[page];
    // left: quick index, the digits keyed, and the keypad
    var lx = SIDE.x, lw = SIDE.w, side = focus === 'side';
    frame(lx, PANEL.y, lw, PANEL.h);
    text('INDEX', lx + 26, PANEL.y + 50, { size: 22, color: C.amber, spacing: 5 });
    INDEX.forEach(function (it, i) {
      var item = SIDE_ITEMS[i], y = item.y + 36;
      var cur = Math.floor(page / 100) * 100 === it[0] && (it[0] !== 100 || page < 110);
      var foc = side && sideIndex === i;
      if (foc) { K.ctx.fillStyle = 'rgba(79,245,216,0.16)'; K.ctx.fillRect(item.x, item.y, item.w, item.h); box(item.x, item.y, item.w, item.h, C.cyan, 2); }
      text(String(it[0]), lx + 26, y, { size: 28, color: foc || cur ? C.cyan : C.text, spacing: 2 });
      text(it[1], lx + 104, y, { size: 22, color: foc || cur ? C.white : C.lineDim, spacing: 2 });
    });

    // readout: what's been keyed so far
    var ry = KEY.top - 74;
    text('SIDE', lx + 26, ry + 34, { size: 22, color: C.amber, spacing: 5 });
    var rx = lx + lw - 26 - 120;
    box(rx, ry, 120, 48, typed ? C.cyan : C.line, 2);
    var shown = typed ? (typed + '___').slice(0, 3) : String(page);
    text(shown, rx + 60, ry + 36, { font: FONT, size: 32, color: typed ? C.white : C.text, align: 'center' });

    var sinking = Date.now() - pressed.at < 160 ? pressed.id : null;
    SIDE_ITEMS.forEach(function (it, i) {
      if (it.key) key3d(it, side && sideIndex === i, sinking === it.id);
    });

    // right: when DR captured this page (some pages go stale)
    var rx = PANEL.x + PANEL.w + 30, rw = W - 96 - rx;
    frame(rx, PANEL.y, rw, PANEL.h);
    text('SIGNAL', rx + 26, PANEL.y + 50, { size: 22, color: C.amber, spacing: 5 });
    // the header carries DR's capture time: "DR   S110  tir 20 okt   22:15:34"
    var m = data && data.lines[0] ? /(man|tir|ons|tor|fre|lør|søn)\s.*$/i.exec(data.lines[0]) : null;
    var stamp = m ? m[0].replace(/\s+/g, ' ').trim() : '---';
    text('PAGE', rx + 26, PANEL.y + 110, { size: 22, color: C.text, spacing: 2 });
    text(String(page), rx + rw - 26, PANEL.y + 110, { font: TITLE, size: 26, color: C.white, align: 'right' });
    text('CAPTURED', rx + 26, PANEL.y + 166, { size: 22, color: C.text, spacing: 2 });
    K.fitText(stamp.toUpperCase(), rx + 26, PANEL.y + 204, rw - 52, { size: 22, color: C.white, spacing: 1 });
    text('LINKS', rx + 26, PANEL.y + 260, { size: 22, color: C.text, spacing: 2 });
    text(data ? String(data.links.length) : '-', rx + rw - 26, PANEL.y + 260, { size: 24, color: C.white, align: 'right' });
    text('SOURCE', rx + 26, PANEL.y + 316, { size: 22, color: C.text, spacing: 2 });
    text('DR1 TEKST-TV', rx + 26, PANEL.y + 352, { size: 22, color: C.white, spacing: 1 });
  }

  function draw(t, now) {
    var ctx = K.ctx;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, K.H);
    K.header('TELETEXT // DR TEKST-TV', now);
    box(PANEL.x, PANEL.y, PANEL.w, PANEL.h, C.line, 2);
    drawPage(t);
    drawSide(now);
    text('STATUS: TEXT SERVICE  //  DR1  //  ' + (loading ? 'SEARCHING' : 'PAGE ' + page), 96, 1030, { size: 22, color: C.text, spacing: 2 });
    text('0-9 SIDE   ↑↓←→ VÆLG   OK GÅ   CH± SIDE   BACK', W - 96, 1030, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }

  function key(code) {
    var data = pages[page];
    if (code >= 48 && code <= 57) {             // number keys key in a page
      digit(code - 48);
      return true;
    }
    if (focus === 'side') {
      switch (code) {
        case 38: moveSide('up'); return true;
        case 40: moveSide('down'); return true;
        case 39: moveSide('right'); return true;
        case 37: moveSide('left'); return true;
        case 13: activateSide(); return true;
      }
    }
    switch (code) {
      case 38: move('up'); break;
      case 40: move('down'); break;
      case 39: move('right'); break;
      case 37: if (data && data.spots.length) move('left'); else enterSide(12); break;
      case 13: if (data && data.spots[linkIndex]) load(data.spots[linkIndex].page, true); break;
      case 33: load(page >= 899 ? 100 : page + 1, true); break;   // CH+ / page up
      case 34: load(page <= 100 ? 899 : page - 1, true); break;   // CH- / page down
      case 461: case 27: case 8:
        if (typed) { typed = ''; break; }
        if (focus === 'side') { focus = 'page'; break; }
        if (!history.length) return false;  // home
        load(history.pop(), false);
        break;
      default: return false;
    }
    return true;
  }

  function reset() {
    on = true;
    focus = 'page';
    history = [];
    load(page, false);
  }

  function leave() {
    on = false;
    clearTimeout(timer);
    pages = {};
    typed = '';
  }

  window.Teletext = { draw: draw, key: key, reset: reset, leave: leave };
})();
