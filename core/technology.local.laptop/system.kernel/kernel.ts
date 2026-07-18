import { runtimeCacheDir } from "#paths";
// system.kernel/kernel.ts - 笔记本内核
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPaimonTool, resultContent } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";
import path from "node:path";
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { validateExecute } from "../../individual.bio.organs/hands.fileactions/fileactions.ts";
import { logerr } from "#paths";
// Excel 动态加载——改 excel.ts 不用重启
let _excelMod: any = null;
let _devMode = false;
async function loadApp(name: string) {
  const key = `_mod_${name}` as keyof typeof globalThis;
  const cache = (globalThis as any).__laptopApps || ((globalThis as any).__laptopApps = {});
  if (_devMode) {
    // ESM cache bust: add timestamp as query param PLUS delete from Node cache
    const modPath = `../apps/${name}/${name}.ts`;
    cache[name] = await import(modPath + `?t=${Date.now()}`);
  } else if (!cache[name]) cache[name] = await import(`../apps/${name}/${name}.ts`);
  return cache[name];
}
async function loadExcel() { return loadApp("excel"); }
async function loadFinder() { return loadApp("finder"); }
async function loadVSCode() { return loadApp("vscode"); }
async function loadTerminal() { return loadApp("terminal"); }

// ── 常量 ──
const W = 74;
const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
const PS = 20;
let _widCounter = 0;
function genWID(): string { return "W" + (++_widCounter); }
function eid(i: number): string { if (i < 36 * 36) return CHARS[Math.floor(i / 36)] + CHARS[i % 36]; return "xx"; }
function lid(p: string, n: number): string { return (p + n).padEnd(3); }

// ── 窗口状态 ──
interface WS { wid: string; type: string; state: any; min: boolean; full: boolean; z: number; }
interface Mac { wins: WS[]; maxZ: number; }
let mac: Mac = { wins: [], maxZ: 0 };
let _sf = "", _ws = "";
function save() { if (_sf) try { writeFileSync(_sf, JSON.stringify({ ...mac, devMode: _devMode })); } catch {} }
function focusWin(wid: string) { const w = mac.wins.find((w: WS) => w.wid === wid); if (w) { w.z = ++mac.maxZ; w.min = false; } }

// ── 显示工具 ──
function cw(c: string): number { const cp = c.codePointAt(0) || 0; if (cp >= 0x1F300 && cp <= 0x1FAFF) return 2; if (cp >= 0x2600 && cp <= 0x27BF) return 2; if ((cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0x20000 && cp <= 0x2FFFF)) return 2; if (cp >= 0xFF01 && cp <= 0xFF60) return 2; return 1; }
function dw(s: string): number { let w = 0; for (const c of [...s]) w += cw(c); return w; }
function padR(s: string, w: number): string { const d = dw(s); return d >= w ? s : s + " ".repeat(w - d); }
function clip(s: string, w: number): string { let r = "", wi = 0; for (const c of [...s]) { const c2 = cw(c); if (wi + c2 > w) return r + "\u2026"; r += c; wi += c2; } return r; }
function wrap(s: string, w: number): string[] { if (w <= 0) return []; const l: string[] = []; let c = "", c2 = 0; for (const ch of [...s]) { const cc = cw(ch); if (c2 + cc > w) { l.push(c); c = ch; c2 = cc; } else { c += ch; c2 += cc; } } if (c) l.push(c); return l.length > 0 ? l : [""]; }
function top(t: string): string { const x = clip(t, W - 6); return "\u250c\u2500\u2500 " + x + " " + "\u2500".repeat(Math.max(0, W - 5 - dw(x))) + "\u2510"; }
function sep(): string { return "\u251c" + "\u2500".repeat(W - 2) + "\u2524"; }
function bot(): string { return "\u2514" + "\u2500".repeat(W - 2) + "\u2518"; }
function frow(t: string, i = 0): string { const m = W - 2 - i; return "\u2502" + " ".repeat(i) + " " + padR(clip(t, m), m) + " \u2502"; }
function blank() { return frow(""); }
function frows(t: string, i: number, ci?: number): string[] {
  const c2 = ci ?? i; const m = W - 2 - i; const cm = W - 2 - c2; if (m <= 0) return [];
  if (dw(t) <= m) return [frow(t, i)];
  const parts = wrap(t, cm); const lines = [frow(parts[0], i)];
  for (let j = 1; j < parts.length; j++) lines.push(frow(parts[j], c2));
  return lines;
}

