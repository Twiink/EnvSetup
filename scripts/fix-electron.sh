#!/bin/bash
set -e

echo "=== 修复 Electron 二进制安装 ==="

ELECTRON_DIR="node_modules/electron"

# 1. 清理旧的残留文件
echo "[1/3] 清理旧的 Electron 二进制残留..."
rm -rf "$ELECTRON_DIR/dist"
rm -f "$ELECTRON_DIR/path.txt"
echo "  已清理 dist/ 和 path.txt"

# 2. 清理可能存在的缓存（避免损坏的缓存导致重复失败）
ELECTRON_CACHE="${ELECTRON_CACHE:-$HOME/.cache/electron}"
if [ -d "$ELECTRON_CACHE" ]; then
  echo "[2/3] 清理 Electron 下载缓存: $ELECTRON_CACHE"
  rm -rf "$ELECTRON_CACHE"
  echo "  已清理缓存"
else
  echo "[2/3] 无缓存需要清理"
fi

# 3. 重新下载安装
echo "[3/3] 重新下载 Electron 二进制..."
node "$ELECTRON_DIR/install.js"

# 验证
if [ -f "$ELECTRON_DIR/path.txt" ] && [ -d "$ELECTRON_DIR/dist" ]; then
  echo ""
  echo "=== 安装成功 ==="
  echo "  path.txt: $(cat "$ELECTRON_DIR/path.txt")"
  echo "  dist 目录已就绪"
else
  echo ""
  echo "=== 安装失败，请检查网络或代理设置 ==="
  exit 1
fi
