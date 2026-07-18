#!/bin/bash
# Paimon Code
# 用 runtime 里的 pi 副本，不动用户全局安装的 pi。

# ── 路径常量（唯一真相源）──
export PAIMON_HOME="$HOME/.paimon"
export PAIMON_RUNTIME="$HOME/.local/lib/paimon/runtime"
export PAIMON_EXT="$HOME/.local/lib/paimon/extensions/paimon-code"
export PAIMON_CLI="$PAIMON_EXT/god.cli"
export PAIMON_CONFIG="$PAIMON_HOME/config"

RUNTIME_CLI="$PAIMON_RUNTIME/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
export PAIMON_CODING_AGENT_DIR="$PAIMON_HOME/agent"
export NODE_PATH="$PAIMON_RUNTIME/node_modules"
MEMORY_DIR="$PAIMON_HOME/MemoryData"
PLIST="$MEMORY_DIR/plist.json"
mkdir -p "$MEMORY_DIR"

if [ ! -f "$RUNTIME_CLI" ]; then
  echo "Error: paimon-code runtime not installed. Run bash install.sh first."
  exit 1
fi

# ── i18n: 简体中文 or English ──
PAIMON_SETTINGS="$PAIMON_CONFIG/settings.json"
PAIMON_LANG=""
[ -f "$PAIMON_SETTINGS" ] && PAIMON_LANG=$(node --input-type=commonjs -e "try{console.log(JSON.parse(require('fs').readFileSync('$PAIMON_SETTINGS','utf8')).lang||'')}catch{console.log('')}" 2>/dev/null)
if [ -z "$PAIMON_LANG" ]; then
  case "${LANG:-}${LC_ALL:-}" in *zh_CN*) PAIMON_LANG="zh";; *) PAIMON_LANG="en";; esac
fi
export PAIMON_LANG

# 统一确认函数：只有 Y 通过
_confirm() {
  local prompt_zh="$1"
  local prompt_en="$2"
  if [ "$PAIMON_LANG" = "zh" ]; then
    read -p "$prompt_zh (Y 确认，其他取消) " CONFIRM
  else
    read -p "$prompt_en (Y to confirm) " CONFIRM
  fi
  case "$CONFIRM" in y|Y) return 0;; *) return 1;; esac
}

# ── 单一真相源：把 DEEPSEEK_API_KEY 强制对齐到 models.json 里配的字面量 key ──
__DSK=$(node --input-type=commonjs -e "try{const j=JSON.parse(require('fs').readFileSync('$PAIMON_CONFIG/models.json','utf8'));const k=j.providers&&j.providers.deepseek&&j.providers.deepseek.apiKey;if(typeof k==='string'&&!k.startsWith('\$')&&k.trim())process.stdout.write(k.trim());}catch(e){}" 2>/dev/null)
[ -n "$__DSK" ] && export DEEPSEEK_API_KEY="$__DSK"
[ -f "$PLIST" ] || echo '[]' > "$PLIST"

COUNT=$(node --input-type=commonjs -e "console.log(JSON.parse(require('fs').readFileSync('$PLIST','utf8')).filter(p=>!p.archived).length)")

PAIMON_LIST_JS="$PAIMON_CLI/list.cjs"

