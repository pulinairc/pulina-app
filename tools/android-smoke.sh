#!/bin/sh
# Install the debug build on a running emulator and fail if the app does not stay up.
set -eu
apk=$(find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' | head -n1)
package=$(node -p "require('./src-tauri/tauri.conf.json').identifier")
adb install -r "$apk"
adb shell monkey -p "$package" -c android.intent.category.LAUNCHER 1
sleep 25
if ! adb shell pidof "$package"; then
    adb logcat -d | grep -iE "lobby|tauri|rust|AndroidRuntime" | tail -n 200
    exit 1
fi
adb exec-out screencap -p > android-smoke.png
adb logcat -d | grep -iE "panic|FATAL" && exit 1
echo "$package is running"