// ── Finder ──
function fmtsz(b: number): string { if(b<1024)return b+"B";if(b<1048576)return (b/1024).toFixed(1)+"K";return (b/1048576).toFixed(1)+"M"; }
function fls(dir: string) { const ds: {name:string,sz:number}[]=[],fs2:{name:string,sz:number}[]=[]; try{for(const e of readdirSync(dir)){try{const s=statSync(path.join(dir,e));(s.isDirectory()?ds:fs2).push({name:e,sz:s.size});}catch {}}}catch {} ds.sort((a,b)=>a.name.localeCompare(b.name));fs2.sort((a,b)=>a.name.localeCompare(b.name));return{ds,fs:fs2};}
function fRender(st: any): string {
  const { ds, fs: files } = fls(st.path||"/"); let s = frow(st.path||"/",1)+"\n"+sep()+"\n"; let idx=0;
  for(const d of ds){const id=eid(idx++);s+=frow((d.name===st.sel?"\u25b6":" ")+" "+id+" \u{1F4C2} "+d.name,1)+"\n";}
  for(const f of files){const id=eid(idx++);s+=frow((f.name===st.sel?"\u25b6":" ")+" "+id+" \u{1F4C4} "+f.name+"  ("+fmtsz(f.sz)+")",1)+"\n";}
  s+=frow("  up [..]  list["+(st.mode==="column"?"\u5206\u680f":"\u5217\u8868")+"]",1)+"\n"+sep()+"\n"+frow((ds.length+files.length)+" items",1);return s;
}
function fClick(st: any, id: string): any {
  if(id==="up"){st={...st,path:path.resolve(path.dirname(st.path)),sel:null};return st;}
  if(id==="mode"){st={...st,mode:st.mode==="column"?"list":"column"};return st;}
  const{ds,fs:files}=fls(st.path);const all=[...ds,...files];const idx=all.findIndex((_:any,i:number)=>eid(i)===id);
  if(idx<0)return st;const nm=all[idx].name;const fp=path.join(st.path,nm);
  try{if(statSync(fp).isDirectory()){if(st.mode==="column"){const cols=st.cols||[{path:st.path,sel:st.sel||(ds[0]?ds[0].name:null)}];const i2=cols.findIndex((c:any)=>c.path===fp);if(i2>=0){st={...st,path:fp,cols:cols.slice(0,i2+1),sel:null};}else{st={...st,path:fp,cols:[...cols,{path:fp,sel:null}],sel:null};}}else{st={...st,path:fp,sel:null};}return st;}}catch {}
  if(st.mode==="column"){const cols=st.cols||[{path:st.path,sel:st.sel||(ds[0]?ds[0].name:null)}];st={...st,cols:[...cols.slice(0,-1),{path:st.path,sel:nm}]};}
  st={...st,sel:nm};return st;
}
function fPress(st: any, k: string): any {
  const { ds, fs: files } = fls(st.path); const all = [...ds, ...files];
  if (k === "Up" && st.sel) { const i = all.findIndex((a:any)=>a.name===st.sel); if (i > 0) st = { ...st, sel: all[i - 1].name }; }
  else if (k === "Down") { if (!st.sel && all.length > 0) st = { ...st, sel: all[0].name }; else { const i = all.findIndex((a:any)=>a.name===st.sel); if (i >= 0 && i < all.length - 1) st = { ...st, sel: all[i + 1].name }; } }
  return st;
}
// ── 分栏视图 ──
function fRenderColumn(st: any): string {
  const cols = st.cols || [{path: st.path, sel: st.sel}]; const CW = 28;
  let s = frow("columns ["+(st.mode||"column")+"]",1)+"\n"+sep()+"\n";
  const grid: string[][] = []; let maxH = 0;
  for (const col of cols) {
    const { ds, fs: files } = fls(col.path); const lines: string[] = [];
    lines.push(clip(path.basename(col.path)||col.path, CW-3));
    lines.push("\u2500".repeat(CW-3));
    let idx = 0;
    for (const d of ds) { const id = eid(idx++); const mk = d.name===col.sel?"\u25b6":" "; lines.push(mk+id+" "+clip(d.name, CW-7)+"/"); }
    for (const f of files) { const id = eid(idx++); const mk = f.name===col.sel?"\u25b6":" "; lines.push(mk+id+" "+clip(f.name, CW-7)); }
    while (lines.length < 20) lines.push("");
    grid.push(lines); if (lines.length > maxH) maxH = lines.length;
  }
  for (let r = 0; r < Math.min(maxH, 18); r++) {
    let line = ""; for (let c = 0; c < grid.length; c++) { line += (grid[c][r]||"").padEnd(CW); }
    s += frow(line, 1) + "\n";
  }
  s += sep() + "\n" + frow(cols.length + " columns  press " + (st.wid||"W") + ":Up/Down  click dir to drill",1);
  return s;
}
function fType(st: any, t: string): any {
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1);
  st = { ...st, filter: t || null }; return st;
}
function fRenderFiltered(st: any): string {
  const { ds, fs: files } = fls(st.path); const q = (st.filter || "").toLowerCase();
  const d2 = q ? ds.filter((d:any) => d.name.toLowerCase().includes(q)) : ds;
  const f2 = q ? files.filter((f:any) => f.name.toLowerCase().includes(q)) : files;
  let s = frow(st.path + (q ? "  filter: \"" + st.filter + "\"" : ""), 1) + "\n" + sep() + "\n"; let idx = 0;
  for (const d of d2) { const id = eid(idx++); s += frow((d.name === st.sel ? "\u25b6" : " ") + " " + id + " \u{1F4C2} " + d.name, 1) + "\n"; }
  for (const f of f2) { const id = eid(idx++); s += frow((f.name === st.sel ? "\u25b6" : " ") + " " + id + " \u{1F4C4} " + f.name + "  (" + fmtsz(f.sz) + ")", 1) + "\n"; }
  s += frow("  up [..]", 1) + "\n" + sep() + "\n" + frow((d2.length + f2.length) + " / " + (ds.length + files.length) + " items", 1); return s;
}

