// list.cjs — 共享的 agent 列表渲染
// 用法: node list.cjs <plist.json> <memoryDir> <lang> <filter>
//   filter: "active" (非归档) | "archived" (已归档)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { homedir } = require('os');

const PLIST = process.argv[2];
const MEM_DIR = process.argv[3];
const lang = process.argv[4] || 'en';
const filter = process.argv[5] || 'list'; // list=agents only, active=agents+help(legacy), help=usage only
const zh = lang === 'zh';

// 路径从环境变量读取（launcher.sh export）
const PAIMON_HOME = process.env.PAIMON_HOME || (homedir() + '/.paimon');
const PAIMON_CONFIG = process.env.PAIMON_CONFIG || (PAIMON_HOME + '/config');

// developer mode
let devMode = false;
try {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(PAIMON_CONFIG, 'settings.json'), 'utf8')); } catch {}
  devMode = !!s.developerMode;
} catch {}
try { const v = JSON.parse(fs.readFileSync(path.join(PAIMON_HOME, 'agent/version.json'), 'utf8')); if (v.paimon && v.paimon.includes('-dev.')) devMode = true; } catch {}
// detail mode (-D flag)
const detailMode = !!process.env.PAIMON_DETAIL;

const Y = '\x1b[33m', G = '\x1b[32m', D = '\x1b[90m', C = '\x1b[36m', M = '\x1b[35m', R = '\x1b[0m', BOLD = '\x1b[1m', RED = '\x1b[31m', YLW = '\x1b[33m';
const KIND_COLORS = { 'coding-agent': M, 'coding': M };

const { pad, lpad, vw, computeAndSort } = require(path.join(__dirname, 'pad.cjs'));

function dirSize(dir) {
  let total = 0;
  try {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else try { total += fs.statSync(fp).size; } catch {}
      }
    };
    walk(dir);
  } catch {}
  return total;
}

function fmtSizeRaw(b) {
  const mb = b / 1024 / 1024;
  if (mb < 0.01) return '  —     ';
  return mb.toFixed(2).padStart(7) + ' MB';
}
function fmtSizeColor(b) {
  const mb = b / 1024 / 1024;
  const raw = fmtSizeRaw(b);
  if (mb < 0.01) return D + raw + R;
  if (mb < 10) return '\x1b[32m' + raw + R;    // green
  if (mb < 100) return '\x1b[33m' + raw + R;   // yellow
  return '\x1b[31m' + raw + R;                  // red
}
function fmtColor(b, text) {
  const mb = b / 1024 / 1024;
  if (mb < 0.01) return D + text + R;
  if (mb < 10) return '\x1b[32m' + text + R;
  if (mb < 100) return '\x1b[33m' + text + R;
  return '\x1b[31m' + text + R;
}

const allList = JSON.parse(fs.readFileSync(PLIST, 'utf8'));
const list = filter === 'help' ? [] : allList.filter(filter === 'archived' ? (p => p.archived) : (p => !p.archived));

if (!list.length && filter !== 'help') {
  console.log(zh ? '  (空)' : '  (empty)');
  process.exit(0);
}

const now = Date.now();
let psOut = '';
try { psOut = execSync('ps aux', { encoding: 'utf8' }); } catch {}

computeAndSort(list, psOut, now);
  for (const p of list) {
    const md = path.join(MEM_DIR, p.id);
    p._memSize = dirSize(md);
    p._memoir = fs.existsSync(PAIMON_HOME + '/MemoirData/' + p.id + '.MEMOIR');
    p._size = p._memSize;
    for (const sub of ['SessionData','AgentFileData','MonitorData','BlackboxData','RuntimeCache', 'IdentityData', 'ErrorData', 'AgentWorkDir/Individual']) {
      p._size += dirSize(path.join(path.dirname(MEM_DIR), sub, p.id));
    }
    // 记忆 breakdown
    const fs2 = (f) => { try { return fs.statSync(path.join(md, f)).size; } catch { return 0; } };
    p._dialog = fs2('context.md') + fs2('context.archive.jsonl') + fs2('events.jsonl');
    p._work = fs2('work_memory.md') + fs2('thinking.stream');
    p._neo = fs2('hc-new-slice.md');
  }

const L_NAME = zh ? '名称' : 'NAME';
const L_KIND = zh ? '类型' : 'KIND';
const L_ID = 'ID';
const L_ORG = zh ? '组织' : 'ORG';
const L_MEMOIR = zh ? '回忆录' : 'MEMOIR';
const L_DISK = zh ? '磁盘（记忆/总计）' : 'DISK (MEM/TOTAL)';
const L_STATUS = zh ? '状态' : 'STATUS';

