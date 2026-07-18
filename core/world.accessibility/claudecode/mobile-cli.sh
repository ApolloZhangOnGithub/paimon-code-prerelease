#!/bin/sh
# mobile — 手机 CLI (Claude Code + paimon 共用)
# 用法: mobile [input...]
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 找到 claude 祖先进程的 PID 作为身份
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

exec node --no-warnings --experimental-transform-types "$SCRIPT_DIR/mobile-runner.mjs" "$@"
