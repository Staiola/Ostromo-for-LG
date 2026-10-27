// DR live TV, framed in the UI. DR's four channels are plain HLS on Akamai
// (no DRM, geo-limited to Denmark) and their TV guide API answers browsers.
// On webOS, video plays on a hardware plane behind the page and can't be
// drawn into a canvas (tested: black frames), so the <video> sits in the DOM
// and the canvases leave a see-through window where it is.
(function () {
  'use strict';

  var W = K.W, C = K.C, TITLE = K.TITLE;
  var text = K.text, box = K.box, frame = K.frame, pad = K.pad;

  // DR's own channel ids (for the guide) and live HLS addresses
  var CHANNELS = [
    { name: 'DR1', id: '20875', stream: 'https://drlivedr1hls.akamaized.net/hls/live/2113625/drlivedr1/master.m3u8' },
    { name: 'DR2', id: '20876', stream: 'https://drlivedr2hls.akamaized.net/hls/live/2113623/drlivedr2/master.m3u8' },
    { name: 'DR TVA', id: '192099', stream: 'https://drlivedrtvahls.akamaized.net/hls/live/2113613/drlivedrtva/master.m3u8' },
    { name: 'RAMASJANG', id: '20892', stream: 'https://drlivedrrhls.akamaized.net/hls/live/2113621/drlivedrr/master.m3u8' }
  ];
  var GUIDE = 'https://prod95-cdn.dr-massive.com/api/schedules';
  var GUIDE_REFRESH_MS = 5 * 60 * 1000;
  var TAG_MS = 3500; // how long the channel tag shows in full screen

  var LEFT = { x: 96, y: 136, w: 400, h: 844 };
  var MAIN = { x: 520, y: 136, w: 1304, h: 844 };
  // 16:9 picture, sized so the now/next lines still fit under it
  var FEED_W = 1104;
  var FEED = { x: MAIN.x + (MAIN.w - FEED_W) / 2, y: MAIN.y + 80, w: FEED_W, h: Math.round(FEED_W * 9 / 16) };
  var FULL = { x: 0, y: 0, w: W, h: K.H };

  var selected = 0;
  var full = false;
  var on = false;       // between reset() and leave(): only then is there video
  var tunedAt = 0;
  var guide = {};       // channel id -> [{ title, desc, start, end }]

  // --- video -------------------------------------------------------------------

  var video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.style.position = 'absolute';
  video.style.display = 'none';
  video.style.background = 'transparent';
  var wrap = document.getElementById('wrap');
  wrap.insertBefore(video, wrap.firstChild); // under the canvases
  var hls = null;

  // the full-screen channel tag is DOM, above the canvases: anything drawn on
  // the canvas inside the video window would be under the picture
  var tag = document.createElement('div');
  tag.style.cssText = 'position:absolute;left:5%;top:6%;padding:1.2% 1.6%;display:none;' +
    'background:rgba(0,0,0,0.75);border:3px double ' + C.text + ';color:' + C.text + ';' +
    'font:1.3vw "Share Tech Mono",monospace;letter-spacing:0.2em;transition:opacity 600ms;';
  wrap.appendChild(tag);

  // webOS plays HLS natively; desktop Chrome (the Mac preview) needs hls.js.
  // Android's WebView says "maybe", but its native HLS is the old MediaPlayer
  // path, which stalled on re-tune in testing, so it uses hls.js too.
  function native() { return !window.OstromoAndroid && video.canPlayType('application/vnd.apple.mpegurl') !== ''; }

  function loadHls(cb) {
    if (window.Hls) return cb();
    var s = document.createElement('script');
    s.src = 'lib/hls.min.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  function tune(i) {
    selected = i;
    tunedAt = Date.now();
    if (window.Radio && window.Radio.stop) window.Radio.stop(); // one sound at a time
    var url = CHANNELS[i].stream;
    if (native()) {
      video.src = url;
      video.play();
      return;
    }
    loadHls(function () {
      if (hls) hls.destroy();
      hls = new window.Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      video.play();
    });
  }

  function stopVideo() {
    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  // place the <video> over a rect given in 1920x1080 coordinates
  function placeVideo(r) {
    video.style.left = (r.x / W * 100) + '%';
    video.style.top = (r.y / K.H * 100) + '%';
    video.style.width = (r.w / W * 100) + '%';
    video.style.height = (r.h / K.H * 100) + '%';
    video.style.display = 'block';
    window.Fx.setHole(r);
  }

  // --- guide ---------------------------------------------------------------------

  function refreshGuide() {
    // the API takes a UTC date and hour; start an hour back to catch what's on
    var from = new Date(Date.now() - 3600000);
    var q = 'channels=' + CHANNELS.map(function (c) { return c.id; }).join(',') +
      '&date=' + from.toISOString().slice(0, 10) + '&hour=' + from.getUTCHours() +
      '&duration=8&device=web_browser&lang=da&segments=drtv,optedout&sub=Anonymous';
    fetch(GUIDE + '?' + q, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        (list || []).forEach(function (ch) {
          guide[ch.channelId] = (ch.schedules || []).map(function (s) {
            var item = s.item || {};
            return {
              title: (item.title || '').toUpperCase(),
              desc: (item.shortDescription || item.description || '').replace(/\s+/g, ' ').trim().toUpperCase(),
              start: new Date(s.startDate),
              end: new Date(s.endDate)
            };
          });
        });
      })
      .catch(function () {})
      .then(function () { setTimeout(refreshGuide, GUIDE_REFRESH_MS); });
  }

  // what's on now and next on a channel
  function nowNext(ch) {
    var list = guide[ch.id] || [], now = Date.now();
    for (var i = 0; i < list.length; i++) {
      if (list[i].start <= now && list[i].end > now) return { now: list[i], next: list[i + 1] || null };
    }
    return { now: null, next: list[0] || null };
  }

  // --- drawing -------------------------------------------------------------------

  function label(str, x, y) {
    var w = text(str, x, y, { size: 22, color: C.amber, spacing: 5 });
    K.ctx.fillStyle = C.amber;
    K.ctx.fillRect(x, y + 8, w, 2);
  }

  function drawChannels() {
    frame(LEFT.x, LEFT.y, LEFT.w, LEFT.h);
    var x = LEFT.x + 30, w = LEFT.w - 60;
    label('FEEDS', x, LEFT.y + 58);
    CHANNELS.forEach(function (ch, i) {
      var y = LEFT.y + 92 + i * 172, h = 150, on = i === selected;
      var nn = nowNext(ch);
      if (on) { frame(x, y, w, h, C.cyan); K.brackets(x, y, w, h, C.pink); }
      else box(x, y, w, h, C.lineDim, 2);
      text('CH-' + (i + 1), x + 20, y + 40, { size: 22, color: on ? C.amber : C.lineDim, spacing: 3 });
      text(ch.name, x + w - 20, y + 40, { size: 22, color: on ? C.white : C.text, spacing: 3, align: 'right' });
      K.fitText(nn.now ? nn.now.title : 'NO SCHEDULE', x + 20, y + 88, w - 40,
        { font: TITLE, size: 24, color: on ? C.white : C.text, spacing: 2, glow: false });
      if (nn.now) text(K.hhmm(nn.now.start) + '-' + K.hhmm(nn.now.end), x + 20, y + 126, { size: 22, color: on ? C.cyan : C.lineDim, spacing: 2 });
    });
  }

  function drawFeed(t) {
    frame(MAIN.x, MAIN.y, MAIN.w, MAIN.h);
    var x = MAIN.x + 34;
    label('VISUAL FEED // ' + CHANNELS[selected].name, x, MAIN.y + 52);
    var rec = Math.floor(t / 530) % 2;
    text((rec ? '● ' : '  ') + 'LIVE  ·  1080P50 MAX', MAIN.x + MAIN.w - 34, MAIN.y + 52,
      { size: 22, color: C.red, spacing: 2, align: 'right' });
    box(FEED.x - 6, FEED.y - 6, FEED.w + 12, FEED.h + 12, C.line, 2);

    var nn = nowNext(CHANNELS[selected]), y = FEED.y + FEED.h + 52;
    if (!nn.now) { text('NO SCHEDULE DATA', FEED.x, y, { size: 24, color: C.text, spacing: 2 }); return; }
    K.fitText(nn.now.title, FEED.x, y, FEED.w * 0.62, { font: TITLE, size: 30, color: C.white, spacing: 3 });
    text(K.hhmm(nn.now.start) + '-' + K.hhmm(nn.now.end), FEED.x + FEED.w, y, { size: 24, color: C.text, spacing: 2, align: 'right' });
    var frac = Math.max(0, Math.min(1, (Date.now() - nn.now.start) / (nn.now.end - nn.now.start)));
    var blocks = 40, bw = (FEED.w - (blocks - 1) * 5) / blocks;
    for (var b = 0; b < blocks; b++) {
      var bx = FEED.x + b * (bw + 5);
      if (b < Math.round(frac * blocks)) K.fillBar(bx, y + 18, bw, 14, C.cyan);
      else box(bx, y + 18, bw, 14, C.lineDim, 2);
    }
    if (nn.next) text('NEXT // ' + K.hhmm(nn.next.start) + '  ' + nn.next.title, FEED.x, y + 70, { size: 22, color: C.amber, spacing: 2 });
  }

  function drawStatusBar() {
    text('STATUS: FEED LOCKED  //  DR BROADCAST NET  //  HLS', 96, 1030, { size: 22, color: C.text, spacing: 2 });
    text('↑↓ FEED   OK EXPAND   BACK HOME', W - 96, 1030, { size: 22, color: C.text, spacing: 2, align: 'right' });
  }

  // full screen: all picture, plus a channel tag that fades after a while
  function drawFull(now) {
    K.ctx.clearRect(0, 0, W, K.H);
    var nn = nowNext(CHANNELS[selected]);
    var line = 'CH-' + (selected + 1) + ' // ' + CHANNELS[selected].name + '  ·  ' + K.hhmm(now) +
      (nn.now ? '<br><span style="color:' + C.white + '">' + nn.now.title + '</span>' : '');
    if (tag.innerHTML !== line) tag.innerHTML = line;
    tag.style.display = 'block';
    tag.style.opacity = Date.now() - tunedAt < TAG_MS ? '1' : '0';
  }

  function draw(t, now) {
    // the switch animation still draws this screen after leave(): no video then
    if (on && full) { placeVideo(FULL); drawFull(now); return; }
    tag.style.display = 'none';
    if (on) placeVideo(FEED);
    var nn = nowNext(CHANNELS[selected]);
    var key = [selected, Math.floor(now.getTime() / 1000), Math.floor(t / 530) % 2, nn.now ? nn.now.title : ''].join('|');
    K.cached('tv', key, function () {
      var ctx = K.ctx;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, K.H);
      K.header('VISUAL FEED // DR BROADCAST NET', now);
      drawChannels();
      drawFeed(t);
      drawStatusBar();
    });
    // the window itself, for when the WebGL layer is off (low quality)
    if (on) K.ctx.clearRect(FEED.x, FEED.y, FEED.w, FEED.h);
  }

  function key(code) {
    if (full) {
      if (code === 461 || code === 27 || code === 8 || code === 13) { full = false; return true; }
      if (code === 38 || code === 40) { /* fall through to channel keys */ } else return true;
    }
    switch (code) {
      case 38: tune((selected + CHANNELS.length - 1) % CHANNELS.length); break;
      case 40: tune((selected + 1) % CHANNELS.length); break;
      case 13: full = true; tunedAt = Date.now(); break;
      default: return false;
    }
    return true;
  }

  // entering: flat glass (curvature would bend the frame off the picture), tune
  function reset() {
    on = true;
    full = false;
    window.Fx.override({ curv: 0 });
    tune(selected);
  }

  function leave() {
    on = false;
    full = false;
    stopVideo();
    video.style.display = 'none';
    tag.style.display = 'none';
    window.Fx.setHole(null);
    window.Fx.override(null);
  }

  refreshGuide();

  window.Tv = { draw: draw, key: key, reset: reset, leave: leave };
})();
