// Settings: what is on this particular TV. Saved on the TV (localStorage).
// Until something is saved, preset.js (if the build has one) supplies a
// starting point, and otherwise the generic defaults below.
// Changing settings restarts the app, so every screen reads them once at load.
(function () {
  'use strict';

  var KEY = 'unterface.settings';
  var SKIP_BOOT = 'unterface.skipBoot';

  // Streaming apps a viewing tile can launch. webOS app ids; `match` finds the
  // real id by title where the TV allows listing launch points (dev-mode apps
  // are refused, so check an id by opening the app and running
  // `ares-launch -d tv --running`).
  var APPS = {
    netflix: { name: 'NETFLIX', code: 'NFX', id: 'netflix', match: /netflix/i },
    youtube: { name: 'YOUTUBE', code: 'YTB', id: 'youtube.leanback.v4', match: /youtube/i },
    prime: { name: 'PRIME', code: 'PRM', id: 'amazon', match: /prime video|amazon/i },
    disney: { name: 'DISNEY+', code: 'DIS', id: 'com.disney.disneyplus-prod', match: /disney/i },
    hbo: { name: 'HBO MAX', code: 'HBO', id: 'com.wbd.stream', match: /hbo/i },
    appletv: { name: 'APPLE TV', code: 'ATV', id: 'com.apple.appletv', match: /apple tv/i },
    spotify: { name: 'SPOTIFY', code: 'SPT', id: 'spotify-beehive', match: /spotify/i },  // id not checked
    plex: { name: 'PLEX', code: 'PLX', id: 'cdp-30', match: /plex/i },                   // id not checked
    drtv: { name: 'DR TV', code: 'DR', screen: 'tv', foot: 'DR1 · DR2 · TVA' }      // Denmark only
  };
  var APP_CHOICES = ['none', 'netflix', 'youtube', 'prime', 'disney', 'hbo', 'appletv', 'spotify', 'plex', 'drtv'];

  var DEVICES = ['off', 'APPLE TV', 'PLAYSTATION 5', 'XBOX', 'NINTENDO SWITCH', 'CHROMECAST', 'BLU-RAY',
    'PC', 'CABLE BOX', 'GAME CONSOLE', 'MEDIA PLAYER'];

  // Electricity prices come from Energinet's open data, so Denmark only.
  // Without a grid company the price is spot + state tariffs + tax + VAT.
  var POWER = {
    off: { label: 'OFF', off: true },
    DK1: { label: 'DK1 · WEST', area: 'DK1', gridOwner: null, gridCode: null, gridName: 'NO NETTARIF',
      supplierMarkup: 0, supplierName: 'SUPPLIER', vat: 0.25 },
    DK2: { label: 'DK2 · EAST', area: 'DK2', gridOwner: null, gridCode: null, gridName: 'NO NETTARIF',
      supplierMarkup: 0, supplierName: 'SUPPLIER', vat: 0.25 },
    // Andel Energi's markup isn't public data: 0.111 kr/kWh excl. VAT was
    // derived from their FlexEnergi price for 20 Oct 2026 10-11.
    'DK2-RADIUS-ANDEL': { label: 'DK2 · RADIUS · ANDEL', area: 'DK2', gridOwner: 'Radius Elnet A/S',
      gridCode: 'DT_C_01', gridName: 'RADIUS C', supplierMarkup: 0.111, supplierName: 'ANDEL FLEX', vat: 0.25 }
  };
  var POWER_CHOICES = ['off', 'DK1', 'DK2', 'DK2-RADIUS-ANDEL'];

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
    teletext: false,
    // set A is recordings that live only on the TV that has them (preset.js
    // says so); everyone else starts on set B
    sound: HAS_SET_A ? 'a' : 'b'
  };

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
    if (typeof s.teletext === 'boolean') out.teletext = s.teletext;
    if (SOUND_CHOICES.indexOf(s.sound) >= 0) out.sound = s.sound;
    return out;
  }

  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* none, or storage blocked */ }
  var configured = !!saved || !!window.UNTERFACE_PRESET;
  var current = clean(saved || window.UNTERFACE_PRESET);

  // the power screen reads this when it loads
  window.UNTERFACE_POWER = POWER[current.power];

  var skipBoot = false;
  try { skipBoot = sessionStorage.getItem(SKIP_BOOT) === '1'; sessionStorage.removeItem(SKIP_BOOT); } catch (e) { /* fine */ }

  window.Settings = {
    APPS: APPS, APP_CHOICES: APP_CHOICES, SOUND_CHOICES: SOUND_CHOICES, SOUND_LABELS: SOUND_LABELS, DEVICES: DEVICES, POWER: POWER, POWER_CHOICES: POWER_CHOICES,
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
