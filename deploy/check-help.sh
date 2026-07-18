#!/bin/bash
# 审计：SUBCOMMANDS 里的命令是否都在 cli.ts 中注册
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -d "$PKG_ROOT/Codebase/core" ]; then
  CLI="$PKG_ROOT/Codebase/core/god.cli/cli.ts"
elif [ -d "$PKG_ROOT/core" ]; then
  CLI="$PKG_ROOT/core/god.cli/cli.ts"
else
  echo "ERROR: cannot find core/god.cli/cli.ts"; exit 1
fi

errors=0
for cmd in archive unarchive archived kill tmux mc hc mobile laptop settings org help version rename doctor; do
  if ! grep -q "'$cmd'" "$CLI"; then
    echo "MISSING subcommand: $cmd"
    errors=1
  fi
done

[ "$errors" = "1" ] && { echo "请更新 cli.ts 的 SUBCOMMANDS"; exit 1; }
exit 0
