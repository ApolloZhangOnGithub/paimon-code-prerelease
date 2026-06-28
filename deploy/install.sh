#!/bin/bash
# pi-coding-master installer v0.2.7
# 兼容 macOS + Linux。从 npm 全局安装或手动 bash deploy/install.sh 均可。
#
# 两条铁律：
#  1) pi-tui 的 tui.js + blockrender.js + text.js 三件套绝不能注释掉——防崩的。
#  2) live(node_modules)是一次性的,npm 重装就冲掉。修复只在源,live 崩了跑本脚本重建。
set -e

PIN="0.79.10"

# ── 定位自身：支持 DEV 开发模式 + npm 全局安装模式 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 判断是 DEV 模式还是发行包模式
if [ -d "$PKG_ROOT/Codebase/core" ]; then
  # DEV 模式：pi-coding-master.DEV/Codebase/deploy/install.sh
  IMPL="$PKG_ROOT/Codebase/core"
  DEPLOY="$PKG_ROOT/Codebase/deploy"
elif [ -d "$PKG_ROOT/core" ]; then
  # 发行包模式：v0.2.7-stable/deploy/install.sh 或 npm 全局 pi-coding-master/deploy/install.sh
  IMPL="$PKG_ROOT/core"
  DEPLOY="$PKG_ROOT/deploy"
else
  echo "Error: 找不到 core/ 目录。请从 pi-coding-master 包根目录运行 bash deploy/install.sh"
  exit 1
fi

echo "── pi-coding-master installer (pinned pi $PIN) ──"
echo "  source: $PKG_ROOT"

# ── 1. 定位 pi(只认 @earendil-works) ──
PI_DIST=""
SEARCH_PATHS=""
# npm root -g 在 mac/linux 都能用
NPM_GLOBAL="$(npm root -g 2>/dev/null)"
[ -n "$NPM_GLOBAL" ] && SEARCH_PATHS="$NPM_GLOBAL/@earendil-works/pi-coding-agent/dist"
# mac homebrew
SEARCH_PATHS="$SEARCH_PATHS /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist"
# linux 常见路径
SEARCH_PATHS="$SEARCH_PATHS /usr/lib/node_modules/@earendil-works/pi-coding-agent/dist"
SEARCH_PATHS="$SEARCH_PATHS /usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist"
# nvm/fnm
[ -n "$NVM_DIR" ] && SEARCH_PATHS="$SEARCH_PATHS $(dirname "$(which node)" 2>/dev/null)/../lib/node_modules/@earendil-works/pi-coding-agent/dist"

for c in $SEARCH_PATHS; do
  [ -f "$c/core/tools/bash.js" ] && { PI_DIST="$c"; break; }
done
[ -z "$PI_DIST" ] && { echo "Error: 未找到 @earendil-works/pi-coding-agent。先: npm i -g @earendil-works/pi-coding-agent@$PIN"; exit 1; }
VER="$(node -e "console.log(require('$(dirname "$PI_DIST")/package.json').version)")"
echo "  pi $VER @ $PI_DIST"
[ "$VER" != "$PIN" ] && echo "  WARN: patch 钉死 $PIN;当前是 $VER,可能打不上。"

# ── 2. 打 dist patch ──
apply_patch() {
  local pf="$1" n; n="$(basename "$pf")"
  if ( cd "$PI_DIST" && git apply --reverse --check -p1 "$pf" ) 2>/dev/null; then
    echo "   $n 已应用"
  elif ( cd "$PI_DIST" && git apply --check -p1 "$pf" ) 2>/dev/null; then
    ( cd "$PI_DIST" && git apply -p1 "$pf" ); echo "  OK $n"
  else
    echo "  WARN: $n patch不匹配当前dist，跳过。"
  fi
}
echo "patch dist:"
apply_patch "$IMPL/individual.bio.organs/heart.interrupt/runner_esc.patch"
apply_patch "$IMPL/individual.bio.organs/heart.interrupt/interactive-mode-loader.patch"

