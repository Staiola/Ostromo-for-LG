// DR Tekst-TV from DR's old (2006) CGI, which still serves live pages:
// https://www.dr.dk/cgi-bin/fttx1.exe/<page>. Each page is the 40-column
// teletext grid inside one <PRE>, with page references as links and Danish
// letters as HTML entities. Text only: no colours, no mosaic graphics, no
// subpages. No CORS headers either, hence this service.
'use strict';

var https = require('https');

var BASE = 'https://www.dr.dk/cgi-bin/fttx1.exe/';
var CACHE_MS = 30 * 1000;
var cache = {}; // page -> { at, result }

var ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aelig: 'æ', oslash: 'ø', aring: 'å', AElig: 'Æ', Oslash: 'Ø', Aring: 'Å',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  eacute: 'é', egrave: 'è', Eacute: 'É', aacute: 'á', oacute: 'ó', iacute: 'í',
  ntilde: 'ñ', ccedil: 'ç', szlig: 'ß', deg: '°', middot: '·', ndash: '–', mdash: '—'
};

function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, function (m, e) {
    if (e[0] === '#') return String.fromCharCode(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES.hasOwnProperty(e) ? ENTITIES[e] : m;
  });
}

function get(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { headers: { 'User-Agent': 'UnterFace/0.1 (personal TV display)' } }, function (res) {
      var chunks = [];
      res.on('data', function (d) { chunks.push(d); });
      res.on('end', function () {
        if (res.statusCode !== 200) return reject(new Error('Tekst-TV HTTP ' + res.statusCode));
        resolve(Buffer.concat(chunks).toString('latin1')); // entities carry the Danish letters anyway
      });
    });
    req.setTimeout(10000, function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// { page, lines: [..] (empty if the page doesn't exist), links: [page numbers] }
function getPage(page) {
  page = parseInt(page, 10);
  if (!(page >= 100 && page <= 899)) return Promise.reject(new Error('no such page ' + page));
  var hit = cache[page];
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.result);
  return get(BASE + page).then(function (html) {
    var pre = (/<PRE>([\s\S]*?)<\/PRE>/i.exec(html) || [])[1] || '';
    var links = [], re = /<a[^>]*>(\d{3})<\/a>/gi, m;
    while ((m = re.exec(pre))) if (links.indexOf(+m[1]) < 0) links.push(+m[1]);
    var lines = decode(pre.replace(/<[^>]+>/g, '')).replace(/\r/g, '').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    var result = { page: page, lines: lines, links: links };
    cache[page] = { at: Date.now(), result: result };
    // keep the cache small: pages nobody looked at for a while go
    Object.keys(cache).forEach(function (k) { if (Date.now() - cache[k].at > CACHE_MS * 4) delete cache[k]; });
    return result;
  });
}

module.exports = { getPage: getPage };
