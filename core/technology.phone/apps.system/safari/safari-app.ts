// safari-app.ts — Safari (自包含，零 jiti 跨文件缓存)
import type { PhoneApp } from "../../system.kernel/kernel.ts";
import * as fs from "fs";
import * as path from "path";

const BROWSER_URL = process.env.PI_BROWSER || "http://127.0.0.1:9222";

interface SafariState {
  currentUrl: string; currentTitle: string;
  history: string[]; histIdx: number;
  pageText: string; pageLinks: string[];
}
const _s: SafariState = {
  currentUrl: "", currentTitle: "",
  history: [], histIdx: -1,
  pageText: "", pageLinks: [],
};

function loadJson(p: string): any[] { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; } }
function saveJson(p: string, data: any[]) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

function recordHistory(personDir: string, entry: string) {
  if (!personDir) return;
  try {
    const histFile = path.join(personDir, "safari_history.json");
    const hist = loadJson(histFile);
    hist.push({ url: entry, ts: new Date().toISOString() });
    saveJson(histFile, hist.slice(-500));
  } catch {}
}

let _svcStarting = false;
async function ensureSvc(): Promise<boolean> {
  try { const r = await fetch(BROWSER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ping" }), signal: AbortSignal.timeout(500) }); return r.ok; } catch {}
  if (_svcStarting) return false;
  _svcStarting = true;
  try {
    const { spawn } = await import("node:child_process");
    const { homedir } = await import("node:os");
    const svc = path.join(homedir(), "smart-pi/pi-coding-master.DEV/Codebase/core/technology.server/browser-service.cjs");
    const env = { ...process.env, PORT: "9222" };
    if (!env.CHROMIUM_PATH) env.CHROMIUM_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const child = spawn("node", [svc], { stdio: "ignore", detached: true, env });
    child.unref();
    for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 500)); try { const r = await fetch(BROWSER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ping" }), signal: AbortSignal.timeout(500) }); if (r.ok) return true; } catch {} }
  } catch {} finally { _svcStarting = false; }
  return false;
}

async function bc(action: string, params: Record<string, any> = {}, session = "safari"): Promise<any> {
  try {
    const res = await fetch(BROWSER_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, session, ...params }),
      signal: AbortSignal.timeout(10000),
    });
    return await res.json();
  } catch {
    if (await ensureSvc()) {
      try {
        const res = await fetch(BROWSER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, session, ...params }), signal: AbortSignal.timeout(10000) });
        return await res.json();
      } catch (e: any) { return { error: `browser: ${e.message}` }; }
    }
    return { error: "browser-service 启动失败" };
  }
}

async function fetchUrl(url: string, limit = 10000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(10000),
  });
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("json") ? JSON.stringify(await res.json(), null, 2) : await res.text()).slice(0, limit);
}

function openBg(url: string): void {
  _s.currentUrl = url; _s.currentTitle = url;
  _s.pageText = ""; _s.pageLinks = [];
  _s.history = _s.history.slice(0, _s.histIdx + 1);
  _s.history.push(url); _s.histIdx = _s.history.length - 1;
  // 全异步加载，不等任何返回
  bc("open", { url }).then(r => {
    if (r.error) { console.log("[safari] open fail:", r.error); return; }
    _s.currentTitle = (r.text || "").replace(/^已打开: /, "").split("\n")[0] || url;
    return Promise.all([bc("text", { limit: 10000 }), bc("links", { limit: 50 })]);
  }).then((results: any) => {
    if (results) {
      _s.pageText = results[0]?.text || "";
      _s.pageLinks = results[1]?.text ? results[1].text.split("\n").filter(Boolean) : [];
      console.log("[safari] loaded", _s.pageText.length, "chars from", url);
    }
  }).catch((e: any) => console.log("[safari] bg fail:", e.message));
}

async function searchWeb(q: string): Promise<string> {
  try {
    const sxng = process.env.SEARXNG_URL || "http://127.0.0.1:8888";
    const r = await fetch(`${sxng}/search?q=${encodeURIComponent(q)}&format=json&language=zh-CN`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json() as any; const items = j.results || [];
    if (items.length) return "搜索: " + q + "\n\n" + items.slice(0, 8).map((i: any, n: number) => `[${n+1}] ${i.title}\n    ${i.content || i.snippet || ""}\n    → ${i.url}`).join("\n\n");
  } catch {}
  try { return await fetchUrl("https://www.google.com/search?q=" + encodeURIComponent(q), 5000); } catch { return "搜索失败"; }
}

export const app: PhoneApp = {
  name: "Safari",
  icon: "浏览器",
  messageDescription: "打开网页、搜索、读取内容",
  onOpen(s: any) {
    return { screen: "Safari\n  URL | 搜索 xxx | 读 | 返回", state: s };
  },
  async onAction(input: string, state: any, personDir: string) {
    const cmd = input.trim();
    try {
      if (cmd === "返回" || cmd === "back") return { screen: "已返回", state: { ...state, _close: true } };
      if (cmd === "读" || cmd === "read") {
        if (_s.pageText) return { screen: _s.pageText.slice(0, 5000), state };
        if (_s.currentUrl) return { screen: `加载中: ${_s.currentUrl}\n\n稍后再试「读」。`, state };
        return { screen: "未打开页面。输入 URL。", state };
      }
      if (cmd.startsWith("搜索 ") || cmd.startsWith("search ")) {
        const q = cmd.replace(/^(搜索 |search )/, "");
        const result = await searchWeb(q);
        recordHistory(personDir, `search: ${q}`);
        return { screen: result.slice(0, 5000), state };
      }
      if (cmd.startsWith("http://") || cmd.startsWith("https://")) {
        const t0 = Date.now();
        const r = await bc("open", { url: cmd });
        if (r.error) return { screen: `打开失败: ${r.error}`, state };
        const title = (r.text || "").replace(/^已打开: /, "").split("\n")[0] || cmd;
        _s.currentUrl = cmd; _s.currentTitle = title;
        const [textR] = await Promise.all([bc("text", { limit: 10000 })]);
        _s.pageText = textR?.text || "";
        recordHistory(personDir, cmd);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        return { screen: `已打开: ${title}\n${cmd}\n\n${_s.pageText.slice(0, 5000) || "(页面无文字)"}\n\n[${elapsed}s]`, state };
      }
      return { screen: "Safari\n  URL | 搜索 xxx | 读 | 返回", state };
    } catch (e: any) {
      return { screen: "错误: " + e.message, state };
    }
  },
};
