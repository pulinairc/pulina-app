#!/bin/sh
# Install the debug build on a running emulator and fail if the app does not stay up.
set -eu
apk=$(find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' | head -n1)
package=$(node -p "require('./src-tauri/tauri.conf.json').identifier")
# The cached emulator can hold a build signed with another run's debug key.
adb uninstall "$package" > /dev/null 2>&1 || true
adb install "$apk"
adb shell monkey -p "$package" -c android.intent.category.LAUNCHER 1
sleep 25
if ! adb shell pidof "$package"; then
    adb logcat -d | grep -iE "lobby|tauri|rust|AndroidRuntime" | tail -n 200
    exit 1
fi
adb exec-out screencap -p > android-smoke.png
log=$(adb logcat -d)
echo "$log" | grep -iE -A8 "panic|FATAL" || true
# The emulator's own apps crash now and then: only a crash in this app, or a panic, fails.
if echo "$log" | grep -qiE "panic|Process: $package[,:]"; then
    exit 1
fi
echo "$package is running"