// ── VSCode ──
function vTree(dir: string): string[] {
  const r: string[] = [];
  try {
    const es = readdirSync(dir).filter((e: string) => !e.startsWith(".") && !e.includes("node_modules"));
    const ds = es.filter((e: string) => { try { return statSync(path.join(dir, e)).isDirectory(); } catch { return false; } }).sort();
    const fs2 = es.filter((e: string) => !ds.includes(e)).sort();
    for (let i = 0; i < ds.length; i++) {
      const last = i === ds.length - 1 && fs2.length === 0;
      r.push((last ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ") + "\u{1F4C1} " + ds[i] + "/");
      r.push(...vTree(path.join(dir, ds[i])));
    }
    for (let i = 0; i < fs2.length; i++) {
      const last = i === fs2.length - 1;
      const ic = [".ts", ".js", ".py"].includes(path.extname(fs2[i])) ? "\u{1F4DD}" : "\u{1F4C4}";
      r.push((last ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ") + ic + " " + fs2[i]);
    }
  } catch {}
  return r;
}

function vWelcome(st: any): string {
  let s = frow("Welcome - type filename to open/create") + "\n" + sep() + "\n";
  const t = vTree(st.ws || _ws).slice(0, 12);
  for (let i = 0; i < t.length; i++) s += frow("  " + lid("f", i) + " " + t[i], 1) + "\n";
  for (let i = t.length; i < 12; i++) s += blank() + "\n";
  s += sep() + "\n" + frow("click f0-f11 | type name to open") + "\n" + bot(); return s;
}

function vEditor(st: any): string {
  const lines = (st.content || "").split("\n"); const maxW = W - 8;
  const vis: { sl: number; t: string }[] = [];
  for (let ln = st.page * PS; ln < lines.length && vis.length < PS; ln++) {
    const l = lines[ln];
    if (dw(l) <= maxW) vis.push({ sl: ln, t: l });
    else for (const wl of wrap(l, maxW)) { if (vis.length >= PS) break; vis.push({ sl: ln, t: wl }); }
  }
  const total = lines.length; const aw = Math.max(3, String(total || 1).length);
  let s = top((st.file ? path.basename(st.file) : "") + (st.dirty ? " *" : "")) + "\n";
  for (let i = 0; i < PS; i++) {
    const an = st.page * PS + i + 1; const as = String(an).padStart(aw); const rid = ("L" + (i + 1)).padEnd(3);
    if (i >= vis.length) { s += frow("  " + rid + " \u2502 " + as + " \u2502", 1) + "\n"; continue; }
    const v = vis[i]; const mk = v.sl === st.cursor ? "\u2588" : " ";
    s += frow(mk + " " + rid + " \u2502 " + as + " \u2502 " + v.t, 1) + "\n";
  }
  const pages = Math.ceil(total / PS) || 1;
  s += sep() + "\n" + frow("Pg " + (st.page + 1) + "/" + pages + "  Ln " + (st.cursor + 1) + "  save[\u4fdd\u5b58] run[\u8fd0\u884c] closefile[\u5173\u95ed] newfile[\u65b0\u5efa]") + "\n" + bot();
  if (st.output) { s += "\n" + top("output") + "\n"; for (const l of (st.output || "").split("\n").slice(0, 8)) for (const wl of frows(l, 1)) s += wl + "\n"; s += bot(); }
  return s;
}

function vClick(st: any, id: string): any {
  if (id === "save") {
    if (st.file && st.dirty) { writeFileSync(st.file, st.content, "utf8"); st = { ...st, dirty: false, output: "Saved." }; }
    else if (st.file) st = { ...st, output: "No changes." };
    return st;
  }
  if (id === "run") {
    if (!st.file) return st;
    if (st.dirty) { writeFileSync(st.file, st.content, "utf8"); st = { ...st, dirty: false }; } else if (st.file && existsSync(st.file)) { st = { ...st, content: readFileSync(st.file, "utf8") }; }
    const ext = path.extname(st.file); let cmd = "";
    if (ext === ".ts") cmd = "npx tsx " + JSON.stringify(st.file);
    else if (ext === ".js") cmd = "node " + JSON.stringify(st.file);
    else if (ext === ".py") cmd = "python3 " + JSON.stringify(st.file);
    if (cmd) {
      try {
        const r = execSync(cmd, { cwd: path.dirname(st.file), timeout: 15000, encoding: "utf8", maxBuffer: 10000 });
        st = { ...st, output: r.slice(0, 10000) || "(no output)" };
      } catch (e: any) {
        const out = (e.stdout || "") + (e.stderr || ""); st = { ...st, output: out.slice(0, 10000) || "Error" };
      }
    }
    return st;
  }
  if (id === "closefile") {
    if (st.dirty) { st = { ...st, output: "Unsaved! Save first." }; return st; }
    st = { ws: st.ws || _ws, file: null, content: "", cursor: 0, col: 0, page: 0, dirty: false, output: "" }; return st;
  }
  if (id === "newfile") {
    let n = 1; while (existsSync(path.join(st.ws || _ws, "untitled" + (n > 1 ? n : "")))) n++;
    const nm = "untitled" + (n > 1 ? n : ""); const fp = path.join(st.ws || _ws, nm);
    writeFileSync(fp, ""); st = { ...st, file: fp, content: "", cursor: 0, col: 0, page: 0, dirty: false, output: "Created: " + nm };
    return st;
  }
  const ln = parseInt(id.slice(1));
  if (id.startsWith("L") && ln >= 1 && ln <= PS) { st = { ...st, cursor: st.page * PS + ln - 1, col: 0 }; return st; }
  if (id.startsWith("f")) {
    const t = vTree(st.ws || _ws).slice(0, 12); const idx = parseInt(id.slice(1));
    if (idx >= 0 && idx < t.length) {
      const nm = t[idx].replace(/^[^a-zA-Z0-9_.]+/, "").trim(); const fp = path.join(st.ws || _ws, nm);
      if (existsSync(fp) && !statSync(fp).isDirectory()) { st = { ...st, file: fp, content: readFileSync(fp, "utf8"), cursor: 0, col: 0, page: 0, dirty: false, output: "Opened: " + nm }; }
    }
    return st;
  }
  return st;
}

function vPress(st: any, k: string): any {
  const lines = (st.content || "").split("\n");
  if (k === "PgDn") { const nc = Math.min(st.page + 1, Math.max(0, Math.floor((lines.length - 1) / PS))); st = { ...st, page: nc, cursor: Math.min(nc * PS, lines.length - 1) }; }
  else if (k === "PgUp") { const nc = Math.max(0, st.page - 1); st = { ...st, page: nc, cursor: Math.max(0, nc * PS) }; }
  else if (k === "Up") { const nc = Math.max(0, st.cursor - 1); st = { ...st, cursor: nc }; if (nc < st.page * PS) st = { ...st, page: Math.max(0, st.page - 1) }; }
  else if (k === "Down") { const nc = Math.min(lines.length - 1, st.cursor + 1); st = { ...st, cursor: nc }; if (nc >= (st.page + 1) * PS) st = { ...st, page: st.page + 1 }; }
  else if (k === "Backspace") {
    const curLine = lines[st.cursor] || "";
    if (st.col > 0) { lines[st.cursor] = curLine.slice(0, st.col - 1) + curLine.slice(st.col); st = { ...st, content: lines.join("\n"), dirty: true, col: st.col - 1 }; }
    else if (st.cursor > 0) { const pl = (lines[st.cursor - 1] || "").length; lines[st.cursor - 1] += curLine; lines.splice(st.cursor, 1); st = { ...st, content: lines.join("\n"), dirty: true, cursor: st.cursor - 1, col: pl }; }
  }
  return st;
}

function vType(st: any, t: string): any {
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1);
  t = t.replace(/\\n/g, "\n");
  if (!st.file) {
    const fp = t.startsWith("/") ? t : path.join(st.ws || _ws, t);
    if (!existsSync(fp)) { mkdirSync(path.dirname(fp), { recursive: true }); writeFileSync(fp, ""); st = { ...st, file: fp, content: "", cursor: 0, col: 0, page: 0, dirty: false, output: "Created: " + t }; return st; }
    st = { ...st, file: fp, content: readFileSync(fp, "utf8"), cursor: 0, col: 0, page: 0, dirty: false, output: "Opened: " + t }; return st;
  }
  const lines = (st.content || "").split("\n"); const parts = t.split("\n");
  const before = lines[st.cursor].slice(0, st.col); const after = lines[st.cursor].slice(st.col);
  lines[st.cursor] = before + parts[0];
  for (let i = 1; i < parts.length; i++) lines.splice(st.cursor + i, 0, parts[i]);
  lines[st.cursor + parts.length - 1] += after;
  st = { ...st, content: lines.join("\n"), dirty: true, cursor: st.cursor + parts.length - 1, col: parts.length === 1 ? st.col + parts[0].length : parts[parts.length - 1].length + after.length };
  return st;
}

// ── Settings ──
function sRender(st: any): string {
  let s = ""; s += frow("Laptop Developer Mode", 1) + "\n" + sep() + "\n";
  s += frow("", 1) + "\n";
  s += frow("  Developer Mode: " + (st.devMode ? "[\u2714 ON]" : "[\u2718 OFF]  toggle_dev[\u5f00\u542f]"), 1) + "\n";
  s += frow("", 1) + "\n";
  s += frow("  ON  = \u6539 app \u4ee3\u7801\u7acb\u523b\u751f\u6548\uff0c\u65e0\u9700\u91cd\u542f", 1) + "\n";
  s += frow("  OFF = \u542f\u52a8\u65f6\u52a0\u8f7d\uff0c\u66f4\u5feb(\u751f\u4ea7\u73af\u5883)", 1) + "\n";
  s += frow("", 1) + "\n" + sep() + "\n";
  s += frow("  \u2605 \u4e0d\u5f71\u54cd paimon \u5f00\u53d1\u8005\u6a21\u5f0f\uff0c\u72ec\u7acb flag", 1) + "\n" + bot();
  return s;
}
function sClick(st: any, id: string): any {
  if (id === "toggle_dev") { const dm = !st.devMode; _devMode = dm; st = { ...st, devMode: dm, output: dm ? "Developer Mode: ON" : "Developer Mode: OFF" }; save(); return st; }
  return st;
}

// ── Terminal ──
function tRender(st: any): string {
  const ol = (st.output || "").split("\n"); const recent = ol.slice(-18);
  let s = ""; let n = 0;
  for (let i = 0; i < recent.length && n < 18; i++) { const wls = frows(recent[i], 1, 3); for (const wl of wls) { if (n >= 18) break; s += wl + "\n"; n++; } }
  for (let i = n; i < 18; i++) s += blank() + "\n";
  if (!st.running && st.input) { s += sep() + "\n"; for (const wl of frows("$ " + st.input + "\u2588", 1, 2)) s += wl + "\n"; s += bot(); }
  else if (st.running) s += sep() + "\n" + frow("running...") + "\n" + bot();
  else s += bot();
  return s;
}

// ── 屏幕渲染 ──
async function render(): Promise<string> {
  const now = new Date(); const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  let s = "  Laptop Desktop" + (" ".repeat(Math.max(0, W - 26 - dw(time)))) + time + "\n\n";
  const wins = [...mac.wins].sort((a, b) => a.z - b.z);
  const fw = wins.find(w => w.full); const vis = fw ? [fw] : wins.filter(w => !w.min);
  for (const w of vis) {
    const st = w.state; const title = w.wid + ":" + w.type;
    let content = "";
    if (w.type === "Finder") {
      const fst = st; fst.wid = w.wid;
      if (_devMode) { const finder = await loadFinder(); content = fst.mode === "column" ? finder.fRenderColumn(fst, frow, sep, clip) : (st.filter ? finder.fRenderFiltered(st, frow, sep, clip) : finder.fRender(st, frow, sep, clip)); }
      else content = fst.mode === "column" ? fRenderColumn(fst) : (st.filter ? fRenderFiltered(st) : fRender(st));
    }
    else if (w.type === "Terminal") {
      if (_devMode) { const term = await loadTerminal(); content = term.tRender(st, frow, sep, bot, frows, blank); }
      else content = tRender(st);
    }
    else if (w.type === "VSCode") {
      if (_devMode) { const vscode = await loadVSCode(); content = st.file ? vscode.vEditor(st, W, frow, sep, bot, top, dw, wrap, frows) : vscode.vWelcome(st, _ws, frow, sep, bot, blank); }
      else content = st.file ? vEditor(st) : vWelcome(st);
    }
    else if (w.type === "Excel") { const excel = await loadExcel(); content = excel.xRender(st, W, frow, () => sep(), () => bot()); }
    else if (w.type === "Settings") content = sRender(st);
    s += "\u250c " + title + "     close[\u5173] min[\u5c0f] full[\u5168]\n";
    for (const l of content.split("\n")) s += l + "\n";
    const h = w.type === "Finder" ? "press " + w.wid + ":Up " + w.wid + ":Down" : w.type === "Terminal" ? "type " + w.wid + ":\"cmd\" Enter" : w.type === "Excel" ? "press " + w.wid + ":Up Down Left Right" : w.type === "Settings" ? "click " + w.wid + ":toggle_dev" : "press " + w.wid + ":PgDn PgUp Up Down";
    s += "\u2514 " + h + "\n\n";
  }
  if (mac.wins.length === 0) s += "\n";
  let dock = "窗口:";
  if (mac.wins.length > 0) { for (const w of mac.wins) dock += " " + w.wid + ":" + w.type + (w.min ? " \u25b8" : ""); dock += "  "; }
  dock += "  +Settings +Terminal +Finder +VSCode +Excel";
  s += "\n" + dock + "\n";
  return s;
}

// ── 路由 ──
async function route(input: string): Promise<string> {
  const t = input.trim(); if (!t) return await render();
  const m = t.match(/^(\w+)\s+(\w+):([\s\S]+)$/); if (!m) return await render();
  const [, op, wid, raw] = m; let target = raw;

  if (wid === "Dock") {
    if (op === "click" && target === "+Finder") { const id = genWID(); mac.wins.push({ wid: id, type: "Finder", state: { path: _ws, sel: null }, min: false, full: false, z: ++mac.maxZ }); save(); return await render(); }
    if (op === "click" && target === "+VSCode") { const id = genWID(); mac.wins.push({ wid: id, type: "VSCode", state: { ws: _ws, file: null, content: "", cursor: 0, col: 0, page: 0, dirty: false, output: "" }, min: false, full: false, z: ++mac.maxZ }); save(); return await render(); }
    if (op === "click" && target === "+Terminal") { const id = genWID(); mac.wins.push({ wid: id, type: "Terminal", state: { cwd: _ws, input: "", output: "", running: false }, min: false, full: false, z: ++mac.maxZ }); save(); return await render(); }
    if (op === "click" && target === "+Excel") { const excel = await loadExcel(); const id = genWID(); mac.wins.push({ wid: id, type: "Excel", state: excel.xInitState(_ws), min: false, full: false, z: ++mac.maxZ }); save(); return await render(); }
    if (op === "click" && target === "+Settings") { const id = genWID(); mac.wins.push({ wid: id, type: "Settings", state: { devMode: _devMode }, min: false, full: false, z: ++mac.maxZ }); save(); return await render(); }
    const dw = mac.wins.find(w => w.wid === target); if (dw && op === "click") { focusWin(target); save(); return await render(); }
    return await render();
  }

  const wi = mac.wins.find(w => w.wid === wid); if (!wi) return await render();
  if (op === "click") { if (target === "close") { mac.wins = mac.wins.filter(w => w.wid !== wid); save(); return await render(); } if (target === "min") { wi.min = !wi.min; save(); return await render(); } if (target === "full") { wi.full = !wi.full; save(); return await render(); } }
  focusWin(wid);

  if (wi.type === "Finder") {
    if (_devMode) { const finder = await loadFinder(); if (op === "click") wi.state = finder.fClick(wi.state, target); else if (op === "press") wi.state = finder.fPress(wi.state, target); else if (op === "type") wi.state = finder.fType(wi.state, target); }
    else { if (op === "click") wi.state = fClick(wi.state, target); else if (op === "press") wi.state = fPress(wi.state, target); else if (op === "type") wi.state = fType(wi.state, target); }
    // Finder open-with: generic dispatch via xOpenCreate hook (no kernel change for new apps)
    if (wi.state._openWith && wi.state._openPath) {
      const fp = wi.state._openPath;
      const appName = wi.state._openWith.toLowerCase();
      if (existsSync(fp)) {
        try {
          const app = await loadApp(appName);
          if (app && typeof app.xOpenCreate === "function") {
            const win = app.xOpenCreate(fp, _ws);
            if (win) {
              const id2 = genWID();
              mac.wins.push({ wid: id2, type: win.type, state: win.state, min: win.min, full: win.full, z: ++mac.maxZ });
            }
          }
        } catch {} // unknown app → silently skip
      } else {
        wi.state.output = "File not found: " + path.basename(fp);
      }
      wi.state._openWith = undefined; wi.state._openPath = undefined;
    }
  }
  else if (wi.type === "VSCode") {
    if (_devMode) { const vscode = await loadVSCode(); if (op === "click") wi.state = vscode.vClick(wi.state, target, _ws); else if (op === "press") wi.state = vscode.vPress(wi.state, target); else if (op === "type") wi.state = vscode.vType(wi.state, target, _ws); }
    else { if (op === "click") wi.state = vClick(wi.state, target); else if (op === "press") wi.state = vPress(wi.state, target); else if (op === "type") wi.state = vType(wi.state, target); }
  }
  else if (wi.type === "Excel") { const excel = await loadExcel(); if (op === "click") wi.state = excel.xClick(wi.state, target); else if (op === "press") wi.state = excel.xPress(wi.state, target); else if (op === "type") wi.state = excel.xType(wi.state, target); }
  else if (wi.type === "Settings") { if (op === "click") wi.state = sClick(wi.state, target); }
  else if (wi.type === "Terminal") {
    if (op === "type") { let t = target; if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1); wi.state.input = (wi.state.input || "") + t; }
    else if (op === "press") {
      if (target === "Enter" && wi.state.input) { wi.state.output = (wi.state.output || "") + "$ " + wi.state.input + "\n"; const check = validateExecute(wi.state.input); if (check.blocked) { wi.state.output += check.message || "命令被拦截"; } else { try { const r = execSync(wi.state.input, { cwd: wi.state.cwd || _ws, timeout: 15000, encoding: "utf8", maxBuffer: 10000 }); wi.state.output += r; } catch (e: any) { wi.state.output += (e.stdout || "") + (e.stderr || "") || "Error"; } } wi.state.input = ""; }
      else if (target === "Backspace") { wi.state.input = (wi.state.input || "").slice(0, -1); }
    }
  }
  save(); return await render();
}

async function scr() { const s = await render(); if (_sf) try { const f = _sf.replace("-state.json", "-screen.txt"); writeFileSync(f, s); } catch {} return s; }

// ── 入口 ──
export default function (pi: ExtensionAPI) {
  registerPaimonTool({
    name: "laptop",
    label: "Laptop",
    messageDescription: "Mac desktop with Finder, VSCode, Terminal, Excel",
    promptSnippet: "Use laptop to open desktop apps: click WID:ID, press WID:KEY, type WID:\"text\" | click Dock:+Settings +Excel +Finder +VSCode +Terminal",
    parameters: { type: "object" as any, properties: { input: { type: "string", messageDescription: "click WID:ID | press WID:KEY | type WID:\"text\"" } } },
    renderCall(args: any, theme: any) {
      return renderToolCall.command(theme, "Laptop", args?.input);
    },
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      return renderMessage.output(theme, ctx, resultContent(result));
    },
    async execute(_id: string, args: any) {
      const input = String(args?.input ?? "").trim();
      if (input) await route(input);
      return { content: [{ type: "text", text: await scr() }], details: {} };
    },
  });

  pi.on("session_start", async (_e, ctx) => {
    const sf = (ctx as any).sessionManager?.getSessionFile?.();
    if (!sf) return;
    const id = sf.match(/[a-f0-9]{8}/)?.[0] || "x";
    _sf = path.join(runtimeCacheDir(id), "laptop-state.json");
    _ws = path.join(path.dirname(sf), "laptop-workspace");
    try { mkdirSync(_ws, { recursive: true }); } catch {}
    try { const d = JSON.parse(readFileSync(_sf, "utf8")); mac = { wins: d.wins || [], maxZ: d.maxZ || 0 }; _devMode = d.devMode || false; _widCounter = Math.max(0, ...(d.wins||[]).map((w:any) => parseInt((w.wid||"W0").slice(1))||0)); } catch {}
    scr();
  });
}
