// A client for an LG TV's remote-control service (SSAP, the one LG's phone app
// uses), on port 3001. Developer-mode apps are refused things like "which app
// is in front"; a paired remote-control client is allowed them. Pairing shows
// a prompt on the TV once; the key it returns lets later connections in
// without asking. A minimal WebSocket client with no dependencies: text
// frames, ping/pong, no extensions.
'use strict';

var tls = require('tls');
var net = require('net');
var crypto = require('crypto');

// Unsigned on purpose: newer firmware rejects the signed manifest open-source
// clients share ("blacklisted certificate") but accepts an unsigned one.
var PERMISSIONS = ['LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CLOSE', 'READ_APP_STATUS', 'READ_RUNNING_APPS',
  'READ_INSTALLED_APPS', 'READ_INPUT_DEVICE_LIST', 'READ_POWER_STATE', 'CONTROL_INPUT_TV'];

function connect(opts) {
  return new Promise(function (resolve, reject) {
    var secure = opts.port === 3001;
    var sock = secure
      ? tls.connect({ host: opts.host, port: opts.port, rejectUnauthorized: false })
      : net.connect({ host: opts.host, port: opts.port });
    var key = crypto.randomBytes(16).toString('base64');
    var buf = Buffer.alloc(0), upgraded = false, handlers = [], closed = false;

    sock.setTimeout(opts.timeout || 15000, function () { sock.destroy(new Error('timeout')); });
    sock.on(secure ? 'secureConnect' : 'connect', function () {
      sock.write('GET ' + (opts.path || '/') + ' HTTP/1.1\r\nHost: ' + opts.host + ':' + opts.port + '\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    sock.on('error', function (e) { if (!upgraded) reject(e); closed = true; handlers.forEach(function (h) { h(null, e); }); });
    sock.on('close', function () { closed = true; handlers.forEach(function (h) { h(null, new Error('closed')); }); });

    function send(text, opcode) {
      var data = Buffer.from(text, 'utf8'), len = data.length, head;
      if (len < 126) { head = Buffer.alloc(2); head[1] = 0x80 | len; }
      else if (len < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
      else { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
      head[0] = 0x80 | (opcode || 1);
      var mask = crypto.randomBytes(4);
      for (var i = 0; i < len; i++) data[i] ^= mask[i % 4];
      sock.write(Buffer.concat([head, mask, data]));
    }

    var partial = [];
    function frames() {
      while (buf.length >= 2) {
        var op = buf[0] & 0x0f, fin = buf[0] & 0x80, len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
        if (buf.length < off + len) return;
        var payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (op === 9) { send(payload.toString('utf8'), 10); continue; }   // ping -> pong
        if (op === 8) { sock.end(); return; }
        if (op === 1 || op === 0) {
          partial.push(payload);
          if (fin) {
            var text = Buffer.concat(partial).toString('utf8');
            partial = [];
            var msg; try { msg = JSON.parse(text); } catch (e) { continue; }
            handlers.slice().forEach(function (h) { h(msg); });
          }
        }
      }
    }

    sock.on('data', function (d) {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        var end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        var head = buf.slice(0, end).toString();
        buf = buf.slice(end + 4);
        if (!/^HTTP\/1\.1 101/.test(head)) { sock.destroy(); return reject(new Error('no upgrade: ' + head.split('\r\n')[0])); }
        upgraded = true;
        sock.setTimeout(0);
        resolve({
          send: function (obj) { send(JSON.stringify(obj)); },
          sendText: function (str) { send(str); },
          on: function (h) { handlers.push(h); },
          off: function (h) { handlers = handlers.filter(function (x) { return x !== h; }); },
          close: function () { if (!closed) { send('', 8); sock.end(); } }
        });
      }
      frames();
    });
  });
}

// connect and pair; resolves { ws, key } once the TV accepts
function session(opts) {
  return connect(opts).then(function (ws) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { ws.close(); reject(new Error('pairing timed out')); }, opts.pairTimeout || 90000);
      ws.on(function h(msg, err) {
        if (err) { clearTimeout(t); return reject(err); }
        if (msg.id !== 'register_0') return;
        if (msg.type === 'registered') { clearTimeout(t); ws.off(h); resolve({ ws: ws, key: msg.payload['client-key'] }); }
        else if (msg.type === 'error') { clearTimeout(t); ws.close(); reject(new Error(msg.error || 'pairing refused')); }
      });
      var payload = { forcePairing: false, pairingType: 'PROMPT',
        manifest: { manifestVersion: 1, appVersion: '1.1', permissions: PERMISSIONS } };
      if (opts.key) payload['client-key'] = opts.key;
      ws.send({ type: 'register', id: 'register_0', payload: payload });
    });
  });
}

// one request over an open session
var n = 0;
function request(ws, uri, payload) {
  var id = 'r' + (++n);
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { ws.off(h); reject(new Error('no answer to ' + uri)); }, 10000);
    function h(msg, err) {
      if (err) { clearTimeout(t); ws.off(h); return reject(err); }
      if (msg.id !== id) return;
      clearTimeout(t); ws.off(h); resolve(msg);
    }
    ws.on(h);
    ws.send({ type: 'request', id: id, uri: uri, payload: payload || {} });
  });
}

// press a remote button (HOME, BACK, UP, ENTER...) through the pointer socket
function button(ws, name) {
  return request(ws, 'ssap://com.webos.service.networkinput/getPointerInputSocket').then(function (r) {
    var m = /^wss?:\/\/([^:/]+):(\d+)(\/.*)$/.exec(r.payload.socketPath || '');
    if (!m) throw new Error('no pointer socket');
    return connect({ host: m[1], port: +m[2], path: m[3] }).then(function (p) {
      p.sendText('type:button\nname:' + name + '\n\n');
      setTimeout(p.close, 300);
    });
  });
}

module.exports = { connect: connect, session: session, request: request, button: button };
