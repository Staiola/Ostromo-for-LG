#!/bin/zsh
# Copies the code into a clone of the public repository (Staiola/Ostromo-for-LG),
# leaving out what stays private: sound set A (recordings), this TV's preset,
# media, the old Rive experiments. Commit and push from the clone yourself.
#   scripts/sync-public.sh <path to the public clone>
set -e
ROOT=${0:A:h:h}
PUB=${1:?usage: sync-public.sh <public clone>}
[[ -d $PUB/.git ]] || { echo "$PUB is not a git clone"; exit 1; }

rm -rf $PUB/nostromo $PUB/nostromo-service $PUB/watcher $PUB/scripts
cp -R $ROOT/nostromo $ROOT/nostromo-service $ROOT/watcher $ROOT/scripts $PUB/
rm -rf $PUB/nostromo/sfx
rm -f $PUB/nostromo/preset.js
# the Android TV version has its own public repository (sync-public-android.sh)
rm -f $PUB/scripts/sync-public-android.sh $PUB/scripts/make-android-key.sh
find $PUB -name .DS_Store -delete

# nothing personal may go out. The details to look for live outside the
# repository, so this script can be public: one extended regex per line.
PATTERNS=~/.config/ostromo/private-patterns
[[ -s $PATTERNS ]] || { echo "missing $PATTERNS (the personal details to keep out, one regex per line)"; exit 1; }
if grep -rn -I -E -f $PATTERNS $PUB --exclude-dir=.git; then
  echo "personal details found: not syncing"; exit 1
fi
echo "synced into $PUB; review with git status there"