const idW = Math.max(vw(L_ID), ...list.map(p => vw(p.id)));
const orgW = Math.max(vw(L_ORG), ...list.map(p => vw(p.org || '/')));

const nw = Math.max(vw(L_NAME) + 2, ...list.map(p => vw(p.name))) + 2;
const shortKind = (k) => k === 'coding-agent' ? 'coding' : (k || 'coding-agent'); // chatbot deprecated
const kw = Math.max(vw(L_KIND) + 2, ...list.map(p => vw(shortKind(p.kind)))) + 2;
const diskStrs = list.map(p => ({
  mem: fmtSizeRaw(p._memSize).trim(),
  total: fmtSizeRaw(p._size).trim()
}));
const memW = Math.max(...diskStrs.map(d => vw(d.mem)));
const totW = Math.max(...diskStrs.map(d => vw(d.total)));
const diskDisplay = list.map((_p, i) => {
  const m = ' '.repeat(memW - vw(diskStrs[i].mem)) + diskStrs[i].mem;
  const t = ' '.repeat(totW - vw(diskStrs[i].total)) + diskStrs[i].total;
  return { raw: m + ' / ' + t, mem: m, total: t };
});
const numW = String(list.length).length;
const hdr = ' '.repeat(numW + 2 + 1); // number + '. ' + trailing space

const title = filter === 'help'
  ? '  ' + BOLD + 'Paimon Code' + R + D + ' ' + (zh ? '用法' : 'usage') + R
  : filter === 'archived'
  ? '  ' + BOLD + 'Paimon Code' + R + D + ' · ' + list.length + (zh ? ' 已归档' : ' archived') + R
  : '  ' + BOLD + 'Paimon Code' + R + D + ' · ' + list.length + ' agent' + (list.length === 1 ? '' : 's') + R
    + (() => { try { const v = JSON.parse(fs.readFileSync(PAIMON_HOME + '/agent/version.json', 'utf8')); return D + '  v' + v.paimon + ' (' + v.channel + ')' + R; } catch(e) { require('fs').appendFileSync('/tmp/paimon-list-error.log', 'version display: ' + (e?.message||e) + '\n'); return ''; } })();

const statusStrs = list.map(p => {
  let tag = '', time = '';
  if (p._active) {
    const rc = `${PAIMON_HOME}/RuntimeCache/${p.id}`;
    try {
      if (fs.existsSync(`${PAIMON_HOME}/MemoryData/${p.id}/paused`) || fs.existsSync(`${rc}/paused`)) tag = '[P]';
      else if (fs.existsSync(`${rc}/main-resting`)) tag = '[W]';
      else if (fs.existsSync(`${rc}/main-hibernate`)) tag = '[H]';
      else tag = '[A]';
    } catch {}
    const secs = Math.round((now - new Date(p.lastSeen).getTime()) / 1000);
    if (secs < 5) time = '刚刚';
    else if (secs < 60) time = `${secs}秒`;
    else {
      const mins = Math.floor(secs / 60);
      if (mins < 60) time = `${mins}分钟`;
      else {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        if (h < 24) time = `${h}小时${m > 0 ? m + '分钟' : ''}`;
        else {
          const d = Math.floor(h / 24);
          const rh = h % 24;
          if (rh > 0) time = `${d}天${rh}小时`;
          else if (m > 0) time = `${d}天${m}分钟`;
          else time = `${d}天`;
        }
      }
    }
    return { tag, time };
  }
  // 离线
  const endTs = p.lastEnded || p.lastSeen;
  if (!endTs) time = zh ? '从未启动' : 'not started';
  else {
    const secs2 = Math.round((now - new Date(endTs).getTime()) / 1000);
    if (secs2 < 5) time = '刚刚';
    else if (secs2 < 60) time = `${secs2}秒前`;
    else {
      const t = Math.floor(secs2 / 60);
      if (t < 60) time = `${t}分钟前`;
      else {
        const h = Math.floor(t / 60);
        if (t < 1440) time = `${h}小时前`;
        else time = `${Math.floor(h / 24)}天前`;
      }
    }
  }
  return { tag, time };
});
const activeLabel = '';
const tw = Math.max(...statusStrs.map(s => vw(s.time)));

