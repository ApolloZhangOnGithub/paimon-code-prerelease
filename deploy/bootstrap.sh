#!/bin/bash
# bootstrap.sh — 新电脑一键部署 paimon-code
# 用法: curl -fsSL <url> | bash  或  bash bootstrap.sh
#
# 前提: git, node (>=18), bun, gh (GitHub CLI, 已 gh auth login)
# 可选: SSH key 能连 root@47.106.190.199（用于 sync 隧道）
set -e

R='\033[0m'; G='\033[32m'; Y='\033[33m'; B='\033[1m'; D='\033[90m'
step() { echo -e "\n  ${B}[$1]${R} $2"; }
ok()   { echo -e "  ${G}✓${R} $1"; }
warn() { echo -e "  ${Y}!${R} $1"; }
die()  { echo -e "  \033[31m✗${R} $1"; exit 1; }

echo ""
echo -e "  ${B}paimon-code${R} bootstrap"
echo "  ───────────────────────────────────"

# ── 0. 检查依赖 ──
step 0 "检查依赖"
command -v git  >/dev/null || die "需要 git"
command -v node >/dev/null || die "需要 node (>=18)"
command -v bun  >/dev/null || die "需要 bun (curl -fsSL https://bun.sh/install | bash)"
command -v gh   >/dev/null || die "需要 gh CLI ($([ "$(uname)" = "Darwin" ] && echo "brew install gh" || echo "https://cli.github.com") && gh auth login)"
gh auth status  >/dev/null 2>&1 || die "请先 gh auth login"
ok "git, node, bun, gh"

# 可选依赖提示
command -v tmux    >/dev/null || warn "tmux 未安装 — 元意识/睡眠功能需要。$([ "$(uname)" = "Darwin" ] && echo "brew install tmux" || echo "apt install tmux")"
command -v ffmpeg  >/dev/null || warn "ffmpeg 未安装 — 语音输入/音频播放需要。$([ "$(uname)" = "Darwin" ] && echo "brew install ffmpeg" || echo "apt install ffmpeg")"
command -v python3 >/dev/null || warn "python3 未安装 — session 初始化需要"
command -v curl    >/dev/null || warn "curl 未安装 — 同步服务需要"

# ── 1. 克隆源码 ──
step 1 "克隆源码"
INSTALL_DIR="$HOME/.local/lib/paimon/source"
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "  ${D}已存在，更新...${R}"
  cd "$INSTALL_DIR" && git pull --ff-only
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  gh repo clone ApolloZhangOnGithub/paimon-code-dev "$INSTALL_DIR" -- --depth 1
fi
ok "源码 → $INSTALL_DIR"

# ── 2. 安装依赖 ──
step 2 "安装依赖"
cd "$INSTALL_DIR/Codebase/core"
if [ ! -d "node_modules" ]; then
  bun install 2>&1 | tail -3
fi
ok "node_modules"

# ── 3. 运行 install.sh ──
step 3 "安装 paimon-code"
bash "$INSTALL_DIR/Codebase/deploy/install.sh"

# ── 4. 登录 ──
step 4 "登录"
if paimon whoami >/dev/null 2>&1; then
  ok "已登录: $(paimon whoami 2>&1 | head -1 | sed 's/^ *//')"
else
  paimon login
fi

# ── 5. SSH 隧道 (sync) ──
step 5 "配置同步隧道"
SYNC_SERVER="root@47.106.190.199"
if ssh -o ConnectTimeout=3 -o BatchMode=yes "$SYNC_SERVER" "echo ok" >/dev/null 2>&1; then
  if [ "$(uname)" = "Darwin" ]; then
    # macOS: LaunchAgent
    PLIST="$HOME/Library/LaunchAgents/beer.paimon.sync-tunnel.plist"
    if [ ! -f "$PLIST" ]; then
      cat > "$PLIST" << 'PXML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>beer.paimon.sync-tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/ssh</string>
        <string>-N</string>
        <string>-o</string>
        <string>ServerAliveInterval=30</string>
        <string>-o</string>
        <string>ServerAliveCountMax=3</string>
        <string>-o</string>
        <string>ExitOnForwardFailure=yes</string>
        <string>-L</string>
        <string>13456:localhost:3456</string>
        <string>root@47.106.190.199</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/paimon-sync-tunnel.log</string>
</dict>
</plist>
PXML
      launchctl load "$PLIST" 2>/dev/null
      ok "SSH 隧道已配置 (LaunchAgent)"
    else
      ok "SSH 隧道已存在"
    fi
  else
    # Linux: systemd user service
    UNIT_DIR="$HOME/.config/systemd/user"
    UNIT_FILE="$UNIT_DIR/paimon-sync-tunnel.service"
    if [ ! -f "$UNIT_FILE" ]; then
      mkdir -p "$UNIT_DIR"
      cat > "$UNIT_FILE" << 'SVCEOF'
[Unit]
Description=Paimon sync SSH tunnel
After=network-online.target

[Service]
ExecStart=/usr/bin/ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 13456:localhost:3456 root@47.106.190.199
Restart=always
RestartSec=10
StandardError=append:/tmp/paimon-sync-tunnel.log

[Install]
WantedBy=default.target
SVCEOF
      systemctl --user daemon-reload 2>/dev/null
      systemctl --user enable --now paimon-sync-tunnel.service 2>/dev/null
      ok "SSH 隧道已配置 (systemd user service)"
    else
      ok "SSH 隧道已存在"
    fi
  fi

  # 等隧道就绪
  sleep 2
  if curl -sf --connect-timeout 2 http://localhost:13456/health >/dev/null 2>&1; then
    ok "隧道连通"
  else
    warn "隧道未就绪，稍后会自动重试"
  fi
else
  warn "无法连接 sync 服务器（需要 SSH key），跳过隧道配置"
  warn "手动配置: ssh-copy-id $SYNC_SERVER"
fi

# ── 6. 首次同步 ──
step 6 "同步数据"
if curl -sf --connect-timeout 2 http://localhost:13456/health >/dev/null 2>&1; then
  paimon sync pull 2>&1
  ok "同步完成"
else
  warn "sync 不可用，跳过首次同步"
fi

# ── 完成 ──
echo ""
echo -e "  ${G}${B}安装完成${R}"
echo ""
echo -e "  使用: ${B}paimon <agent名>${R}  启动/进入 agent"
echo -e "        ${B}paimon${R}             列出所有 agent"
echo -e "        ${B}paimon sync${R}        查看同步状态"
echo ""
