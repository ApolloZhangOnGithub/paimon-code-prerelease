#!/bin/bash
# build-github.sh — 从 DEV 打包发布
#
# 用法:
#   bash Codebase/deploy/scripts/build-github.sh 0.2.8          # 发 dev + stable
#   bash Codebase/deploy/scripts/build-github.sh 0.2.8 dev      # 只发 dev
#   bash Codebase/deploy/scripts/build-github.sh 0.2.8 stable   # 只发 stable
#
# 目录结构:
#   pi-coding-master.DEV/              ← 开发（无版本号）
#   pi-coding-master.RELEASE/
#     v0.2.8-dev/                      ← 全量快照 → push github-dev
#     v0.2.8-stable/                   ← 精简包 → push github-release + npm publish
#     VERSION.INDEX                    ← 版本记录
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEV="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PARENT="$(dirname "$DEV")"
RELEASE_DIR="$PARENT/pi-coding-master.RELEASE"

VER="${1:-}"
TARGET="${2:-all}"

if [ -z "$VER" ]; then
  echo "用法: $0 <版本号> [dev|stable|all]"
  echo "  例: $0 0.2.8"
  exit 1
fi

DEV_DIR="$RELEASE_DIR/v${VER}-dev"
STABLE_DIR="$RELEASE_DIR/v${VER}-stable"
VERSION_INDEX="$RELEASE_DIR/VERSION.INDEX"

# ── 共用排除 ──
CLEAN_EXCLUDES=(
  --exclude='.DS_Store'
  --exclude='__pycache__'
  --exclude='*.pyc'
  --exclude='*.pyo'
  --exclude='node_modules'
  --exclude='*.log'
  --exclude='.env'
  --exclude='.env.*'
  --exclude='*.pem'
  --exclude='*.key'
  --exclude='*.crt'
  --exclude='data/cookies/'
  --exclude='authorize.TRUST'
  --exclude='ears.listen/config.json'
  --exclude='*ABANDONED*'
  --exclude='*REMOVED*'
  --exclude='*FUTURE*'
  --exclude='.git'
)

# ── 安全检查 ──
security_check() {
  local dir="$1" label="$2"
  local leaked=0
  local p1='7mTFF''zKEkzC4DcV3'
  local p2='53487''81537'
  local p3='/Users/zhang''kezhen'
  for pattern in "$p1" "$p2" "$p3"; do
    if grep -rq --exclude='build-github.sh' "$pattern" "$dir" 2>/dev/null; then
      echo "  LEAKED: $pattern"
      leaked=1
    fi
  done
  if [ "$leaked" -eq 1 ]; then
    echo "  Error: $label 有敏感信息泄露，中止。"
    return 1
  fi
  echo "  OK 安全检查通过"
}

# ══════════════════════════════════════════════════════════════════════
# DEV 版：全量（Codebase + Docs）→ github-dev
# ══════════════════════════════════════════════════════════════════════
build_dev() {
  echo ""
  echo "══ build v${VER}-dev ══"

  mkdir -p "$DEV_DIR"

  # Codebase
  rsync -a --delete "${CLEAN_EXCLUDES[@]}" --exclude='debug/logs/' \
    "$DEV/Codebase/" "$DEV_DIR/Codebase/"

  # Docs（排除 Paper）
  rsync -a --delete "${CLEAN_EXCLUDES[@]}" \
    --exclude='Paper/' --exclude='#human.Paper/' \
    --exclude='*.aux' --exclude='*.out' --exclude='*.synctex.gz' --exclude='.!*' \
    "$DEV/Docs/" "$DEV_DIR/Docs/"

  # .gitignore + README
  [ -f "$DEV/.gitignore" ] && cp "$DEV/.gitignore" "$DEV_DIR/.gitignore"
  [ -f "$DEV_DIR/Codebase/deploy/scripts/build-github.sh" ] || true

  echo "  OK 打包完成"
  security_check "$DEV_DIR/Codebase/" "dev" || return 1

  # git init + push
  if [ ! -d "$DEV_DIR/.git" ]; then
    cd "$DEV_DIR"
    git init -b main
    git remote add origin https://github.com/ApolloZhangOnGithub/pi-coding-master-dev.git 2>/dev/null || true
  fi

  cd "$DEV_DIR"
  git add -A
  if git diff --cached --quiet 2>/dev/null; then
    echo "  无变更。"
  else
    git commit -m "v${VER}-dev $(date '+%Y-%m-%d %H:%M')"
    git push origin main --force
    echo "  OK pushed github-dev"
  fi
}

