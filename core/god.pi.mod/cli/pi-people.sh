#!/bin/bash
# pi — person-based launcher
MEMORY_DIR="$HOME/.pi/memory"
PLIST="$MEMORY_DIR/plist.json"
mkdir -p "$MEMORY_DIR"

# ── 单一真相源：把 DEEPSEEK_API_KEY 强制对齐到 models.json 里配的字面量 key ──
# 否则 pi 会先读环境变量(auth-storage 里 env 优先于 models.json)，shell 里残留的旧 key 会盖过来 → 402。
# 这样无论 ~/.zshrc / 终端环境是什么，pi 进程(以及它 spawn 的 hc/sc/sl 小号)都用 models.json 的 key。
__DSK=$(node --input-type=commonjs -e 'try{const j=JSON.parse(require("fs").readFileSync(process.env.HOME+"/.pi/agent/models.json","utf8"));const k=j.providers&&j.providers.deepseek&&j.providers.deepseek.apiKey;if(typeof k==="string"&&!k.startsWith("$")&&k.trim())process.stdout.write(k.trim());}catch(e){}' 2>/dev/null)
[ -n "$__DSK" ] && export DEEPSEEK_API_KEY="$__DSK"
[ -f "$PLIST" ] || echo '[]' > "$PLIST"

COUNT=$(node --input-type=commonjs -e "console.log(JSON.parse(require('fs').readFileSync('$PLIST','utf8')).length)")

# Parse flags —— 认【任意位置】的模式 flag，不只开头。
# 这样 `pi --archive 18` 和 `pi 18 --archive` 都对；而且带了模式 flag 就绝不会再掉进"创建新人"
# （旧逻辑只看 $1：`pi nn --archive 18` 里 --archive 在名字后面没被认出来 → 误判成创建 nn）。
# 非模式的 --flag（如 pi 自带的 --session-dir resume 提示）→ 原样转发给真 pi。
MODE=""
ORIG=("$@")
POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    # --msg) MODE="msg"; shift;;   # message parked in v0.1-stable(代码保留,见 Readme.md.GITHUB)
    --sc) MODE="sc"; shift;;
    --think) MODE="think"; shift;;           # 双 pane：上面对话，下面 thinking 流
    --archive) MODE="archive"; shift;;       # 归档一个人（从列表隐藏，不删）
    --unarchive) MODE="unarchive"; shift;;   # 恢复
    --archived) MODE="archived"; shift;;     # 看已归档的
    --dev) export PI_DEV=1; shift;;           # 开发模式：暴露 editcontext/issues 等调试工具
    --*) exec /opt/homebrew/bin/pi "${ORIG[@]}";;   # 未知 --flag → 原样转发真 pi
    *) POS+=("$1"); shift;;                          # 位置参数(名字/序号)收集起来
  esac
done
set -- "${POS[@]+"${POS[@]}"}"   # 还原位置参数（空数组在 bash3.2 也安全）

NAME="$1"
shift 2>/dev/null

# ── archive 管理：归档=从列表隐藏，不删除（有意没有 delete；也不杀进程）──
if [ "$MODE" = "archived" ]; then
  node --input-type=commonjs -e "
    const fs=require('fs'),{execSync}=require('child_process');
    let a=JSON.parse(fs.readFileSync('$PLIST','utf8')).filter(p=>p.archived);
    if(!a.length){console.log('没有已归档的人。');process.exit(0);}
    const now=Date.now();let ps='';try{ps=execSync('ps aux',{encoding:'utf8'});}catch{}
    for(const p of a){p._active=ps.includes(p.id+'/sessions');p._ago=Math.round((now-new Date(p.lastSeen).getTime())/60000);}
    a.sort((x,y)=>(y._active?1:0)-(x._active?1:0)||x._ago-y._ago);   // 和恢复时的序号一致
    console.log('已归档（不在主列表；pi --unarchive <序号|名字> 恢复）：');
    a.forEach((p,i)=>console.log('  '+String(i+1).padStart(2)+'. '+p.name+'   '+p.id));
  "
  exit 0
