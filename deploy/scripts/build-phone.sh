#!/bin/bash
# Build phone/device tools .ts → .js
# Auto-discovers source directory (survives renames)
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPL="$SCRIPT_DIR/../../core"

# 自动发现 device-manifest.ts
DM=$(find "$IMPL" -name 'technology-manifest.ts' -not -path '*/node_modules/*' 2>/dev/null | head -1)
if [ -z "$DM" ]; then echo "Error: technology-manifest.ts not found"; exit 1; fi
PHONE_DIR="$(dirname "$DM")"
SAFARI="$PHONE_DIR/safari.ts"

# ── 禁止 execSync（只检查扩展工具目录）──
if grep -rn 'execSync' "$PHONE_DIR/" --include='*.ts' 2>/dev/null | grep -v '.bak\|.CHANGELOG\|.SPEC\|sh.ts'; then
  echo "Error: BLOCKING: execSync found!"
  exit 1
fi

echo "── Building phone tools ($PHONE_DIR) ──"
bun build --outdir="$PHONE_DIR" --target=node --format=esm --external '*' \
  "$DM" \
  "$SAFARI"
echo "OK Done"