if (filter !== 'help') {
console.log('');
console.log(title);
console.log('');
// Header: 名称 类型 组织 ID 回忆录 状态 时间
const showStatus = filter !== 'archived';
const r1Hdr = hdr + pad(L_NAME, nw) + pad(L_KIND, kw) + ' ' + pad(L_ORG, orgW) + '  ' + pad(L_ID, idW) + '  ' + pad(L_MEMOIR, 6) + (showStatus ? '  ' + (zh ? '时间' : 'TIME') : '');

let offlineNum = 1;
let activeNum = 1;
// 分页：每 PAGE_SIZE 个 agent 暂停（直接 inline，无死代码）
const PAGE_SIZE = 10;
// 第一遍：收集所有行用于计算宽度
const rows1 = [], rows2 = [];
const savedActive = [];
for (let i = 0; i < list.length; i++) {
  const p = list[i];
  const org = p.org || '/';
  const kind = shortKind(p.kind);
  const s = statusStrs[i];
  const tag = showStatus && s.tag ? s.tag + ' ' : '';
  const stime = pad(s.time, tw);
  const statusColor = p._active ? G : '';
  const statusReset = p._active ? R : '';
  const num = p._active ? G + String(activeNum++).padStart(numW) + '. ' + R : Y + String(offlineNum++).padStart(numW) + '. ' + R;
  const kc = KIND_COLORS[kind] || D;
  const memoir = pad(p._memoir ? '✓' : '✗', 6);
  const pct = p._size > 0 ? ((p._memSize / p._size) * 100).toFixed(1) : '0.0';
  const dpct = p._size > 0 ? ((p._dialog / p._size) * 100).toFixed(1) : '0.0';
  const wpct = p._size > 0 ? ((p._work / p._size) * 100).toFixed(1) : '0.0';
  const npct = p._size > 0 ? ((p._neo / p._size) * 100).toFixed(1) : '0.0';
  const pctColor = parseFloat(pct) > 80 ? (parseFloat(pct) > 95 ? RED : YLW) : G;
  const statusPart = showStatus ? '  ' + statusColor + tag + stime + statusReset : '';
  const row1 = '  ' + num + ' ' + pad(p.name, nw) + kc + pad(kind, kw) + R + ' ' + pad(org, orgW) + '  ' + p.id + ' '.repeat(Math.max(0, idW - vw(p.id))) + '  ' + memoir + statusPart;
  rows1.push(row1);
  savedActive.push(p._active);
  if (detailMode) {
    const breakdown = D + '[' + R + D + '对话' + R + D + dpct + R + ' ' + D + '工作' + R + D + wpct + R + ' ' + D + '新皮层' + R + D + npct + R + D + ']' + R;
    const memLine = '      ' + D + '记忆' + R + ' ' + D + pct + '%' + R + ' ' + breakdown;
    rows2.push(memLine + '  ' + D + fmtSizeRaw(p._size).trim() + R);
  } else { rows2.push(''); }
}
// 数据行宽度 = 所有固定列宽之和
const r1DataW = numW + 3 + nw + kw + 1 + orgW + 2 + idW + 2 + 6 + (showStatus ? 2 + tw : 0);
console.log('  ' + r1Hdr);
console.log('  ' + '─'.repeat(r1DataW));
// 第二遍：输出
for (let i = 0; i < rows1.length; i++) {
  console.log(rows1[i]);
  if (rows2[i]) console.log(rows2[i]);
  const agentCount = i + 1;
  if (process.stdout.isTTY && agentCount % PAGE_SIZE === 0 && agentCount < list.length) {
    process.stdout.write(D + '  -- Enter 继续, q/Esc 退出 --' + R);
    const buf = Buffer.alloc(64);
    try { require('fs').readSync(0, buf, 0, 64); } catch {}
    const firstByte = buf[0];
    const input = buf.toString('utf8').trim().toLowerCase();
    if (firstByte === 0x1b || input === 'q') { process.exit(0); }
    process.stdout.write('\r' + ' '.repeat(50) + '\r');
  }
}
// sync 状态
try {
  const syncStatusPath = path.join(PAIMON_HOME, 'LogData', 'sync-status.json');
  if (fs.existsSync(syncStatusPath)) {
    const ss = JSON.parse(fs.readFileSync(syncStatusPath, 'utf8'));
    if (ss.lastAt) {
      const ago = Math.round((Date.now() - new Date(ss.lastAt).getTime()) / 60000);
      const agoStr = ago < 1 ? '<1m' : ago < 60 ? ago + 'm' : Math.round(ago/60) + 'h';
      const detail = ss.count > 0 ? ` (${ss.lastAction} ${ss.count})` : '';
      console.log(D + '  Synced ' + agoStr + ' ago' + detail + R);
    }
  }
} catch {}
} // end if (filter !== 'help')

