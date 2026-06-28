#!/bin/bash
# check-deploy.sh — 检查扩展是否和源码一致
# 用法: check-deploy.sh [DEV_ROOT]
#   DEV_ROOT: 可选，默认取 \$PI_DEV_ROOT 环境变量或 ~/smart-pi/pi-coding-master.DEV
#   如果源码更新了但未部署，返回非 0 并打印警告
set -e

DEV_ROOT="${1:-${PI_DEV_ROOT:-$HOME/smart-pi/pi-coding-master.DEV}}"
IMPL="$DEV_ROOT/Codebase/core"
EXT="$HOME/.pi/agent/extensions"
STALE=0

check() {
  local src="$1" dest="$2" label="$3"
  if [ ! -d "$dest" ]; then
    echo "  WARN:  $label 扩展目录不存在: $dest"
    STALE=1
    return
  fi
  # 比较所有 .ts 文件（只看源码层的改动）
  for f in "$src"/*.ts; do
    local bn; bn="$(basename "$f")"
    local df="$dest/$bn"
    if [ ! -f "$df" ]; then continue; fi
    if ! diff -q "$f" "$df" >/dev/null 2>&1; then
      echo "  Error: $label/$bn 已更新但未部署"
      STALE=1
    fi
  done
}

check "$IMPL/technology.phone/"              "$EXT/device/"     "device"
check "$IMPL/god.pi.mod/tui.mods.viewmode/"  "$EXT/view_mode/"  "view_mode"

if [ "$STALE" -eq 1 ]; then
  echo ""
  echo "WARN:  扩展源码已更新但未部署。运行: bash Codebase/deploy/install.sh"
  exit 1
else
  echo "OK 所有扩展已是最新"
  exit 0
fi
