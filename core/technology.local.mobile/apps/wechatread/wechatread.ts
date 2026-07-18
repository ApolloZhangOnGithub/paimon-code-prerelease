import type { MobileApp } from "../../system.kernel/kernel.ts";
import { execSync } from "node:child_process";
import { readdirSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logerr, serviceKey, apiFetch } from "#paths";

const PAGE = 18;
const SKILL_VER = "1.0.4";
const API = "https://i.weread.qq.com/api/agent/gateway";
// 暂时禁用：Anna's Archive 镜像被墙，fetch 超时
// const ANNAS_API = "https://annas-archive.org";
let _pd = "";

// ── WeRead API（仅公共接口，不涉及个人数据）──
async function wereadApi(apiName: string, params: Record<string, any> = {}): Promise<any> {
  const key = serviceKey("weread");
  if (!key) throw new Error("weread 未配置，使用 /config 编辑");
  const body = { api_name: apiName, skill_version: SKILL_VER, ...params };
  const r = await apiFetch(API, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  }, { service: "weread", api: apiName, key });
  if (!r.ok) throw new Error(`WeRead API ${r.status}`);
  return r.json();
}

// ── Tab 定义 ─────────────────────────────────────────────────
type Tab = "weread" | "local";

function tabBar(active: Tab): string {
  const wr = active === "weread" ? "[微信读书]" : " 微信读书 ";
  const lo = active === "local" ? "[本地书架]" : " 本地书架 ";
  return `  ${wr}  |  ${lo}\n${"─".repeat(40)}`;
}

// ── 微信读书 Tab ─────────────────────────────────────────────
async function wereadHome(): Promise<string> {
  const key = serviceKey("weread");
  if (!key) return "微信读书\n\n  weread 未配置，使用 /config 编辑";
  return "微信读书\n\n命令: 搜索 xxx | 详情 书名 | 目录 书名";
}

async function wereadAction(cmd: string): Promise<string> {
  try {
    if (cmd.startsWith("搜索 ") || cmd.startsWith("search ")) {
      const kw = cmd.replace(/^(搜索 |search )/, "");
      const r = await wereadApi("/store/search", { keyword: kw, count: 8, scope: 10 });
      const results = r.results || [];
      const books = results.flatMap((g: any) => g.books || []);
      if (!books.length) return `搜索: ${kw}\n\n  无结果`;
      let s = `搜索: ${kw}\n\n`;
      for (const b of books.slice(0, 8)) {
        const info = b.bookInfo || b;
        const rating = info.newRatingDetail?.title ? ` [${info.newRatingDetail.title}]` : "";
        s += `  📖 ${info.title || "?"} — ${info.author || ""}${rating}\n`;
      }
      return s;
    }
    if (cmd.startsWith("详情 ") || cmd.startsWith("info ")) {
      const name = cmd.replace(/^(详情 |info )/, "").trim();
      const sr = await wereadApi("/store/search", { keyword: name, count: 1, scope: 10 });
      const results = sr.results || [];
      const books = results.flatMap((g: any) => g.books || []);
      const book = books[0]?.bookInfo || books[0];
      if (!book) return `未找到「${name}」`;
      const info = await wereadApi("/book/info", { bookId: book.bookId });
      const rating = info.newRatingDetail?.title || "";
      const ratingCount = info.newRatingCount ? `(${info.newRatingCount}人评)` : "";
      let s = `${info.title || book.title}\n\n`;
      s += `  作者: ${info.author || ""}\n`;
      if (info.publisher) s += `  出版: ${info.publisher}\n`;
      if (info.isbn) s += `  ISBN: ${info.isbn}\n`;
      if (info.wordCount) s += `  字数: ${Math.round(info.wordCount / 10000)}万\n`;
      if (rating) s += `  评价: ${rating} ${ratingCount}\n`;
      if (info.intro) s += `\n  ${(info.intro).slice(0, 400)}`;
      return s;
    }
    if (cmd.startsWith("目录 ") || cmd.startsWith("toc ")) {
      const name = cmd.replace(/^(目录 |toc )/, "").trim();
      const sr = await wereadApi("/store/search", { keyword: name, count: 1, scope: 10 });
      const results = sr.results || [];
      const books = results.flatMap((g: any) => g.books || []);
      const book = books[0]?.bookInfo || books[0];
      if (!book) return `未找到「${name}」`;
      const ch = await wereadApi("/book/chapterinfo", { bookId: book.bookId });
      const chapters = ch.chapters || [];
      if (!chapters.length) return `「${book.title}」无章节信息`;
      let s = `${book.title} · 目录 (${chapters.length} 章)\n\n`;
      for (const c of chapters.slice(0, 30)) {
        s += `  ${c.chapterIdx != null ? c.chapterIdx + ". " : ""}${c.title || ""}\n`;
      }
      if (chapters.length > 30) s += `  ... 共 ${chapters.length} 章\n`;
      return s;
    }
    // TODO: Anna's Archive 镜像被墙 (fetch 超时)，代码暂时禁用
    // if (cmd.startsWith("安娜搜 ") || cmd.startsWith("annas ")) { ... }
    return "微信读书\n\n  搜索 xxx | 详情 书名 | 目录 书名";
  } catch (e: any) { return `错误: ${e.message}`; }
}

