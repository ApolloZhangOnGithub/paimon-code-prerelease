#!/bin/bash
# build-github.sh — 从 DEV 自动打包到 github-dev 和 github-release
# 用法:
#   bash Codebase/deploy/scripts/build-github.sh dev      # 只打 dev
#   bash Codebase/deploy/scripts/build-github.sh release   # 只打 release
#   bash Codebase/deploy/scripts/build-github.sh all       # 两个都打（默认）
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEV="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PARENT="$(dirname "$DEV")"
GH_DEV="$PARENT/pi-coding-master.GITHUB"
GH_REL="$PARENT/pi-coding-master.RELEASE-GITHUB"
RELEASE_DIR="$PARENT/pi-coding-master.RELEASE"

TARGET="${1:-all}"

# ── 共用：排除规则 ──
COMMON_EXCLUDES=(
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
)

DOC_EXCLUDES=(
  --exclude='.DS_Store'
  --exclude='Paper/'
  --exclude='#human.Paper/'
  --exclude='*.aux'
  --exclude='*.out'
  --exclude='*.log'
  --exclude='*.synctex.gz'
  --exclude='.!*'
)

# ── 共用：安全检查 ──
security_check() {
  local dir="$1" label="$2"
  echo "  安全检查 ($label)..."
  local leaked=0
  # 拆开字符串防自匹配
  local p1='7mTFF''zKEkzC4DcV3'
  local p2='53487''81537'
  local p3='/Users/zhang''kezhen'
  for pattern in "$p1" "$p2" "$p3"; do
    if grep -rq --exclude='build-github.sh' "$pattern" "$dir" 2>/dev/null; then
      echo "    LEAKED: $pattern"
      leaked=1
    fi
  done
  if [ "$leaked" -eq 1 ]; then
    echo "  Error: $label 有敏感信息泄露，中止。"
    return 1
  fi
  # 旧名检查
  local old="pi-ali""ve"
  local count
  count=$(grep -r --exclude='build-github.sh' -c "$old" "$dir" 2>/dev/null | awk -F: '{s+=$2}END{print s+0}')
  if [ "$count" -gt 0 ]; then
    echo "  WARN: $label 仍有 $count 处 '$old' 引用"
  fi
  echo "  OK $label 安全检查通过"
  return 0
}

# ══════════════════════════════════════════════════════════════════════
# DEV → github-dev (pi-coding-master-dev)
# ══════════════════════════════════════════════════════════════════════
build_dev() {
  echo ""
  echo "══ build github-dev ══"
  echo "  DEV:    $DEV"
  echo "  TARGET: $GH_DEV"

  if [ ! -d "$GH_DEV/.git" ]; then
    echo "  Error: $GH_DEV/.git 不存在。先 git clone pi-coding-master-dev 到该目录。"
    return 1
  fi

  # 同步 Codebase
  rsync -a --delete "${COMMON_EXCLUDES[@]}" --exclude='debug/logs/' "$DEV/Codebase/" "$GH_DEV/Codebase/"
  echo "  OK Codebase"

  # 同步 Docs
  rsync -a --delete "${DOC_EXCLUDES[@]}" "$DEV/Docs/" "$GH_DEV/Docs/"
  echo "  OK Docs"

  # .gitignore
  [ -f "$DEV/.gitignore" ] && cp "$DEV/.gitignore" "$GH_DEV/.gitignore"

  # README 不覆盖（GITHUB 目录有自己维护的 README.md）

  # 安全检查
  security_check "$GH_DEV/Codebase/" "dev-codebase" || return 1

  # 自动 commit + push
  cd "$GH_DEV"
  git add -A
  if git diff --cached --quiet 2>/dev/null; then
    echo "  无变更，跳过 commit。"
  else
    local msg="sync from DEV $(date '+%Y-%m-%d %H:%M')"
    git commit -m "$msg"
    git push origin main
    echo "  OK pushed to pi-coding-master-dev"
  fi
}

# ══════════════════════════════════════════════════════════════════════
# DEV → github-release (pi-coding-master-release)
# 只包含 npm 需要的文件：core/ deploy/ package.json README.md
# ══════════════════════════════════════════════════════════════════════
build_release() {
  echo ""
  echo "══ build github-release ══"

  # 找最新的 release 版本目录
  local latest
  latest=$(ls -d "$RELEASE_DIR"/v*-stable 2>/dev/null | sort -V | tail -1)
  if [ -z "$latest" ]; then
    echo "  Error: 没找到 release 版本目录 ($RELEASE_DIR/v*-stable)"
    return 1
  fi
  local ver
  ver=$(basename "$latest" | sed 's/-stable//')
  echo "  RELEASE: $latest ($ver)"
  echo "  TARGET:  $GH_REL"

  # 初始化 release github 目录
  if [ ! -d "$GH_REL" ]; then
    mkdir -p "$GH_REL"
    cd "$GH_REL"
    git init
    git remote add origin https://github.com/ApolloZhangOnGithub/pi-coding-master-release.git
    git checkout -b main 2>/dev/null || true
  fi

  if [ ! -d "$GH_REL/.git" ]; then
    echo "  Error: $GH_REL/.git 不存在。"
    return 1
  fi

  # 从 DEV 重新打包 release（确保用最新源码）
  rsync -a --delete "${COMMON_EXCLUDES[@]}" "$DEV/Codebase/core/" "$latest/core/"
  rsync -a --delete --exclude='.DS_Store' "$DEV/Codebase/deploy/" "$latest/deploy/"
  echo "  OK release 源码已从 DEV 同步"

  # 同步到 github-release 目录
  rsync -a --delete \
    --exclude='.DS_Store' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='node_modules' --exclude='*.log' --exclude='data/cookies/' \
    --exclude='authorize.TRUST' --exclude='ears.listen/config.json' \
    --exclude='*ABANDONED*' --exclude='*REMOVED*' --exclude='*FUTURE*' \
    --exclude='debug/' \
    "$latest/core/" "$GH_REL/core/"
  rsync -a --delete --exclude='.DS_Store' "$latest/deploy/" "$GH_REL/deploy/"
  [ -f "$latest/package.json" ] && cp "$latest/package.json" "$GH_REL/package.json"
  [ -f "$latest/README.md" ] && cp "$latest/README.md" "$GH_REL/README.md"
  [ -f "$latest/RELEASE.README" ] && cp "$latest/RELEASE.README" "$GH_REL/RELEASE.README"

  # .gitignore
  cat > "$GH_REL/.gitignore" << 'GITEOF'
.DS_Store
__pycache__/
*.pyc
node_modules/
*.log
data/cookies/
*.pem
*.key
GITEOF

  # 安全检查
  security_check "$GH_REL/core/" "release-core" || return 1

  # 自动 commit + push
  cd "$GH_REL"
  git add -A
  if git diff --cached --quiet 2>/dev/null; then
    echo "  无变更，跳过 commit。"
  else
    local msg="release $ver $(date '+%Y-%m-%d %H:%M')"
    git commit -m "$msg"
    git push -u origin main 2>/dev/null || git push --set-upstream origin main
    echo "  OK pushed to pi-coding-master-release"
  fi

  # 创建 tag
  if ! git tag -l "$ver" | grep -q "$ver"; then
    git tag "$ver"
    git push origin "$ver"
    echo "  OK tag $ver"
  fi
}

# ── 执行 ──
case "$TARGET" in
  dev)     build_dev ;;
  release) build_release ;;
  all)     build_dev; build_release ;;
  *)       echo "用法: $0 [dev|release|all]"; exit 1 ;;
esac

echo ""
echo "── 完成 ──"
