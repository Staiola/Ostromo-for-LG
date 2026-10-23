#!/usr/bin/env node
// Sends the TV's Home button to UnterFace instead of LG's home.
//
// webOS won't let an app replace Home, or even see which app is in front, so
// this runs on another always-on machine on the same network (here, the Mac).
// It watches the foreground app over the TV's remote-control service and, the
// moment LG's home appears, opens UnterFace on top. LG's home shows briefly.
//
//   node home-watch.js 192.168.1.50
//
// Press Home twice within ESCAPE_MS to stay on LG's home (for its settings).
// The first run shows a pairing prompt on the TV: accept it. The key is kept
// in ~/.config/unterface/tv-keys.json.
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var ssap = require('./ssap');

var LAUNCHER = 'com.unterface.nostromo';
var LG_HOME = 'com.webos.app.home';
var ESCAPE_MS = 3000;
var CHECK_MS = 60 * 1000;   // a request now and then, so a dead connection is noticed
var KEYS = path.join(os.homedir(), '.config', 'unterface', 'tv-keys.json');

var host = process.argv[2] || process.env.TV_HOST;
if (!host) { console.error('usage: home-watch.js <TV IP>'); process.exit(1); }

function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(console, [new Date().toISOString().replace('T', ' ').slice(0, 19)].concat(args));
}

function loadKeys() { try { return JSON.parse(fs.readFileSync(KEYS, 'utf8')); } catch (e) { return {}; } }
function saveKey(key) {
  var keys = loadKeys();
  if (keys[host] === key) return;
  keys[host] = key;
  fs.mkdirSync(path.dirname(KEYS), { recursive: true });
  fs.writeFileSync(KEYS, JSON.stringify(keys, null, 1));
}

function watch() {
  return ssap.session({ host: host, port: 3001, key: loadKeys()[host] }).then(function (s) {
    saveKey(s.key);
    log('connected to', host);
    var ws = s.ws, lastRedirect = 0;
    return new Promise(function (resolve) {
      var check = setInterval(function () {
        ssap.request(ws, 'ssap://com.webos.applicationManager/getForegroundAppInfo')
          .catch(function () { log('no answer, reconnecting'); ws.close(); finish(); });
      }, CHECK_MS);
      function finish() { clearInterval(check); resolve(); }

      ws.on(function (msg, err) {
        if (err) { log('disconnected:', err.message); return finish(); }
        if (msg.id !== 'fg' || !msg.payload) return;
        if (msg.payload.appId !== LG_HOME) return;
        var now = Date.now();
        if (now - lastRedirect < ESCAPE_MS) {
          log('Home pressed twice: staying on LG home');
          lastRedirect = 0;
          return;
        }
        lastRedirect = now;
        ws.send({ type: 'request', id: 'launch', uri: 'ssap://system.launcher/launch', payload: { id: LAUNCHER } });
        log('LG home -> UnterFace');
      });
      ws.send({ type: 'subscribe', id: 'fg', uri: 'ssap://com.webos.applicationManager/getForegroundAppInfo', payload: {} });
    });
  });
}

// TV off, in standby or off the network: keep trying, backing off to 20 s
var delay = 5000;
function loop() {
  watch().then(function () { delay = 5000; }, function (e) {
    log('not connected:', e.message);
    delay = Math.min(delay * 2, 20000);
  }).then(function () { setTimeout(loop, delay); });
}
loop();
