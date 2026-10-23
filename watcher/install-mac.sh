#!/bin/zsh
# Runs home-watch.js as a background service on this Mac, started at login.
#   ./install-mac.sh 192.168.1.50     install or update
#   ./install-mac.sh uninstall         remove
# The log is ~/Library/Logs/unterface-home-watch.log.
set -e

LABEL=studio.staiola.unterface.homewatch
PLIST=~/Library/LaunchAgents/$LABEL.plist
LOG=~/Library/Logs/unterface-home-watch.log
HERE=${0:A:h}

if [[ $1 == uninstall ]]; then
  launchctl bootout gui/$(id -u)/$LABEL 2>/dev/null || true
  rm -f $PLIST
  echo "removed"
  exit 0
fi

TV=${1:-$TV_HOST}
[[ -n $TV ]] || { echo "usage: $0 <TV IP> | uninstall"; exit 1; }
NODE=$(command -v node) || { echo "node not found"; exit 1; }

mkdir -p ~/Library/LaunchAgents
cat > $PLIST <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$HERE/home-watch.js</string>
    <string>$TV</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout gui/$(id -u)/$LABEL 2>/dev/null || true
launchctl bootstrap gui/$(id -u) $PLIST
echo "running; log: $LOG"
