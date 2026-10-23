// Sound effects for the boot and the EXECUTE box: recorded effects from sfx/
// (a blip per typed letter, a deeper blip per line, a double blip when done,
// a "thinking" chatter while the card plots) and a synthesised power-on thump.
// The radio's long description types silently. The radio shares this context. Browsers may start audio suspended until
// a key press; unlock() on the first key brings it back.
(function () {
  'use strict';

  var MASTER = 0.6;
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = AC ? new AC() : null;
  var master = null, echo = null;

  if (ctx) {
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);

    // a short feedback delay: the radar blip's sonar echo
    echo = ctx.createDelay(1);
    echo.delayTime.value = 0.21;
    var feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    var damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 900;
    echo.connect(damp);
    damp.connect(feedback);
    feedback.connect(echo);
    damp.connect(master);
  }

  // which set plays: 'a' (sfx/, recordings that stay on this TV), 'b' (sfx-b/,
  // synthesised by scripts/make-sounds-b.py; the public build carries only
  // these) or 'off'. Chosen in SETUP.
  var SET = window.Settings ? window.Settings.get().sound : 'a';

  function ready() { return ctx && ctx.state === 'running' && SET !== 'off'; }

  // --- recorded effects --------------------------------------------------------

  var SAMPLES = [
    'thinking_a_long.m4a', 'writing_a_shortA.m4a', 'writing_a_shortB.m4a', 'writing_a_long.m4a',
    'writing_b_shortA.m4a', 'writing_b_long.m4a', 'writing_c_shortA.m4a', 'writing_c_shortb.m4a',
    'writing_a_veryshort_1.wav', // one burst of a_long: one per typed letter
    // sentry: the tracker's outgoing ping, the return beep (pitched up as
    // contacts close in), and
    // ~10 rounds of the gun, looped while it fires
    'ping_01.m4a', 'beep_level1_NOhandles.m4a', 'machinegun_1_short.wav'
  ];
  // the exported levels ran from ~1.71 kHz (1) to ~2.28 kHz (11): the same
  // span by playback rate
  // the contact beep starts a little below its recorded pitch far out and
  // rises to a third above it close in
  var BEEP_LOW_RATE = 0.85, BEEP_TOP_RATE = 1.33;
  var GUN_GAIN = 8; // the recording peaks around -30 dB
  var buffers = {};
  var starts = {};  // seconds of silence to skip at the head of a sample

  // the beep exports carry different amounts of silence up front (up to half
  // a second): find where the sound really starts so every pulse lands on time
  function leadIn(buf) {
    var d = buf.getChannelData(0), peak = 0, i;
    for (i = 0; i < d.length; i++) if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
    for (i = 0; i < d.length; i++) if (Math.abs(d[i]) > peak * 0.05) break;
    return Math.max(0, i / buf.sampleRate - 0.004);
  }

  // name: what the app asks for; by default the file name without its extension
  function load(dir, file, name) {
    name = name || file.replace(/\.\w+$/, '');
    fetch(dir + file)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (data) {
        // the callback form works on older engines that lack the promise one
        ctx.decodeAudioData(data, function (buf) {
          buffers[name] = buf;
          if (/^(beep|ping)_/.test(name)) starts[name] = leadIn(buf);
        }, function () {});
      })
      .catch(function () {});
  }

  if (ctx && SET === 'a') SAMPLES.forEach(function (file) { load('sfx/', file); });
  // set B lists its files, so they can be WAVs or anything else the engine decodes
  if (ctx && SET === 'b') {
    fetch('sfx-b/index.json').then(function (r) { return r.json(); }).then(function (index) {
      Object.keys(index).forEach(function (name) { load('sfx-b/', index[name], name); });
    }).catch(function () {});
  }

  function sample(name, gain, rate, delay) {
    if (!ready() || !buffers[name]) return;
    var src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buffers[name];
    src.playbackRate.value = rate || 1;
    g.gain.value = gain === undefined ? 1 : gain;
    src.connect(g);
    g.connect(master);
    src.start(ctx.currentTime + (delay || 0), starts[name] || 0);
  }

  var gun = null;

  // the gun runs through overdrive, then a short room: built once, on first fire
  var gunIn = null;
  function gunChain() {
    if (gunIn) return gunIn;
    gunIn = ctx.createGain();
    var drive = ctx.createWaveShaper(), k = 5, n = 1024, curve = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    drive.curve = curve;
    drive.oversample = '2x';
    var dry = ctx.createGain(); dry.gain.value = 0.55;
    var wet = ctx.createGain(); wet.gain.value = 0.3;
    // a room as an impulse: 1.1 s of noise falling away, a little different per side
    var len = Math.floor(ctx.sampleRate * 1.1), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = ir.getChannelData(c);
      for (var j = 0; j < len; j++) d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, 3);
    }
    var room = ctx.createConvolver();
    room.buffer = ir;
    gunIn.connect(drive);
    drive.connect(dry); dry.connect(master);
    drive.connect(room); room.connect(wet); wet.connect(master);
    return gunIn;
  }

  // How typing sounds: 'loop' plays writing_b_long on repeat while any text
  // is being written; 'blips' plays one writing_a_veryshort_1 burst per letter.
  var TYPING_SOUND = 'blips';
  var LOOP_GAIN = 2.2; // b_long is recorded ~10 dB quieter than the rest

  // text types at one letter per burst length (42 ms), so each letter gets
  // exactly one burst and a line sounds like writing_a_long
  var lastKey = 0;
  var KEY_GAP_MS = 30; // letters come every 42 ms, so this only guards doubles

  // the loop runs while any owner (boot, radio, execute box) is typing. Owners
  // report every frame; one that stops reporting (its screen closed) expires.
  var loop = null, typingOwners = {}, OWNER_STALE_MS = 200;
  function updateLoop() {
    var now = Date.now();
    var on = Object.keys(typingOwners).some(function (k) { return now - typingOwners[k] < OWNER_STALE_MS; });
    if (on && !loop && ready() && buffers.writing_b_long) {
      var src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buffers.writing_b_long;
      src.loop = true;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(LOOP_GAIN, ctx.currentTime + 0.03);
      src.connect(g);
      g.connect(master);
      // start somewhere random in the recording so repeats don't sound identical
      src.start(0, Math.random() * buffers.writing_b_long.duration);
      loop = { src: src, gain: g };
    } else if (!on && loop) {
      var l = loop;
      loop = null;
      l.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.04);
      l.src.stop(ctx.currentTime + 0.25);
    }
  }

  // one enveloped oscillator: freq can glide from f0 to f1 over len seconds
  function tone(type, f0, f1, len, peak, dest, delay) {
    var t = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g);
    g.connect(dest || master);
    osc.start(t);
    osc.stop(t + len + 0.05);
    return g;
  }


  var Sound = {
    context: ctx, // shared with the radio, which plays through the same graph

    unlock: function () {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },

    // the tube coming on: a low thump with a little 50 Hz hum riding on it
    powerOn: function () {
      if (!ready() || SET === 'b') return; // set B keeps only the typing from the intro
      tone('sine', 70, 38, 0.9, 0.5);
      tone('triangle', 50, 50, 1.2, 0.05);
    },

    // the machine thinking while the boot card plots on
    thinking: function (rate) { sample('thinking_a_long', 0.9, rate || 1); },

    // a character typed: a short blip, pitch nudged so a run doesn't drone
    key: function (gain) {
      if (TYPING_SOUND !== 'blips') return;
      var now = Date.now();
      if (now - lastKey < KEY_GAP_MS) return;
      lastKey = now;
      sample('writing_a_veryshort_1', gain === undefined ? 1.2 : gain * 1.5);
    },

    // owner says whether it's writing right now (called every frame)
    typing: function (owner, on) {
      if (TYPING_SOUND !== 'loop') return;
      typingOwners[owner] = on ? Date.now() : 0;
      updateLoop();
    },

    // a line finished: the deeper blip
    lineEnd: function () { sample('writing_c_shortA', 0.8); },

    // the whole read-out done: the deep double blip
    done: function () { sample('writing_c_shortb', 0.9); },

    // the motion tracker sending a pulse, on its steady beat
    trackerPing: function () {
      if (!ready()) return;
      sample('ping_01', 1);
    },

    // a contact out there: the beep rises in pitch as it closes in (near 0..1)
    trackerContact: function (near) {
      if (!ready()) return;
      near = Math.max(0, Math.min(1, near));
      sample('beep_level1_NOhandles', 1, BEEP_LOW_RATE + near * (BEEP_TOP_RATE - BEEP_LOW_RATE));
    },

    // the sentry firing: loop the recording while on, fade out quickly when it
    // stops. Each burst starts somewhere else in the loop, a touch faster or
    // slower and louder or softer, so bursts don't all sound the same.
    gun: function (on) {
      if (!ready() || !buffers.machinegun_1_short) return;
      if (on && !gun) {
        var src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buffers.machinegun_1_short;
        src.loop = true;
        src.playbackRate.value = 0.93 + Math.random() * 0.14;
        g.gain.value = GUN_GAIN * (0.8 + Math.random() * 0.3);
        src.connect(g);
        g.connect(gunChain());
        src.start(0, Math.random() * src.buffer.duration);
        gun = { src: src, g: g };
      } else if (!on && gun) {
        var t = ctx.currentTime;
        gun.g.gain.setValueAtTime(gun.g.gain.value, t);
        gun.g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        gun.src.stop(t + 0.1);
        gun = null;
      }
    },

    // a dead feed: band-limited hiss for a while, then the click of the set
    static: function (seconds) {
      if (!ready()) return;
      var len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf;
      bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.6;
      var t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
      g.gain.setValueAtTime(0.22, t + seconds - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t);
      tone('square', 90, 40, 0.06, 0.12, null, seconds);   // the set going off
    },

    // deep sonar blip with a pitch drop and a dark echo tail
    ping: function () {
      if (!ready()) return;
      var dry = tone('sine', 150, 92, 0.75, 0.32);
      dry.connect(echo);
      tone('sine', 300, 184, 0.25, 0.04);
    }
  };

  document.addEventListener('keydown', Sound.unlock, true);
  setInterval(updateLoop, 100); // lets an owner that went quiet fade the loop out
  window.Sound = Sound;
})();