if (filter === 'help') {
  let ver = '';
  try { const v = JSON.parse(fs.readFileSync(PAIMON_HOME + '/agent/version.json', 'utf8')); ver = ' v' + v.paimon; } catch {}
  console.log('');
  console.log('  ' + BOLD + 'Paimon Code Help' + R + ver);
  console.log('');
  if (zh) {
    console.log('  世界上最先进的Agent系统，在持续生命、状态保持、Agent间交互、记忆等方法领先Claude Code等前沿工程。');
    console.log('  拥有自己的记忆、身份、元意识和海马体。');
  } else {
    console.log('  The most advanced agent system in the world, leading in aspects like continuous life, state persistence, agent interaction, and memory.');
    console.log('  Each agent has its own memory, identity, metaconsciousness, and hippocampus.');
  }
}

console.log('');
if (filter === 'active' || filter === 'help') {
if (filter === 'archived') {
  console.log('  paimon unarchive <' + (zh ? 'agent名称' : 'agent') + '>  ' + (zh ? '恢复归档' : 'restore'));
} else {
  const W = 30;
  const row = (cmd, desc) => console.log('    ' + cmd + ' '.repeat(Math.max(1, W - vw(cmd))) + desc);
  const hdr = (s) => { console.log(''); console.log('  ' + BOLD + s + R); };

  if (zh) {
    hdr('管理');
    row('<agent名称>',                    '创建新 agent 或启动已有 agent');
    row('kill, k <agent名称>',           '终止正在运行的 agent 进程');
    row('archive, a <agent名称>',        '归档 agent，从主列表隐藏');
    row('unarchive, ua <agent名称>',     '恢复已归档的 agent 到主列表');
    row('archived, A',                    '列出所有已归档的 agents');
    row('rename <agent名称> <新名称>',    '重命名 agent，保留历史记录');
    row('org, o [组织名称] <agent名称>',  '列出组织 / 创建组织 / 加入组织');

    hdr('调试');
    row('mc <agent名称>',                '连接到 agent 的元意识 tmux session');
    row('hc <agent名称>',                '连接到 agent 的海马体 tmux session');
    row('mobile, m <agent名称>',         '查看 agent 的手机屏幕输出');
    row('laptop, l <agent名称>',         '查看 agent 的笔记本桌面输出');
    row('version, v',            '显示当前版本号和可用通道');

    hdr('诊断');
    row('help, h',               '显示此帮助信息');
    row('doctor',                '运行系统诊断，检查配置和健康状态');

    hdr('账户');
    row('login',                 '通过 GitHub 登录并绑定账户');
    row('logout',                '登出，清除 token（保留绑定）');
    row('unbind',                '解除账户绑定');
    row('whoami',                '显示当前账户和同步状态');

    hdr('设置');
    row('settings, s',           '打开交互式设置界面');
  } else {
    hdr('Manage');
    row('<agent>',                        'Create a new agent or start an existing one');
    row('kill, k <agent>',               'Terminate a running agent process');
    row('archive, a <agent>',            'Archive an agent, hide from main list');
    row('unarchive, ua <agent>',         'Restore an archived agent to main list');
    row('archived, A',                    'List all archived agents');
    row('rename <agent> <new-name>',     'Rename an agent, preserving history');
    row('org, o [org-name] <agent>',     'List orgs / create org / join org');

    hdr('Debug');
    row('mc <agent>',                    'Attach to metaconsciousness tmux session');
    row('hc <agent>',                    'Attach to hippocampus tmux session');
    row('mobile, m <agent>',            'View mobile screen output of an agent');
    row('laptop, l <agent>',            'View laptop desktop output of an agent');
    row('version, v',           'Show current version and available channels');

    hdr('Diagnose');
    row('help, h',              'Show this help message');
    row('doctor',               'Run system diagnostics and health checks');

    hdr('Account');
    row('login',                         'Log in with GitHub account');
    row('logout',                        'Log out, clear token (keep binding)');
    row('unbind',                        'Remove account binding');
    row('whoami',                        'Show current account and sync status');

    hdr('Settings');
    row('settings, s',                   'Open interactive settings interface');
  }
}
console.log('');
}
