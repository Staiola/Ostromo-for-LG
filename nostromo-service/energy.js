// Proxy for Energi Data Service and NYISO. Energi Data Service only answers
// browser requests without an Origin header, and NYISO sends no CORS headers,
// so a page (or the TV's web engine) can't call either directly. Only what
// the power screen uses is passed through.
// Plain Node with https.get, so it can run as the webOS JS service too.
'use strict';

var https = require('https');

var BASE = 'https://api.energidataservice.dk/dataset/';
var ALLOWED = { DayAheadPrices: true, DatahubPricelist: true };
var CACHE_MS = 5 * 60 * 1000;
var cache = {}; // url -> { at, body }

function get(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Ostromo/0.9 (personal TV display)' } }, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        if (res.statusCode !== 200) return reject(new Error(url + ' HTTP ' + res.statusCode));
        resolve(body);
      });
    });
    req.setTimeout(10000, function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// dataset: 'DayAheadPrices' | 'DatahubPricelist'; query: the raw query string
function fetchDataset(dataset, query) {
  if (!ALLOWED[dataset]) return Promise.reject(new Error('dataset not allowed: ' + dataset));
  var url = BASE + dataset + (query ? '?' + query : '');
  var hit = cache[url];
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.body);
  return get(url).then(function (body) {
    cache[url] = { at: Date.now(), body: body };
    return body;
  });
}

// NYISO day-ahead zonal prices for one day (YYYYMMDD, New York time) as the
// CSV NYISO publishes; tomorrow's appears around 11:00 New York time
var NYISO = 'https://mis.nyiso.com/public/csv/damlbmp/';

function fetchNyiso(day) {
  if (!/^\d{8}$/.test(day || '')) return Promise.reject(new Error('bad day: ' + day));
  var url = NYISO + day + 'damlbmp_zone.csv';
  var hit = cache[url];
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.body);
  return get(url).then(function (body) {
    cache[url] = { at: Date.now(), body: body };
    return body;
  });
}

module.exports = { fetchDataset: fetchDataset, fetchNyiso: fetchNyiso };
