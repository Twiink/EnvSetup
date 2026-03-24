#!/usr/bin/env bash
# 将 icon/icon.png 转换为多平台图标，输出到 build/ 目录
# 依赖：sips（macOS 内置）、iconutil（macOS 内置）、magick（ImageMagick 7）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
SRC="$ROOT/icon/icon.png"
BUILD="$ROOT/build"

if [[ ! -f "$SRC" ]]; then
  echo "Error: source icon not found at $SRC" >&2
  exit 1
fi

echo "Source: $SRC"
echo "Output: $BUILD"

# ── macOS .icns ────────────────────────────────────────────────────────────────
ICONSET="$BUILD/icon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

for SIZE in 16 32 64 128 256 512 1024; do
  sips -z $SIZE $SIZE "$SRC" --out "$ICONSET/tmp_${SIZE}.png" > /dev/null
done

# iconutil 要求的命名规范
cp "$ICONSET/tmp_16.png"   "$ICONSET/icon_16x16.png"
cp "$ICONSET/tmp_32.png"   "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/tmp_32.png"   "$ICONSET/icon_32x32.png"
cp "$ICONSET/tmp_64.png"   "$ICONSET/icon_32x32@2x.png"
cp "$ICONSET/tmp_128.png"  "$ICONSET/icon_128x128.png"
cp "$ICONSET/tmp_256.png"  "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/tmp_256.png"  "$ICONSET/icon_256x256.png"
cp "$ICONSET/tmp_512.png"  "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/tmp_512.png"  "$ICONSET/icon_512x512.png"
cp "$ICONSET/tmp_1024.png" "$ICONSET/icon_512x512@2x.png"

rm "$ICONSET"/tmp_*.png
iconutil -c icns "$ICONSET" -o "$BUILD/icon.icns"
rm -rf "$ICONSET"
echo "[ok] macOS icon.icns"

# ── Windows .ico ───────────────────────────────────────────────────────────────
TMPICO="$(mktemp -d)"
for SIZE in 16 24 32 48 64 128 256; do
  sips -z $SIZE $SIZE "$SRC" --out "$TMPICO/${SIZE}.png" > /dev/null
done

magick \
  "$TMPICO/16.png" \
  "$TMPICO/24.png" \
  "$TMPICO/32.png" \
  "$TMPICO/48.png" \
  "$TMPICO/64.png" \
  "$TMPICO/128.png" \
  "$TMPICO/256.png" \
  "$BUILD/icon.ico"

rm -rf "$TMPICO"
echo "[ok] Windows icon.ico"

# ── Linux 512x512 PNG ──────────────────────────────────────────────────────────
sips -z 512 512 "$SRC" --out "$BUILD/icon.png" > /dev/null
echo "[ok] Linux icon.png (512x512)"

echo "Done. Files in $BUILD/"
ls -lh "$BUILD/"