// TODO: Anna's Archive 下载管线（镜像被墙，fetch 超时，暂时禁用）
// 搜书 → md5 API 拿元数据 → 下载 EPUB → 入本地书架
// 恢复时取消注释并在 wereadAction / onAction 中启用安娜搜/安娜下命令
/*
interface AnnaResult { md5: string; title: string; author: string; lang: string; ext: string; filesize: number; }

async function annaSearch(query: string): Promise<AnnaResult[]> {
  const url = `${ANNAS_API}/search?index=&q=${encodeURIComponent(query)}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Anna's Archive ${r.status}`);
  const html = await r.text();
  const results: AnnaResult[] = [];
  const md5Re = /\/md5\/([a-f0-9]{32})/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = md5Re.exec(html)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
  }
  const md5s = [...seen].slice(0, 5);
  const infos = await Promise.allSettled(md5s.map(md5 => annaMd5(md5)));
  for (const r of infos) {
    if (r.status === "fulfilled" && r.value) results.push(r.value);
  }
  return results;
}

async function annaMd5(md5: string): Promise<AnnaResult | null> {
  const url = `${ANNAS_API}/md5/${md5}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const m = data?.metadata || data;
  if (!m?.title) return null;
  return { md5, title: m.title, author: m.author || "?", lang: m.language || "?", ext: m.filetype || m.extension || "epub", filesize: m.filesize || m.file_size || 0 };
}

async function annaDownload(md5: string, title: string): Promise<string> {
  ...
}
*/

// ── 本地 EPUB Tab（保留原有功能）────────────────────────────
interface Chapter { title: string; content: string }
interface Book { file: string; title: string; author: string; chs: Chapter[] }

function stripHtml(html: string): string {
  return html.replace(/<head[\s\S]*?<\/head>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\n{3,}/g,"\n\n").trim();
}

function epubUnzip(epub: string, innerPath: string): string {
  return execSync(`unzip -p ${JSON.stringify(epub)} ${JSON.stringify(innerPath)}`,{encoding:"utf8",maxBuffer:10*1024*1024,timeout:15000});
}

function parseEpub(epub: string): Book|null {
  try{
    const container=epubUnzip(epub,"META-INF/container.xml");
    const opfRel=container.match(/full-path="([^"]+)"/)?.[1]||"";if(!opfRel)return null;
    const opf=epubUnzip(epub,opfRel);const base=opfRel.replace(/\/[^/]+$/,"");
    const title=opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.replace(/<[^>]+>/g,"").trim()||"Unknown";
    const author=opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1]?.replace(/<[^>]+>/g,"").trim()||"Unknown";
    const idHref=new Map<string,string>();for(const m of opf.matchAll(/<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"/gi))idHref.set(m[1],m[2]);
    const spine:string[]=[];for(const m of opf.matchAll(/<itemref[^>]*idref="([^"]+)"/gi))spine.push(m[1]);
    const chs:Chapter[]=[];
    for(const idref of spine){
      const href=idHref.get(idref);if(!href)continue;
      const fullPath=base?base+"/"+href:href;
      try{const html=epubUnzip(epub,fullPath);const text=stripHtml(html);if(text.length<20)continue;
        const chTitle=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g,"").trim()||`Ch${chs.length+1}`;
        chs.push({title:chTitle,content:text});}catch{continue;}
    }
    if(chs.length===0)return null;return{file:epub,title,author,chs};
  }catch{return null;}
}

function booksDir(){const d=join(_pd,"wechatread","books");try{mkdirSync(d,{recursive:true});}catch {}return d;}
function scanEpubs():string[]{try{return readdirSync(booksDir()).filter(f=>f.endsWith(".epub"));}catch{return[];}}
const _cache=new Map<string,Book>();
function getBook(file:string):Book|null{if(_cache.has(file))return _cache.get(file)!;const b=parseEpub(join(booksDir(),file));if(b)_cache.set(file,b);return b;}
function fmtBar(cur:number,total:number):string{const p=Math.min(100,Math.round(Math.min(cur,total)/Math.max(total,1)*100));const f=Math.max(0,Math.floor(p/10));return`[ ${"█".repeat(f)}${"░".repeat(10-f)} ] ${p}%`;}

function localHome(): string {
  const files=scanEpubs();
  let s="本地书架\n\n";
  if(files.length===0){s+="  书架为空。\n  把 .epub 放到 wechatread/books/\n";}
  else{s+=`  ${files.length} 本:\n`;files.forEach((f,i)=>s+=`  ${i+1}. ${f}\n`);}
  s+="\n输入「打开 书名」或序号";
  return s;
}

