# Installing Ostromo on an LG TV

> [!NOTE]
> Not finished software. A home screen I made for my own LG TV, shared as is. Expect to tweak it, with some
> coding know-how or a coding agent like Claude Code, and use it at your own responsibility.

Ostromo is a home screen for LG webOS TVs. It isn't in LG's app store; you install it yourself with LG's
free **Developer Mode**. Nothing on the TV is rooted or changed, and removing it is one click.

It's a beta, tested on an LG C5 (2025, webOS 25). Newer LGs should be fine; older or cheaper sets may run it
slowly or not at all.

I built it for my own TV and have made it more generic, but it's a beta: expect rough edges, and expect to
tweak it for your own setup. That takes some coding know-how, or a coding agent such as Claude Code to do it
with you. Everything is at your own responsibility.

**You need:**

- An LG TV with webOS, on your home Wi-Fi.
- A computer on the same Wi-Fi (Mac, Windows or Linux).
- A free LG developer account, made at [webostv.developer.lge.com](https://webostv.developer.lge.com).
- The file `ostromo_x.y.z.ipk` from the [latest release](https://github.com/Staiola/Ostromo-for-LG/releases/latest).

## 1. Turn on Developer Mode on the TV

Everyone does this part by hand:

1. On the TV, open the **LG Content Store** (Apps), search for **Developer Mode** and install it.
2. Open Developer Mode and sign in with your LG developer account.
3. Switch **Dev Mode Status** on. The TV restarts.
4. Open Developer Mode again and switch **Key Server** on.
5. Write down the **IP address** and the **passphrase** it shows. You need both in the next step.

## 2. Install it: the easy way, with Claude

If you use [Claude Code](https://claude.com/claude-code) (in a terminal, or the Code tab of the Claude desktop
app), it can do the rest for you: set up LG's tools, connect to the TV and install the app. You need a paid
Claude plan for Claude Code.

Open Claude Code in an empty folder and paste this, with your own details filled in:

```text
Please install Ostromo on my LG TV.

- TV model: <your model, e.g. OLED55C5>
- Developer Mode is on and Key Server is on.
- TV IP address: <the IP from Developer Mode>
- Passphrase: <the passphrase from Developer Mode>

1. Use LG's webOS command-line tools (the npm package @webos-tools/cli; run them with npx
   rather than installing anything globally if you can).
2. Register the TV as a device named "tv" (port 9922, user "prisoner") and fetch its key
   with the passphrase.
3. Download the newest ostromo_*.ipk from
   https://github.com/Staiola/Ostromo-for-LG/releases/latest
4. Install it on the TV and start it (the app id is com.unterface.nostromo).
5. Tell me what you did. Don't change any settings on the TV, and don't ask for my LG
   account password: it isn't needed.
```

Claude asks before running commands, so you can follow along. If something fails, paste the error back in
and ask it to fix it. To get the optional Home button fix (step 5 below) as well, add: *"Then set up the Home
watcher from the same release on this computer."*

## 3. Or install it yourself

### With an app: webOS Dev Manager

1. Download **webOS Dev Manager** for your computer from
   [github.com/webosbrew/dev-manager-desktop/releases](https://github.com/webosbrew/dev-manager-desktop/releases).
2. Add your TV with the IP address and passphrase from step 1.
3. Install the `ostromo_x.y.z.ipk` file through it.

### With the command line

You need [Node.js](https://nodejs.org). Replace the IP with your TV's:

```bash
npx -y -p @webos-tools/cli ares-setup-device -a tv -i "host=192.168.1.50" -i "port=9922" -i "username=prisoner"
```

```bash
npx -y -p @webos-tools/cli ares-novacom --device tv --getkey
```

Type the passphrase from the TV when it asks. Then, from the folder with the downloaded file:

```bash
npx -y -p @webos-tools/cli ares-install -d tv ostromo_0.9.2.ipk
```

```bash
npx -y -p @webos-tools/cli ares-launch -d tv com.unterface.nostromo
```

## 4. First start

Ostromo opens in **SETUP**. Use the arrows to choose:

- the six apps on your home screen,
- what's plugged into two HDMI inputs and which ports,
- power prices (Denmark only, otherwise leave it off),
- DR teletext (Danish, otherwise leave it off),
- sounds on or off.

Then **SAVE & RESTART**. You can come back later: press ↑ from the top row of the home screen to reach SETUP.

**A one-press shortcut:** with Ostromo open, hold a number key on the remote (say **1**) and assign it.
From then on, holding 1 opens Ostromo from anywhere, Netflix included.

## 5. Optional: make the Home button come back to Ostromo

LG doesn't let a Developer Mode app take over the Home button, so pressing Home or quitting Netflix lands on
LG's own home screen. The **Home watcher** in the release (`ostromo-home-watcher_x.y.z.zip`) fixes that from a
computer that stays on: it watches the TV and switches straight back to Ostromo when LG's home appears.
Its README explains how to run it. It only works while that computer is awake and on the same Wi-Fi.

## Keep it working

- **Developer Mode times out.** Apps installed this way stop opening when the Developer Mode session runs
  out. The Developer Mode app shows the time left; open it now and then and extend the session.
- **Updating:** install a newer `.ipk` the same way. Your setup is kept.
- **Removing:** uninstall Ostromo like any app, or switch Developer Mode off.

## What works where

- Netflix, YouTube, Prime Video, Disney+, HBO Max, the inputs, the webcams, NTS radio and the sentry screen
  work anywhere.
- The flight radar always shows the airspace around Copenhagen Airport. Other airports aren't in yet.
- Power prices, DR TV and DR teletext are Danish. DR's live channels only play in Denmark.
- App tiles launch apps by their LG app id. If a tile does nothing, that app may have a different id on your
  TV: [open an issue](https://github.com/Staiola/Ostromo-for-LG/issues) with the app and your TV model.

## Rooting, in broad terms

Everything above uses LG's official Developer Mode. If you want Ostromo to *be* the TV's home screen for
good, with no timeout and no extra computer for the Home button, you would have to look into **rooting** your
LG. The [webOS Homebrew](https://www.webosbrew.org) community documents what's possible for which models and
firmware.

That's entirely your own responsibility. Rooting depends on your exact firmware, LG closes the holes in
updates, it can void your warranty, and done wrong it can leave the TV unusable. Ostromo doesn't need it,
and I don't give instructions or support for it.

## Questions

[Open an issue](https://github.com/Staiola/Ostromo-for-LG/issues) on GitHub and say which TV model you have.
