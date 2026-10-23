# UnterFace

A home screen for LG webOS TVs that looks like the ship computers in *Alien* and *Aliens*: blue vector lines on black, a worn picture tube, and a boot card that plots itself on. It launches the streaming apps and HDMI inputs, and around them it shows live flights over Kastrup, today's electricity prices, webcams at research stations, NTS radio, DR's teletext and a sentry gun.

![The UnterFace home screen](images/home.jpg)

More about it, with video: [staiola.studio/apps/unterface.html](https://staiola.studio/apps/unterface.html)

## Try it

**Version 0.9.1 is out, as a beta.** Download `unterface_0.9.1.ipk` from the
[latest release](https://github.com/Staiola/unterface-notes/releases/latest) and follow
**[the install guide](INSTALL.md)**. It uses LG's free Developer Mode, so nothing is rooted, and it can be
installed by hand or by asking Claude Code to do it.

Tested on an LG C5 (2025, webOS 25). It's free.

I built it for my own TV and have made it more generic, but it's a beta: expect rough edges, and expect to
tweak it for your own setup. That takes some coding know-how, or a coding agent such as Claude Code to do it
with you. Everything is at your own responsibility.

What to expect:

- A SETUP screen on first start, for your apps, HDMI inputs, power prices and teletext.
- The flight radar is fixed to Copenhagen Airport, and power prices, DR TV and teletext are Danish.
- Sounds are a set made for the public version: typing, the motion tracker and the sentry gun. SETUP can switch them off.
- Home and quitting an app go to LG's home screen. Hold a number key to jump back, or run the optional Home
  watcher from the release on a computer that stays on.

The code itself is in a private repository; this one is for notes and releases.

## Follow along

- On GitHub: **Watch → Custom → Releases** on this repository and you get a notice when there is something to install.
- By email: [jesper@staiola.studio](mailto:jesper@staiola.studio). Tell me which TV you have.

## Notes

**23 October 2026, later.** Version 0.9.1 adds sound. The typing blip, the tracker's ping and the gun are
synthesised in code; the sonar beep for contacts closing in is made on a synth in Logic. The tracker now
pings on a steady beat while the contact beep speeds up and rises as they get closer, and the first contact
of an attack shows at once.

**23 October 2026.** Version 0.9, the first one for other TVs. New since the first notes: a SETUP screen,
UnterFace's own standby screen instead of LG's clock, a smoother frame rate on the C5, symbols the fonts
lacked now drawn by the app, and the film's names swapped for its own (the computer is MA-TH-OR 6200, the
gun an LD 567-C).

**21 October 2026.** First public notes. The home screen, power prices, flight radar, NTS radio, teletext, DR TV, eight webcams and the sentry screen all work on the TV. Two things LG will not let a developer-mode app do: see which app is in front, so quitting Netflix lands on LG's home screen rather than this one, and read the list of installed apps.

![The sentry screen](images/sentry.jpg)

---

UnterFace is a fan's homage to the screens in *Alien* (1979), *Aliens* (1986) and *WarGames* (1983), and has nothing to do with the people who made them.