function localAction(cmd: string, st: any): { screen: string; state: any } {
  const files=scanEpubs();
  if(st?.file&&st?.ci!=null){
    if(cmd==="返回"||cmd==="back") return{screen:localHome(),state:{tab:"local"}};
    const b=getBook(st.file);if(!b)return{screen:localHome(),state:{tab:"local"}};
    const ch=b.chs[st.ci];const lines=ch.content.split("\n");const pos=st.pos||0;
    if(cmd==="下一页"||cmd==="next"){const np=Math.min(pos+PAGE,Math.max(0,lines.length-PAGE));return{screen:`📖 ${b.title} · ${ch.title}\n${fmtBar(np+PAGE,lines.length)}\n\n${lines.slice(np,np+PAGE).join("\n")}\n\n「上一页」「下一页」「目录」「返回」`,state:{...st,pos:np}};}
    if(cmd==="上一页"||cmd==="prev"){const np=Math.max(0,pos-PAGE);return{screen:`📖 ${b.title} · ${ch.title}\n${fmtBar(np+PAGE,lines.length)}\n\n${lines.slice(np,np+PAGE).join("\n")}\n\n「上一页」「下一页」「目录」「返回」`,state:{...st,pos:np}};}
    if(cmd==="目录"||cmd==="toc")return{screen:_toc(st.file),state:{...st,ci:undefined,pos:undefined}};
    return{screen:`📖 ${b.title} · ${ch.title}\n${fmtBar(pos+PAGE,lines.length)}\n\n${lines.slice(pos,pos+PAGE).join("\n")}\n\n「上一页」「下一页」「目录」「返回」`,state:st};
  }
  if(st?.file){
    if(cmd==="返回"||cmd==="back")return{screen:localHome(),state:{tab:"local"}};
    const b=getBook(st.file);if(!b)return{screen:localHome(),state:{tab:"local"}};
    const n=parseInt(cmd);if(n>=1&&n<=b.chs.length)return _openCh(st.file,n-1);
    return{screen:_toc(st.file),state:{tab:"local",file:st.file}};
  }
  if(cmd.startsWith("打开 ")){const name=cmd.slice(3).trim().toLowerCase();const idx=files.findIndex(f=>{const b=getBook(f);return b&&b.title.toLowerCase().includes(name);});if(idx<0)return{screen:`未找到「${cmd.slice(3).trim()}」`,state:{tab:"local"}};return{screen:_toc(files[idx]),state:{tab:"local",file:files[idx]}};}
  const n=parseInt(cmd);if(n>=1&&n<=files.length)return{screen:_toc(files[n-1]),state:{tab:"local",file:files[n-1]}};
  return{screen:localHome(),state:{tab:"local"}};
}

function _toc(file:string):string{const b=getBook(file);if(!b)return"解析失败";let s=`📖 ${b.title} — ${b.author}\n\n目录 (${b.chs.length} 章):\n`;b.chs.forEach((c,i)=>s+=`  ${i+1}. ${c.title}\n`);s+="\n输入章节号开始阅读";return s;}
function _openCh(file:string,ci:number){const b=getBook(file);if(!b)return{screen:"解析失败",state:{tab:"local"}};const c=b.chs[ci];const lines=c.content.split("\n");return{screen:`📖 ${b.title} · ${c.title}\n${fmtBar(PAGE,lines.length)}\n\n${lines.slice(0,PAGE).join("\n")}\n\n「上一页」「下一页」「目录」「返回」`,state:{tab:"local",file,ci,pos:0}};}

// ── MobileApp ─────────────────────────────────────────────────
export const app: MobileApp = {
  name:"wechatread",icon:"📚",messageDescription:"微信读书 — 在线书架 + 本地 EPUB",
  onOpen(_state: any, personDir: string) {
    _pd=personDir||"";
    const tab: Tab = _state?.tab || "weread";
    return { screen: `📚 微信读书\n${tabBar(tab)}\n\n加载中...\n\n命令: 搜索 xxx | 详情 书名 | 目录 书名\n切换标签输入「微信读书」或「本地书架」`, state: { tab } };
  },
  async onAction(input, state, personDir) {
    _pd=personDir||"";const cmd=input.trim();const st=state as any;
    const tab: Tab = st?.tab || "weread";

    if(cmd==="微信读书"||cmd==="weread"){const s=await wereadHome();return{screen:`📚 微信读书\n${tabBar("weread")}\n\n${s}`,state:{tab:"weread"}};}
    if(cmd==="本地书架"||cmd==="local"){return{screen:`📚 微信读书\n${tabBar("local")}\n\n${localHome()}`,state:{tab:"local"}};}
    if(cmd==="返回"&&!st?.file)return app.onOpen({},personDir);

    if(tab==="weread"){
      // TODO: Anna's Archive 下载（镜像被墙，暂时禁用）
      /*
      if(/^安娜下\s+\d+$/.test(cmd) || /^annad\s+\d+$/.test(cmd)){
        ... annaDownload ...
      }
      */
      const s = await wereadAction(cmd);
      return{screen:`📚 微信读书\n${tabBar("weread")}\n\n${s}`,state:{tab:"weread"}};
    }
    const r=localAction(cmd,st);
    return{screen:`📚 微信读书\n${tabBar("local")}\n\n${r.screen}`,state:{...r.state,tab:"local"}};
  },
};
