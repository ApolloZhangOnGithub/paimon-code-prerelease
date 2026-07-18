#!/bin/bash
# blackbox.sh — pi 终端黑匣子录屏
# 用法: blackbox.sh <person-id> <person-name> <role> -- <command...>
# 用 macOS 自带 script 命令录（分配 pty，不干扰 TUI）

PERSON_ID="$1"; shift
PERSON_NAME="$1"; shift
ROLE="$1"; shift
shift # skip --

if [ -z "$PERSON_ID" ] || [ $# -eq 0 ]; then
  exec "$@" 2>/dev/null || exit 1
fi

BOX_DIR="$HOME/.paimon/BlackboxData/$PERSON_ID"
mkdir -p "$BOX_DIR"

TS=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$BOX_DIR/${TS}-${ROLE}.log"

echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"person\":\"$PERSON_NAME\",\"id\":\"$PERSON_ID\",\"role\":\"$ROLE\",\"log\":\"$LOG_FILE\",\"cmd\":\"$*\"}" >> "$BOX_DIR/manifest.jsonl"

exec script -q "$LOG_FILE" "$@"