# Parse flags
MODE=""
ORIG=("$@")
POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --archive|-a) MODE="archive"; shift;;
    --archived|-A) MODE="archived"; shift;;
    --unarchive|-ua) MODE="unarchive"; shift;;
    --org|-o) MODE="org"; shift;;
    --kill|-k) MODE="kill"; shift;;
    --tmux|-t) MODE="tmux"; shift;;
    --mobile|-m) MODE="mobile"; shift;;
    --laptop|-l) MODE="laptop"; shift;;
    --metaconsciousness|-mc) MODE="mc"; shift;;
    --hippocampus|-hc) MODE="hc"; shift;;
    --web|-w) MODE="web"; shift;;
    --detail|-D) export PAIMON_DETAIL=1; shift;;
    --settings|-s) MODE="settings"; shift;;
    --help|-h)
      node "$PAIMON_LIST_JS" "$PLIST" "$MEMORY_DIR" "$PAIMON_LANG" help
      exit 0;;
    --version|-v)
      if [ -z "$2" ] || [ "${2:0:1}" = "-" ]; then
        # paimon -v: show available versions
        echo ""
        if [ -f "$PAIMON_HOME/agent/version.json" ]; then
          node --input-type=commonjs -e "
            const fs=require('fs'),h=require('os').homedir(),lang=process.env.PAIMON_LANG||'en',zh=lang==='zh';
            const cur=JSON.parse(fs.readFileSync(h+'/.paimon/agent/version.json','utf8'));
            const C=zh?'当前':'current', H=zh?'通道':'channels', N=zh?'(无)':' (none)';
            console.log('  '+C+': ' + cur.paimon + ' (' + (cur.channel||'minutely') + ', pi v'+cur.pi+')');
            console.log('');
            console.log('  '+H+':');
            const pad = (s,n) => s + ' '.repeat(Math.max(0, n - s.length));
            const rows=[];
            const isCur = (ch) => (cur.channel||'minutely') === ch ? ' ◀' : '';
            // minutely
            rows.push(['minutely', cur.paimon, isCur('minutely')]);
            // dev-stable: 从 git tag 读取
            let devAdded = false;
            try {
              let repoRoot = '';
              try {
                const nmLink = require('path').join('$PAIMON_EXT', 'node_modules');
                const realNm = require('fs').realpathSync(nmLink);
                const coreDir = require('path').dirname(realNm);
                repoRoot = require('child_process').execSync('git rev-parse --show-toplevel', {cwd: coreDir, encoding:'utf8', timeout:2000}).trim();
              } catch {}
              if (repoRoot) {
                const gitTags = require('child_process').execSync('git tag -l dev-stable-* | sort -rV | head -6', {cwd: repoRoot, encoding:'utf8', timeout:2000}).trim().split('\n').filter(Boolean);
                for (const t of gitTags.slice(0,5)) {
                  const v = t.replace('dev-stable-','');
                  rows.push(['dev-stable', v, isCur('dev-stable')]);
                  devAdded = true;
                }
              }
            } catch {}
            if (!devAdded) {
              try {
                const svf=h+'/.paimon/agent/version-stable.json';
                if(fs.existsSync(svf)){const sv=JSON.parse(fs.readFileSync(svf,'utf8'));rows.push(['dev-stable', sv.paimon, isCur('dev-stable')])}
                else {rows.push(['dev-stable', N, ''])}
              } catch {rows.push(['dev-stable', N, ''])}
            }
            // release: npm + GitHub
            let relVer = '';
            try{relVer=require('child_process').execSync('npm view paimon-code version 2>/dev/null',{encoding:'utf8',timeout:3000}).trim()}catch{}
            if(!relVer) try{relVer=require('child_process').execSync('npm view pi-coding-master version 2>/dev/null',{encoding:'utf8',timeout:3000}).trim()}catch{}
            if(!relVer) try{const rv=require('child_process').execSync('git ls-remote --tags https://github.com/ApolloZhangOnGithub/paimon-code-release.git 2>/dev/null',{encoding:'utf8',timeout:5000});const tags=rv.split('\\n').map(l=>l.replace(/.*refs\\/tags\\//,'')).filter(t=>t.startsWith('v')).sort().reverse();relVer=tags[0]||''}catch{}
            rows.push(['release', relVer||N, ''])
            const nw=Math.max(...rows.map(r=>r[0].length),10), vw=Math.max(...rows.map(r=>r[1].length),8);
            for(const r of rows) console.log('    '+pad(r[0],nw)+'  '+pad(r[1],vw)+'  '+r[2]);
          " 2>/dev/null
        else
          echo "  paimon version unknown"
        fi
        echo ""
        exit 0
      fi
      # paimon -v dev-stable: use dev-stable channel
      VCHANNEL="$2"; shift; shift;;
    --*) exec node "$RUNTIME_CLI" "${ORIG[@]}";;
    *) POS+=("$1"); shift;;
  esac
done
set -- "${POS[@]+"${POS[@]}"}"

NAME="$1"
shift 2>/dev/null

# ── 子命令路由 ──
PAIMON_CLI_TS="$PAIMON_CLI/cli.ts"
case "$NAME" in
  help|h)
    node "$PAIMON_LIST_JS" "$PLIST" "$MEMORY_DIR" "$PAIMON_LANG" help
    exit 0;;
  version|v)
    exec "$0" --version "$@";;
  doctor)
    cd "$PAIMON_EXT/.." && bun "$PAIMON_CLI_TS" doctor
    exit $?;;
  rename)
    cd "$PAIMON_EXT/.." && bun "$PAIMON_CLI_TS" rename "$@"
    exit $?;;
  login|logout|unbind|whoami)
    cd "$PAIMON_EXT/.." && bun "$PAIMON_CLI_TS" "$NAME" "$@"
    exit $?;;
  sync)
    cd "$PAIMON_EXT/.." && bun "$PAIMON_CLI/sync.ts" "${1:-status}" "$@"
    exit $?;;
  update)
    echo ""
    echo -e "  \033[1mpaimon update\033[0m"
    echo "  ─────────────────────────────────"
    SOURCE_DIR="$HOME/.local/lib/paimon/source"
    VER_JSON="$HOME/.paimon/agent/version.json"
    CHANNEL="minutely"
    [ -f "$VER_JSON" ] && CHANNEL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$VER_JSON','utf8')).channel)}catch{console.log('minutely')}" 2>/dev/null)
    if [ "$CHANNEL" = "release" ]; then
      echo "  channel: release (npm)"
      npm update -g paimon-code && echo -e "  \033[32mOK\033[0m updated via npm"
    elif [ -d "$SOURCE_DIR/.git" ]; then
      echo "  channel: $CHANNEL (source: $SOURCE_DIR)"
      cd "$SOURCE_DIR" && git pull --ff-only && bash Codebase/deploy/install.sh
    else
      echo "  ERROR: cannot locate source. reinstall with bootstrap.sh"
      exit 1
    fi
    exit $?;;
  uninstall)
    echo ""
    echo -e "  \033[1mpaimon uninstall\033[0m"
    echo "  ─────────────────────────────────"
    echo "  will remove:"
    echo "    ~/.local/bin/paimon            (launcher)"
    echo "    ~/.local/bin/mobile            (mobile cli)"
    echo "    ~/.local/bin/identity          (identity cli)"
    echo "    ~/.local/lib/paimon/extensions (extensions)"
    echo "    ~/.local/lib/paimon/runtime    (runtime)"
    echo ""
    echo -e "  \033[33mnot removed:\033[0m"
    echo "    ~/.paimon/                     (agent data, config)"
    echo "    ~/.local/lib/paimon/source     (source code)"
    echo ""
    read -p "  continue? [y/N] " CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
      echo "  cancelled"
      exit 0
    fi
    rm -f "$HOME/.local/bin/paimon" "$HOME/.local/bin/mobile" "$HOME/.local/bin/mobile-runner.mjs" "$HOME/.local/bin/identity"
    rm -rf "$HOME/.local/lib/paimon/extensions" "$HOME/.local/lib/paimon/extensions-stable" "$HOME/.local/lib/paimon/runtime"
    echo -e "  \033[32mOK\033[0m uninstalled. agent data preserved in ~/.paimon/"
    echo "  to reinstall: bash <(curl -fsSL https://raw.githubusercontent.com/ApolloZhangOnGithub/paimon-code-dev/main/Codebase/deploy/bootstrap.sh)"
    exit 0;;
  archive|a)    MODE="archive"; NAME="$1"; shift 2>/dev/null;;
  unarchive|ua) MODE="unarchive"; NAME="$1"; shift 2>/dev/null;;
  archived|A)   MODE="archived"; NAME="";;
  kill|k)       MODE="kill"; NAME="$1"; shift 2>/dev/null;;
  tmux|t)       MODE="tmux"; NAME="$1"; shift 2>/dev/null;;
  mc)           MODE="mc"; NAME="$1"; shift 2>/dev/null;;
  hc)           MODE="hc"; NAME="$1"; shift 2>/dev/null;;
  mobile|m)     MODE="mobile"; NAME="$1"; shift 2>/dev/null;;
  laptop|l)     MODE="laptop"; NAME="$1"; shift 2>/dev/null;;
  settings|s)   MODE="settings"; NAME="";;
  org|o)        MODE="org"; NAME="$1"; shift 2>/dev/null;;
  web|w)        MODE="web"; NAME="";;
