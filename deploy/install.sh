#!/bin/bash
# paimon-code installer — 必须通过 make 调用，不要直接 bash install.sh
[ "$PAIMON_VIA_MAKE" = "1" ] || { echo "ERROR: 不要直接跑 install.sh。用 make dev-minutely。"; exit 1; }

PIN="0.80.7"
R='\033[0m'; RED='\033[31m'; GRN='\033[32m'; YLW='\033[33m'; DIM='\033[90m'
ok()   { echo -e "  ${GRN}OK${R}  $1"; }
warn() { echo -e "  ${YLW}WARN${R}  $1"; }
err()  { echo -e "  ${RED}ERROR${R}  $1"; exit 1; }
quiet_cp() { cp "$1" "$2" 2>/dev/null; }

# ── 定位源码 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -d "$PKG_ROOT/Codebase/core" ]; then
  IMPL="$PKG_ROOT/Codebase/core"; DEPLOY="$PKG_ROOT/Codebase/deploy"
elif [ -d "$PKG_ROOT/core" ]; then
  IMPL="$PKG_ROOT/core"; DEPLOY="$PKG_ROOT/deploy"
else
  err "core/ not found"
fi

echo ""
echo -e "  ${GRN}paimon-code${R} installer"
echo "  ─────────────────────────────────────"

# ── 0. 系统依赖检查 ──
DEP_WARN=0
# 必须有
for cmd in node npm git rsync; do
  command -v "$cmd" >/dev/null || err "缺少必需依赖: $cmd$([ "$cmd" = "rsync" ] && echo " — 安装: $([ "$(uname)" = "Darwin" ] && echo "brew install rsync" || echo "apt install rsync / dnf install rsync")" || true)"
done
ok "必需依赖: node npm git rsync"

# 功能依赖（缺了不致命，但对应功能不可用）
_check_opt() {
  if command -v "$1" >/dev/null 2>&1; then return 0; fi
  warn "未找到 $1 — $2"
  DEP_WARN=1; return 1
}
_check_opt bun       "语音输入 (ear) 需要 bun 运行时。安装: curl -fsSL https://bun.sh/install | bash"
_check_opt tmux      "元意识 (metaconsciousness) 和睡眠整理 (sleep) 需要 tmux。$([ "$(uname)" = "Darwin" ] && echo "安装: brew install tmux" || echo "安装: apt install tmux / dnf install tmux")"
_check_opt ffmpeg    "语音输入 (ear) 和音频播放 (iPod) 需要 ffmpeg。$([ "$(uname)" = "Darwin" ] && echo "安装: brew install ffmpeg" || echo "安装: apt install ffmpeg / dnf install ffmpeg")"
_check_opt ffprobe   "iPod 播放器获取音频时长需要 ffprobe (随 ffmpeg 安装)"
_check_opt python3   "元意识和睡眠的 session 初始化需要 python3"
_check_opt curl      "同步服务和隧道检测需要 curl"

# Chrome/Chromium 检查（Safari 浏览器 app 需要）
CHROMIUM_FOUND=0
if [ -n "$CHROMIUM_PATH" ]; then
  [ -x "$CHROMIUM_PATH" ] && CHROMIUM_FOUND=1
