#!/usr/bin/env python3
"""Sound set B: every sound UnterFace plays, synthesised from scratch, so the
public build has sounds that are ours to hand out. Writes 16-bit mono WAVs and
an index.json to nostromo/sfx-b/. Plain Python, no packages; the same seed
gives the same files.

    python3 scripts/make-sounds-b.py

Each sound is a function below; change a number, run it again, listen. Or
replace any WAV with one made in Logic, keeping the file name.
"""
import json
import math
import os
import random
import struct
import wave

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'nostromo', 'sfx-b')
rnd = random.Random(2026)


# --- building blocks ------------------------------------------------------------

def silence(sec):
    return [0.0] * int(SR * sec)


def tone(freq, sec, shape='sine', phase=0.0):
    n = int(SR * sec)
    out = []
    for i in range(n):
        p = (phase + freq * i / SR) % 1.0
        if shape == 'sine':
            v = math.sin(2 * math.pi * p)
        elif shape == 'square':
            v = 1.0 if p < 0.5 else -1.0
        elif shape == 'tri':
            v = 4 * abs(p - 0.5) - 1
        else:
            v = 2 * p - 1
        out.append(v)
    return out


def glide(f0, f1, sec, shape='sine'):
    n = int(SR * sec)
    out, ph = [], 0.0
    for i in range(n):
        f = f0 * (f1 / f0) ** (i / max(1, n - 1))
        ph = (ph + f / SR) % 1.0
        out.append(math.sin(2 * math.pi * ph) if shape == 'sine' else (1.0 if ph < 0.5 else -1.0))
    return out


def noise(sec):
    return [rnd.uniform(-1, 1) for _ in range(int(SR * sec))]


def lowpass(x, cutoff):
    a = 1 - math.exp(-2 * math.pi * cutoff / SR)
    y, out = 0.0, []
    for v in x:
        y += a * (v - y)
        out.append(y)
    return out


def highpass(x, cutoff):
    low = lowpass(x, cutoff)
    return [a - b for a, b in zip(x, low)]


def bandpass(x, lo, hi):
    return lowpass(highpass(x, lo), hi)


def env(x, attack, decay_to_end=True, hold=0.0, curve=4.0):
    """attack seconds of linear rise, optional hold, then an exponential fall to the end"""
    n, a, h = len(x), int(SR * attack), int(SR * hold)
    out = []
    for i, v in enumerate(x):
        if i < a:
            g = i / max(1, a)
        elif i < a + h or not decay_to_end:
            g = 1.0
        else:
            t = (i - a - h) / max(1, n - a - h)
            g = math.exp(-curve * t) * (1 - t)
        out.append(v * g)
    return out


def mix(*parts):
    n = max(len(p) for p in parts)
    return [sum(p[i] if i < len(p) else 0.0 for p in parts) for i in range(n)]


def gain(x, g):
    return [v * g for v in x]


def at(x, sec, total):
    """place x starting at sec inside a buffer of total seconds"""
    out = silence(total)
    s = int(SR * sec)
    for i, v in enumerate(x):
        if s + i < len(out):
            out[s + i] += v
    return out


def saturate(x, drive=1.5):
    return [math.tanh(v * drive) / math.tanh(drive) for v in x]


def normalise(x, peak):
    m = max(abs(v) for v in x) or 1.0
    return [v * peak / m for v in x]


def write(name, x, peak=0.5):
    x = normalise(x, peak)
    path = os.path.join(OUT, name + '.wav')
    with wave.open(path, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, v)) * 32767)) for v in x))
    print('%-24s %5.3f s' % (name, len(x) / SR))
    return name + '.wav'


# --- the sounds -----------------------------------------------------------------

def key_blip():
    # one typed letter: a single short, bright tick. Letters come every 32 ms,
    # so the blip is over in about 20 ms and they never run into each other.
    body = env(lowpass(tone(1900, 0.02, 'square'), 6000), 0.0008, curve=6)
    tick = env(highpass(noise(0.004), 3000), 0.0002, curve=8)
    return mix(gain(body, 0.8), gain(tick, 0.25)) + silence(0.004)