# ── 2b. dist-overrides ──
PI_AI_DIST="$(dirname "$PI_DIST")/node_modules/@earendil-works/pi-ai/dist"
PI_TUI_DIST="$(dirname "$PI_DIST")/node_modules/@earendil-works/pi-tui/dist"
echo "dist-overrides:"
if [ "$VER" = "$PIN" ]; then
  # 语法闸
  echo "  语法闸:校验 golden..."
  GATE_BAD=0
  for js in $(find "$DEPLOY/dist-overrides" -name "*.js" ! -name "*.bak" 2>/dev/null) "$IMPL/god.pi.mod/tui.mods.blockrender/blockrender.js"; do
    node --check "$js" 2>/dev/null || { echo "  Error: golden 语法错: ${js#$PKG_ROOT/}"; GATE_BAD=1; }
  done
  [ "$GATE_BAD" = "1" ] && { echo "  Error: 有 golden 解析不过,中止部署。"; exit 1; }
  echo "  OK 所有 golden 语法通过"

  cp "$IMPL/god.pi.mod/tui.mods.blockrender/blockrender.js" "$PI_DIST/modes/interactive/components/blockrender.js" && echo "  OK blockrender.js"
  cp "$DEPLOY/dist-overrides/modes/interactive/components/footer.js" "$PI_DIST/modes/interactive/components/footer.js" && echo "  OK footer.js"
  cp "$DEPLOY/dist-overrides/modes/interactive/components/tool-execution.js" "$PI_DIST/modes/interactive/components/tool-execution.js" && echo "  OK tool-execution.js"
  cp "$DEPLOY/dist-overrides/modes/interactive/components/model-selector.js" "$PI_DIST/modes/interactive/components/model-selector.js" && echo "  OK model-selector.js"
  cp "$DEPLOY/dist-overrides/core/system-prompt.js" "$PI_DIST/core/system-prompt.js" && echo "  OK system-prompt.js"
  cp "$DEPLOY/dist-overrides/modes/interactive/interactive-mode.js" "$PI_DIST/modes/interactive/interactive-mode.js" && echo "  OK interactive-mode.js"
  cp "$DEPLOY/dist-overrides/main.js" "$PI_DIST/main.js" && echo "  OK main.js"
  cp "$DEPLOY/dist-overrides/modes/interactive/components/assistant-message.js" "$PI_DIST/modes/interactive/components/assistant-message.js" && echo "  OK assistant-message.js"
  cp "$DEPLOY/dist-overrides/core/extensions/loader.js" "$PI_DIST/core/extensions/loader.js" && echo "  OK core/extensions/loader.js"
  cp "$DEPLOY/dist-overrides/core/package-manager.js" "$PI_DIST/core/package-manager.js" && echo "  OK core/package-manager.js"

  for f in bash edit read write ls grep find; do
    cp "$DEPLOY/dist-overrides/core/tools/$f.js" "$PI_DIST/core/tools/$f.js" && echo "  OK core/tools/$f.js"
  done
  for f in edit-diff.js file-mutation-queue.js ls-guard.js output-accumulator.js path-utils.js prompts-reader.js render-utils.js tool-definition-wrapper.js truncate.js; do
    [ -f "$DEPLOY/dist-overrides/core/tools/$f" ] && cp "$DEPLOY/dist-overrides/core/tools/$f" "$PI_DIST/core/tools/$f" && echo "  OK core/tools/$f"
  done

  if [ -d "$PI_TUI_DIST" ]; then
    cp "$IMPL/god.pi.mod/tui.mods.blockrender/blockrender.js" "$PI_TUI_DIST/blockrender.js" && echo "  OK pi-tui/blockrender.js"
    cp "$DEPLOY/dist-overrides/pi-tui/tui.js" "$PI_TUI_DIST/tui.js" && echo "  OK pi-tui/tui.js"
    cp "$DEPLOY/dist-overrides/pi-tui/utils.js" "$PI_TUI_DIST/utils.js" && echo "  OK pi-tui/utils.js"
    cp "$DEPLOY/dist-overrides/pi-tui/components/markdown.js" "$PI_TUI_DIST/components/markdown.js" && echo "  OK pi-tui/components/markdown.js"
    cp "$DEPLOY/dist-overrides/pi-tui/components/text.js" "$PI_TUI_DIST/components/text.js" && echo "  OK pi-tui/components/text.js"
    cp "$DEPLOY/dist-overrides/pi-tui/components/loader.js" "$PI_TUI_DIST/components/loader.js" && echo "  OK pi-tui/components/loader.js"
  else
    echo "  WARN: 未找到 pi-tui/dist，跳过渲染 override。"
  fi

  if [ -f "$PI_AI_DIST/providers/openai-completions.js" ]; then
    cp "$DEPLOY/dist-overrides/pi-ai/providers/openai-completions.js" "$PI_AI_DIST/providers/openai-completions.js" && echo "  OK openai-completions.js"
    mkdir -p "$(dirname "$PI_DIST")/prompts"
    [ -f "$IMPL/prompts/prompts.json" ] && cp "$IMPL/prompts/prompts.json" "$(dirname "$PI_DIST")/prompts/prompts.json" && echo "  OK prompts/prompts.json"
  else
    echo "  WARN: 未找到 pi-ai/providers/openai-completions.js，跳过断流补丁。"
  fi
