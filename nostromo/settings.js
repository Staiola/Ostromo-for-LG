// Settings: what is on this particular TV. Saved on the TV (localStorage).
// Until something is saved, preset.js (if the build has one) supplies a
// starting point, and otherwise the generic defaults below.
// Changing settings restarts the app, so every screen reads them once at load.
(function () {
  'use strict';

  var KEY = 'unterface.settings';
  var SKIP_BOOT = 'unterface.skipBoot';

  // Streaming apps a viewing tile can launch. `id` is the webOS app id;
  // `android` the Android TV package names, looked for first on Android, as a
  // name can differ between TVs and app versions. `match` finds the app by
  // its title where neither is listed (on webOS, dev-mode apps are refused,
  // so check an id by opening the app and running `ares-launch -d tv --running`).
  var APPS = {
    netflix: { name: 'NETFLIX', code: 'NFX', id: 'netflix', android: ['com.netflix.ninja'], match: /netflix/i },
    youtube: { name: 'YOUTUBE', code: 'YTB', id: 'youtube.leanback.v4', android: ['com.google.android.youtube.tv'], match: /youtube/i },
    prime: { name: 'PRIME', code: 'PRM', id: 'amazon', android: ['com.amazon.amazonvideo.livingroom'], match: /prime video|amazon/i },
    disney: { name: 'DISNEY+', code: 'DIS', id: 'com.disney.disneyplus-prod', android: ['com.disney.disneyplus'], match: /disney/i },
    hbo: { name: 'HBO MAX', code: 'HBO', id: 'com.wbd.stream', android: ['com.wbd.stream'], match: /hbo|^max$/i },
    appletv: { name: 'APPLE TV', code: 'ATV', id: 'com.apple.appletv', android: ['com.apple.atve.androidtv.appletv'], match: /apple tv/i },
    spotify: { name: 'SPOTIFY', code: 'SPT', id: 'spotify-beehive', android: ['com.spotify.tv.android'], match: /spotify/i },  // webOS id not checked
    plex: { name: 'PLEX', code: 'PLX', id: 'cdp-30', android: ['com.plexapp.android'], match: /plex/i },                   // webOS id not checked
    drtv: { name: 'DR TV', code: 'DR', screen: 'tv', foot: 'DR1 · DR2 · TVA' }      // Denmark only
  };
  var APP_CHOICES = ['none', 'netflix', 'youtube', 'prime', 'disney', 'hbo', 'appletv', 'spotify', 'plex', 'drtv'];

  var DEVICES = ['off', 'APPLE TV', 'PLAYSTATION 5', 'XBOX', 'NINTENDO SWITCH', 'CHROMECAST', 'BLU-RAY',
    'PC', 'CABLE BOX', 'GAME CONSOLE', 'MEDIA PLAYER'];

  // Electricity prices. Denmark: Energinet's open data, spot + state tariffs
  // + tax + VAT (+ a grid company's nettarif and a supplier markup if set).
  // Elsewhere one public price per area, in the local unit, from APIs that
  // answer browsers (no service needed): `source` says which (see power.js).
  var POWER = {
    off: { label: 'OFF', off: true },
    DK1: { label: 'DK1 · WEST', area: 'DK1', gridOwner: null, gridCode: null, gridName: 'NO NETTARIF',
      supplierMarkup: 0, supplierName: 'SUPPLIER', vat: 0.25 },
    DK2: { label: 'DK2 · EAST', area: 'DK2', gridOwner: null, gridCode: null, gridName: 'NO NETTARIF',
      supplierMarkup: 0, supplierName: 'SUPPLIER', vat: 0.25 },
    // Andel Energi's markup isn't public data: 0.111 kr/kWh excl. VAT was
    // derived from their FlexEnergi price for 20 Oct 2026 10-11.
    'DK2-RADIUS-ANDEL': { label: 'DK2 · RADIUS · ANDEL', area: 'DK2', gridOwner: 'Radius Elnet A/S',
      gridCode: 'DT_C_01', gridName: 'RADIUS C', supplierMarkup: 0.111, supplierName: 'ANDEL FLEX', vat: 0.25 },
    // Nord Pool spot via elprisetjustnu.se (Sweden) and hvakosterstrommen.no
    // (Norway), before energy tax, grid and VAT
    SE1: { label: 'SE1 · LULEÅ', area: 'SE1', source: 'elpris', country: 'SE', unit: 'ÖRE/KWH', decimals: 1 },
    SE2: { label: 'SE2 · SUNDSVALL', area: 'SE2', source: 'elpris', country: 'SE', unit: 'ÖRE/KWH', decimals: 1 },
    SE3: { label: 'SE3 · STOCKHOLM', area: 'SE3', source: 'elpris', country: 'SE', unit: 'ÖRE/KWH', decimals: 1 },
    SE4: { label: 'SE4 · MALMÖ', area: 'SE4', source: 'elpris', country: 'SE', unit: 'ÖRE/KWH', decimals: 1 },
    NO1: { label: 'NO1 · OSLO', area: 'NO1', source: 'elpris', country: 'NO', unit: 'ØRE/KWH', decimals: 1 },
    NO2: { label: 'NO2 · KRISTIANSAND', area: 'NO2', source: 'elpris', country: 'NO', unit: 'ØRE/KWH', decimals: 1 },
    NO3: { label: 'NO3 · TRONDHEIM', area: 'NO3', source: 'elpris', country: 'NO', unit: 'ØRE/KWH', decimals: 1 },
    NO4: { label: 'NO4 · TROMSØ', area: 'NO4', source: 'elpris', country: 'NO', unit: 'ØRE/KWH', decimals: 1 },
    NO5: { label: 'NO5 · BERGEN', area: 'NO5', source: 'elpris', country: 'NO', unit: 'ØRE/KWH', decimals: 1 },
    // EPEX day-ahead for Germany, via the same Energi Data Service dataset
    DE: { label: 'DE · GERMANY', area: 'DE', source: 'eds-eur', unit: 'CT/KWH', decimals: 1 },
    // Octopus Agile: a real household tariff that follows the wholesale
    // price every half hour, VAT included. Region C is London.
    'GB-C': { label: 'GB · LONDON · AGILE', area: 'GB-C', region: 'C', source: 'agile', unit: 'P/KWH', decimals: 1 },
    // NYISO day-ahead for New York City (zone J), wholesale, through the
    // app's service since NYISO doesn't answer browsers
    NYC: { label: 'US · NEW YORK CITY', area: 'NYC', source: 'nyiso', unit: 'CENTS/KWH', decimals: 1 },
    // AEMO: the east-coast grid's (NEM) 5-minute wholesale price per region,
    // what Amber Electric customers pay through; Western Australia isn't in it
    NSW1: { label: 'AU · NSW · SYDNEY', area: 'NSW1', source: 'aemo', unit: 'C/KWH', decimals: 1 },
    VIC1: { label: 'AU · VIC · MELBOURNE', area: 'VIC1', source: 'aemo', unit: 'C/KWH', decimals: 1 },
    QLD1: { label: 'AU · QLD · BRISBANE', area: 'QLD1', source: 'aemo', unit: 'C/KWH', decimals: 1 },
    SA1: { label: 'AU · SA · ADELAIDE', area: 'SA1', source: 'aemo', unit: 'C/KWH', decimals: 1 },
    TAS1: { label: 'AU · TAS · HOBART', area: 'TAS1', source: 'aemo', unit: 'C/KWH', decimals: 1 }
  };
  // Teletext services the TELETEXT cell can show (teletext.js has the rest)
  var TELETEXT = {
    off: { label: 'OFF' },
    dr: { label: 'DR TEKST-TV · DK', name: 'DR TEKST-TV', short: 'DR' },
    svt: { label: 'SVT TEXT · SE', name: 'SVT TEXT', short: 'SVT' },
    ard: { label: 'ARD TEXT · DE', name: 'ARD TEXT', short: 'ARD' }
  };
  var TELETEXT_CHOICES = ['off', 'dr', 'svt', 'ard'];

  var POWER_CHOICES = ['off', 'DK1', 'DK2', 'DK2-RADIUS-ANDEL', 'SE1', 'SE2', 'SE3', 'SE4',
    'NO1', 'NO2', 'NO3', 'NO4', 'NO5', 'DE', 'GB-C', 'NYC', 'NSW1', 'VIC1', 'QLD1', 'SA1', 'TAS1'];

  // the public build has only sound set B (see sound.js)
  var RELEASE = !!window.UNTERFACE_RELEASE;
  // set A is recordings that live only on the TV whose preset.js asks for them;
  // anywhere else (the public build, or the code built from GitHub) it isn't offered
  var HAS_SET_A = !RELEASE && !!window.UNTERFACE_PRESET && window.UNTERFACE_PRESET.sound === 'a';
  var SOUND_CHOICES = HAS_SET_A ? ['a', 'b', 'off'] : ['b', 'off'];
  var SOUND_LABELS = { a: 'SET A · RECORDED', b: 'SET B · SYNTH', off: 'OFF' };

  var DEFAULTS = {
    viewing: ['netflix', 'youtube', 'prime', 'disney', 'none', 'none'],
    inputs: [{ device: 'off', port: 1 }, { device: 'off', port: 2 }],
    power: 'off',
    airport: 'EKCH',
    teletext: 'off',
    // set A is recordings that live only on the TV that has them (preset.js
    // says so); everyone else starts on set B
    sound: HAS_SET_A ? 'a' : 'b'
  };

  // A TV that has never been set up starts with the airport, power prices
  // and teletext of where it is, going by its time zone. (Denmark has two
  // price areas and the time zone can't tell them apart, so power stays off.)
  var REGIONS = {
    'Europe/Copenhagen': { airport: 'EKCH', teletext: 'dr' },
    'Europe/Stockholm': { airport: 'ESSA', power: 'SE3', teletext: 'svt' },
    'Europe/Oslo': { airport: 'ENGM', power: 'NO1' },
    'Europe/Berlin': { airport: 'EDDB', power: 'DE', teletext: 'ard' },
    'Europe/Paris': { airport: 'LFPG' },
    'Europe/London': { airport: 'EGLL', power: 'GB-C' },
    'America/New_York': { airport: 'KJFK', power: 'NYC' },
    'Australia/Sydney': { airport: 'YSSY', power: 'NSW1' },
    'Australia/Melbourne': { airport: 'YMML', power: 'VIC1' },
    'Australia/Brisbane': { airport: 'YBBN', power: 'QLD1' },
    'Australia/Adelaide': { airport: 'YPAD', power: 'SA1' },
    'Australia/Hobart': { airport: 'YMML', power: 'TAS1' },
    'Australia/Perth': { airport: 'YPPH' }
  };
  var zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* no Intl time zones */ }
  var region = REGIONS[zone] || {};
  Object.keys(region).forEach(function (k) { DEFAULTS[k] = region[k]; });

  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  // keep only values we know, so an old or hand-edited save can't break a screen
  function clean(s) {
    var out = copy(DEFAULTS);
    if (!s) return out;
    if (Array.isArray(s.viewing)) for (var i = 0; i < 6; i++) if (APP_CHOICES.indexOf(s.viewing[i]) >= 0) out.viewing[i] = s.viewing[i];
    if (Array.isArray(s.inputs)) for (var j = 0; j < 2; j++) {
      var inp = s.inputs[j] || {};
      if (DEVICES.indexOf(inp.device) >= 0) out.inputs[j].device = inp.device;
      if (inp.port >= 1 && inp.port <= 4) out.inputs[j].port = inp.port;
    }
    if (POWER_CHOICES.indexOf(s.power) >= 0) out.power = s.power;
    if (window.AIRPORT_CHOICES.indexOf(s.airport) >= 0) out.airport = s.airport;
    // before Sweden and Germany, teletext was DR or nothing: true / false
    if (typeof s.teletext === 'boolean') out.teletext = s.teletext ? 'dr' : 'off';
    if (TELETEXT_CHOICES.indexOf(s.teletext) >= 0) out.teletext = s.teletext;
    if (SOUND_CHOICES.indexOf(s.sound) >= 0) out.sound = s.sound;
    return out;
  }

  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* none, or storage blocked */ }
  var configured = !!saved || !!window.UNTERFACE_PRESET;
  var current = clean(saved || window.UNTERFACE_PRESET);

  // the power screen and the radar read these when they load
  window.UNTERFACE_POWER = POWER[current.power];
  window.UNTERFACE_AIRPORT = window.AIRPORTS[current.airport];

  var skipBoot = false;
  try { skipBoot = sessionStorage.getItem(SKIP_BOOT) === '1'; sessionStorage.removeItem(SKIP_BOOT); } catch (e) { /* fine */ }

  window.Settings = {
    APPS: APPS, APP_CHOICES: APP_CHOICES, TELETEXT: TELETEXT, TELETEXT_CHOICES: TELETEXT_CHOICES, SOUND_CHOICES: SOUND_CHOICES, SOUND_LABELS: SOUND_LABELS, DEVICES: DEVICES, POWER: POWER, POWER_CHOICES: POWER_CHOICES,
    get: function () { return copy(current); },
    configured: function () { return configured; },
    skipBoot: function () { return skipBoot; },
    // save and restart, straight back into the app without the boot card
    save: function (s) {
      try {
        localStorage.setItem(KEY, JSON.stringify(clean(s)));
        sessionStorage.setItem(SKIP_BOOT, '1');
      } catch (e) { /* storage blocked: nowhere to keep it, so the restart drops it */ }
      location.reload();
    }
  };
})();
