#!/bin/zsh
# Builds what goes on a GitHub Release: the app without this TV's preset
# (so other TVs start in SETUP with generic defaults), the optional Home
# watcher as a zip, and the Google TV / Android TV app as a signed APK (when
# the signing key is set up, see the README). Output in dist/release/.
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
mv $OUT/com.unterface.nostromo_${VERSION}_all.ipk $OUT/ostromo_${VERSION}.ipk

mkdir -p $WORK/watcher/ostromo-home-watcher
cp $ROOT/watcher/home-watch.js $ROOT/watcher/ssap.js $ROOT/watcher/install-mac.sh $ROOT/watcher/README.md $WORK/watcher/ostromo-home-watcher/
(cd $WORK/watcher && zip -qr $OUT/ostromo-home-watcher_${VERSION}.zip ostromo-home-watcher)

# Android: the release build is already the public one (android-tv/app/build.gradle.kts)
if [[ -f ~/.android/ostromo-release.properties ]]; then
  (cd $ROOT/android-tv && JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17} ./gradlew -q assembleRelease)
  # one name for every version, so releases/latest/download/ostromo-android-tv.apk always works
  cp $ROOT/android-tv/app/build/outputs/apk/release/app-release.apk $OUT/ostromo-android-tv.apk
else
  echo "no Android signing key (~/.android/ostromo-release.properties): APK skipped"
fi

ls -la $OUT
