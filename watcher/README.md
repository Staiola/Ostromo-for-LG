# Ostromo Home watcher (optional)

LG doesn't let an app installed in Developer Mode replace the Home button, or even see which app is in
front. So pressing Home, or quitting Netflix, lands on LG's own home screen.

This small script fixes that from another computer on the same Wi-Fi. It connects to the TV the way LG's
phone app does, watches which app is on screen, and the moment LG's home appears it opens Ostromo again.

- Press **Home twice within three seconds** to stay on LG's home, for its settings.
- It only works while the computer is awake and on the same network. A Mac that sleeps, or is away,
  means Home goes to LG's home as usual. A Raspberry Pi or any always-on machine can run it all the time.

## Needs

- Node.js 16 or newer (`node --version`).
- The TV's IP address (Settings → Network on the TV, or the Developer Mode app).
- On the TV, connecting from phone apps must be allowed. If no prompt appears when you first run it,
  look for "LG Connect Apps" or similar under Settings → General → Devices.

## Try it

```bash
node home-watch.js 192.168.1.50
```

The first time, the TV asks whether to allow a new device: accept it with the remote. The key is kept in
`~/.config/unterface/tv-keys.json`, so it only asks once.

## Run it in the background on a Mac

```bash
./install-mac.sh 192.168.1.50
```

It starts at login and restarts if it stops. The log is `~/Library/Logs/unterface-home-watch.log`.
To remove it:

```bash
./install-mac.sh uninstall
```

On a Raspberry Pi or Linux machine, run `node home-watch.js <TV IP>` from a systemd service or similar.