# ══════════════════════════════════════════════════════════════════════
# STABLE 版：精简（core + deploy + package.json）→ github-release + npm
# ══════════════════════════════════════════════════════════════════════
build_stable() {
  echo ""
  echo "══ build v${VER}-stable ══"

  mkdir -p "$STABLE_DIR"

  # core（精简，无 debug）
  rsync -a --delete "${CLEAN_EXCLUDES[@]}" --exclude='debug/' \
    "$DEV/Codebase/core/" "$STABLE_DIR/core/"

  # deploy
  rsync -a --delete "${CLEAN_EXCLUDES[@]}" \
    "$DEV/Codebase/deploy/" "$STABLE_DIR/deploy/"

  # package.json（自动写入版本号）
  if [ -f "$STABLE_DIR/package.json" ]; then
    sed -i '' "s/\"version\": *\"[^\"]*\"/\"version\": \"$VER\"/" "$STABLE_DIR/package.json"
  else
    cat > "$STABLE_DIR/package.json" << PKGEOF
{
  "name": "pi-coding-master",
  "version": "$VER",
  "description": "Living AI agent extension for pi-coding-agent",
  "license": "MIT",
  "os": ["darwin", "linux"],
  "engines": { "node": ">=18" },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.79.10"
  },
  "scripts": {
    "postinstall": "bash deploy/install.sh"
  },
  "files": ["core/", "deploy/", "README.md"]
}
PKGEOF
  fi

  # README
  [ ! -f "$STABLE_DIR/README.md" ] && [ -f "$DEV_DIR/README.md" ] && cp "$DEV_DIR/README.md" "$STABLE_DIR/README.md"

  # .gitignore
  cat > "$STABLE_DIR/.gitignore" << 'GITEOF'
.DS_Store
__pycache__/
*.pyc
node_modules/
*.log
data/cookies/
*.pem
*.key
authorize.TRUST
ears.listen/config.json
*ABANDONED*
*REMOVED*
*FUTURE*
GITEOF

  echo "  OK 打包完成"
  security_check "$STABLE_DIR/core/" "stable" || return 1

  # git init + push
  if [ ! -d "$STABLE_DIR/.git" ]; then
    cd "$STABLE_DIR"
    git init -b main
    git remote add origin https://github.com/ApolloZhangOnGithub/pi-coding-master-release.git 2>/dev/null || true
  fi

  cd "$STABLE_DIR"
  git add -A
  if git diff --cached --quiet 2>/dev/null; then
    echo "  git 无变更。"
  else
    git commit -m "v${VER}-stable $(date '+%Y-%m-%d %H:%M')"
    git push origin main --force
    echo "  OK pushed github-release"
  fi

  # tag
  if ! git tag -l "v${VER}" | grep -q "v${VER}"; then
    git tag "v${VER}"
    git push origin "v${VER}" 2>/dev/null || true
    echo "  OK tag v${VER}"
  fi

  # npm publish
  local npm_ver
  npm_ver=$(npm view pi-coding-master version 2>/dev/null || echo "")
  if [ "$npm_ver" != "$VER" ]; then
    echo "  npm publish ${VER}..."
    npm publish || echo "  WARN: npm publish 失败（可能需要 --otp）"
  else
    echo "  npm ${VER} 已是最新。"
  fi
}

# ── VERSION.INDEX ──
update_index() {
  local dev_ok="x" stable_ok="x"
  [ -d "$DEV_DIR/Codebase" ] && dev_ok="✓"
  [ -d "$STABLE_DIR/core" ] && stable_ok="✓"

  local npm_ver
  npm_ver=$(npm view pi-coding-master version 2>/dev/null || echo "")
  local npm_ok="x"
  [ "$npm_ver" = "$VER" ] && npm_ok="✓"

  local line="v${VER}  dev:${dev_ok}  stable:${stable_ok}  npm:${npm_ok}  $(date '+%Y-%m-%d %H:%M')"

  # 创建或更新
  if [ ! -f "$VERSION_INDEX" ]; then
    echo "# VERSION.INDEX — 版本发布记录" > "$VERSION_INDEX"
    echo "# 格式: 版本  dev  stable  npm  日期" >> "$VERSION_INDEX"
    echo "" >> "$VERSION_INDEX"
  fi

  # 去掉旧的同版本行，追加新行
  grep -v "^v${VER} " "$VERSION_INDEX" > "${VERSION_INDEX}.tmp" 2>/dev/null || true
  mv "${VERSION_INDEX}.tmp" "$VERSION_INDEX"
  echo "$line" >> "$VERSION_INDEX"
  echo "  OK VERSION.INDEX 已更新"
}

# ── 执行 ──
echo "── build-github v${VER} (${TARGET}) ──"

case "$TARGET" in
  dev)     build_dev ;;
  stable)  build_stable ;;
  all)     build_dev; build_stable ;;
  *)       echo "用法: $0 <版本号> [dev|stable|all]"; exit 1 ;;
esac

update_index

echo ""
echo "── 完成 v${VER} ──"
