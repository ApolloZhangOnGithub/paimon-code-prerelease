(async () => {
const fs = require('fs');
const { computeAndSort } = require('./pad.cjs');
const { execSync } = require('child_process');

const PLIST = process.argv[2];
const MODE = process.argv[3];
const targets = process.argv.slice(4);
const PAIMON_HOME = process.env.PAIMON_HOME || (require('os').homedir() + '/.paimon');

const list = JSON.parse(fs.readFileSync(PLIST, 'utf8'));

// ── org 支持：6位hex = 组织号 → 展开为成员 agent 列表 ──
const ORGS_FILE = PAIMON_HOME + '/AgentWorkDir/Organizational/orgs.json';
let orgs = [];
try { orgs = JSON.parse(fs.readFileSync(ORGS_FILE, 'utf8')); } catch {}
const now = Date.now();
let ps = '';
try { ps = execSync('ps aux', { encoding: 'utf8' }); } catch {}

function sorted(filterFn) {
  const a = list.filter(filterFn);
  computeAndSort(a, ps, now);
  return a;
}

const poolRaw = sorted(MODE === 'archive' ? (x => !x.archived) : (x => x.archived));
// 归档时只能选不在运行的（数字对应离线编号，同 paimon list）
const pool = MODE === 'archive' ? poolRaw.filter(p => !p._active) : poolRaw;
const picked = new Set();
const errs = [];

// 展开 org ID（6位hex）→ 成员 agent ID 列表
let orgArchiveName = ''; // 记录被归档的组织名
const expanded = [];
for (const arg of targets) {
  if (/^[a-f0-9]{6}$/.test(arg)) {
    const org = orgs.find(o => o.id === arg);
    if (org) {
      // 检查是否有 live 的成员——只要有一个人活着就不能归档
      if (MODE === 'archive') {
        const liveMembers = org.members.filter(mid => {
          const a = list.find(x => x.id === mid);
          return a && a._active;
        });
        if (liveMembers.length > 0) {
          const liveNames = liveMembers.map(mid => {
            const a = list.find(x => x.id === mid);
            return a ? a.name : mid;
          }).join(', ');
          errs.push(`组织「${org.name}」有 ${liveMembers.length} 人在运行中，不能归档: ${liveNames}`);
          continue;
        }
      }
      orgArchiveName = org.name;
      for (const mid of org.members) {
        const agent = list.find(a => a.id === mid);
        if (agent) expanded.push(agent.name);
      }
      continue;
    }
  }
  expanded.push(arg);
}

for (const arg of expanded) {
  if (arg === '*' || arg === 'all') {
    pool.forEach(p => picked.add(p));
  } else if (/^\d+-\d+$/.test(arg)) {
    const m = arg.match(/^(\d+)-(\d+)$/);
    const a = parseInt(m[1]), b = parseInt(m[2]);
    // 先检查起始是否在范围内，不在直接报错整段
    if (a > pool.length) { errs.push('序号 ' + arg + ' 超出范围（共 ' + pool.length + ' 个）'); continue; }
    const end = Math.min(b, pool.length);
    for (let i = a; i <= end; i++) picked.add(pool[i - 1]);
    if (b > pool.length) errs.push('序号 ' + (pool.length + 1) + '-' + b + ' 超出范围（共 ' + pool.length + ' 个）');
  } else if (/^\d+$/.test(arg)) {
    const p = pool[parseInt(arg) - 1];
    if (p) picked.add(p);
    else errs.push('序号 ' + arg + ' 超出范围（共 ' + pool.length + ' 个）');
  } else {
    const p = pool.find(x => x.name === arg);
    if (p) picked.add(p);
    else errs.push('没找到 "' + arg + '"');
  }
}

if (errs.length) {
  console.error(errs.join('；'));
  process.exit(1);
}

if (!picked.size) {
  console.error('没有可处理的目标。');
  process.exit(1);
}

// ── 回忆录检查 ──
const MEMOIR_DIR = process.env.PAIMON_MEMOIR_DIR || PAIMON_HOME + '/MemoirData';
try { require('fs').mkdirSync(MEMOIR_DIR, { recursive: true }); } catch {}

let memoirWarn = '';
if (MODE === 'archive' && MEMOIR_DIR) {
  const missing = [...picked].filter(p => !fs.existsSync(MEMOIR_DIR + '/' + p.id + '.MEMOIR'));
  if (missing.length === 1) memoirWarn = '该agent尚未撰写回忆录(' + MEMOIR_DIR + '/' + missing[0].id + '.MEMOIR), ';
  else if (missing.length > 1) memoirWarn = missing.length + '个agent尚未撰写回忆录，';
}

const names = orgArchiveName
  ? `组织「${orgArchiveName}」的 ${[...picked].length} 人(` + [...picked].map(p => p.name).join(', ') + ')'
  : [...picked].map(p => p.name).join(', ');
process.stdout.write(memoirWarn + (MODE === 'archive' ? '确定归档 ' : '确定恢复 ') + names + '? (Y 确认，其他取消) ');

const rl = require('readline').createInterface({ input: process.stdin });
const ans = await new Promise(r => { rl.question('', a => { rl.close(); r(a) }); });
if (!ans || !/^y/i.test(ans)) { console.log('cancelled'); process.exit(0); }

for (const p of picked) {
  // 如果还在跑，先杀掉
  if (MODE === 'archive' && p._active) {
    try {
      const pid = execSync(`ps aux | grep 'paimon:.*${p.id}' | grep -v grep | awk '{print $2}'`, {encoding:'utf8'}).trim().split('\n')[0];
      if (pid) { process.kill(parseInt(pid)); console.log(`  已杀掉 ${p.name} (PID ${pid})`); }
    } catch {}
  }
  p.archived = (MODE === 'archive');
  p.archivedAt = (MODE === 'archive') ? new Date().toISOString() : undefined;
  // 同步 IdentityData + 记录完整历史
  const idPath = PAIMON_HOME + '/IdentityData/' + p.id + '/identity.json';
  try {
    const idDir = require('path').dirname(idPath);
    require('fs').mkdirSync(idDir, { recursive: true });
    let idData = {};
    try { idData = JSON.parse(fs.readFileSync(idPath, 'utf8')); } catch {}
    idData.archived = p.archived;
    idData.archivedAt = p.archivedAt;
    if (!idData.archiveHistory) idData.archiveHistory = [];
    idData.archiveHistory.push({ action: MODE, at: new Date().toISOString() });
    fs.writeFileSync(idPath, JSON.stringify(idData, null, 2));
  } catch {}
}
fs.writeFileSync(PLIST, JSON.stringify(list, null, 2));
// 归档后自动压缩，恢复后自动解压
for (const p of picked) {
  const COMPRESS = __dirname + '/paimon-compress.cjs';
  const { spawn } = require('child_process');
  if (MODE === 'archive') {
    spawn('node', [COMPRESS, 'compress', p.id], { stdio: 'ignore', detached: true }).unref();
  } else {
    spawn('node', [COMPRESS, 'decompress', p.id], { stdio: 'ignore', detached: true }).unref();
  }
}
console.log((MODE === 'archive' ? '已归档 ' : 'OK 已恢复 ') + [...picked].map(p => p.name).join('、'));
})();
