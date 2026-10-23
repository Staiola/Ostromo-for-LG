#!/bin/zsh
# Builds what goes on a GitHub Release: the app without this TV's preset
# (so other TVs start in SETUP with generic defaults), and the optional Home
# watcher as a zip. Output in dist/release/.
#   scripts/build-release.sh
set -e
ROOT=${0:A:h:h}
VERSION=$(node -p "require('$ROOT/nostromo/appinfo.json').version")
OUT=$ROOT/dist/release
WORK=$(mktemp -d)
trap 'rm -rf $WORK' EXIT

rm -rf $OUT && mkdir -p $OUT
cp -R $ROOT/nostromo $WORK/app
cp -R $ROOT/nostromo-service $WORK/service
rm -f $WORK/app/preset.js $WORK/service/dev-server.js
# sound set A (sfx/) is recordings that stay on this TV; the public build
# carries only set B (sfx-b/), synthesised by scripts/make-sounds-b.py
rm -rf $WORK/app/sfx
# the preset becomes a flag that tells settings.js this is the public build
sed -i '' 's|<script src="preset.js"></script>|<script>window.UNTERFACE_RELEASE = true;</script>|' $WORK/app/index.html
grep -q 'preset.js' $WORK/app/index.html && { echo "preset still referenced"; exit 1; }
grep -q 'UNTERFACE_RELEASE' $WORK/app/index.html || { echo "release flag missing"; exit 1; }

ares-package $WORK/app $WORK/service -o $OUT >/dev/null
mv $OUT/com.unterface.nostromo_${VERSION}_all.ipk $OUT/unterface_${VERSION}.ipk

mkdir -p $WORK/watcher/unterface-home-watcher
cp $ROOT/watcher/home-watch.js $ROOT/watcher/ssap.js $ROOT/watcher/install-mac.sh $ROOT/watcher/README.md $WORK/watcher/unterface-home-watcher/
(cd $WORK/watcher && zip -qr $OUT/unterface-home-watcher_${VERSION}.zip unterface-home-watcher)

ls -la $OUT