esac

# 阻止非法名字（纯数字走序号路径，不在这里拦）
if [ -n "$NAME" ] && [[ ! "$NAME" =~ ^[0-9]+$ ]]; then
  if [ "${NAME:0:1}" = "-" ]; then
    echo "Error: 未知选项 '$NAME'。用 paimon -h 查看用法。"
    exit 1
  fi
  if [ "${NAME:0:1}" = "/" ]; then
    echo "Error: '$NAME' 是路径，不是名字。"
    exit 1
  fi
  # 只允许 [a-zA-Z0-9_-.]，必须字母开头，必须含数字
  if [[ ! "$NAME" =~ ^[a-zA-Z][a-zA-Z0-9_.\-]*$ ]]; then
    echo "Error: 名字只能用英文字母、数字、下划线、点、横杠，且必须字母开头。"
    echo "  示例: paimon alice_$(date +%Y%m%d)"
    exit 1
  fi
  if [[ ! "$NAME" =~ [0-9] ]]; then
    echo "Error: 名字必须含数字（防止和命令混淆）。建议加日期后缀。"
    echo "  示例: paimon ${NAME}_$(date +%Y%m%d)"
    exit 1
  fi
fi
# ── web UI ──
if [ "$MODE" = "web" ]; then
  PAIMON_SERVER_DIR="${PAIMON_SERVER_DIR:-$PAIMON_EXT/technology.cloud.servers/paimon-server}"
  if [ ! -f "$PAIMON_SERVER_DIR/server.js" ]; then
    echo "Error: paimon web server not found at $PAIMON_SERVER_DIR"
    exit 1
  fi
  PAIMON_PORT="${PAIMON_PORT:-3000}"
  # Kill any existing paimon-server (only node server.js, not other processes on the port)
  OLD_PIDS=$(pgrep -f "node.*paimon-server/server.js" 2>/dev/null)
  [ -n "$OLD_PIDS" ] && echo "$OLD_PIDS" | xargs kill 2>/dev/null && sleep 0.5
  cd "$PAIMON_SERVER_DIR" && PAIMON_PORT="$PAIMON_PORT" node server.js > /tmp/paimon-web.log 2>&1 &
  SERVER_PID=$!
  disown $SERVER_PID
  ACTUAL_PORT=""
  for i in $(seq 1 30); do
    ACTUAL_PORT=$(grep -o 'http://127.0.0.1:[0-9]*' /tmp/paimon-web.log 2>/dev/null | head -1 | grep -o '[0-9]*$')
    [ -n "$ACTUAL_PORT" ] && break
    sleep 0.5
  done
  [ -z "$ACTUAL_PORT" ] && ACTUAL_PORT=$PAIMON_PORT
  echo "paimon web: http://127.0.0.1:$ACTUAL_PORT (pid $SERVER_PID)"
  open "http://127.0.0.1:$ACTUAL_PORT"
  exit 0
fi

# ── archive 管理 ──
# ── settings ──
PAIMON_SETTINGS_JS="$PAIMON_CLI/settings.cjs"
if [ "$MODE" = "settings" ]; then
  node "$PAIMON_SETTINGS_JS" "$PAIMON_SETTINGS" "$PAIMON_LANG"
  exit 0
fi

PAIMON_LIST_SCRIPT="$(dirname "$RUNTIME_CLI")/../../../.."

if [ "$MODE" = "archived" ]; then
  if [ -n "$NAME" ]; then echo "用法: paimon -A  (不接受额外参数)"; exit 1; fi
  node "$PAIMON_LIST_JS" "$PLIST" "$MEMORY_DIR" "$PAIMON_LANG" archived
  exit 0
fi
if [ "$MODE" = "archive" ] || [ "$MODE" = "unarchive" ]; then
  if [ -z "$NAME" ]; then echo "用法: paimon --$MODE <名字|序号|1-5|*> "; exit 1; fi
  PAIMON_ARCHIVE_JS="$PAIMON_CLI/archive.cjs"
  node "$PAIMON_ARCHIVE_JS" "$PLIST" "$MODE" "$NAME" "$@" || exit 1
  exit 0
fi