else
  echo "  pi $VER != $PIN：跳过 dist-overrides，避免不兼容。"
fi

# ── 3. 部署扩展 ──
EXT_DIR="$HOME/.pi/agent/extensions"
mkdir -p "$EXT_DIR"

for old in unstop conscious memory hippocampus; do
  [ -d "$EXT_DIR/$old" ] && [ ! -L "$EXT_DIR/$old" ] && mv "$EXT_DIR/$old" "$EXT_DIR/$old.old"
done

safe_deploy() {
  local src="$1" dest="$2" label="$3"; local d="${dest%/}"
  if [ -L "$d" ]; then
    echo "  跳过 $label -- $d 是软链(已 live 指向源)"
    return 0
  fi
  rsync -a --exclude='.DS_Store' --exclude='__pycache__' --exclude='*.pyc' "$src" "$dest"
  echo "  OK $label"
}

echo "扩展:"
safe_deploy "$IMPL/"                                  "$EXT_DIR/pi-coding-master/"   "pi-coding-master/ (主扩展)"
safe_deploy "$IMPL/technology.phone/"                 "$EXT_DIR/device/"     "device/"
safe_deploy "$IMPL/god.pi.mod/tui.mods.viewmode/"    "$EXT_DIR/view_mode/"  "view_mode/"

# ── 4. 部署 launcher ──
mkdir -p "$HOME/.local/bin"
LAUNCHER_SRC="$IMPL/god.pi.mod/cli/pi-people.sh"
if [ -L "$HOME/.local/bin/pi" ]; then
  echo "  跳过 launcher -- ~/.local/bin/pi 是软链(防写穿源)"
elif [ -f "$LAUNCHER_SRC" ]; then
  cp "$LAUNCHER_SRC" "$HOME/.local/bin/pi"
  chmod +x "$HOME/.local/bin/pi"
  echo "  OK pi launcher -> ~/.local/bin/pi"
else
  echo "  WARN: 未找到 launcher，跳过。"
fi

# ── 5. 部署 shell 补全 ──
mkdir -p "$HOME/.pi/agent"
COMPL_SRC="$IMPL/god.pi.mod/cli/pi-completion.zsh"
if [ -f "$COMPL_SRC" ]; then
  cp "$COMPL_SRC" "$HOME/.pi/agent/pi-completion.zsh"
  echo "  OK pi 补全 -> ~/.pi/agent/pi-completion.zsh"
fi

# zsh 补全自动接入
SRC_LINE='source "$HOME/.pi/agent/pi-completion.zsh" 2>/dev/null'
for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
  [ -f "$rc" ] || continue
  if ! grep -qF '.pi/agent/pi-completion.zsh' "$rc"; then
    printf '\n# pi-coding-master shell 补全\n%s\n' "$SRC_LINE" >> "$rc"
    echo "  OK 补全已接入 $(basename "$rc")"
  fi
done

# ── 6. 部署完整性检查 ──
if [ -f "$DEPLOY/scripts/check-deploy.sh" ]; then
  echo ""
  echo "部署检查:"
  bash "$DEPLOY/scripts/check-deploy.sh" "$PKG_ROOT" 2>&1 | sed 's/^/  /' || true
fi

echo ""
echo "── pi-coding-master v0.2.7 安装完成。重启 pi 生效。 ──"
