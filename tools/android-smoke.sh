#!/bin/sh
# Install the debug build on a running emulator and fail if the app does not stay up. Pictures
# with three-button navigation, before and with the keyboard open, show whether the bars cover it.
set -eu
apk=$(find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' | head -n1)
package=$(node -p "require('./src-tauri/tauri.conf.json').identifier")
adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton || true
adb install -r "$apk"
adb shell monkey -p "$package" -c android.intent.category.LAUNCHER 1
sleep 25
if ! adb shell pidof "$package"; then
    adb logcat -d | grep -iE "lobby|tauri|rust|AndroidRuntime" | tail -n 200
    exit 1
fi
adb exec-out screencap -p > android-smoke.png
# The nick field, from the screen's accessibility tree, else where it sits on the welcome.
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
bounds=$(adb exec-out cat /sdcard/ui.xml 2>/dev/null | grep -o 'class="android.widget.EditText"[^>]*bounds="[^"]*"' | head -n1 | sed 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]"/\1 \2 \3 \4/')
if [ -n "$bounds" ]; then
    set -- $bounds
    x=$(( ($1 + $3) / 2 )); y=$(( ($2 + $4) / 2 ))
else
    size=$(adb shell wm size | sed -n 's/.*: \([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -n1)
    set -- $size
    x=$(( $1 / 3 )); y=$(( $2 * 85 / 100 ))
fi
adb shell input tap "$x" "$y"
sleep 4
adb exec-out screencap -p > android-keyboard.png
adb logcat -d | grep -iE -A20 "panic|FATAL" && exit 1
echo "$package is running"
