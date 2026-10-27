// An example preset. Copy it to preset.js and edit it to start your TV with
// this setup instead of opening SETUP on first run. Without a preset.js the
// app starts in SETUP with generic defaults. Set A sounds ('a') are recordings
// that aren't in this repository; use 'b' (the synthesised set) or 'off'.
// The choices for power, airport and teletext are in settings.js and
// airports.js (POWER_CHOICES, AIRPORT_CHOICES, TELETEXT_CHOICES).
window.UNTERFACE_PRESET = {
  viewing: ['netflix', 'hbo', 'youtube', 'prime', 'disney', 'drtv'],
  inputs: [{ device: 'APPLE TV', port: 1 }, { device: 'PLAYSTATION 5', port: 2 }],
  power: 'DK2-RADIUS-ANDEL',
  airport: 'EKCH',
  teletext: 'dr',
  sound: 'b'
};
