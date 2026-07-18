// apps/vscode/vscode.ts - Code editor for laptop
import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { logerr } from "#paths";

const PS = 20;

type FrowFn = (t: string, i?: number) => string;
type VoidFn = () => string;

export function vInitState(ws: string) {
  return { ws, file: null as string|null, content: "", cursor: 0, col: 0, page: 0, dirty: false, output: "" };
}

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

export function vWelcome(st: any, ws: string, frow: FrowFn, sep: VoidFn, bot: VoidFn, blank: ()=>string): string {
  let s = frow("Welcome - type filename to open/create") + "\n" + sep() + "\n";
  const t = vTree(st.ws || ws).slice(0, 12);
  for (let i = 0; i < t.length; i++) s += frow("  f" + i + " " + t[i], 1) + "\n";
  for (let i = t.length; i < 12; i++) s += blank() + "\n";
  s += sep() + "\n" + frow("click f0-f11 | type name to open") + "\n" + bot(); return s;
}

export function vEditor(st: any, W: number, frow: FrowFn, sep: VoidFn, bot: VoidFn, topFn: (t:string)=>string, dwFn: (s:string)=>number, wrapFn: (s:string,w:number)=>string[], frowsFn: (t:string,i:number,ci?:number)=>string[]): string {
  const lines = (st.content || "").split("\n"); const maxW = W - 8;
  const vis: { sl: number; t: string }[] = [];
  for (let ln = st.page * PS; ln < lines.length && vis.length < PS; ln++) {
    const l = lines[ln];
    if (dwFn(l) <= maxW) vis.push({ sl: ln, t: l });
    else for (const wl of wrapFn(l, maxW)) { if (vis.length >= PS) break; vis.push({ sl: ln, t: wl }); }
  }
  const total = lines.length; const aw = Math.max(3, String(total || 1).length);
  let s = topFn((st.file ? path.basename(st.file) : "") + (st.dirty ? " *" : "")) + "\n";
  for (let i = 0; i < PS; i++) {
    const an = st.page * PS + i + 1; const as = String(an).padStart(aw); const rid = ("L" + (i + 1)).padEnd(3);
    if (i >= vis.length) { s += frow("  " + rid + " \u2502 " + as + " \u2502", 1) + "\n"; continue; }
    const v = vis[i]; const mk = v.sl === st.cursor ? "\u2588" : " ";
    s += frow(mk + " " + rid + " \u2502 " + as + " \u2502 " + v.t, 1) + "\n";
  }
  const pages = Math.ceil(total / PS) || 1;
  s += sep() + "\n" + frow("Pg " + (st.page + 1) + "/" + pages + "  Ln " + (st.cursor + 1) + "  save[\u4fdd\u5b58] run[\u8fd0\u884c] closefile[\u5173\u95ed] newfile[\u65b0\u5efa]") + "\n" + bot();
  if (st.output) { s += "\n" + topFn("output") + "\n"; for (const l of (st.output || "").split("\n").slice(0, 8)) for (const wl of frowsFn(l, 1)) s += wl + "\n"; s += bot(); }
  return s;
}

export function vClick(st: any, id: string, ws: string): any {
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
    st = { ws: st.ws || ws, file: null, content: "", cursor: 0, col: 0, page: 0, dirty: false, output: "" }; return st;
  }
  if (id === "newfile") {
    let n = 1; while (existsSync(path.join(st.ws || ws, "untitled" + (n > 1 ? n : "")))) n++;
    const nm = "untitled" + (n > 1 ? n : ""); const fp = path.join(st.ws || ws, nm);
    writeFileSync(fp, ""); st = { ...st, file: fp, content: "", cursor: 0, col: 0, page: 0, dirty: false, output: "Created: " + nm };
    return st;
  }
  const ln = parseInt(id.slice(1));
  if (id.startsWith("L") && ln >= 1 && ln <= PS) { st = { ...st, cursor: st.page * PS + ln - 1, col: 0 }; return st; }
  if (id.startsWith("f")) {
    const t = vTree(st.ws || ws).slice(0, 12); const idx = parseInt(id.slice(1));
    if (idx >= 0 && idx < t.length) {
      const nm = t[idx].replace(/^[^a-zA-Z0-9_.]+/, "").trim(); const fp = path.join(st.ws || ws, nm);
      if (existsSync(fp) && !statSync(fp).isDirectory()) { st = { ...st, file: fp, content: readFileSync(fp, "utf8"), cursor: 0, col: 0, page: 0, dirty: false, output: "Opened: " + nm }; }
    }
    return st;
  }
  return st;
}

export function vPress(st: any, k: string): any {
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

export function vType(st: any, t: string, ws: string): any {
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1);
  t = t.replace(/\\n/g, "\n");
  if (!st.file) {
    const fp = t.startsWith("/") ? t : path.join(st.ws || ws, t);
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

// ── open-create hook (called by kernel when opening from Finder) ──
export function xOpenCreate(fp: string, ws: string): { type: string; state: any; min: boolean; full: boolean } | null {
  try {
    const content = readFileSync(fp, "utf8");
    return {
      type: "VSCode",
      state: { ...vInitState(ws), file: fp, content, cursor: 0, col: 0, page: 0, dirty: false, output: "Opened from Finder: " + path.basename(fp) },
      min: false, full: false,
    };
  } catch { return null; }
}
