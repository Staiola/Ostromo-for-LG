// webOS JS service: fetches flight and electricity data for the app, since the
// TV's web engine can't reach those APIs directly (no CORS for browsers).
// Called from the app as luna://com.unterface.nostromo.service/<method>.
'use strict';

var Service = require('webos-service');
var aircraft = require('./aircraft');
var energy = require('./energy');
var cams = require('./cams');
var teletext = require('./teletext');

var service = new Service('com.unterface.nostromo.service');

function reply(message, promise) {
  promise.then(function (data) {
    message.respond({ returnValue: true, data: data });
  }, function (err) {
    message.respond({ returnValue: false, errorText: String((err && err.message) || err) });
  });
}

// { icao, lat, lon }: live traffic around that airport, normalised (see aircraft.js)
service.register('aircraft', function (message) {
  reply(message, aircraft.getAircraft(message.payload));
});

// { id }: a polar station camera's current still, as base64 JPEG
service.register('cam', function (message) {
  reply(message, cams.getStill((message.payload || {}).id));
});

// the newest deep-sea clip from Axial Seamount: { url, start }
service.register('abyss', function (message) {
  reply(message, cams.getClip());
});

// { page }: a DR Tekst-TV page as text lines plus the page numbers it links to
service.register('teletext', function (message) {
  reply(message, teletext.getPage((message.payload || {}).page));
});

// { day: 'YYYYMMDD' }: NYISO day-ahead zonal prices, { csv }
service.register('nyiso', function (message) {
  reply(message, energy.fetchNyiso((message.payload || {}).day).then(function (csv) { return { csv: csv }; }));
});

// { dataset: 'DayAheadPrices' | 'DatahubPricelist', query: '<raw query string>' }
service.register('eds', function (message) {
  var p = message.payload || {};
  reply(message, energy.fetchDataset(p.dataset, p.query || '').then(JSON.parse));
});
