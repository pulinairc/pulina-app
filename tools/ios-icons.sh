#!/bin/sh
# Puts Lobby's icons into the Xcode project `tauri ios init` made: Pendant lamp as the
# app icon, the others as alternates the icon picker in Settings switches to.
set -eu
cd "$(dirname "$0")/../src-tauri/gen/apple"

# Icon sets for icons Lobby no longer has go first.
for dir in Assets.xcassets/AppIcon-*.appiconset; do
  [ -e "$dir" ] || continue
  name=${dir#Assets.xcassets/AppIcon-}
  [ -f "../../icons/ios/${name%.appiconset}.png" ] || find "$dir" -delete
done

for png in ../../icons/ios/*.png; do
  name=$(basename "$png" .png)
  dir="Assets.xcassets/AppIcon-$name.appiconset"
  [ "$name" = pendant-lamp ] && dir=Assets.xcassets/AppIcon.appiconset
  mkdir -p "$dir"
  rm -f "$dir"/*
  cp "$png" "$dir/icon.png"
  cat > "$dir/Contents.json" <<'EOF'
{"images":[{"filename":"icon.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}
EOF
done

# Alternate icons are only built in when asked for.
grep -q INCLUDE_ALL_APPICON project.yml ||
  perl -pi -e 's/^(\s*)ENABLE_BITCODE: false\n/$&$1ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS: YES\n/' project.yml
grep -q INCLUDE_ALL_APPICON lobby.xcodeproj/project.pbxproj ||
  perl -pi -e 's/^(\s*)ENABLE_BITCODE = NO;\n/$&$1ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = YES;\n/' lobby.xcodeproj/project.pbxproj
