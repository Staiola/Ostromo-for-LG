// Live traffic around an airport (Copenhagen unless the app asks for another),
// normalised for the radar.
// Positions: adsb.fi open data (personal, non-commercial use; credit adsb.fi).
// Routes: adsbdb, looked up once per callsign and kept in memory only.
// Plain Node with https.get and no dependencies, so the same file can run as
// the webOS JS service on the TV (older Node, no global fetch).
'use strict';

var https = require('https');

var EKCH = { icao: 'EKCH', lat: 55.6180, lon: 12.6508 };
var RADIUS_NM = 80;
var ROUTE_URL = 'https://api.adsbdb.com/v0/callsign/';

var CACHE_MS = 4000;          // answer repeated polls from memory
var ROUTE_TTL_MS = 6 * 3600 * 1000;
var ROUTE_RETRY_MS = 60 * 1000;   // after an error that wasn't "unknown callsign"
var ROUTE_LOOKUPS_PER_POLL = 8;
var USER_AGENT = 'Ostromo/0.9 (personal TV display)';

var snapshots = {}; // icao -> { result, at, inflight }
var routes = {}; // callsign -> { route, at }

function getJSON(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        if (res.statusCode !== 200) return reject(new Error(url + ' -> HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(8000, function () { req.destroy(new Error('timeout ' + url)); });
    req.on('error', reject);
  });
}

function distanceKm(c, lat, lon) {
  var toRad = Math.PI / 180;
  var dLat = (lat - c.lat) * toRad, dLon = (lon - c.lon) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(c.lat * toRad) * Math.cos(lat * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function place(p) {
  if (!p) return null;
  return { icao: p.icao_code, iata: p.iata_code, city: (p.municipality || p.name || '').toUpperCase() };
}

function lookupRoute(cs) {
  return getJSON(ROUTE_URL + encodeURIComponent(cs))
    .then(function (json) {
      var fr = json && json.response && json.response.flightroute;
      routes[cs] = { route: fr ? { from: place(fr.origin), to: place(fr.destination) } : null, at: Date.now() };
    })
    .catch(function (e) {
      // unknown callsigns (404) are cached as "no route" so we don't ask
      // again; anything else (rate limit, timeout) is tried again soon
      var unknown = / 404$/.test(e.message);
      routes[cs] = { route: null, at: unknown ? Date.now() : Date.now() - ROUTE_TTL_MS + ROUTE_RETRY_MS };
    });
}

function classify(c, a) {
  if (a.route) {
    if (a.route.from && a.route.from.icao === c.icao) return 'DEP';
    if (a.route.to && a.route.to.icao === c.icao) return 'ARR';
    return 'OVR';
  }
  if (a.ground) return 'GND'; // parked or taxiing, direction unknown
  // no route known: low and close to the airport means it's ours
  if (a.alt !== null && a.alt < 10000 && a.distKm < 45) return a.vs < 0 ? 'ARR' : 'DEP';
  return 'OVR';
}

function normalise(c, raw) {
  var cs = (raw.flight || '').trim();
  var ground = raw.alt_baro === 'ground';
  var a = {
    id: raw.hex,
    cs: cs || raw.r || raw.hex.toUpperCase(),
    hasCallsign: !!cs,
    reg: raw.r || null,
    type: raw.t || null,
    lat: raw.lat,
    lon: raw.lon,
    ground: ground,
    alt: ground ? 0 : (typeof raw.alt_baro === 'number' ? raw.alt_baro : (raw.alt_geom || null)),
    gs: raw.gs || 0,
    hdg: typeof raw.track === 'number' ? raw.track : (raw.true_heading || 0),
    vs: raw.baro_rate || raw.geom_rate || 0,
    sqk: raw.squawk || null,
    mlat: !!(raw.mlat && raw.mlat.length),
    seenPos: raw.seen_pos || 0,
    distKm: distanceKm(c, raw.lat, raw.lon)
  };
  var cached = cs && routes[cs];
  a.route = cached ? cached.route : null;
  a.dir = classify(c, a);
  return a;
}

function poll(c) {
  return getJSON('https://opendata.adsb.fi/api/v3/lat/' + c.lat + '/lon/' + c.lon + '/dist/' + RADIUS_NM).then(function (json) {
    var list = (json.ac || []).filter(function (r) {
      // drop airport vehicles: ADS-B categories C1-C3 are surface vehicles
      var vehicle = /^C/.test(r.category || '') || r.t === 'TWR' || r.t === 'GND';
      return typeof r.lat === 'number' && typeof r.lon === 'number' && !vehicle;
    });

    // look up a few routes we haven't seen, nearest first, so the boards
    // fill before the overflights; the rest arrive on later polls (around a
    // busy airport like JFK that can take a few minutes)
    var now = Date.now();
    var missing = list
      .map(function (r) { return { cs: (r.flight || '').trim(), km: distanceKm(c, r.lat, r.lon) }; })
      .sort(function (a, b) { return a.km - b.km; })
      .map(function (r) { return r.cs; })
      .filter(function (cs) { return cs && (!routes[cs] || now - routes[cs].at > ROUTE_TTL_MS); })
      .slice(0, ROUTE_LOOKUPS_PER_POLL);

    return Promise.all(missing.map(lookupRoute)).then(function () {
      return {
        t: json.now ? Math.round(json.now / 1000) : Math.round(now / 1000),
        source: 'adsb.fi',
        routes: 'adsbdb',
        aircraft: list.map(function (r) { return normalise(c, r); })
      };
    });
  });
}

// The airport the app asked for: { icao, lat, lon } (as strings from a query
// string, or numbers), or Kastrup when it didn't say or said nonsense.
function center(p) {
  p = p || {};
  var lat = Number(p.lat), lon = Number(p.lon);
  if (!/^[A-Z]{4}$/.test(p.icao || '') || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return EKCH;
  return { icao: p.icao, lat: lat, lon: lon };
}

// Resolves with the latest snapshot for that airport, at most one upstream
// call per CACHE_MS.
function getAircraft(params) {
  var c = center(params);
  var s = snapshots[c.icao] || (snapshots[c.icao] = { result: null, at: 0, inflight: null });
  if (s.result && Date.now() - s.at < CACHE_MS) return Promise.resolve(s.result);
  if (s.inflight) return s.inflight;
  s.inflight = poll(c)
    .then(function (result) { s.result = result; s.at = Date.now(); return result; })
    .then(function (r) { s.inflight = null; return r; }, function (e) { s.inflight = null; throw e; });
  return s.inflight;
}

module.exports = { getAircraft: getAircraft, EKCH: EKCH };
