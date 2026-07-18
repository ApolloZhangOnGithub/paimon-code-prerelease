// apps/finder/finder.ts - Finder file browser for laptop
import { statSync, readdirSync } from "node:fs";
import path from "node:path";
import { logerr } from "#paths";

// ── helpers (self-contained, no kernel.ts dependency) ──
const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
function eid(i: number): string { if (i < 36 * 36) return CHARS[Math.floor(i / 36)] + CHARS[i % 36]; return "xx"; }
function fmtsz(b: number): string { if(b<1024)return b+"B";if(b<1048576)return (b/1024).toFixed(1)+"K";return (b/1048576).toFixed(1)+"M"; }
function fls(dir: string) { const ds: {name:string,sz:number}[]=[],fs2:{name:string,sz:number}[]=[]; try{for(const e of readdirSync(dir)){try{const s=statSync(path.join(dir,e));(s.isDirectory()?ds:fs2).push({name:e,sz:s.size});}catch {}}}catch {} ds.sort((a,b)=>a.name.localeCompare(b.name));fs2.sort((a,b)=>a.name.localeCompare(b.name));return{ds,fs:fs2};}

export function fInitState(ws: string) { return { path: ws, sel: null as string|null, mode: "list" as string, filter: null as string|null, cols: null as any }; }

type FrowFn = (t: string, i?: number) => string;
type VoidFn = () => string;

export function fRender(st: any, frow: FrowFn, sep: VoidFn, clipFn: (s:string,w:number)=>string): string {
  const { ds, fs: files } = fls(st.path||"/"); let s = frow("[DEV] "+(st.path||"/"),1)+"\n"+sep()+"\n"; let idx=0;
  for(const d of ds){const id=eid(idx++);s+=frow((d.name===st.sel?"\u25b6":" ")+" "+id+" \u{1F4C2} "+d.name,1)+"\n";}
  for(const f of files){const id=eid(idx++);s+=frow((f.name===st.sel?"\u25b6":" ")+" "+id+" \u{1F4C4} "+f.name+"  ("+fmtsz(f.sz)+")",1)+"\n";}
  s+=frow("  up [..]  list["+(st.mode==="column"?"\u5206\u680f":"\u5217\u8868")+"]",1)+"\n";
  if (st.sel) { const ext = path.extname(st.sel).toLowerCase(); const isMedia = /\.(m4a|mp4|mov|mkv|webm|avi|mp3|flv|wmv|m4v|ogg|wma|aac|flac|wav)$/i.test(ext); s+=frow("  open_vscode[VSCode]" + (ext === ".csv" ? " open_excel[Excel]" : "") + (isMedia ? " open_ffactory[Format Factory]" : "") + (isMedia ? " open_ytdl[YT Downloader]" : ""), 1)+"\n"; }
  s+=sep()+"\n"+frow((ds.length+files.length)+" items",1);return s;
}

export function fRenderColumn(st: any, frow: FrowFn, sep: VoidFn, clipFn: (s:string,w:number)=>string): string {
  const cols = st.cols || [{path: st.path, sel: st.sel}]; const CW = 28;
  let s = frow("columns ["+(st.mode||"column")+"]",1)+"\n"+sep()+"\n";
  const grid: string[][] = []; let maxH = 0;
  for (const col of cols) {
    const { ds, fs: files } = fls(col.path); const lines: string[] = [];
    lines.push(clipFn(path.basename(col.path)||col.path, CW-3));
    lines.push("\u2500".repeat(CW-3));
    let idx = 0;
    for (const d of ds) { const id = eid(idx++); const mk = d.name===col.sel?"\u25b6":" "; lines.push(mk+id+" "+clipFn(d.name, CW-7)+"/"); }
    for (const f of files) { const id = eid(idx++); const mk = f.name===col.sel?"\u25b6":" "; lines.push(mk+id+" "+clipFn(f.name, CW-7)); }
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

export function fRenderFiltered(st: any, frow: FrowFn, sep: VoidFn, clipFn: (s:string,w:number)=>string): string {
  const { ds, fs: files } = fls(st.path); const q = (st.filter || "").toLowerCase();
  const d2 = q ? ds.filter((d:any) => d.name.toLowerCase().includes(q)) : ds;
  const f2 = q ? files.filter((f:any) => f.name.toLowerCase().includes(q)) : files;
  let s = frow(st.path + (q ? "  filter: \"" + st.filter + "\"" : ""), 1) + "\n" + sep() + "\n"; let idx = 0;
  for (const d of d2) { const id = eid(idx++); s += frow((d.name === st.sel ? "\u25b6" : " ") + " " + id + " \u{1F4C2} " + d.name, 1) + "\n"; }
  for (const f of f2) { const id = eid(idx++); s += frow((f.name === st.sel ? "\u25b6" : " ") + " " + id + " \u{1F4C4} " + f.name + "  (" + fmtsz(f.sz) + ")", 1) + "\n"; }
  s += frow("  up [..]", 1) + "\n" + sep() + "\n" + frow((d2.length + f2.length) + " / " + (ds.length + files.length) + " items", 1); return s;
}

export function fClick(st: any, id: string): any {
  // open-with actions
  if ((id === "open_vscode" || id === "open_excel" || id === "open_ffactory" || id === "open_ytdl") && st.sel) {
    const apps:Record<string,string> = {open_vscode:"VSCode", open_excel:"Excel", open_ffactory:"FFactory", open_ytdl:"ytdl"};
    st = { ...st, _openWith: apps[id]||"VSCode", _openPath: path.join(st.path, st.sel) }; return st;
  }
  if(id==="up"){st={...st,path:path.resolve(path.dirname(st.path)),sel:null};return st;}
  if(id==="mode"){st={...st,mode:st.mode==="column"?"list":"column"};return st;}
  const{ds,fs:files}=fls(st.path);const all=[...ds,...files];const idx=all.findIndex((_:any,i:number)=>eid(i)===id);
  if(idx<0)return st;const nm=all[idx].name;const fp=path.join(st.path,nm);
  try{if(statSync(fp).isDirectory()){if(st.mode==="column"){const cols=st.cols||[{path:st.path,sel:st.sel||(ds[0]?ds[0].name:null)}];const i2=cols.findIndex((c:any)=>c.path===fp);if(i2>=0){st={...st,path:fp,cols:cols.slice(0,i2+1),sel:null};}else{st={...st,path:fp,cols:[...cols,{path:fp,sel:null}],sel:null};}}else{st={...st,path:fp,sel:null};}return st;}}catch {}
  if(st.mode==="column"){const cols=st.cols||[{path:st.path,sel:st.sel||(ds[0]?ds[0].name:null)}];st={...st,cols:[...cols.slice(0,-1),{path:st.path,sel:nm}]};}
  st={...st,sel:nm};return st;
}

export function fPress(st: any, k: string): any {
  const { ds, fs: files } = fls(st.path); const all = [...ds, ...files];
  if (k === "Up" && st.sel) { const i = all.findIndex((a:any)=>a.name===st.sel); if (i > 0) st = { ...st, sel: all[i - 1].name }; }
  else if (k === "Down") { if (!st.sel && all.length > 0) st = { ...st, sel: all[0].name }; else { const i = all.findIndex((a:any)=>a.name===st.sel); if (i >= 0 && i < all.length - 1) st = { ...st, sel: all[i + 1].name }; } }
  return st;
}

export function fType(st: any, t: string): any {
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1);
  st = { ...st, filter: t || null }; return st;
}
