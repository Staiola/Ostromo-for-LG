// Outpost cameras: public webcams at polar research stations, plus the latest
// deep-sea clip from the OOI camera at Axial Seamount. The image hosts send
// no CORS headers, so stills come through here as base64 JPEG (a data: URL in
// the app can be drawn into the WebGL-fed canvas without tainting it).
// Plain Node with https.get, so it runs as the webOS JS service too.
'use strict';

var https = require('https');

var USAP = 'https://www.usap.gov';
var USAP_IMAGE_DIR = USAP + '/videoclipsandmaps/SouthPoleWebcam/';
var CAMHD = 'https://rawdata.oceanobservatories.org/files/RS03ASHS/PN03B/CAMHDA301/';
var STILL_CACHE_MS = 45 * 1000;
var CLIP_CACHE_MS = 10 * 60 * 1000;
var USER_AGENT = 'Ostromo/0.9 (personal TV display)';

// id -> how to get the current image
var CAMS = {
  'sp-aro': { usap: ['South Pole', 'aro'] },
  'sp-dark': { usap: ['South Pole', 'darksector'] },
  'mcm-bore': { usap: ['McMurdo', 'boreSite'] },
  'oresund-east': { url: 'https://www.oresundsbron.com/cams/pyloneast' },
  // the station page links the newest still, whose name carries its time
  'mawson': { page: 'https://www.antarctica.gov.au/antarctic-operations/webcams/mawson/',
    pattern: /https:\/\/images\.antarctica\.gov\.au\/webcams\/mawson\/[^"']+\.jpg/ },
  'gemini-north': { url: 'https://www.gemini.edu/sciops/schedules/obsStatus/currentstill_North.png' },
  'svalbard-zeppelin': { url: 'https://data.npolar.no/_file/zeppelin/camera/Latest/zeppCam2.jpg' }
};

var stills = {}; // id -> { at, result }
var clip = null; // { at, result }

function get(url, binary, redirects) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 4) {
        res.resume();
        var next = res.headers.location.indexOf('http') === 0 ? res.headers.location : new URL(res.headers.location, url).toString();
        return resolve(get(next, binary, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(url + ' -> HTTP ' + res.statusCode)); }
      var chunks = [];
      res.on('data', function (d) { chunks.push(d); });
      res.on('end', function () {
        var buf = Buffer.concat(chunks);
        resolve({ body: binary ? buf : buf.toString('utf8'), modified: res.headers['last-modified'] || null });
      });
    });
    req.setTimeout(15000, function () { req.destroy(new Error('timeout ' + url)); });
    req.on('error', reject);
  });
}

// USAP's page script asks this endpoint for the current file name:
// "spole00022.jpg?=123,Live,Live" or "camera-offline.jpg,Disabled,Seasonal Downtime"
function usapImageUrl(location, camera) {
  var q = '/components/webcams.cfc?method=outputCurrentCamImage&cameraLocation=' +
    encodeURIComponent(location) + '&camera=' + encodeURIComponent(camera);
  return get(USAP + q, false).then(function (r) {
    var parts = r.body.trim().split(',');
    var file = parts[0].split('?')[0];
    if (!file || parts[1] !== 'Live') throw new Error('offline: ' + (parts[2] || 'unknown'));
    return USAP_IMAGE_DIR + file;
  });
}

// drop stills nobody has asked for lately (the Svalbard one alone is 1.5 MB)
function prune() {
  var now = Date.now();
  Object.keys(stills).forEach(function (k) { if (now - stills[k].at > STILL_CACHE_MS) delete stills[k]; });
}

function getStill(id) {
  prune();
  var cam = CAMS[id];
  if (!cam) return Promise.reject(new Error('unknown camera ' + id));
  var hit = stills[id];
  if (hit && Date.now() - hit.at < STILL_CACHE_MS) return Promise.resolve(hit.result);
  var url = cam.usap ? usapImageUrl(cam.usap[0], cam.usap[1])
    : cam.page ? get(cam.page, false).then(function (r) {
      var m = cam.pattern.exec(r.body);
      if (!m) throw new Error('no image on ' + cam.page);
      return m[0];
    })
    : Promise.resolve(cam.url);
  return url.then(function (u) { return get(u, true); }).then(function (r) {
    var result = {
      id: id,
      fetched: Date.now(),
      modified: r.modified ? new Date(r.modified).getTime() : null,
      jpeg: r.body.toString('base64')
    };
    stills[id] = { at: Date.now(), result: result };
    return result;
  });
}

function hrefs(html, pattern) {
  var out = [], re = /href="([^"]+)"/g, m;
  while ((m = re.exec(html))) if (pattern.test(m[1])) out.push(m[1]);
  return out;
}

// newest 14-minute CAMHD clip: walk year/month/day directories backwards
function getClip() {
  if (clip && Date.now() - clip.at < CLIP_CACHE_MS) return Promise.resolve(clip.result);
  function last(path, pattern) {
    return get(CAMHD + path, false).then(function (r) {
      var list = hrefs(r.body, pattern).sort();
      if (!list.length) throw new Error('nothing in ' + path);
      return list;
    });
  }
  return last('', /^\d{4}\/$/).then(function (years) {
    var y = years[years.length - 1];
    return last(y, /^\d{2}\/$/).then(function (months) {
      var m = months[months.length - 1];
      return last(y + m, /^\d{2}\/$/).then(function (days) {
        // today's folder may be empty early in the UTC day: try the last two
        var tryDays = days.slice(-2).reverse();
        function tryDay(i) {
          if (i >= tryDays.length) throw new Error('no clips');
          return last(y + m + tryDays[i], /\.mp4$/).then(function (files) {
            var f = files[files.length - 1];
            var t = /(\d{8})T(\d{6})/.exec(f);
            return {
              url: CAMHD + y + m + tryDays[i] + f,
              start: t ? Date.UTC(+t[1].slice(0, 4), +t[1].slice(4, 6) - 1, +t[1].slice(6, 8),
                +t[2].slice(0, 2), +t[2].slice(2, 4), +t[2].slice(4, 6)) : null
            };
          }, function () { return tryDay(i + 1); });
        }
        return tryDay(0);
      });
    });
  }).then(function (result) {
    clip = { at: Date.now(), result: result };
    return result;
  });
}

module.exports = { getStill: getStill, getClip: getClip, ids: Object.keys(CAMS) };
