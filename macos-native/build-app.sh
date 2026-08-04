#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_ROOT="$ROOT/macos-native"
APP="$ROOT/out/StaySound Native.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

swift build --package-path "$NATIVE_ROOT" -c release
BIN_PATH="$(swift build --package-path "$NATIVE_ROOT" -c release --show-bin-path)"

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"
cp "$BIN_PATH/StaySoundNative" "$MACOS/StaySoundNative"
cp "$NATIVE_ROOT/Info.plist" "$CONTENTS/Info.plist"
cp "$ROOT/src-tauri/icons/icon.icns" "$RESOURCES/AppIcon.icns"
cp "$ROOT/src-tauri/binaries/staysound-soulseek-bridge-aarch64-apple-darwin" "$RESOURCES/staysound-soulseek-bridge"
chmod 755 "$MACOS/StaySoundNative" "$RESOURCES/staysound-soulseek-bridge"

codesign --force --sign - "$RESOURCES/staysound-soulseek-bridge"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "$APP"