def line_end():
    # the end of a line: a lower, rounder blip with a soft click in front
    click = env(bandpass(noise(0.006), 800, 4000), 0.0005, curve=6)
    body = env(lowpass(tone(240, 0.064, 'square'), 1400), 0.004, hold=0.03, curve=3)
    return mix(gain(click, 0.4), at(body, 0.004, 0.07))


def done():
    # the readout finished: two low blips, the second a step lower
    a = env(lowpass(tone(260, 0.075, 'square'), 1300), 0.004, hold=0.04, curve=3)
    b = env(lowpass(tone(196, 0.085, 'square'), 1200), 0.004, hold=0.05, curve=3)
    return mix(at(a, 0, 0.23), at(b, 0.135, 0.23))


def thinking():
    # the machine thinking while the boot card plots: a run of short, quiet
    # data blips at random pitches, with gaps, over a faint hum
    total = 1.6
    out = silence(total)
    t = 0.02
    while t < total - 0.05:
        f = rnd.choice([330, 392, 440, 523, 587, 659, 784, 880, 1047, 1175])
        d = rnd.choice([0.018, 0.024, 0.03, 0.04])
        blip = env(lowpass(tone(f, d, 'square'), 2400), 0.002, hold=d * 0.6, curve=2)
        out = mix(out, at(gain(blip, rnd.uniform(0.5, 1.0)), t, total))
        t += d + rnd.choice([0.004, 0.008, 0.012, 0.03, 0.06])
    hum = gain(lowpass(tone(110, total, 'tri'), 300), 0.06)
    return mix(out, hum)


def tracker_ping():
    # the tracker sending a pulse: a power jolt. An instant crack of bright
    # noise, a short burst of mains buzz and a low pop under it, all over in
    # about 60 ms.
    crack = env(highpass(noise(0.012), 3500), 0.0003, curve=9)
    buzz = env(lowpass(mix(tone(180, 0.05, 'square'), gain(tone(270, 0.05, 'saw'), 0.6)), 2800), 0.0006, curve=6)
    pop = env(glide(520, 150, 0.06), 0.0004, curve=6)
    return saturate(mix(gain(crack, 0.8), gain(buzz, 0.45), pop), 2.5)


def gun_loop():
    # ten rounds in 0.708 s (about 14 a second), each a crack of noise over a
    # low thump, slightly different every time, built to loop without a seam
    total, shots = 0.708, 10
    period = total / shots
    out = silence(total)
    for k in range(shots):
        crack = env(bandpass(noise(0.05), 700, rnd.uniform(3500, 5500)), 0.0008, curve=7)
        thump = env(glide(rnd.uniform(110, 135), 55, 0.06), 0.001, curve=5)
        shot = mix(gain(crack, rnd.uniform(0.75, 1.0)), gain(thump, 0.9))
        out = mix(out, at(saturate(shot, 2.2), k * period + rnd.uniform(0, 0.004), total))
    # a bed of mechanism noise so the gaps aren't dead silence
    bed = gain(lowpass(noise(total), 900), 0.08)
    return mix(out, bed)


def main():
    os.makedirs(OUT, exist_ok=True)
    files = {
        'writing_a_veryshort_1': write('writing_a_veryshort_1', key_blip(), 0.32),
        # the rest of the intro (line end, done, thinking) is left out of set B on purpose
        'ping_01': write('ping_01', tracker_ping(), 0.55),
        # the return beep is Jesper's own synth sonar, made in Logic, not generated here
        'beep_level1_NOhandles': 'sonar.m4a',
        # the app plays the gun at 8x, made for a recording that peaks at -30 dB
        'machinegun_1_short': write('machinegun_1_short', gun_loop(), 0.04),
    }
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(files, f, indent=1)
    with open(os.path.join(OUT, 'README.txt'), 'w') as f:
        f.write('Sound set B for UnterFace. The WAVs are synthesised from scratch by\n'
                'scripts/make-sounds-b.py; sonar.m4a was made on a synth in Logic by Jesper GB Henriksen.\n'
                'No recordings or samples from anywhere else are used.\n')


if __name__ == '__main__':
    main()
