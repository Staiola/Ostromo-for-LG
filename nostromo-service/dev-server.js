// Local preview server: serves the app (../nostromo) and stands in for the
// webOS service: /api/aircraft and /api/eds/<dataset>?<query>.
// Usage: node nostromo-service/dev-server.js [port]
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var feed = require('./aircraft');
var energy = require('./energy');
var cams = require('./cams');
var teletext = require('./teletext');

var PORT = Number(process.argv[2]) || 8081;
var ROOT = path.join(__dirname, '..', 'nostromo');
var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.otf': 'font/otf'
};

http.createServer(function (req, res) {
  var url = req.url.split('?')[0];

  if (url === '/api/aircraft') {
    feed.getAircraft()
      .then(function (data) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
      })
      .catch(function (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      });
    return;
  }

  // /api/teletext?page=<nnn> -> DR Tekst-TV
  if (url === '/api/teletext') {
    teletext.getPage((/[?&]page=(\d+)/.exec(req.url) || [])[1])
      .then(function (data) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
      })
      .catch(function (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      });
    return;
  }

  // /api/cam?id=<camera> and /api/abyss -> the outpost cameras
  if (url === '/api/cam' || url === '/api/abyss') {
    var id = (/[?&]id=([^&]+)/.exec(req.url) || [])[1];
    (url === '/api/cam' ? cams.getStill(decodeURIComponent(id || '')) : cams.getClip())
      .then(function (data) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
      })
      .catch(function (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      });
    return;
  }

  // /api/eds/<dataset>?<query> -> Energi Data Service
  if (url.indexOf('/api/eds/') === 0) {
    var query = req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?') + 1) : '';
    energy.fetchDataset(url.slice('/api/eds/'.length), query)
      .then(function (body) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(body);
      })
      .catch(function (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      });
    return;
  }

  var file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : decodeURIComponent(url)));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, body) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}).listen(PORT, function () {
  console.log('UnterFace preview on http://localhost:' + PORT);
});
