// Proxy for Energi Data Service. The API only answers browser requests
// without an Origin header, so a page (or the TV's web engine) can't call it
// directly. Only the datasets the power screen uses are passed through.
// Plain Node with https.get, so it can run as the webOS JS service too.
'use strict';

var https = require('https');

var BASE = 'https://api.energidataservice.dk/dataset/';
var ALLOWED = { DayAheadPrices: true, DatahubPricelist: true };
var CACHE_MS = 5 * 60 * 1000;
var cache = {}; // url -> { at, body }

function get(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'UnterFace/0.1 (personal TV display)' } }, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        if (res.statusCode !== 200) return reject(new Error('Energi Data Service HTTP ' + res.statusCode));
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

module.exports = { fetchDataset: fetchDataset };
