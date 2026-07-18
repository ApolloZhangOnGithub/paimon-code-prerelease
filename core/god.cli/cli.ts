// cli.ts — Paimon Code 统一入口
// 用法: paimon [flags] [name]

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { SYNC_ENDPOINT_DEFAULT } from '../paths.ts';

const H = os.homedir();
const PAIMON = path.join(H, '.paimon');
const PLIST = path.join(PAIMON, 'MemoryData', 'plist.json');
const RUNTIME = path.join(H, '.local/lib/paimon/runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
const EXT = path.join(H, '.local/lib/paimon/extensions/paimon-code');
const LANG = process.env.PAIMON_LANG || (process.env.LANG?.includes('zh_CN') ? 'zh' : 'en');
const ZH = LANG === 'zh';
const _uaSettings = path.join(PAIMON, 'UserAccount', 'settings.json');
const PAIMON_SETTINGS = fs.existsSync(_uaSettings) ? _uaSettings : path.join(PAIMON, 'config', 'settings.json');

// ── pad utils ──
function vw(s: string): number { let w=0; for(const c of [...String(s)]){ const cp=c.codePointAt(0); w+=(cp&&cp>0x2E7F)?2:1 } return w }
function pad(s: string, n: number): string { return String(s)+' '.repeat(Math.max(0,n-vw(String(s)))) }
function lpad(s: string, n: number): string { return ' '.repeat(Math.max(0,n-vw(String(s))))+String(s) }
function computeAndSort(list: any[], psOut: string, now: number) {
  for(const p of list){ p._active=psOut.split('\n').some((l: string)=>l.includes('paimon:')&&l.includes('(main,')&&l.includes(p.id)); p._ago=Math.round((now-new Date(p.lastEnded||p.lastSeen).getTime())/60000) }
  list.sort((a: any,b: any)=>(b._active?1:0)-(a._active?1:0)||a._ago-b._ago)
}

// ── helpers ──
const Y='\x1b[33m', G='\x1b[32m', D='\x1b[90m', M='\x1b[35m', R='\x1b[0m', BOLD='\x1b[1m';
function loadPlist(): any[] { try { return JSON.parse(fs.readFileSync(PLIST,'utf8')) } catch { return [] } }
function savePlist(l: any[]) { fs.mkdirSync(path.dirname(PLIST),{recursive:true}); fs.writeFileSync(PLIST,JSON.stringify(l,null,2)) }
const SUBCOMMANDS: Record<string,string> = {
  'archive':'archive', 'a':'archive',
  'unarchive':'unarchive', 'ua':'unarchive',
  'archived':'archived', 'A':'archived',
  'kill':'kill', 'k':'kill',
  'tmux':'tmux', 't':'tmux',
  'mc':'mc', 'hc':'hc',
  'mobile':'mobile', 'm':'mobile',
  'laptop':'laptop', 'l':'laptop',
  'settings':'settings', 's':'settings',
  'org':'org', 'o':'org',
  'help':'help', 'h':'help',
  'login':'login', 'logout':'logout', 'unbind':'unbind',
  'whoami':'whoami',
  'sync':'sync',
  'update':'update', 'uninstall':'uninstall',
  'sessions':'sessions', 'web':'web',
  'version':'version', 'v':'version',
  'rename':'rename',
  'doctor':'doctor',
};
const RESERVED_NAMES = new Set([
  ...Object.keys(SUBCOMMANDS),
  'update','upgrade','config','list','ls','status',
  'install','uninstall','doctor','reset',
]);

function confirm(prompt: string): boolean {
  if(!process.stdin.isTTY) return true;
  process.stdout.write(prompt+' (Y/n) ');
  const buf=Buffer.alloc(8);
  try { fs.readSync(0, buf, 0, 8, 0) } catch {}
  return buf.toString().trim().toLowerCase()==='y'||buf.toString().trim()==='';
}
function psAux(): string { try { return execSync('ps aux',{encoding:'utf8',timeout:3000}) } catch { return '' } }
function shortKind(k: string): string { return k==='coding-agent'?'coding':k }
function dirSize(dir: string): number { let t=0; try{ const w=(d:string)=>{ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const fp=path.join(d,e.name); if(e.isDirectory()) w(fp); else try{ t+=fs.statSync(fp).size }catch{} } }; w(dir) }catch{} return t }

