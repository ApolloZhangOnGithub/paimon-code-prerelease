#!/bin/sh
# identity — 身份查询 CLI (Claude Code + paimon 共用)
# 用法: identity [id|名字]
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 找到 claude 祖先进程的 PID 作为身份（与 mobile-cli.sh 同一套机制）
if [ -z "$PAIMON_AGENT_NAME" ]; then
  _p=$$
  while [ "$_p" != "1" ] && [ -n "$_p" ]; do
    _n=$(ps -p "$_p" -o comm= 2>/dev/null)
    if [ "$_n" = "claude" ]; then
      export PAIMON_AGENT_NAME="claude-$_p"
      break
    fi
    _p=$(ps -p "$_p" -o ppid= 2>/dev/null | tr -d ' ')
  done
  [ -z "$PAIMON_AGENT_NAME" ] && export PAIMON_AGENT_NAME="claude-$$"
fi

# identity.ts 靠 package.json 的 #imports 解析别名,必须在 core 包作用域内运行:
# 优先用部署后的 extension 副本,否则用脚本旁边的(仓库内直接运行)
EXT_IDENTITY="$HOME/.local/lib/paimon/extensions/paimon-code/individual.abio.identity/identity.ts"
if [ -f "$EXT_IDENTITY" ]; then
  TARGET="$EXT_IDENTITY"
else
  TARGET="$SCRIPT_DIR/identity.ts"
fi

exec node --no-warnings --experimental-transform-types "$TARGET" "$@"