fi
if [ "$MODE" = "archive" ] || [ "$MODE" = "unarchive" ]; then
  if [ -z "$NAME" ]; then echo "用法: pi --$MODE <名字|序号> [更多...]（可批量，序号/名字混着给都行）"; exit 1; fi
  node --input-type=commonjs -e "(async()=>{
    const fs=require('fs'),{execSync}=require('child_process');
    const list=JSON.parse(fs.readFileSync('$PLIST','utf8'));
    const mode=process.argv[1];
    const targets=process.argv.slice(2);   // 批量：所有位置参数都是目标(序号或名字)
    const now=Date.now();let ps='';try{ps=execSync('ps aux',{encoding:'utf8'});}catch{}
    // 序号必须和【你看到的列表】同一个排序(active优先+最近优先)，否则归档错人(见过 nn-researcher 被误归档)。
    // archive 的序号 = 主列表(非归档)里的序号；unarchive 的序号 = 'pi --archived' 里的序号。
    function sorted(filterFn){
      const a=list.filter(filterFn);
      for(const p of a){p._active=ps.includes(p.id+'/sessions');p._ago=Math.round((now-new Date(p.lastSeen).getTime())/60000);}
      a.sort((x,y)=>(y._active?1:0)-(x._active?1:0)||x._ago-y._ago);
      return a;
    }
    // 关键：先按【同一份快照】把所有目标解析成人对象，再统一改 ——
    // 否则边归档边重排，序号会错位(pi --archive 2 4 5 6 会越归档越错)。
    const pool=sorted(mode==='archive' ? (x=>!x.archived) : (x=>x.archived));
    const picked=new Set(); const errs=[];
    for(const arg of targets){
      let p=null;
      if(/^[0-9]+\$/.test(arg)){ p=pool[parseInt(arg)-1]; if(!p){errs.push('序号 '+arg+' 超出'+(mode==='archive'?'当前列表':'已归档列表')+'范围');continue;} }
      else { p=list.find(x=>x.name===arg); if(!p){errs.push('没找到 \"'+arg+'\"');continue;} }
      picked.add(p);
    }
    if(!picked.size){ console.error(errs.join('；')||'没有可处理的目标。'); process.exit(1); }
    const names=[...picked].map(p=>p.name).join(', ');
    process.stdout.write((mode==='archive'?'归档':'恢复')+' '+names+'? [Y/n] ');
    const rl=require('readline').createInterface({input:process.stdin});
    const ans=await new Promise(r=>{rl.question('',a=>{rl.close();r(a)})});
    if(ans&&/^n/i.test(ans)){console.log('cancelled');process.exit(0);}
    for(const p of picked) p.archived=(mode==='archive');
    fs.writeFileSync('$PLIST', JSON.stringify(list,null,2));
    console.log((mode==='archive'?'已归档 ':'OK 已恢复 ')+[...picked].map(p=>p.name).join('、'));
    if(errs.length) console.error('WARN: 跳过：'+errs.join('；'));
  })();" "$MODE" "$NAME" "$@" || exit 1
  exit 0
fi

if [ -z "$NAME" ] && [ -z "$MODE" ]; then
  if [ "$COUNT" = "0" ]; then
    echo "No people. Usage: pi <name>"
  else
    node --input-type=commonjs -e "
      const fs = require('fs');
      const Y = '\x1b[33m', G = '\x1b[32m', D = '\x1b[90m', R = '\x1b[0m';
      function vw(s){let w=0;for(const c of [...s])w+=(c.codePointAt(0)>0x2E7F?2:1);return w;}
      function pad(s,n){return s+' '.repeat(Math.max(0,n-vw(s)));}
      const list = JSON.parse(fs.readFileSync('$PLIST','utf8')).filter(p=>!p.archived); // 归档的不显示
      const now = Date.now();
      const { execSync } = require('child_process');
      let psOut = '';
      try { psOut = execSync('ps aux', { encoding: 'utf8' }); } catch {}
      for (const p of list) {
        p._active = psOut.includes(p.id + '/sessions');
        p._ago = Math.round((now - new Date(p.lastSeen).getTime()) / 60000);
      }
      list.sort((a,b) => (b._active?1:0) - (a._active?1:0) || a._ago - b._ago);
      const nw = Math.max(6, ...list.map(p=>vw(p.name))) + 2;
      console.log('  ' + '  ' + pad('NAME',nw) + pad('ID',12) + 'STATUS');
      console.log('  ' + '─'.repeat(nw+12+20));
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const time = p._ago < 60 ? p._ago+'m ago' : p._ago < 1440 ? Math.round(p._ago/60)+'h ago' : Math.round(p._ago/1440)+'d ago';
        const status = p._active ? G+'Active'+R : time;
        const num = Y + String(i+1).padStart(2) + '.' + R;
        console.log('  '+num+' '+pad(p.name,nw)+D+pad(p.id,12)+R+status);
      }
      console.log(D+'  pi <序号|名字> 进入   ·   pi --archive <名字> 归档(隐藏不删)   ·   pi --archived 看归档的'+R);
    "
  fi
  exit 0