fi
if [ "$CHROMIUM_FOUND" = "0" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    for b in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
      [ -x "$b" ] && { CHROMIUM_FOUND=1; break; }
    done
  else
    for b in google-chrome-stable google-chrome chromium-browser chromium; do
      command -v "$b" >/dev/null 2>&1 && { CHROMIUM_FOUND=1; break; }
    done
  fi
fi
if [ "$CHROMIUM_FOUND" = "1" ]; then
  ok "Chrome/Chromium"
else
  warn "未找到 Chrome/Chromium — Safari 浏览器 app 将不可用。$([ "$(uname)" = "Darwin" ] && echo "安装 Google Chrome 到 /Applications" || echo "安装: apt install chromium-browser / dnf install chromium")"
  DEP_WARN=1
fi

# Linux 音频后端检查
if [ "$(uname)" = "Linux" ]; then
  # TTS 输出的是 MP3——只有 ffplay/mpv/cvlc 能播（paplay/aplay 只支持 WAV，不能用）
  AUDIO_OUT=0
  for cmd in ffplay mpv cvlc; do command -v "$cmd" >/dev/null 2>&1 && { AUDIO_OUT=1; ok "MP3 播放 ($cmd)"; break; }; done
  [ "$AUDIO_OUT" = "1" ] || { warn "未找到 MP3 播放器 (ffplay/mpv/cvlc) — TTS 语音输出将不可用。安装: apt install ffmpeg（推荐，同时解决录入依赖）或 apt install mpv"; DEP_WARN=1; }

  # 麦克风录入需要 ffmpeg + pulse 或 alsa 输入设备
  AUDIO_IN=0
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -hide_banner -devices 2>&1 | grep -qE "pulse|alsa" && AUDIO_IN=1
  fi
  [ "$AUDIO_IN" = "1" ] && ok "音频输入 (pulse/alsa)" || { warn "ffmpeg 未检测到 pulse/alsa 输入设备 — 麦克风录入可能不可用。安装: apt install pulseaudio 或 apt install alsa-utils"; DEP_WARN=1; }
fi

[ "$DEP_WARN" = "0" ] && ok "所有可选依赖就绪" || warn "部分可选依赖缺失（上面的功能将不可用，其余功能正常）"
echo ""

# ── 1. runtime ──
RUNTIME="$HOME/.local/lib/paimon/runtime"
PI_PKG="$RUNTIME/node_modules/@earendil-works/pi-coding-agent"
PI_DIST="$PI_PKG/dist"

CURRENT_VER=""
if [ -f "$PI_PKG/package.json" ]; then CURRENT_VER=$(node -e "try{console.log(require('$PI_PKG/package.json').version)}catch {}" 2>/dev/null); fi

if [ "$CURRENT_VER" = "$PIN" ]; then
  ok "runtime pi@$PIN"
else
  echo -e "  ${DIM}installing pi@$PIN...${R}"
  mkdir -p "$RUNTIME"
  [ -f "$RUNTIME/package.json" ] || echo '{"private":true}' > "$RUNTIME/package.json"
  ( cd "$RUNTIME" && npm install "@earendil-works/pi-coding-agent@$PIN" 2>&1 | tail -3 )
  ok "runtime pi@$PIN"
fi

[ ! -f "$PI_DIST/core/tools/bash.js" ] && err "runtime broken"
node -e "const f='$PI_PKG/package.json',p=JSON.parse(require('fs').readFileSync(f,'utf8'));if(p.piConfig?.name!=='paimon'){p.piConfig=p.piConfig||{};p.piConfig.name='paimon';require('fs').writeFileSync(f,JSON.stringify(p,null,'\t'))}" 2>/dev/null

# 顶层 pi-ai / pi-agent-core 与 PIN 对齐（扩展经软链解析到顶层副本；不对齐 = 扩展侧与 pi 核心两个版本并存）
for dep in pi-ai pi-agent-core; do
  DEP_VER=$(node -e "try{console.log(require('$RUNTIME/node_modules/@earendil-works/$dep/package.json').version)}catch {}" 2>/dev/null)
  if [ "$DEP_VER" != "$PIN" ]; then
    echo -e "  ${DIM}aligning $dep@$PIN (was ${DEP_VER:-none})...${R}"
    ( cd "$RUNTIME" && npm install "@earendil-works/$dep@$PIN" 2>&1 | tail -1 )
    DEP_VER=$(node -e "try{console.log(require('$RUNTIME/node_modules/@earendil-works/$dep/package.json').version)}catch {}" 2>/dev/null)
  fi
  [ "$DEP_VER" = "$PIN" ] && ok "runtime $dep@$PIN" || warn "$dep version drift: ${DEP_VER:-none} (want $PIN)"
done

# ── 2. live integrity check ──
# 检查 runtime 是否被手动修改过（对比上次 install 保存的 manifest）
# make dev-minutely/dev-restore 走正常部署流程，跳过 drift 检查
MANIFEST="$RUNTIME/.paimon-install-manifest"
if [ -f "$MANIFEST" ] && [ -z "$PAIMON_VER" ]; then
  DRIFT=""
  while IFS=$'\t' read -r hash file; do
    if [ -f "$file" ]; then
      current=$(md5 -q "$file" 2>/dev/null || md5sum "$file" 2>/dev/null | cut -d' ' -f1)
      [ "$current" = "$hash" ] || DRIFT="${DRIFT}\n  MODIFIED: ${file##*dist/}"
    else
      DRIFT="${DRIFT}\n  MISSING: ${file##*dist/}"
    fi
  done < "$MANIFEST"
  if [ -n "$DRIFT" ]; then
    echo -e "  ${RED}DRIFT DETECTED${R} — runtime was modified outside make:${DRIFT}"
    echo -e "  ${YLW}修复方法:${R}"
    echo -e "    1. 检查上面的 MODIFIED 文件是否有需要保存的改动"
    echo -e "    2. 如有，先把改动合并回 god.tui/overrides/ 源码"
    echo -e "    3. trash ~/.local/lib/paimon/runtime/node_modules/@earendil-works/ 然后重新 make"
    exit 1
  fi
fi

# ── 3. restore stock dist before overrides ──
STOCK_BACKUP="$(dirname "$(dirname "$IMPL")")/pi-source-backup/v${PIN}"
if [ -d "$STOCK_BACKUP/pi-coding-agent" ]; then
  rsync -a --delete "$STOCK_BACKUP/pi-coding-agent/" "$PI_DIST/"
  ok "runtime pi-coding-agent dist restored from stock"
fi
if [ -d "$STOCK_BACKUP/pi-tui" ]; then
  _PI_TUI_RESTORE="$PI_PKG/node_modules/@earendil-works/pi-tui/dist"
  [ -d "$_PI_TUI_RESTORE" ] || _PI_TUI_RESTORE="$RUNTIME/node_modules/@earendil-works/pi-tui/dist"
  if [ -d "$_PI_TUI_RESTORE" ]; then
    rsync -a --delete "$STOCK_BACKUP/pi-tui/" "$_PI_TUI_RESTORE/"
    ok "runtime pi-tui dist restored from stock"
  fi
fi

# ── 3. runtime overrides ──
OVERRIDES="$IMPL/god.tui/overrides"
PI_TUI_DIST="$PI_PKG/node_modules/@earendil-works/pi-tui/dist"
if [ ! -d "$PI_TUI_DIST" ]; then PI_TUI_DIST="$RUNTIME/node_modules/@earendil-works/pi-tui/dist"; fi

# syntax gate
GATE_BAD=0
while IFS= read -r -d '' js; do
  node --check "$js" 2>/dev/null || { err "syntax error: ${js##*/}"; GATE_BAD=1; }
done < <(find "$OVERRIDES" -name "*.js" ! -name "*.bak" -print0 2>/dev/null)
node --check "$IMPL/god.tui/ui/blockrender.js" 2>/dev/null || { err "syntax error: blockrender.js"; }

# overrides 实体拷贝进 pi dist（cp -f，不是 symlink——symlink 会让 Node 按真实路径解析
# relative import，从 source 树找依赖，路径就断了）
LINK_FAIL=0
_override() {
  cp -f "$1" "$2" 2>/dev/null || { echo -e "  ${RED}COPY FAIL${R}  $1 → $2"; LINK_FAIL=1; }
}
_override "$IMPL/god.tui/ui/blockrender.js" "$PI_DIST/modes/interactive/components/blockrender.js"

# Patch tool-execution.js: inject visibleWidth/wrapTextWithAnsi for blockrender hangWrapText support
TE="$PI_DIST/modes/interactive/components/tool-execution.js"
if [ -f "$TE" ]; then
  sed -i '' 's|import { Box, Container, getCapabilities, Image, Spacer, Text } from "@earendil-works/pi-tui";|import { Box, Container, getCapabilities, Image, Spacer, Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";|' "$TE"
  sed -i '' 's|initBlockrender(Text, Container);|initBlockrender(Text, Container, visibleWidth, wrapTextWithAnsi);|' "$TE"
fi

_override "$IMPL/god.tui/ui/footer.js" "$PI_DIST/modes/interactive/components/footer.js"
_override "$IMPL/god.tui/ui/spinner.js" "$PI_DIST/modes/interactive/components/spinner.js"
_override "$IMPL/god.tui/ui/statusbar.js" "$PI_DIST/modes/interactive/components/statusbar.js"
for f in $(cd "$OVERRIDES/modes" && find . -name '*.js' -o -name '*.json'); do
  _override "$OVERRIDES/modes/$f" "$PI_DIST/modes/$f"
done
# pi-dist overrides（之前靠残留活着，现在纳入正式管理——npm update 不会再丢）
PI_DIST_OVERRIDES="$OVERRIDES/pi-dist"
if [ -d "$PI_DIST_OVERRIDES" ]; then
  for f in $(cd "$PI_DIST_OVERRIDES" && find . -name '*.js' ! -path './modes/interactive/components/diff.js'); do
    mkdir -p "$(dirname "$PI_DIST/$f")"
    _override "$PI_DIST_OVERRIDES/$f" "$PI_DIST/$f"
    # 同时复制到 pi-dist/ 以支持 tool-execution.js 的 ../../../pi-dist/... 引用路径
    mkdir -p "$(dirname "$PI_DIST/pi-dist/$f")"
    _override "$PI_DIST_OVERRIDES/$f" "$PI_DIST/pi-dist/$f"
  done
  # diff.js 桥接：仅放 pi-dist/，不能覆盖 dist/ 原始 diff.js
  mkdir -p "$(dirname "$PI_DIST/pi-dist/modes/interactive/components/diff.js")"
  _override "$PI_DIST_OVERRIDES/modes/interactive/components/diff.js" "$PI_DIST/pi-dist/modes/interactive/components/diff.js"
fi
# core/ overrides（tools、agent-session 等）
if [ -d "$OVERRIDES/core" ]; then
  for f in $(cd "$OVERRIDES/core" && find . -name '*.js'); do
    mkdir -p "$(dirname "$PI_DIST/core/$f")"
    _override "$OVERRIDES/core/$f" "$PI_DIST/core/$f"
  done
fi
if [ -d "$PI_TUI_DIST" ]; then
  _override "$IMPL/god.tui/ui/blockrender.js" "$PI_TUI_DIST/blockrender.js"
  for f in $(cd "$OVERRIDES/pi-tui" && find . -name '*.js'); do
    mkdir -p "$(dirname "$PI_TUI_DIST/$f")"
    _override "$OVERRIDES/pi-tui/$f" "$PI_TUI_DIST/$f"
  done
fi
# pi-ai overrides
AI_APPLIED=0
for AI_PKG in "$PI_PKG/node_modules/@earendil-works/pi-ai" "$RUNTIME/node_modules/@earendil-works/pi-ai"; do
  AI_VER=$(node -e "try{console.log(require('$AI_PKG/package.json').version)}catch {}" 2>/dev/null)
  [ "$AI_VER" = "$PIN" ] || continue
  for f in openai-completions.js openai-responses-shared.js; do
    if [ -f "$OVERRIDES/pi-ai/$f" ]; then _override "$OVERRIDES/pi-ai/$f" "$AI_PKG/dist/api/$f" && AI_APPLIED=1; fi
  done
done
[ "$AI_APPLIED" = "1" ] || warn "pi-ai overrides not applied (no pi-ai@$PIN found — check alignment / rebase golden)"
# theme overrides
for f in dark.json light.json; do
  _override "$OVERRIDES/modes/interactive/theme/$f" "$PI_DIST/modes/interactive/theme/$f"
done

# override 拷贝失败 = 线上继续跑旧渲染代码，必须响、必须停（2026-07-17 叠帧事故教训：部署失败不许静默）
[ "$LINK_FAIL" = "1" ] && err "runtime overrides 部署失败（上面有 COPY FAIL）— 线上会继续跑旧代码" || ok "runtime overrides (copied)"

# ── 4. paimon agent directory ──
PAIMON_AGENT="$HOME/.paimon"
PAIMON_EXT="$HOME/.local/lib/paimon/extensions"
EXT_NAME="paimon-code"
if [ "$PAIMON_CHANNEL" = "dev-stable" ]; then EXT_NAME="paimon-code-stable"; fi
mkdir -p "$PAIMON_EXT"
# dev-stable: 复制一份独立副本，不受后续 dev-minutely 影响
if [ "$PAIMON_CHANNEL" = "dev-stable" ]; then
  STABLE_DIR="$HOME/.local/lib/paimon/extensions-stable/paimon-code"
  rsync -a --delete --exclude='.DS_Store' --exclude='node_modules' "$IMPL/" "$STABLE_DIR/" 2>/dev/null
  # dev-stable 副本需要 node_modules（@sinclair/typebox 等），复制
  rm -rf "$STABLE_DIR/node_modules" 2>/dev/null
  ln -sf "$IMPL/node_modules" "$STABLE_DIR/node_modules" 2>/dev/null
  IMPL="$STABLE_DIR"
fi
# 软链 node_modules → runtime，扩展 import 能解析到 @earendil-works/pi-tui 等
rm -rf "$PAIMON_AGENT/node_modules" 2>/dev/null || true
ln -sf "$RUNTIME/node_modules" "$PAIMON_AGENT/node_modules" 2>/dev/null
# @mariozechner 别名 → @earendil-works（扩展 import 时 Node 需要找到这个包）
rm -rf "$RUNTIME/node_modules/@mariozechner" 2>/dev/null
mkdir -p "$RUNTIME/node_modules/@mariozechner" 2>/dev/null
ln -sf "$RUNTIME/node_modules/@earendil-works/pi-coding-agent" "$RUNTIME/node_modules/@mariozechner/pi-coding-agent" 2>/dev/null
# 源码目录也需要（扩展从真实路径加载）
rm -rf "$IMPL/node_modules/@mariozechner" 2>/dev/null
mkdir -p "$IMPL/node_modules/@mariozechner" 2>/dev/null
ln -sf "$RUNTIME/node_modules/@earendil-works/pi-coding-agent" "$IMPL/node_modules/@mariozechner/pi-coding-agent" 2>/dev/null
rm -rf "$IMPL/node_modules/@earendil-works" 2>/dev/null
mkdir -p "$IMPL/node_modules/@earendil-works"
# 嵌套副本优先（pi 实际加载的那份），被 npm dedup 提升后回退顶层——保证扩展与 pi 核心用同一份
PI_TUI_PKG="$PI_PKG/node_modules/@earendil-works/pi-tui"
[ -d "$PI_TUI_PKG" ] || PI_TUI_PKG="$RUNTIME/node_modules/@earendil-works/pi-tui"
ln -sf "$PI_TUI_PKG" "$IMPL/node_modules/@earendil-works/pi-tui"
PI_AI_PKG="$PI_PKG/node_modules/@earendil-works/pi-ai"
[ -d "$PI_AI_PKG" ] || PI_AI_PKG="$RUNTIME/node_modules/@earendil-works/pi-ai"
ln -sf "$PI_AI_PKG" "$IMPL/node_modules/@earendil-works/pi-ai"
ln -sf "$RUNTIME/node_modules/@earendil-works/pi-coding-agent" "$IMPL/node_modules/@earendil-works/pi-coding-agent"

mkdir -p "$HOME/.paimon/config"
for f in auth.json models.json settings.json; do
  SRC="$HOME/.paimon/config/$f"
  DEST="$PAIMON_AGENT/$f"
  [ -e "$SRC" ] || touch "$SRC" 2>/dev/null
  ln -sf "config/$f" "$DEST" 2>/dev/null
done

# services.json — 第三方服务配置模板（不覆盖已有配置）
SERVICES_JSON="$HOME/.paimon/config/services.json"
if [ ! -f "$SERVICES_JSON" ]; then
  cat > "$SERVICES_JSON" << 'SVCEOF'
{
  "brave": {
    "apiKey": ""
  },
  "weread": {
    "apiKey": ""
  },
  "doubao-voicengine": {
    "appId": "",
    "token": ""
  },
  "doubao-seed": {
    "url": "",
    "apiKey": "",
    "model": ""
  }
}
SVCEOF
  echo -e "  ${YLW}INFO${R}  created services.json — run /config to set API keys"
fi

# extensions (symlink for cross-module imports)
# dev-stable 只存实体副本到 extensions-stable/，不放 extensions/（避免工具冲突）
EXT_NAME="paimon-code"
# 清理旧残留（曾用名 paimon-code.minutely / paimon-code）
rm -rf "$PAIMON_EXT/paimon-code.minutely" 2>/dev/null
rm -rf "$PAIMON_EXT/paimon-code" 2>/dev/null
rm -rf "$PAIMON_EXT/device" 2>/dev/null
rsync -rptgo --delete --exclude='.DS_Store' "$IMPL/" "$PAIMON_EXT/paimon-code/" 2>/dev/null || true
# 部署校验：上面 rsync 的报错被静默（node_modules 里 symlink 跳过的噪音），失败也照样往下走——
# 曾导致 extensions 静默没同步、线上长期跑旧代码（2026-07-17 hibernate 叠帧事故）。
# 这里按内容逐字节校验源码树 vs 线上副本，不一致必须响、必须停。
_tree_sum() { (cd "$1" && find . -type f -not -path './node_modules/*' -not -name '.DS_Store' -print0 | sort -z | xargs -0 shasum 2>/dev/null | shasum | cut -d' ' -f1); }
SRC_SUM=$(_tree_sum "$IMPL")
DST_SUM=$(_tree_sum "$PAIMON_EXT/paimon-code")
if [ -z "$SRC_SUM" ] || [ "$SRC_SUM" != "$DST_SUM" ]; then
  err "extensions 部署校验失败：线上副本与源码不一致（rsync 没落地）— 线上是旧代码"
fi
# extensions node_modules：pi-coding-agent 的嵌套 node_modules 有 pi-tui/pi-ai 完整依赖，
# 顶层 runtime/node_modules 有 pi-coding-agent 本身和 @sinclair/typebox。
# 合并两层到 extensions，避免 pi-tui 双实例（双实例 = kitty protocol 状态不共享 = 乱码）。
[ -d "$RUNTIME/node_modules/@sinclair/typebox" ] || ( cd "$RUNTIME" && npm install @sinclair/typebox --silent 2>&1 | tail -1 )
rm -rf "$PAIMON_EXT/paimon-code/node_modules" 2>/dev/null
mkdir -p "$PAIMON_EXT/paimon-code/node_modules"
# 先链顶层（pi-coding-agent, @sinclair/typebox, @mariozechner 等）
for d in "$RUNTIME/node_modules/@earendil-works" "$RUNTIME/node_modules/@mariozechner" "$RUNTIME/node_modules/@sinclair"; do
  [ -d "$d" ] && ln -s "$d" "$PAIMON_EXT/paimon-code/node_modules/$(basename "$d")" 2>/dev/null
done
# 再用嵌套的 pi-tui/pi-ai 覆盖顶层的（保证和 pi-coding-agent 用同一份）
PI_NESTED="$PI_PKG/node_modules/@earendil-works"
if [ -d "$PI_NESTED/pi-tui" ]; then
  ln -sfn "$PI_NESTED/pi-tui" "$PAIMON_EXT/paimon-code/node_modules/@earendil-works/pi-tui" 2>/dev/null
fi
if [ -d "$PI_NESTED/pi-ai" ]; then
  ln -sfn "$PI_NESTED/pi-ai" "$PAIMON_EXT/paimon-code/node_modules/@earendil-works/pi-ai" 2>/dev/null
fi
# 打构建标记：部署副本标记为 deployed（源码保持 dev 不动）
sed -i.bak 's/BUILD_MODE: "dev" | "release" = "dev"/BUILD_MODE: "dev" | "release" = "release"/' "$PAIMON_EXT/paimon-code/paths.ts" 2>/dev/null && rm -f "$PAIMON_EXT/paimon-code/paths.ts.bak"
# view-mode 扩展已退役（2026-07-16）：功能内化到渲染组件（__piViewMode 默认 full），launcher 不再加载
# 生成 mobile apps manifest（build + MD5）
if [ -f "$IMPL/technology.local.mobile/apps.build.sh" ]; then
  bash "$IMPL/technology.local.mobile/apps.build.sh" "$IMPL/technology.local.mobile" 2>/dev/null
fi
ok "extensions"

# ── 4b. mobile apps → ProgramFiles/Mobile (symlink) ──
PF_MOBILE="$HOME/.paimon/ProgramFiles/Mobile"
DEPLOYED_APPS="$PAIMON_EXT/paimon-code/technology.local.mobile/apps"
mkdir -p "$PF_MOBILE"
if [ -d "$DEPLOYED_APPS" ]; then
  for app_dir in "$DEPLOYED_APPS"/*/; do
    [ -d "$app_dir" ] || continue
    app_name=$(basename "$app_dir")
    [[ "$app_name" == @FUTURE.* || "$app_name" == @removed.* || "$app_name" == .* ]] && continue
    ln -sfn "$app_dir" "$PF_MOBILE/$app_name"
  done
  ok "mobile apps → ProgramFiles/Mobile"
fi

# ── 5. launcher ──
mkdir -p "$HOME/.local/bin"
LAUNCHER_SRC="$IMPL/god.cli/launcher.sh"
if [ -f "$LAUNCHER_SRC" ]; then
  cp "$LAUNCHER_SRC" "$HOME/.local/bin/paimon"
  chmod +x "$HOME/.local/bin/paimon"
fi
ok "launcher"

# ── 5b. mobile CLI ──
MOBILE_CLI_DIR="$IMPL/world.accessibility/claudecode"
if [ -f "$MOBILE_CLI_DIR/mobile-cli.sh" ]; then
  cp "$MOBILE_CLI_DIR/mobile-cli.sh" "$HOME/.local/bin/mobile"
  cp "$MOBILE_CLI_DIR/mobile-runner.mjs" "$HOME/.local/bin/mobile-runner.mjs"
  chmod +x "$HOME/.local/bin/mobile"
  ok "mobile cli"
fi

# ── 5c. identity CLI ──
IDENTITY_CLI="$IMPL/individual.abio.identity/identity-cli.sh"
if [ -f "$IDENTITY_CLI" ]; then
  cp "$IDENTITY_CLI" "$HOME/.local/bin/identity"
  chmod +x "$HOME/.local/bin/identity"
  ok "identity cli"
fi

# ── 5d. npm dependencies: 自动安装 extensions package.json 中新增的依赖 ──
if [ -f "$EXT_DIR/package.json" ]; then
  echo "  installing dependencies..."
  (cd "$EXT_DIR" && npm install --no-save --no-audit --no-fund --loglevel=error 2>&1) || true
fi

# ── 6. shell completion ──
COMPL_DIR="$HOME/.paimon/agent/config"
mkdir -p "$COMPL_DIR"
COMPL_SRC="$IMPL/god.cli/paimon-completion.zsh"
if [ -f "$COMPL_SRC" ]; then cp "$COMPL_SRC" "$COMPL_DIR/paimon-completion.zsh"; fi
SRC_LINE='source "$HOME/.paimon/agent/config/paimon-completion.zsh" 2>/dev/null'
for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
  [ -f "$rc" ] || continue
  grep -qF '.paimon/agent/config/paimon-completion.zsh' "$rc" || printf '\n# paimon shell completion\n%s\n' "$SRC_LINE" >> "$rc"
done
ok "completion"

# ── 7. migration (one-time, silent unless triggered) ──
GLOBAL_PI_DIST=""
NPM_GLOBAL="$(npm root -g 2>/dev/null)"
SEARCH_PATHS=""
[ -n "$NPM_GLOBAL" ] && SEARCH_PATHS="$NPM_GLOBAL/@earendil-works/pi-coding-agent/dist"
SEARCH_PATHS="$SEARCH_PATHS /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist"
SEARCH_PATHS="$SEARCH_PATHS /usr/lib/node_modules/@earendil-works/pi-coding-agent/dist"
SEARCH_PATHS="$SEARCH_PATHS /usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist"
for c in $SEARCH_PATHS; do [ -f "$c/core/tools/bash.js" ] && { GLOBAL_PI_DIST="$c"; break; }; done

if [ -n "$GLOBAL_PI_DIST" ]; then
  GLOBAL_PKG="$(dirname "$GLOBAL_PI_DIST")"
  if [ -d "$GLOBAL_PKG/dist-traditional" ]; then
    GLOBAL_VER=$(node -e "try{console.log(require('$GLOBAL_PKG/package.json').version)}catch {}" 2>/dev/null)
    npm i -g "@earendil-works/pi-coding-agent@${GLOBAL_VER:-latest}" >/dev/null 2>&1
    ok "migration: global pi restored"
  fi
  if [ -f "$HOME/.local/bin/pi" ] && [ ! -L "$HOME/.local/bin/pi" ] && grep -q "person-based launcher" "$HOME/.local/bin/pi" 2>/dev/null; then
    mv "$HOME/.local/bin/pi" "$HOME/.local/bin/pi.old-launcher"
    ok "migration: old launcher renamed"
  fi
fi

# ── 7. version ──
if [ -n "$PAIMON_VER" ]; then
  mkdir -p "$HOME/.paimon/agent"
  CHANNEL="${PAIMON_CHANNEL:-minutely}"
  echo "{\"paimon\":\"$PAIMON_VER\",\"pi\":\"$PIN\",\"channel\":\"$CHANNEL\"}" > "$HOME/.paimon/agent/version.json"
  # dev-stable: also save a separate version file for paimon -v listing
  if [ "$PAIMON_CHANNEL" = "dev-stable" ]; then
    echo "{\"paimon\":\"$PAIMON_VER\",\"pi\":\"$PIN\"}" > "$HOME/.paimon/agent/version-stable.json"
  fi
  ok "version $PAIMON_VER ($CHANNEL, pi@$PIN)"
fi

# ── 8. 部署完整性验证 ──
# 不靠 quiet_cp 的返回值——直接检查目标文件是否存在
DEPLOY_ERRORS=0
_deployed() {
  if [ ! -e "$1" ]; then
    echo -e "  ${RED}MISSING${R}  $1"
    DEPLOY_ERRORS=1
  fi
}

echo ""
echo "  verifying deployment..."

# runtime
_deployed "$PI_DIST/cli.js"
_deployed "$PI_DIST/core/tools/bash.js"

# overrides（interactive-mode.js + 它 require 的所有文件）
_deployed "$PI_DIST/modes/interactive/interactive-mode.js"
_deployed "$PI_DIST/modes/interactive/components/blockrender.js"
_deployed "$PI_DIST/modes/interactive/components/footer.js"
_deployed "$PI_DIST/modes/interactive/components/status-indicator.js"
_deployed "$PI_DIST/modes/interactive/components/spinner.js"

# 扩展核心文件
EXT="$PAIMON_EXT/paimon-code"
_deployed "$EXT/paths.ts"
_deployed "$EXT/index.ts"
_deployed "$EXT/package.json"
_deployed "$EXT/individual.bio.organs/kernel.core/core.ts"
_deployed "$EXT/individual.bio.organs/kernel.heart/heart.ts"
_deployed "$EXT/individual.bio.organs/hands.execute/execute.ts"
_deployed "$EXT/individual.bio.organs/mouth.speak/speak.ts"
_deployed "$EXT/individual.bio.organs/ears.listen/listen.ts"
_deployed "$EXT/individual.bio.organs/brain.metaconsciousness/metaconsciousness.ts"
_deployed "$EXT/individual.bio.organs/brain.hippocampus/hippocampus-sleep.ts"
_deployed "$EXT/individual.bio.gene/rna.json"
_deployed "$EXT/god.cli/launcher.sh"
_deployed "$EXT/technology.cloud.servers/browser-service.cjs"
_deployed "$EXT/technology.local.mobile/system.kernel/kernel.ts"

# release 标记
if grep -q '"release"' "$EXT/paths.ts" 2>/dev/null; then
  ok "BUILD_MODE = release"
else
  warn "BUILD_MODE = dev（未标记为 release）"
fi

# launcher
_deployed "$HOME/.local/bin/paimon"

# require 路径验证：interactive-mode.js 引用的 components 必须存在
if [ -f "$PI_DIST/modes/interactive/interactive-mode.js" ]; then
  for req in $(grep -oE 'require\("[^"]+"\)' "$PI_DIST/modes/interactive/interactive-mode.js" | grep -oE '"[^"]+"' | tr -d '"'); do
    # 只检查相对路径
    case "$req" in ./*)
      TARGET="$PI_DIST/modes/interactive/$req"
      # 补 .js 后缀
      [ -f "$TARGET" ] || [ -f "${TARGET}.js" ] || { echo -e "  ${RED}BROKEN REQUIRE${R}  interactive-mode.js → $req"; DEPLOY_ERRORS=1; }
    ;; esac
  done
fi

if [ "$DEPLOY_ERRORS" = "0" ]; then
  ok "deployment verified"
else
  err "部署验证失败 — 上面标红的文件缺失，运行时会崩溃"
fi

echo ""
# save manifest for next install's drift check
: > "$MANIFEST"
for f in $(find "$PI_DIST" "$PI_TUI_DIST" -name '*.js' -not -name '*.map' 2>/dev/null); do
  h=$(md5 -q "$f" 2>/dev/null || md5sum "$f" 2>/dev/null | cut -d' ' -f1)
  printf '%s\t%s\n' "$h" "$f" >> "$MANIFEST"
done

  # read/write/edit TUI: silent() → 显示 ⎿ 摘要（末尾执行，确保不被覆盖）
if [ -f "$TE" ]; then
  _patch_read="$PI_DIST/modes/interactive/components/.patch-read.cjs"
  cat > "$_patch_read" <<'ENDPATCH'
const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const oldLine = '            return renderMessage.silent();';
const newLine = '            const rawHd = ((result?.content || [])[0]?.text || "").split("\\n")[0] || "";\n            const hd = rawHd.replace(/\\s+/g, " ").replace(/(\\d+)/g, m => t.bold(m));\n            return renderMessage.summary(t, ctx, hd);';
src = src.split(oldLine).join(newLine);
fs.writeFileSync(process.argv[2], src);
console.log('patch-ok');
ENDPATCH
  node "$_patch_read" "$TE" && rm -f "$_patch_read"

  # patch tui.js: Container.render 容错无 render 方法的 child
  _tui_js="$PI_PKG/node_modules/@earendil-works/pi-tui/dist/tui.js"
  if [ -f "$_tui_js" ]; then
    _patch_tui="$PI_DIST/modes/interactive/components/.patch-tui.cjs"
    cat > "$_patch_tui" <<'ENDPATCH'
const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const oldLine = 'const childLines = child.render(width);';
const newLine = 'const childLines = typeof child.render === "function" ? child.render(width) : (typeof child === "string" ? [child] : []);';
src = src.split(oldLine).join(newLine);
fs.writeFileSync(process.argv[2], src);
console.log('patch-tui-ok');
ENDPATCH
    node "$_patch_tui" "$_tui_js" && rm -f "$_patch_tui"
  fi
fi

echo -e "  ${GRN}done${R}  Paimon Code@$PIN"
echo ""
