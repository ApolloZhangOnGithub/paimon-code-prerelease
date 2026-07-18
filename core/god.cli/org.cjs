// paimon -o              → 列出所有组织
// paimon -o <name>       → 创建组织
// paimon -o <org_id> <agent> → agent 加入组织
(async () => {
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { computeAndSort } = require('./pad.cjs');

const PLIST = process.argv[2];
const ARG1 = process.argv[3];
const ARG2 = process.argv[4];
const PAIMON_HOME = process.env.PAIMON_HOME || (require('os').homedir() + '/.paimon');

const list = JSON.parse(fs.readFileSync(PLIST, 'utf8'));
const now = Date.now();
let ps = '';
try { ps = execSync('ps aux', { encoding: 'utf8' }); } catch {}
computeAndSort(list.filter(p => !p.archived), ps, now);

const ORGS_FILE = PAIMON_HOME + '/AgentWorkDir/Organizational/orgs.json';
fs.mkdirSync(require('path').dirname(ORGS_FILE), { recursive: true });
let orgs = [];
try { orgs = JSON.parse(fs.readFileSync(ORGS_FILE, 'utf8')); } catch { orgs = []; }

function pad(s, n) { return s + ' '.repeat(Math.max(0, n - s.length)); }

// ── 无参数: 列出所有组织 ──
if (!ARG1) {
  if (orgs.length === 0) { console.log('(暂无组织)\n\n创建: paimon -o <组织名>'); process.exit(0); }
  const nw = Math.max(...orgs.map(o => o.name.length), 4);
  const iw = 8;
  console.log('  名称' + ' '.repeat(nw - 2) + '  ID       成员');
  console.log('  ──' + '──'.repeat(Math.max(nw, 4) + iw));
  for (const o of orgs) {
    const memberNames = o.members.map(mid => {
      const a = list.find(x => x.id === mid);
      return a ? a.name : mid;
    }).join(', ');
    console.log('  ' + pad(o.name, nw + 2) + o.id + '  ' + memberNames);
  }
  process.exit(0);
}

// ── 模式 1: paimon -o <org_name>（无 agent 参数）→ 创建组织 ──
if (!ARG2) {
  if (/^[a-f0-9]{6}$/.test(ARG1)) {
    const org = orgs.find(o => o.id === ARG1);
    if (org) {
      const memberNames = org.members.map(mid => {
        const a = list.find(x => x.id === mid);
        return a ? a.name : mid;
      }).join(', ');
      console.log(org.name + ' (' + org.id + ')  成员: ' + (memberNames || '无') + '\n  创建: ' + org.created);
      process.exit(0);
    }
    console.error('组织 ' + ARG1 + ' 不存在');
    process.exit(1);
  }
  const name = ARG1;
  if (orgs.find(o => o.name === name)) {
    console.error('组织「' + name + '」已存在 (ID: ' + orgs.find(o => o.name === name).id + ')');
    process.exit(1);
  }
  process.stdout.write('创建组织「' + name + '」? (Y 确认，其他取消) ');
  const rl = require('readline').createInterface({ input: process.stdin });
  const ans = await new Promise(r => { rl.question('', a => { rl.close(); r(a); }); });
  if (!ans || !/^y/i.test(ans)) { console.log('取消'); process.exit(0); }
  const id = crypto.randomBytes(3).toString('hex');
  orgs.push({ id, name, members: [], created: new Date().toISOString().slice(0, 10) });
  fs.writeFileSync(ORGS_FILE, JSON.stringify(orgs, null, 2));
  console.log('组织「' + name + '」已创建 (' + id + ')');
  process.exit(0);
}

// ── 模式 2: paimon -o <org_id> <agent> → agent 加入组织 ──
const ORG_ID = ARG1;
const AGENT_ARG = ARG2;

const org = orgs.find(o => o.id === ORG_ID);
if (!org) { console.error('组织 ' + ORG_ID + ' 不存在'); process.exit(1); }

if (/^\d+$/.test(AGENT_ARG)) {
  const offline = list.filter(p => !p._active && !p.archived);
  const agent = offline[parseInt(AGENT_ARG) - 1];
  if (!agent) {
    console.error('序号 ' + AGENT_ARG + ' 超出范围（共 ' + offline.length + ' 个离线 agent）');
    process.exit(1);
  }
  for (const o of orgs) o.members = o.members.filter(m => m !== agent.id);
  if (!org.members.includes(agent.id)) org.members.push(agent.id);
  fs.writeFileSync(ORGS_FILE, JSON.stringify(orgs, null, 2));
  agent.org = ORG_ID;
  fs.writeFileSync(PLIST, JSON.stringify(list, null, 2));
  console.log(agent.name + ' 已加入「' + org.name + '」(' + ORG_ID + ')');
} else {
  const agent = list.find(p => p.name === AGENT_ARG);
  if (!agent) { console.error('没找到 "' + AGENT_ARG + '"'); process.exit(1); }
  for (const o of orgs) o.members = o.members.filter(m => m !== agent.id);
  if (!org.members.includes(agent.id)) org.members.push(agent.id);
  fs.writeFileSync(ORGS_FILE, JSON.stringify(orgs, null, 2));
  agent.org = ORG_ID;
  fs.writeFileSync(PLIST, JSON.stringify(list, null, 2));
  console.log(agent.name + ' 已加入「' + org.name + '」(' + ORG_ID + ')');
}
})();