fi

if [ -z "$NAME" ]; then
  echo "Usage: pi [--sc] <name>"
  exit 1
fi

# Resolve by index or name
ENTRY=$(node --input-type=commonjs -e "
  const fs = require('fs'), { execSync } = require('child_process');
  const list = JSON.parse(fs.readFileSync('$PLIST','utf8')).filter(p=>!p.archived); // 归档的不参与序号/进入解析
  const now = Date.now();
  let psOut = '';
  try { psOut = execSync('ps aux', { encoding: 'utf8' }); } catch {}
  for (const p of list) {
    p._active = psOut.includes(p.id + '/sessions');
    p._ago = Math.round((now - new Date(p.lastSeen).getTime()) / 60000);
  }
  list.sort((a,b) => (b._active?1:0) - (a._active?1:0) || a._ago - b._ago);
  const arg = '$NAME';
  let e;
  if (/^\d+$/.test(arg)) {
    const i = parseInt(arg) - 1;
    e = list[i];
  } else {
    e = list.find(p => p.name === arg);
  }
  if (e) console.log(JSON.stringify(e));
")

if [ -z "$ENTRY" ]; then
  if [[ "$NAME" =~ ^[0-9]+$ ]]; then
    echo "序号 $NAME 不存在。运行 pi 查看列表。"
    exit 1
  fi
  if [ -n "$MODE" ]; then
    echo "\"$NAME\" not found."
    exit 1
  fi
  if [ "$COUNT" != "0" ]; then
    read -p "Create \"$NAME\"? [Y/n] " CONFIRM
    case "$CONFIRM" in n|N) exit 0;; esac
  fi
  ID=$(node --input-type=commonjs -e "console.log(require('crypto').randomBytes(4).toString('hex'))")
  mkdir -p "$MEMORY_DIR/$ID/sessions" "$MEMORY_DIR/$ID/.data"
  node --input-type=commonjs -e "
    const fs = require('fs');
    const list = JSON.parse(fs.readFileSync('$PLIST','utf8'));
    list.push({id:'$ID',name:'$NAME',created:new Date().toISOString(),lastSeen:new Date().toISOString(),note:'',model:''});
    fs.writeFileSync('$PLIST',JSON.stringify(list,null,2));
  "
else
  ID=$(echo "$ENTRY" | node --input-type=commonjs -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).id)})")
  NAME=$(echo "$ENTRY" | node --input-type=commonjs -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).name)})")
  node --input-type=commonjs -e "
    const fs = require('fs');
    const list = JSON.parse(fs.readFileSync('$PLIST','utf8'));
    const p = list.find(x=>x.id==='$ID');
    if(p)p.lastSeen=new Date().toISOString();
    fs.writeFileSync('$PLIST',JSON.stringify(list,null,2));
  "
fi

DATA_DIR="$MEMORY_DIR/$ID/.data"
mkdir -p "$DATA_DIR"