# -- org: 组织管理 ──
if [ "$MODE" = "org" ]; then
  PAIMON_ORG_JS="$PAIMON_CLI/org.cjs"
  if [ -z "$NAME" ]; then
    # paimon -o 无参数 → 列出所有组织
    node "$PAIMON_ORG_JS" "$PLIST" || exit 1
  else
    # paimon -o <name|id> [agent] → 创建/查看/加入
    node "$PAIMON_ORG_JS" "$PLIST" "$NAME" "$1" || exit 1
  fi
  exit 0
fi

# -- mobile --
if [ "$MODE" = "mobile" ]; then
  if [ -z "$NAME" ]; then echo "用法: paimon -m <序号|名字>"; exit 1; fi
  # 数字→active 序号，名字→ID
  ID=$(node --input-type=commonjs -e "
    const fs=require('fs'),{execSync}=require('child_process');
    const list=JSON.parse(fs.readFileSync('$PLIST','utf8')).filter(p=>!p.archived);
    const now=Date.now();
    let ps='';try{ps=execSync('ps aux',{encoding:'utf8'})}catch{}
    for(const p of list){p._active=ps.split('\\n').some(l=>l.includes('paimon:')&&l.includes('(main,')&&l.includes(p.id));p._ago=Math.round((now-new Date(p.lastEnded||p.lastSeen).getTime())/60000)}
    list.sort((a,b)=>(b._active?1:0)-(a._active?1:0)||a._ago-b._ago);
    const active=list.filter(p=>p._active);
    const arg='$NAME';
    let p;
    if(/^[0-9]+\$/.test(arg)){p=active[parseInt(arg)-1];}
    else{p=list.find(x=>x.name===arg||x.id===arg);}
    if(p)console.log(p.id+'::'+p.name);
  ")
  if [ -z "$ID" ]; then echo "没找到 $NAME"; exit 1; fi
  AGENT_NAME=$(echo "$ID" | cut -d: -f3-)
  ID=$(echo "$ID" | cut -d: -f1)
  node "$PAIMON_CLI/mobile.cjs" "$ID" "$AGENT_NAME"
  exit 0
fi

# -- laptop --
if [ "$MODE" = "laptop" ]; then
  if [ -z "$NAME" ]; then echo "用法: paimon -l <序号|名字>"; exit 1; fi
  ID=$(node --input-type=commonjs -e "
    const fs=require('fs'),{execSync}=require('child_process');
    const list=JSON.parse(fs.readFileSync('$PLIST','utf8')).filter(p=>!p.archived);
    const now=Date.now();
    let ps='';try{ps=execSync('ps aux',{encoding:'utf8'})}catch{}
    for(const p of list){p._active=ps.split('\\n').some(l=>l.includes('paimon:')&&l.includes('(main,')&&l.includes(p.id));p._ago=Math.round((now-new Date(p.lastEnded||p.lastSeen).getTime())/60000)}
    list.sort((a,b)=>(b._active?1:0)-(a._active?1:0)||a._ago-b._ago);
    const active=list.filter(p=>p._active);
    const arg='$NAME';
    let p;
    if(/^[0-9]+\$/.test(arg)){p=active[parseInt(arg)-1];}
    else{p=list.find(x=>x.name===arg||x.id===arg);}
    if(p)console.log(p.id+'::'+p.name);
  ")
  if [ -z "$ID" ]; then echo "没找到 $NAME"; exit 1; fi
  AGENT_NAME=$(echo "$ID" | cut -d: -f3-)
  ID=$(echo "$ID" | cut -d: -f1)
  node "$PAIMON_CLI/laptop.cjs" "$ID" "$AGENT_NAME"
  exit 0
fi

# -- sessions --
if [ "$MODE" = "sessions" ]; then
  if [ -z "$NAME" ]; then echo "用法: paimon -S <名字|ID>"; exit 1; fi
  ID=$(node --input-type=commonjs -e "
    const list=JSON.parse(require('fs').readFileSync('$PLIST','utf8')).filter(x=>!x.archived);
    const arg='$NAME';
    if(/^[0-9]+\$/.test(arg)) {
      const n=Date.now();
      let ps=''; try{ps=require('child_process').execSync('ps aux',{encoding:'utf8',timeout:2000})}catch{}
      list.forEach(x=>{x._active=ps.split('\\n').some(l=>l.includes('paimon:')&&l.includes('(main,')&&l.includes(x.id));x._ago=Math.round((n-new Date(x.lastEnded||x.lastSeen).getTime())/60000)});
      list.sort((a,b)=>(b._active?1:0)-(a._active?1:0)||a._ago-b._ago);
      // separate active/offline numbering
      let ai=0, oi=0;
      const matches=[];
      for(const x of list){
        x._aid=x._active?(++ai):0; x._oid=!x._active?(++oi):0;
        if(x._aid===parseInt(arg)||x._oid===parseInt(arg)) matches.push(x);
      }
      if(matches.length===0) process.exit(1);
      console.log(matches.map(x=>x.id+'::'+x.name+'::'+(x._active?'active':'offline')).join('||'));
    } else { const p=list.find(x=>x.name===arg||x.id===arg); if(p)console.log(p.id+'::'+p.name); }
  ")
  if [ -z "$ID" ]; then echo "没找到 $NAME"; exit 1; fi
  IFS='||' read -ra MATCHES <<< "$ID"
  if [ ${#MATCHES[@]} -gt 1 ]; then
    echo "序号 $NAME 有歧义:"
    for i in "${!MATCHES[@]}"; do
      m="${MATCHES[$i]}"
      MID="${m%%::*}"; m="${m#*::}"
      MNAME="${m%%::*}"; MSTATE="${m##*::}"
      echo "  [$((i+1))] $MNAME ($MSTATE)"
    done
    read -p "选一个 [1-${#MATCHES[@]}]: " C
    if [ -n "$C" ] && [ "$C" -ge 1 ] 2>/dev/null && [ "$C" -le ${#MATCHES[@]} ]; then
      m="${MATCHES[$((C-1))]}"; ID="${m%%::*}"; ACTUAL_NAME="${m#*::}"; ACTUAL_NAME="${ACTUAL_NAME%%::*}"
    else echo "取消"; exit 1; fi
  else
    m="${MATCHES[0]}"; ID="${m%%::*}"; ACTUAL_NAME="${m#*::}"; ACTUAL_NAME="${ACTUAL_NAME%%::*}"
  fi
  SESS_DIR="$PAIMON_HOME/SessionData/$ID"
  if [ ! -d "$SESS_DIR" ]; then echo "$ACTUAL_NAME (#$ID) 没有 session 数据。"; exit 1; fi
  echo "$ACTUAL_NAME (#$ID) 的 session 历史："
  echo ""
  for f in "$SESS_DIR"/*.jsonl; do
    [ -f "$f" ] || continue
    bn=$(basename "$f" .jsonl)
    ts=$(echo "$bn" | cut -d_ -f1 | sed 's/T/ /')
    size=$(wc -c < "$f" | tr -d ' ')
    echo "  $ts  ($(node -e "console.log((Math.round($size/1024))+'K')"))"
  done | sort -r
  echo ""
  echo "总: $(ls "$SESS_DIR"/*.jsonl 2>/dev/null | wc -l | tr -d ' ') 个 session"
  exit 0
fi

# -- kill --
if [ "$MODE" = "kill" ]; then
  if [ -z "$NAME" ]; then echo "用法: paimon -k <名字|ID|序号>"; exit 1; fi
  # 数字 => 第 N 个运行中的 agent
  if [[ "$NAME" =~ ^[0-9]+$ ]]; then
    TARGET=$(node --input-type=commonjs -e "
      const fs=require('fs'),{execSync}=require('child_process');
      const list=JSON.parse(fs.readFileSync('$PLIST','utf8')).filter(p=>!p.archived);
      const now=Date.now();
      let ps='';try{ps=execSync('ps aux',{encoding:'utf8'})}catch{}
      for(const p of list){p._active=ps.split('\\n').some(l=>l.includes('paimon:')&&l.includes('(main,')&&l.includes(p.id));p._ago=Math.round((now-new Date(p.lastEnded||p.lastSeen).getTime())/60000)}
      list.sort((a,b)=>(b._active?1:0)-(a._active?1:0)||a._ago-b._ago);
      const active=list.filter(p=>p._active);
      const i=parseInt('$NAME')-1;
      if(active[i])console.log(active[i].name);
    ")
    if [ -z "$TARGET" ]; then echo "没有第 $NAME 个运行中的 agent"; exit 1; fi
    NAME="$TARGET"
  fi
  PID=$(ps aux | grep "paimon:.*${NAME}" | grep -v grep | awk '{print $2}' | head -1)
  if [ -z "$PID" ]; then echo "没找到运行中的 $NAME"; exit 1; fi
  if _confirm "杀掉 $NAME?" "Kill $NAME?"; then
    # 杀掉 pi 进程及其父 bash launcher，清 wake-restart 防重启
    PARENT_PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')
    kill "$PID" 2>/dev/null
    [ -n "$PARENT_PID" ] && kill "$PARENT_PID" 2>/dev/null
    # 找对应的 agent id 清文件
    AGENT_ID=$(echo "$NAME" | node --input-type=commonjs -e "const fs=require('fs'); const list=JSON.parse(fs.readFileSync('$PLIST','utf8')); const n=process.argv[1]; const p=list.find(x=>x.name===n||x.id===n); if(p)console.log(p.id)" "$NAME" 2>/dev/null)
    if [ -n "$AGENT_ID" ]; then
      rm -f "$PAIMON_HOME/RuntimeCache/$AGENT_ID/wake-restart" 2>/dev/null
      rm -f "$PAIMON_HOME/MemoryData/$AGENT_ID/main.pid" 2>/dev/null
    fi
    echo "已杀掉 $NAME"
  else
    echo "取消"
  fi
  exit 0
fi

# -- tmux --
if [ "$MODE" = "tmux" ]; then
  if [ -z "$NAME" ]; then echo "用法: paimon -t <名字|ID|序号>"; exit 1; fi
  # 数字 => 第 N 个运行中的 agent
  if [[ "$NAME" =~ ^[0-9]+$ ]]; then
    TARGET=$(node --input-type=commonjs -e "
      const fs=require('fs'),{execSync}=require('child_process');
      const list=JSON.parse(fs.readFileSync('$PLIST','utf8')).filter(p=>!p.archived);
      const now=Date.now();
      let ps='';try{ps=execSync('ps aux',{encoding:'utf8'})}catch{}
      for(const p of list){p._active=ps.split('\\n').some(l=>l.includes('paimon:')&&l.includes('(main,')&&l.includes(p.id));p._ago=Math.round((now-new Date(p.lastEnded||p.lastSeen).getTime())/60000)}
      list.sort((a,b)=>(b._active?1:0)-(a._active?1:0)||a._ago-b._ago);
      const active=list.filter(p=>p._active);
      const i=parseInt('$NAME')-1;
      if(active[i])console.log(active[i].name);
    ")
    if [ -z "$TARGET" ]; then echo "没有第 $NAME 个运行中的 agent"; exit 1; fi
    NAME="$TARGET"
  fi
  PS_LINE=$(ps aux | grep "paimon:.*${NAME}" | grep -v grep | head -1)
  if [ -z "$PS_LINE" ]; then echo "没找到运行中的 $NAME"; exit 1; fi
  TTY=$(echo "$PS_LINE" | awk '{print $7}')
  PID=$(echo "$PS_LINE" | awk '{print $2}')
  if [ "$TTY" = "??" ]; then
    echo "$NAME 在后台运行（无终端），无法观看。PID: $PID"
  elif [ "$TTY" = "$(ps -o tty= -p $$ | tr -d ' ')" ]; then
    echo "$NAME 就在当前终端运行中。"
  else
    echo "$NAME 在终端 $TTY 运行。PID: $PID"
  fi

  exit 0
fi

if [ -z "$NAME" ] && [ -z "$MODE" ]; then
  if [ "$COUNT" = "0" ]; then
    if [ "$PAIMON_LANG" = "zh" ]; then
      echo ""
      echo "  还没有 agent。"
      echo ""
      echo "  创建: paimon <名字>"
      echo "  示例: paimon alice_$(date +%Y%m%d)"
      echo ""
      echo "  更多: paimon -h"
      echo ""
    else
      echo ""
      echo "  No agents yet."
      echo ""
      echo "  Create: paimon <name>"
      echo "  Example: paimon alice"
      echo ""
      echo "  More: paimon -h"
      echo ""
    fi
  else
    node "$PAIMON_LIST_JS" "$PLIST" "$MEMORY_DIR" "$PAIMON_LANG" list
    # save order for comparison (same sort as paimon-list)
    node --input-type=commonjs -e "const l=JSON.parse(require('fs').readFileSync('$PLIST','utf8')).filter(p=>!p.archived);const n=Date.now();let ps='';try{ps=require('child_process').execSync('ps aux',{encoding:'utf8'})}catch{}l.forEach(p=>{p._active=ps.split('\n').some(l=>l.includes('paimon:')&&l.includes('(main,')&&l.includes(p.id)));p._ago=Math.round((n-new Date(p.lastEnded||p.lastSeen).getTime())/60000)});l.sort((a,b)=>(b._active?1:0)-(a._active?1:0)||a._ago-b._ago);const ids=l.map(p=>p.id);const d='$PAIMON_HOME/RuntimeCache';require('fs').existsSync(d)||require('fs').mkdirSync(d,{recursive:true});require('fs').writeFileSync(d+'/paimon-order-last.json',JSON.stringify(ids))" 2>/dev/null
  fi
  exit 0
fi

if [ -z "$NAME" ]; then
  echo "Usage: paimon [-mc] <name>"
  exit 1
fi

# mc/tmux: 数字→运行中 agent（在 ENTRY 解析前）
if [ "$MODE" = "mc" ] || [ "$MODE" = "tmux" ] || [ "$MODE" = "hc" ]; then
  if [[ "$NAME" =~ ^[0-9]+$ ]]; then
    TARGET=$(node --input-type=commonjs -e "
      const fs=require('fs'),{execSync}=require('child_process');
      const list=JSON.parse(fs.readFileSync('$PLIST','utf8')).filter(p=>!p.archived);
      const now=Date.now();
      let ps='';try{ps=execSync('ps aux',{encoding:'utf8'})}catch{}
      for(const p of list){p._active=ps.split('\\n').some(l=>l.includes('paimon:')&&l.includes('(main,')&&l.includes(p.id));p._ago=Math.round((now-new Date(p.lastEnded||p.lastSeen).getTime())/60000)}
      list.sort((a,b)=>(b._active?1:0)-(a._active?1:0)||a._ago-b._ago);
      const active=list.filter(p=>p._active);
      const i=parseInt('$NAME')-1;
      if(active[i])console.log(active[i].name);
    ")
    if [ -z "$TARGET" ]; then echo "没有第 $NAME 个运行中的 agent"; exit 1; fi
    NAME="$TARGET"
  fi
fi

# Resolve by index or name
ORDER_FILE="$PAIMON_HOME/RuntimeCache/paimon-order.json"
LAST_ORDER_FILE="$PAIMON_HOME/RuntimeCache/paimon-order-last.json"
ENTRY=$(node --input-type=commonjs -e "
  const fs = require('fs'), { execSync } = require('child_process');
  const list = JSON.parse(fs.readFileSync('$PLIST','utf8')).filter(p=>!p.archived);
  const now = Date.now();
  let psOut = '';
  try { psOut = execSync('ps aux', { encoding: 'utf8' }); } catch {}
  for (const p of list) {
    p._active = psOut.split('\n').some(l => l.includes('paimon:') && l.includes('(main,') && l.includes(p.id));
    p._ago = Math.round((now - new Date(p.lastEnded || p.lastSeen).getTime()) / 60000);
  }
  list.sort((a,b) => (b._active?1:0) - (a._active?1:0) || a._ago - b._ago);
  const arg = '$NAME';
  let e;
  if (/^\d+$/.test(arg)) {
    // number only offline agents (active ones not numbered for direct access)
    const offline = list.filter(x => !x._active);
    const i = parseInt(arg) - 1;
    e = offline[i];
  } else {
    e = list.find(p => p.name === arg);
  }
  const order = list.map(p => p.id);
  fs.writeFileSync('$ORDER_FILE', JSON.stringify(order));
  if (e) console.log(JSON.stringify(e));
")

# check order change (number mode) — 暂时关闭，数字直接用上次保存的顺序
if false; then
  CURR_IDS=$(node --input-type=commonjs -e "console.log(JSON.parse(require('fs').readFileSync('$ORDER_FILE','utf8')).join(':'))")
  LAST_IDS=$(node --input-type=commonjs -e "console.log(JSON.parse(require('fs').readFileSync('$LAST_ORDER_FILE','utf8')).join(':'))")
  if [ "$CURR_IDS" != "$LAST_IDS" ]; then
    echo "顺序有变化，重新看了再选。当前列表："
    echo ""
    node "$PAIMON_LIST_JS" "$PLIST" "$MEMORY_DIR" "$PAIMON_LANG" active
    exit 1
  fi
fi
# save current as last
if [ -f "$ORDER_FILE" ]; then cp "$ORDER_FILE" "$LAST_ORDER_FILE"; fi

if [ -z "$ENTRY" ]; then
  # 检查重名（含已归档）
  EXISTING_NAME=$(node --input-type=commonjs -e "
    const list=JSON.parse(require('fs').readFileSync('$PLIST','utf8'));
    const p=list.find(x=>x.name==='$NAME');
    if(p)console.log(p.name+' (#'+p.id+')'+(p.archived?' 已归档':''));
  ")
  if [ -n "$EXISTING_NAME" ]; then
    echo "$EXISTING_NAME 已存在。"
    if echo "$EXISTING_NAME" | grep -q "已归档"; then
      echo "用 paimon -ua|--unarchive 恢复。"
    fi
    exit 1
  fi
  if [[ "$NAME" =~ ^[0-9]+$ ]]; then
    echo "序号 $NAME 尚不存在。运行 paimon 查看agents列表。"
    exit 1
  fi
  if [ -n "$MODE" ]; then
    echo "\"$NAME\" not found."
    exit 1
  fi
  # 命名规则已在上面统一校验（字母开头 + 含数字 + ASCII only）
  if [ "$COUNT" != "0" ]; then
    if [ "$PAIMON_LANG" = "zh" ]; then
    read -p "创建 \"$NAME\"? [Y/n] " CONFIRM
  else
    read -p "Create \"$NAME\"? [Y/n] " CONFIRM
  fi
    case "$CONFIRM" in y|Y) ;; *) exit 0;; esac
  fi
  ID=$(node --input-type=commonjs -e "console.log(require('crypto').randomBytes(4).toString('hex'))")
  mkdir -p "$PAIMON_HOME/SessionData/$ID" "$MEMORY_DIR/$ID"
  node --input-type=commonjs -e "
    const fs = require('fs');
    const list = JSON.parse(fs.readFileSync('$PLIST','utf8'));
    list.push({id:'$ID',name:'$NAME',kind:'coding-agent',deployment:'local',created:new Date().toISOString(),lastSeen:new Date().toISOString(),note:'',model:''});
    fs.writeFileSync('$PLIST',JSON.stringify(list,null,2));
    const idDir=require('os').homedir()+'/.paimon/IdentityData/$ID';
    require('fs').mkdirSync(idDir,{recursive:true});
    require('fs').writeFileSync(idDir+'/identity.json',JSON.stringify({id:'$ID',name:'$NAME',kind:'coding-agent',created:new Date().toISOString(),lastSeen:new Date().toISOString(),archived:false,note:'',model:''},null,2));
  "
else
  ID=$(echo "$ENTRY" | node --input-type=commonjs -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).id)})")
  NAME=$(echo "$ENTRY" | node --input-type=commonjs -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).name)})")
fi

DATA_DIR="$MEMORY_DIR/$ID"
RUNTIME_DIR="$PAIMON_HOME/RuntimeCache/$ID"
mkdir -p "$DATA_DIR" "$RUNTIME_DIR"

# 确认（按模式区分提示）
if [ -t 0 ]; then
  case "$MODE" in
    mc) _confirm "查看 $NAME 的元意识？" "Watch MC $NAME?" || { echo "取消"; exit 0; } ;;
    hc) _confirm "查看 $NAME 的海马体？" "Watch HC $NAME?" || { echo "取消"; exit 0; } ;;
    tmux) _confirm "观看 $NAME?" "Watch $NAME?" || { echo "取消"; exit 0; } ;;
    *) _confirm "进入 $NAME?" "Enter $NAME?" || { echo "取消"; exit 0; } ;;
  esac
fi

# 确认后更新 lastSeen
if [ -n "$ENTRY" ]; then
  node --input-type=commonjs -e "
    const fs = require('fs');
    const list = JSON.parse(fs.readFileSync('$PLIST','utf8'));
    const p = list.find(x=>x.id==='$ID');
    if(p && !p.archived){p.lastSeen=new Date().toISOString();
      try{const idPath=require('os').homedir()+'/.paimon/IdentityData/$ID/identity.json';const idData=JSON.parse(require('fs').readFileSync(idPath,'utf8'));idData.lastSeen=p.lastSeen;require('fs').writeFileSync(idPath,JSON.stringify(idData,null,2));}catch{}
      fs.writeFileSync('$PLIST',JSON.stringify(list,null,2));}
  "
fi

# ── 扩展：显式指定，不自动发现 ──
PAIMON_EXT_BASE="$HOME/.local/lib/paimon/extensions"
EXT_DIR="$PAIMON_EXT"
if [ "$VCHANNEL" = "dev-stable" ] && [ -d "$PAIMON_EXT_BASE-stable/paimon-code" ]; then
  EXT_DIR="$PAIMON_EXT_BASE-stable/paimon-code"
fi
EXT_FLAGS="-ne -e $EXT_DIR/index.ts"

case "$MODE" in
  mc)
    TMUX_NAME="mc-$ID"
    if ! tmux has-session -t "$TMUX_NAME" 2>/dev/null; then
      echo "$NAME 的元意识进程没有在运行。先用 paimon $NAME 启动主 session。"
      exit 0
    fi
    echo "按 Ctrl+B 再按 D 退出"
    exec tmux attach -t "$TMUX_NAME"
    ;;
  hc)
    TMUX_NAME="hc-$ID"
    if ! tmux has-session -t "$TMUX_NAME" 2>/dev/null; then
      echo " $NAME 的海马体进程尚未运行。先用 paimon $NAME 启动主 session。"
      exit 0
    fi
    echo "按 Ctrl+B 再按 D 退出"
    exec tmux attach -t "$TMUX_NAME"
    ;;
  *)
    PIDFILE="$RUNTIME_DIR/main.pid"
    if [ -f "$PIDFILE" ]; then
      OLD_PID=$(cat "$PIDFILE" 2>/dev/null)
      if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        SESSION_ID=$(ps aux 2>/dev/null | grep "paimon:.*$ID" | head -1 | sed 's/.*(main,[^,]*,//' | sed 's/).*//')
        echo "ERROR: $NAME (#$ID, PID $OLD_PID, session ${SESSION_ID:-?}) 已有Session处在运行中。"
        exit 1
      fi
    fi
    # 写入 launcher PID 做锁，kernel 启动后会覆盖
    echo $$ > "$PIDFILE"
    BLACKBOX="$EXT_DIR/god.cli/blackbox.sh"
    PAIMON_COMPRESS="$EXT_DIR/god.cli/compress.cjs"
    cleanup() {
      rm -f "$PIDFILE"
      if [ "$(ps aux | grep '[p]im:' | wc -l | tr -d ' ')" -le 1 ]; then lsof -t -i :19223 | xargs kill 2>/dev/null; fi
      printf '\x1b[<u' 2>/dev/null
      stty sane 2>/dev/null
    }
    trap cleanup EXIT
    if [ "$PAIMON_NO_INT_TRAP" != "1" ]; then
      trap 'cleanup; stty sane 2>/dev/null; exit 130' INT
    fi
    WAKEFILE="$RUNTIME_DIR/wake-restart"
    LAST_NONCE=$(cat "$WAKEFILE" 2>/dev/null)
    WOKE=""
    # 启动前解压
    node "$PAIMON_COMPRESS" decompress "$ID" 2>/dev/null
    SESSION_DIR="$PAIMON_HOME/SessionData/$ID"
    mkdir -p "$SESSION_DIR"
    # 迁移: 旧 sessions 目录如果有文件,移过来
    if [ -d "$MEMORY_DIR/$ID/sessions" ] && ls "$MEMORY_DIR/$ID/sessions"/*.jsonl >/dev/null 2>&1; then
      mv "$MEMORY_DIR/$ID/sessions"/*.jsonl "$SESSION_DIR/" 2>/dev/null
    fi
    # 自动同步
    PAIMON_SYNC="$PAIMON_CLI/sync.ts"
    if [ -f "$PAIMON_SYNC" ]; then
      nohup bun "$PAIMON_SYNC" pull --quiet </dev/null >/dev/null 2>&1 &
      # 每5分钟自动推送
      ( while true; do sleep 300; nohup bun "$PAIMON_SYNC" push --quiet </dev/null >/dev/null 2>&1; done ) &
      SYNC_LOOP_PID=$!
    fi
    # 清屏到最上方，再启动 pi
    printf '\033[2J\033[H'
    while true; do
      export PAIMON_AGENT_NAME="$NAME"
  export PAIMON_AGENT_ID="$ID"
      # 检查 settings.json 的 blackboxEnabled 开关
      USE_BLACKBOX=0
      SETTINGS_FILE="$PAIMON_CONFIG/settings.json"
      if [ -f "$SETTINGS_FILE" ]; then
        BB_ENABLED=$(python3 -c "import json; s=json.load(open('$SETTINGS_FILE')); print('true' if s.get('blackboxEnabled') else 'false')" 2>/dev/null || echo "true")
        [ "$BB_ENABLED" = "true" ] && USE_BLACKBOX=1
      else
        USE_BLACKBOX=1
      fi
      if [ -x "$BLACKBOX" ] && [ "$USE_BLACKBOX" = "1" ]; then
        PI_ALIVE_RESTART_LOOP=1 PI_ALIVE_WOKE="$WOKE" "$BLACKBOX" "$ID" "${NAME:-unknown}" "main" -- node "$RUNTIME_CLI" $EXT_FLAGS --session-dir "$SESSION_DIR" "$@"
      else
        # 黑匣子开关不连坐器官:PAIMON_NO_MC=1 是 0713 事故(sc spawn 递归风暴)的临时止血,
        # 根因已在 dev.20260715.1 修复。手动调试禁用器官请自行 export PAIMON_NO_MC=1。
        PI_ALIVE_RESTART_LOOP=1 PI_ALIVE_WOKE="$WOKE" node "$RUNTIME_CLI" $EXT_FLAGS --session-dir "$SESSION_DIR" "$@"
      fi
      NONCE=$(cat "$WAKEFILE" 2>/dev/null)
      if [ -n "$NONCE" ] && [ "$NONCE" != "$LAST_NONCE" ]; then
        LAST_NONCE="$NONCE"; WOKE=1; continue
      fi
      break
    done
    # 退出后：停止周期同步，最终推送
    kill $SYNC_LOOP_PID 2>/dev/null; wait $SYNC_LOOP_PID 2>/dev/null
    if [ -f "$PAIMON_SYNC" ]; then
      bun "$PAIMON_SYNC" push --quiet 2>/dev/null
    fi
    ;;
esac