// ── DEEPSEEK KEY ──
try {
  const ua = path.join(PAIMON, 'UserAccount', 'services.json');
  const legacy = path.join(PAIMON, 'config', 'services.json');
  const sf = fs.existsSync(ua) ? ua : legacy;
  const svc = JSON.parse(fs.readFileSync(sf,'utf8'));
  const k = svc?.deepseek?.apiKey;
  if(typeof k==='string' && k.trim()) process.env.DEEPSEEK_API_KEY = k.trim();
} catch {}

// ═══════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════
function cmdList(filter='list') {
  const all = loadPlist();
  const list = filter==='archived' ? all.filter((p:any)=>p.archived) : all.filter((p:any)=>!p.archived);
  if(!list.length) { console.log(ZH?'  (空)':'  (empty)'); process.exit(0) }

  let devMode=false;
  try{ const s=JSON.parse(fs.readFileSync(PAIMON_SETTINGS,'utf8')); devMode=!!s.developerMode }catch{}
  try{ const v=JSON.parse(fs.readFileSync(path.join(PAIMON,'version.json'),'utf8')); if(v.paimon?.includes('-dev.')) devMode=true }catch{}

  const now=Date.now(), ps=psAux();
  computeAndSort(list,ps,now);

  for(const p of list){
    const md=path.join(PAIMON,'MemoryData',p.id);
    p._memSize=dirSize(md); p._memoir=fs.existsSync(path.join(PAIMON,'MemoirData',p.id+'.MEMOIR'));
    let sz=p._memSize;
    for(const sub of ['SessionData','AgentFileData','RuntimeCache','IdentityData'])
      try{ sz+=dirSize(path.join(PAIMON,sub,p.id)) }catch{}
    p._size=sz;
  }

  let devVer='';
  try{ const v=JSON.parse(fs.readFileSync(path.join(PAIMON,'version.json'),'utf8')); devVer=D+'  v'+v.paimon+' ('+v.channel+')'+R }catch{}

  const title='  '+BOLD+'Paimon Code'+R+D+' · '+list.length+' agent'+(list.length===1?'':'s')+R+devVer;
  console.log('\n'+title+'\n');

  const nw=Math.max(6,...list.map((p:any)=>vw(p.name)));
  const kw=Math.max(6,...list.map((p:any)=>vw(shortKind(p.kind||'coding-agent'))));
  const orgW=Math.max(vw(ZH?'组织':'ORG'),...list.map((p:any)=>vw(p.org||'/')));
  const idW=8, numW=String(list.length).length, hdr=' '.repeat(numW+3);
  const showStatus=filter!=='archived';

  const stStrs=list.map((p:any)=>{
    let tag='',time='';
    if(p._active){
      const rc=path.join(PAIMON,'RuntimeCache',p.id);
      try{
        if(fs.existsSync(path.join(PAIMON,'MemoryData',p.id,'paused'))||fs.existsSync(path.join(rc,'paused'))) tag='[P]';
        else if(fs.existsSync(path.join(rc,'main-resting'))) tag='[W]';
        else if(fs.existsSync(path.join(rc,'main-hibernate'))) tag='[H]';
        else tag='[A]';
      }catch{}
      const secs=Math.round((now-new Date(p.lastSeen).getTime())/1000);
      if(secs<5) time='刚刚'; else if(secs<60) time=secs+'秒';
      else{ const m=Math.floor(secs/60); if(m<60) time=m+'分钟'; else{ const h=Math.floor(m/60); if(h<24) time=h+'小时'; else time=Math.floor(h/24)+'天' } }
    }else{
      const et=p.lastEnded||p.lastSeen;
      if(!et) time=ZH?'从未启动':'never';
      else{ const s=Math.round((now-new Date(et).getTime())/1000);
        if(s<5) time='刚刚'; else if(s<60) time=s+'秒前'; else{ const m=Math.floor(s/60); if(m<60) time=m+'分钟前'; else{ const h=Math.floor(m/60); if(h<1440) time=h+'小时前'; else time=Math.floor(h/24)+'天前' } }
      }
    }
    return {tag,time};
  });
  const tw=Math.max(...stStrs.map((s:any)=>vw(s.time)));

  const r1Hdr=hdr+pad(ZH?'名称':'NAME',nw)+pad(ZH?'类型':'KIND',kw)+' '+pad(ZH?'组织':'ORG',orgW)+'  '+pad('ID',idW)+'  '+pad(ZH?'回忆录':'MEMOIR',6)+(showStatus?'  '+(ZH?'时间':'TIME'):'');
  const r1DataW=numW+3+nw+kw+1+orgW+2+idW+2+6+(showStatus?2+tw:0);

  console.log('  '+r1Hdr);
  console.log('  '+'\u2500'.repeat(r1DataW));

  let on=1, an=1;
  for(let i=0;i<list.length;i++){
    const p=list[i], org=p.org||'/', kd=shortKind(p.kind||'coding-agent');
    const s=stStrs[i], tag=showStatus&&s.tag?s.tag+' ':'', stime=pad(s.time,tw);
    const sc=p._active?G:'', sr=p._active?R:'';
    const num=p._active?G+String(an++).padStart(numW)+'. '+R:Y+String(on++).padStart(numW)+'. '+R;
    const kc={coding:M}[kd]||D;
    const memoir=pad(p._memoir?'\u2713':'\u2717',6);
    const sp=showStatus?'  '+sc+tag+stime+sr:'';
    console.log('  '+num+' '+pad(p.name,nw)+kc+pad(kd,kw)+R+' '+pad(org,orgW)+'  '+p.id+' '.repeat(Math.max(0,idW-vw(p.id)))+'  '+memoir+sp);
    if(process.stdout.isTTY&&(i+1)%10===0&&i+1<list.length){
      process.stdout.write(D+'  -- Enter 继续, q/Esc 退出 --'+R);
      const buf=Buffer.alloc(64); try{ fs.readSync(0,buf,0,64,0) }catch{}
      if(buf[0]===0x1b||buf.toString().trim().toLowerCase()==='q') process.exit(0);
      process.stdout.write('\r'+' '.repeat(50)+'\r');
    }
  }
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════
// ENTER AGENT
// ═══════════════════════════════════════════════════════════════════
function enterAgent(name: string, mode='') {
  const list=loadPlist();
  let entry: any;

  if(/^\d+$/.test(name)){
    const now=Date.now(), ps=psAux();
    const active=list.filter((p:any)=>!p.archived);
    computeAndSort(active,ps,now);
    const offline=active.filter((p:any)=>!p._active);
    entry=offline[parseInt(name)-1];
  }else{
    entry=list.find((p:any)=>p.name===name);
  }

  let id: string, pname: string, kind: string;
  if(entry){
    id=entry.id; pname=entry.name; kind=entry.kind||'coding-agent';
  }else{
    // Create new
    if(RESERVED_NAMES.has(name.toLowerCase())){ console.error(`  "${name}" is reserved, cannot be used as agent name.`); process.exit(1) }
    if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)){ console.error(`  invalid name "${name}": must start with a letter, only a-z A-Z 0-9 _ allowed.`); process.exit(1) }
    const exist=list.find((p:any)=>p.name===name);
    if(exist){ console.error(`${name} already exists`); process.exit(1) }
    id=randomBytes(4).toString('hex');
    const now=new Date().toISOString();
    list.push({id,name,kind:'coding-agent',deployment:'local',created:now,lastSeen:now,note:'',model:''});
    savePlist(list);
    pname=name; kind='coding-agent';
  }

  if(!confirm(`Enter ${pname}?`)) process.exit(0);

  // Update lastSeen
  const p=list.find((x:any)=>x.id===id);
  if(p){ p.lastSeen=new Date().toISOString(); savePlist(list) }

  // Setup dirs
  const dataDir=path.join(PAIMON,'MemoryData',id);
  const rtDir=path.join(PAIMON,'RuntimeCache',id);
  const sessDir=path.join(PAIMON,'SessionData',id);
  fs.mkdirSync(dataDir,{recursive:true}); fs.mkdirSync(rtDir,{recursive:true}); fs.mkdirSync(sessDir,{recursive:true});

  // Mode handling
  if(mode==='mc'){
    const tn=`mc-${id}`;
    try{ execSync(`tmux has-session -t ${tn} 2>/dev/null`); console.log(`Attaching to ${tn}`); execSync(`tmux attach -t ${tn}`,{stdio:'inherit'}); process.exit(0) }catch{ console.error(`${pname} metaconsciousness not running`); process.exit(0) }
  }
  if(mode==='hc'){
    const tn=`hc-${id}`;
    try{ execSync(`tmux has-session -t ${tn} 2>/dev/null`); console.log(`Attaching to ${tn}`); execSync(`tmux attach -t ${tn}`,{stdio:'inherit'}); process.exit(0) }catch{ console.error(`${pname} hippocampus not running`); process.exit(0) }
  }
  if(mode==='kill'){
    try{ execSync(`pkill -f "paimon:.*${pname}" 2>/dev/null`); console.log(`killed ${pname}`) }catch{}
    process.exit(0);
  }
  if(mode==='tmux'){
    const out=execSync('ps aux',{encoding:'utf8'});
    const line=out.split('\n').find((l: string)=>l.includes(`paimon:`)&&l.includes(pname));
    if(!line){ console.error(`${pname} not running`); process.exit(0) }
    console.log(line); process.exit(0);
  }

  // Mobile / Laptop
  if(mode==='mobile'||mode==='laptop'){
    const devCli=path.join(EXT,'god.cli','cli.ts');
    try{ execSync(`node ${devCli} ${mode} ${id} ${pname}`,{stdio:'inherit'}) }catch{}
    process.exit(0);
  }

  // Settings
  if(mode==='settings'){
    cmdSettings(); process.exit(0);
  }

  // Archive / Unarchive
  if(mode==='archive'||mode==='unarchive'){
    if(entry){ entry.archived=mode==='archive'; savePlist(list); console.log(`${pname} ${mode}d`) }
    process.exit(0);
  }

  // Main agent loop
  process.env.PAIMON_AGENT_NAME=pname;
  process.env.PAIMON_AGENT_ID=id;

  const pidFile=path.join(dataDir,'main.pid');
  if(fs.existsSync(pidFile)){
    const oldPid=parseInt(fs.readFileSync(pidFile,'utf8').trim());
    try{ process.kill(oldPid,0); console.error(`ERROR: ${pname} already running (PID ${oldPid})`); process.exit(1) }catch{}
  }
  fs.writeFileSync(pidFile,String(process.pid));

  const wakeFile=path.join(rtDir,'wake-restart');
  const extFlags=`-ne -e ${EXT}/index.ts`;

  let lastNonce='', woke='';
  try{ lastNonce=fs.readFileSync(wakeFile,'utf8').trim() }catch{}

  // Clear screen
  process.stdout.write('\x1b[2J\x1b[H');

  while(true){
    try{
      const args=[RUNTIME,...extFlags.split(' '),'--session-dir',sessDir];
      const { spawnSync } = require('child_process');
      spawnSync('node', args, {stdio:'inherit', env:{...process.env, PI_ALIVE_RESTART_LOOP:'1', PI_ALIVE_WOKE:woke}});
    }catch(e: any){
      console.error('paimon error:',e?.message||e);
    }

    let nonce='';
    try{ nonce=fs.readFileSync(wakeFile,'utf8').trim() }catch{}
    if(nonce&&nonce!==lastNonce){ lastNonce=nonce; woke='1'; continue }
    break;
  }

  try{ fs.unlinkSync(pidFile) }catch{}
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════
function cmdSettings() {
  process.stdout.write('\x1b[2J\x1b[H');
  let settings: any={};
  try{ settings=JSON.parse(fs.readFileSync(PAIMON_SETTINGS,'utf8')) }catch{}
  const save=()=>{ try{ fs.mkdirSync(path.dirname(PAIMON_SETTINGS),{recursive:true}); fs.writeFileSync(PAIMON_SETTINGS,JSON.stringify(settings,null,2)) }catch{} };

  const menu=[
    {key:'defaultKind',label:ZH?'默认类型':'Default Kind',opts:['coding-agent']},
    {key:'lang',label:ZH?'界面语言':'Language',opts:['zh','en']},
    {key:'developerMode',label:ZH?'开发者模式':'Developer Mode',toggle:true},
    {key:'blackboxEnabled',label:ZH?'黑盒模式':'Blackbox',toggle:true},
  ];

  let idx=0;
  const render=()=>{
    process.stdout.write('\x1b[2J\x1b[H');
    const lines=['  '+BOLD+'Paimon Code'+R+D+' · '+(ZH?'设置':'Settings')+R,''];
    for(let i=0;i<menu.length;i++){
      const m=menu[i];
      const pre=i===idx?G+'> '+R:'  ';
      let val='';
      if(m.toggle) val=settings[m.key]?(ZH?' \u2713 \u5f00':' \u2713 ON'):(ZH?' \u2717 \u5173':' \u2717 OFF');
      else val=' ['+(settings[m.key]||m.opts?.[0])+']';
      lines.push(pre+m.label+val);
    }
    lines.push('',D+'  \u2191\u2193 \u9009  Enter/\u2190\u2192 \u6539  q \u9000\u51fa'+R);
    console.log(lines.join('\n'));
  };
  render();

  const stdin=process.stdin;
  if(stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data',(key: Buffer)=>{
    const k=key.toString();
    if(k==='q'||k==='\x1b'||k==='\x03'){ process.stdout.write('\x1b[2J\x1b[H'); if(stdin.isTTY) stdin.setRawMode(false); process.exit(0) }
    if(k==='\x1b[A'){ idx=Math.max(0,idx-1); render() }
    else if(k==='\x1b[B'){ idx=Math.min(menu.length-1,idx+1); render() }
    else{
      const m=menu[idx];
      if(m.toggle){ settings[m.key]=!settings[m.key]; save(); render() }
      else{ const ci=(m.opts||[]).indexOf(settings[m.key]||''); settings[m.key]=m.opts![(ci+1)%m.opts!.length]; save(); render() }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// ORG
// ═══════════════════════════════════════════════════════════════════
function cmdOrg(name?: string, agent?: string) {
  const ofile=path.join(PAIMON,'AgentWorkDir','Organizational','orgs.json');
  let orgs: any[]=[];
  try{ orgs=JSON.parse(fs.readFileSync(ofile,'utf8')) }catch{}

  if(!name){ for(const o of orgs) console.log(`${o.name} (${o.id})\n  members: ${o.members.join(', ')}`); return }

  if(!agent){
    const id=Math.random().toString(16).slice(2,8);
    orgs.push({id,name,members:[],created:new Date().toISOString().slice(0,10)});
    fs.mkdirSync(path.dirname(ofile),{recursive:true}); fs.writeFileSync(ofile,JSON.stringify(orgs,null,2));
    console.log(`created org: ${name} (${id})`);
  }else{
    const o=orgs.find((x: any)=>x.id===name||x.name===name);
    if(!o){ console.error(`org ${name} not found`); return }
    if(!o.members.includes(agent)) o.members.push(agent);
    fs.mkdirSync(path.dirname(ofile),{recursive:true}); fs.writeFileSync(ofile,JSON.stringify(orgs,null,2));
    console.log(`${agent} joined ${o.name}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// ARCHIVE
// ═══════════════════════════════════════════════════════════════════
function cmdArchive(targets: string[], doArchive: boolean) {
  const list=loadPlist();
  const now=Date.now(), ps=psAux();
  computeAndSort(list.filter((p:any)=>!p.archived),ps,now);

  for(const t of targets){
    let p: any;
    if(/^\d+$/.test(t)){
      const active=list.filter((x:any)=>x._active);
      const offline=list.filter((x:any)=>!x._active);
      p=doArchive?offline[parseInt(t)-1]:active[parseInt(t)-1];
    }else{
      p=list.find((x: any)=>x.name===t||x.id===t);
    }
    if(!p){ console.log(`  ${t} not found`); continue }
    p.archived=doArchive;
    console.log(`  ${p.name} ${doArchive?'archived':'unarchived'}`);
  }
  savePlist(list);
}

// ═══════════════════════════════════════════════════════════════════
// VERSION
// ═══════════════════════════════════════════════════════════════════
function cmdVersion() {
  try {
    const v=JSON.parse(fs.readFileSync(path.join(PAIMON,'version.json'),'utf8'));
    console.log(`${v.paimon} (${v.channel})`);
  } catch {
    console.log('unknown');
  }
}

// ═══════════════════════════════════════════════════════════════════
// RENAME
// ═══════════════════════════════════════════════════════════════════
function cmdRename(oldName: string, newName: string) {
  if(!oldName||!newName){ console.error('  usage: paimon rename <name> <new-name>'); process.exit(1) }
  if(RESERVED_NAMES.has(newName.toLowerCase())){ console.error(`  "${newName}" is a reserved name.`); process.exit(1) }
  if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(newName)){ console.error(`  invalid name "${newName}": must start with a letter, only a-z A-Z 0-9 _ allowed.`); process.exit(1) }

  const list=loadPlist();
  const entry=list.find((p:any)=>p.name===oldName||p.id===oldName);
  if(!entry){ console.error(`  agent "${oldName}" not found.`); process.exit(1) }
  if(list.find((p:any)=>p.name===newName)){ console.error(`  name "${newName}" already taken.`); process.exit(1) }

  const prev=entry.name;
  entry.name=newName;
  savePlist(list);

  const idDir=path.join(PAIMON,'IdentityData',entry.id);
  const idFile=path.join(idDir,'identity.json');
  let idData: any={};
  try{ idData=JSON.parse(fs.readFileSync(idFile,'utf8')) }catch{}
  if(!Array.isArray(idData.renameHistory)) idData.renameHistory=[];
  idData.renameHistory.unshift({from:prev,to:newName,at:new Date().toISOString()});
  fs.mkdirSync(idDir,{recursive:true});
  fs.writeFileSync(idFile,JSON.stringify(idData,null,2));

  console.log(`  ${prev} → ${newName}`);
}

// ═══════════════════════════════════════════════════════════════════
// DOCTOR
// ═══════════════════════════════════════════════════════════════════
function cmdDoctor() {
  const B=BOLD, R_=R, G_=G, R2='\x1b[31m';
  console.log('\n  '+B+'Paimon Code'+R_+D+' · doctor'+R_+'\n');

  let passed=0, failed=0, skipped=0;
  const ok=(label:string,msg:string)=>{ console.log(`  ${G_}✓${R_} ${pad(label,20)} ${msg}`); passed++ };
  const fail=(label:string,msg:string)=>{ console.log(`  ${R2}✗${R_} ${pad(label,20)} ${msg}`); failed++ };
  const skip=(label:string,msg:string)=>{ console.log(`  ${D}⊘${R_} ${pad(label,20)} ${msg}`); skipped++ };

  const list=loadPlist();
  const NAME_RE=/^[a-zA-Z][a-zA-Z0-9_]*$/;

  // plist-identity: check for redundant fields in identity.json
  {
    let issues=0;
    for(const p of list){
      const idFile=path.join(PAIMON,'IdentityData',p.id,'identity.json');
      try{
        const id=JSON.parse(fs.readFileSync(idFile,'utf8'));
        for(const k of ['name','kind','archived','lastSeen','lastEnded','deployment','created']){
          if(k in id) issues++;
        }
      }catch{}
    }
    if(issues) fail('plist-identity',`${issues} redundant field(s) in identity.json`);
    else ok('plist-identity','一致');
  }

  // name-valid
  {
    const bad=list.filter((p:any)=>!NAME_RE.test(p.name));
    if(bad.length) fail('name-valid',`${bad.length} invalid: ${bad.map((p:any)=>p.name).join(', ')}`);
    else ok('name-valid',`${list.length} agents, 全部合规`);
  }

  // name-unique
  {
    const names=list.map((p:any)=>p.name);
    const dups=names.filter((n:string,i:number)=>names.indexOf(n)!==i);
    if(dups.length) fail('name-unique',`duplicates: ${[...new Set(dups)].join(', ')}`);
    else ok('name-unique','无重名');
  }

  // name-reserved
  {
    const bad=list.filter((p:any)=>RESERVED_NAMES.has(p.name.toLowerCase()));
    if(bad.length) fail('name-reserved',`${bad.length} reserved: ${bad.map((p:any)=>p.name).join(', ')}`);
    else ok('name-reserved','无保留字冲突');
  }

  // plist-orphan: plist entry but no MemoryData dir
  {
    const orphans=list.filter((p:any)=>!fs.existsSync(path.join(PAIMON,'MemoryData',p.id)));
    if(orphans.length) fail('plist-orphan',`${orphans.length} agents have no MemoryData dir`);
    else ok('plist-orphan','全部有对应目录');
  }

  // dir-orphan: MemoryData dir but no plist entry
  {
    const mdRoot=path.join(PAIMON,'MemoryData');
    const ids=new Set(list.map((p:any)=>p.id));
    let orphans=0;
    try{
      for(const d of fs.readdirSync(mdRoot,{withFileTypes:true})){
        if(d.isDirectory()&&!ids.has(d.name)&&d.name!=='.DS_Store') orphans++;
      }
    }catch{}
    if(orphans) fail('dir-orphan',`${orphans} dir(s) with no plist entry`);
    else ok('dir-orphan','无孤儿目录');
  }

  // dir-legacy: config/ still exists
  {
    const configDir=path.join(PAIMON,'config');
    if(fs.existsSync(configDir)){
      try{
        const files=fs.readdirSync(configDir).filter((f:string)=>f!=='.DS_Store');
        fail('dir-legacy',`config/ still exists (${files.length} files)`);
      }catch{ fail('dir-legacy','config/ still exists') }
    }else ok('dir-legacy','config/ 已迁移');
  }

  // dir-structure: key directories exist
  {
    const dirs=['MemoryData','RuntimeCache','SessionData','IdentityData','UserAccount','MemoirData','AgentWorkDir'];
    const missing=dirs.filter(d=>!fs.existsSync(path.join(PAIMON,d)));
    if(missing.length) fail('dir-structure',`missing: ${missing.join(', ')}`);
    else ok('dir-structure','全部存在');
  }

  // pid-stale
  {
    let stale=0;
    for(const p of list){
      const pidFile=path.join(PAIMON,'MemoryData',p.id,'main.pid');
      try{
        const pid=parseInt(fs.readFileSync(pidFile,'utf8').trim());
        try{ process.kill(pid,0) }catch{ stale++ }
      }catch{}
    }
    if(stale) fail('pid-stale',`${stale} stale PID file(s)`);
    else ok('pid-stale','无残留 PID');
  }

  // sync-binding
  {
    const bindFile=path.join(PAIMON,'UserAccount','binding.json');
    if(fs.existsSync(bindFile)){
      try{
        const b=JSON.parse(fs.readFileSync(bindFile,'utf8'));
        ok('sync-binding',`bound to ${b.username||b.github_id||'unknown'}`);
      }catch{ fail('sync-binding','binding.json 损坏') }
    }else skip('sync-binding','未登录，跳过同步检查');
  }

  // version
  {
    try{
      const v=JSON.parse(fs.readFileSync(path.join(PAIMON,'version.json'),'utf8'));
      ok('version',`${v.paimon} (${v.channel})`);
    }catch{ fail('version','version.json 不存在') }
  }

  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped\n`);
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT
// ═══════════════════════════════════════════════════════════════════

const USER_ACCOUNT = path.join(PAIMON, 'UserAccount');
const BINDING_FILE = path.join(USER_ACCOUNT, 'binding.json');

function getBinding(): any | null {
  try { return JSON.parse(fs.readFileSync(BINDING_FILE, 'utf8')); } catch { return null; }
}
function saveBinding(b: any) {
  fs.mkdirSync(USER_ACCOUNT, { recursive: true });
  fs.writeFileSync(BINDING_FILE, JSON.stringify(b, null, 2));
}
const SYNC_TUNNEL = 'http://localhost:13456';
function getEndpoint(): string {
  try {
    const svc = JSON.parse(fs.readFileSync(path.join(USER_ACCOUNT, 'services.json'), 'utf8'));
    if (svc['paimon-sync']?.endpoint) return svc['paimon-sync'].endpoint;
  } catch {}
  // SSH 隧道优先（绕过 ICP），探测是否可用
  try { execSync('curl -sf --connect-timeout 1 ' + SYNC_TUNNEL + '/health', { stdio: 'ignore' }); return SYNC_TUNNEL; } catch {}
  return SYNC_ENDPOINT_DEFAULT;
}

async function cmdLogin() {
  const existing = getBinding();
  if (existing?.token && existing?.githubLogin) {
    console.log(`  已登录: ${existing.githubLogin}`);
    console.log(`  如需切换账户，先 paimon logout`);
    return;
  }

  // 策略1: 检测 gh CLI token（最快路径，无需网络到 sync 服务器）
  let ghToken = '';
  try { ghToken = execSync('gh auth token 2>/dev/null', { encoding: 'utf8' }).trim(); } catch {}

  if (ghToken) {
    console.log('  检测到 gh CLI，正在验证...');
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'paimon-code' },
    });
    if (res.ok) {
      const gh = await res.json() as { id: number; login: string; avatar_url: string };
      const deviceId = existing?.deviceId || randomBytes(4).toString('hex');
      saveBinding({
        githubUserId: gh.id,
        githubLogin: gh.login,
        deviceId,
        boundAt: new Date().toISOString(),
        token: ghToken,
        authMethod: 'gh-cli',
      });
      console.log(`  ${G}✓${R} 登录成功: ${gh.login} (via gh CLI)`);
      return;
    }
    console.log('  gh token 验证失败，尝试 device flow...');
  }

  // 策略2: device flow（需要 sync 服务器在线）
  const endpoint = getEndpoint();
  console.log(`  正在连接 ${endpoint}...`);

  let startRes: Response;
  try {
    startRes = await fetch(`${endpoint}/auth/device-flow/start`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error(`  无法连接到同步服务器: ${e.code || e.message}`);
    console.error(`  请先安装 gh CLI 并运行 gh auth login，然后重试 paimon login`);
    process.exit(1);
  }
  if (!startRes.ok) { console.error(`  服务器错误: ${startRes.status}`); process.exit(1); }

  const startData = await startRes.json() as {
    device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number;
  };

  console.log('');
  console.log(`  请在浏览器中打开: ${BOLD}${startData.verification_uri}${R}`);
  console.log(`  输入验证码:       ${BOLD}${startData.user_code}${R}`);
  console.log('');
  console.log(`  等待授权中...`);

  const interval = (startData.interval || 5) * 1000;
  const deadline = Date.now() + (startData.expires_in || 900) * 1000;
  const deviceId = existing?.deviceId || randomBytes(4).toString('hex');

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));

    const pollRes = await fetch(`${endpoint}/auth/device-flow/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: startData.device_code }),
    });

    const pollData = await pollRes.json() as {
      token?: string; error?: string;
      user?: { githubId: number; login: string; avatarUrl: string };
    };

    if (pollData.token && pollData.user) {
      saveBinding({
        githubUserId: pollData.user.githubId,
        githubLogin: pollData.user.login,
        deviceId,
        boundAt: new Date().toISOString(),
        token: pollData.token,
      });
      console.log(`  ${G}✓${R} 登录成功: ${pollData.user.login}`);
      return;
    }

    if (pollData.error === 'authorization_pending' || pollData.error === 'slow_down') continue;
    if (pollData.error === 'expired_token') { console.error('  验证码已过期，请重新运行 paimon login'); process.exit(1); }
    if (pollData.error === 'access_denied') { console.error('  授权被拒绝'); process.exit(1); }
    if (pollData.error) { console.error(`  错误: ${pollData.error}`); process.exit(1); }
  }

  console.error('  超时，请重新运行 paimon login');
  process.exit(1);
}

function cmdLogout() {
  const b = getBinding();
  if (!b?.token) { console.log('  未登录'); return; }
  const login = b.githubLogin || 'unknown';
  b.token = '';
  saveBinding(b);
  console.log(`  ${G}✓${R} 已登出 (${login})，绑定关系保留`);
}

function cmdUnbind() {
  const b = getBinding();
  if (!b?.githubLogin && !b?.token) { console.log('  未绑定'); return; }
  const login = b.githubLogin || 'unknown';
  fs.writeFileSync(BINDING_FILE, '{}');
  console.log(`  ${G}✓${R} 已解绑 ${login}，同步数据已清除`);
}

function cmdWhoami() {
  const b = getBinding();
  if (!b?.githubLogin) {
    console.log('  未登录。运行 paimon login 绑定 GitHub 账户。');
    return;
  }
  console.log(`  ${BOLD}${b.githubLogin}${R}`);
  console.log(`  GitHub ID:  ${b.githubUserId}`);
  console.log(`  设备 ID:    ${b.deviceId}`);
  console.log(`  绑定时间:   ${b.boundAt ? new Date(b.boundAt).toLocaleString('zh-CN') : '未知'}`);
  const method = b.authMethod === 'gh-cli' ? ' (gh CLI)' : ' (device flow)';
  console.log(`  登录状态:   ${b.token ? G + '已登录' + method + R : Y + '已登出（token 已清除）' + R}`);
  console.log(`  同步服务:   ${getEndpoint()}`);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  const args=process.argv.slice(2);
  if(!args.length){ cmdList(); return }

  const first=args[0];

  // --version / --help: POSIX 惯例，唯二保留的 flag
  if(first==='--version'||first==='-V'){ cmdVersion(); return }
  if(first==='--help'){ cmdList('help'); return }

  const sub=SUBCOMMANDS[first];
  const rest=sub?args.slice(1):args;

  if(sub){
    const name=rest[0]||'';
    switch(sub){
      case 'version': cmdVersion(); return;
      case 'archived': cmdList('archived'); return;
      case 'settings': cmdSettings(); return;
      case 'help': cmdList('help'); return;
      case 'org': cmdOrg(name, rest[1]); return;
      case 'archive': case 'unarchive':
        if(!name){ console.error(`usage: paimon ${first} <name|#>`); process.exit(1) }
        cmdArchive(rest, sub==='archive'); return;
      case 'rename':
        cmdRename(name, rest[1]||''); return;
      case 'doctor': cmdDoctor(); return;
      case 'login': await cmdLogin(); return;
      case 'logout': cmdLogout(); return;
      case 'unbind': cmdUnbind(); return;
      case 'whoami': cmdWhoami(); return;
      case 'mc': case 'hc': case 'kill': case 'tmux': case 'mobile': case 'laptop':
        if(!name){ console.error(`usage: paimon ${first} <name>`); process.exit(1) }
        enterAgent(name, sub); return;
      case 'update': case 'uninstall':
        console.log(`  use: paimon ${sub} (handled by launcher)`); return;
      case 'sessions': case 'web':
        console.log(`  ${first}: not yet implemented`); return;
    }
  }

  const name=first;
  if(RESERVED_NAMES.has(name.toLowerCase())){
    console.error(`  "${name}" is a reserved name, cannot be used as agent name.`);
    process.exit(1);
  }
  if(!/^\d+$/.test(name) && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)){
    console.error(`  invalid name "${name}": must start with a letter, only a-z A-Z 0-9 _ allowed.`);
    process.exit(1);
  }

  enterAgent(name);
}

main();