case "$MODE" in
  # msg)   # message parked in v0.1-stable(代码保留,见 Readme.md.GITHUB)
  #   exec node ~/.pi/agent/extensions/message/chat.mjs "$NAME"
  #   ;;
  sc)
    TMUX_NAME="sc-$ID"
    if ! tmux has-session -t "$TMUX_NAME" 2>/dev/null; then
      echo "潜意识没有在运行。先用 pi $NAME 启动主 session。"
      exit 0
    fi
    exec tmux attach -t "$TMUX_NAME" -r
    ;;
  think)
    # dual-pane: upper=pi conversation, lower=thinking stream
    THINK_LOG="$DATA_DIR/thinking.stream"
    : > "$THINK_LOG"
    TMUX_THINK="think-$ID"
    tmux kill-session -t "$TMUX_THINK" 2>/dev/null || true
    WAKEFILE="$DATA_DIR/.wake-restart"
    LAST_NONCE=$(cat "$WAKEFILE" 2>/dev/null)
    UPPER_SCRIPT="$DATA_DIR/.think-upper.sh"
    cat > "$UPPER_SCRIPT" << 'UPPER_EOF'
#!/bin/bash
WOKE=""
while true; do
  PI_ALIVE_RESTART_LOOP=1 PI_ALIVE_WOKE="$WOKE" /opt/homebrew/bin/pi --session-dir "$SESSION_DIR" "$@"
  NONCE=$(cat "$WAKEFILE" 2>/dev/null)
  if [ -n "$NONCE" ] && [ "$NONCE" != "$LAST_NONCE" ]; then
    LAST_NONCE="$NONCE"; WOKE=1; continue
  fi
  break
done
UPPER_EOF
    chmod +x "$UPPER_SCRIPT"
    tmux new-session -d -s "$TMUX_THINK" -x "$(tput cols)" -y "$(tput lines)" \
      "SESSION_DIR='$MEMORY_DIR/$ID/sessions' WAKEFILE='$WAKEFILE' LAST_NONCE='$LAST_NONCE' bash '$UPPER_SCRIPT'"
    tmux split-window -t "$TMUX_THINK" -v -l 30% \
      "echo 'Thinking Stream'; tail -f '$THINK_LOG' 2>/dev/null"
    tmux select-pane -t "$TMUX_THINK:0.0"
    exec tmux attach -t "$TMUX_THINK"
    ;;
  *)
    # wake-restart loop (Issues.DEV/010) + mutex PID lock
    PIDFILE="$DATA_DIR/.pi-main.pid"
    if [ -f "$PIDFILE" ]; then
      OLD_PID=$(cat "$PIDFILE" 2>/dev/null)
      if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "WARN:  $NAME 已有主意识在跑 (PID $OLD_PID)。不能同时开两个。"
        exit 1
      fi
    fi
    echo $$ > "$PIDFILE"
    trap 'rm -f "$PIDFILE"' EXIT
    WAKEFILE="$DATA_DIR/.wake-restart"
    LAST_NONCE=$(cat "$WAKEFILE" 2>/dev/null)   # 吃掉历史残留的 nonce，避免首启误判为"睡醒"
    WOKE=""
    BLACKBOX="$HOME/smart-pi/pi-coding-master.DEV/Codebase/debug/god.pi.blackbox/blackbox.sh"
    while true; do
      if [ -x "$BLACKBOX" ]; then
        PI_ALIVE_RESTART_LOOP=1 PI_ALIVE_WOKE="$WOKE" "$BLACKBOX" "$ID" "${NAME:-unknown}" "main" -- /opt/homebrew/bin/pi --session-dir "$MEMORY_DIR/$ID/sessions" "$@"
      else
        PI_ALIVE_RESTART_LOOP=1 PI_ALIVE_WOKE="$WOKE" /opt/homebrew/bin/pi --session-dir "$MEMORY_DIR/$ID/sessions" "$@"
      fi
      NONCE=$(cat "$WAKEFILE" 2>/dev/null)
      if [ -n "$NONCE" ] && [ "$NONCE" != "$LAST_NONCE" ]; then
        LAST_NONCE="$NONCE"; WOKE=1; continue   # 睡醒重启：重新拉起，并告诉新实例"你是睡醒的"
      fi
      break
    done
    ;;
esac
