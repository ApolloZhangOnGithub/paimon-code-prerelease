// god.agent.capability/hands.dev.writedoc — 通用开发文档写入
// 支持 ISSUE / LESSON / NORM 等所有 .{TYPE}.md 文档类型。
// 规律：目录 Docs.Dev.{Type}s/ · 文件 NNN-slug.{TYPE}.md · 索引 {Type}s.INDEX.md

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DIRS } from "#paths";

type DocType = "ISSUE" | "LESSON" | "NORM";

const DOC_CONFIG: Record<DocType, { plural: string; dir: string; hasStatus: boolean }> = {
  ISSUE:  { plural: "Issues",  dir: DIRS.devIssues,  hasStatus: true },
  LESSON: { plural: "Lessons", dir: DIRS.devLessons, hasStatus: false },
  NORM:   { plural: "Norms",   dir: DIRS.devNorms,   hasStatus: false },
};

function docDir(type: DocType): string {
  return DOC_CONFIG[type].dir;
}

function ensureDir(type: DocType): void { try { mkdirSync(docDir(type), { recursive: true }); } catch {} }
function pad(n: number): string { return String(n).padStart(3, "0"); }
function today(): string { return new Date().toISOString().slice(0, 10); }

function slugify(title: string): string {
  return title.trim().toLowerCase()
    .replace(/[\s/\\]+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "")
    .slice(0, 40) || "entry";
}

interface DocMeta { num: number; file: string; status: string; title: string; created: string; }

function filePattern(type: DocType): RegExp {
  return new RegExp(`^\\d{3}-.*\\.${type}$`);
}

function listFiles(type: DocType): string[] {
  ensureDir(type);
  try { return readdirSync(docDir(type)).filter((f) => filePattern(type).test(f)).sort(); } catch { return []; }
}

function parseDoc(type: DocType, file: string): DocMeta | null {
  try {
    const content = readFileSync(join(docDir(type), file), "utf8");
    const num = parseInt(file.slice(0, 3), 10);
    const status = content.match(/^status:\s*(.+)$/m)?.[1]?.trim() ?? "open";
    const title = content.match(/^#\s*\[\d+\]\s*(.+)$/m)?.[1]?.trim() ?? file.replace(/\.md$/, "");
    const created = content.match(/^created:\s*(.+)$/m)?.[1]?.trim() ?? "";
    return { num, file, status, title, created };
  } catch { return null; }
}

function nextNum(type: DocType): number {
  let max = 0;
  for (const f of listFiles(type)) { const n = parseInt(f.slice(0, 3), 10); if (n > max) max = n; }
  return max + 1;
}

function regenIndex(type: DocType): void {
  ensureDir(type);
  const cfg = DOC_CONFIG[type];
  const docs = listFiles(type).map((f) => parseDoc(type, f)).filter(Boolean) as DocMeta[];

  const L: string[] = [
    `# pi-coding-master ${cfg.plural} — 索引`,
    "",
    `_自动生成，别手改。_`,
    "",
  ];

  if (cfg.hasStatus) {
    const open = docs.filter((d) => d.status === "open");
    const done = docs.filter((d) => d.status !== "open");
    L.push(`**打开 ${open.length} · 已解决 ${done.length} · 共 ${docs.length}**`, "");
    L.push("## 打开");
    if (open.length) for (const d of open) L.push(`- [${pad(d.num)}](${d.file}) — ${d.title}${d.created ? ` _(${d.created})_` : ""}`);
    else L.push("_（无）_");
    L.push("", "## 已解决");
    if (done.length) for (const d of done) L.push(`- [${pad(d.num)}](${d.file}) — ${d.title} — ${d.status}`);
    else L.push("_（无）_");
  } else {
    L.push(`**共 ${docs.length} 条**`, "");
    for (const d of docs) L.push(`- [${pad(d.num)}](${d.file}) — ${d.title}${d.created ? ` _(${d.created})_` : ""}`);
    if (!docs.length) L.push("_（无）_");
  }

  writeFileSync(join(docDir(type), `${cfg.plural}.INDEX`), L.join("\n") + "\n");
}

export function addDoc(type: DocType, title: string, detail: string): number {
  ensureDir(type);
  const num = nextNum(type);
  const file = `${pad(num)}-${slugify(title)}.${type}`;
  const lines = [`# [${pad(num)}] ${title}`];
  if (DOC_CONFIG[type].hasStatus) lines.push("status: open");
  lines.push(`created: ${today()}`, "", detail || "（暂无详情）", "");
  writeFileSync(join(docDir(type), file), lines.join("\n"));
  regenIndex(type);
  return num;
}

export function setStatus(type: DocType, num: number, status: string): boolean {
  if (!DOC_CONFIG[type].hasStatus) return false;
  const file = listFiles(type).find((f) => parseInt(f.slice(0, 3), 10) === num);
  if (!file) return false;
  const p = join(docDir(type), file);
  let content = readFileSync(p, "utf8");
  content = /^status:\s*.+$/m.test(content)
    ? content.replace(/^status:\s*.+$/m, `status: ${status}`)
    : content.replace(/\n/, `\nstatus: ${status}\n`);
  writeFileSync(p, content);
  regenIndex(type);
  return true;
}

export function listOpen(type: DocType): DocMeta[] {
  const docs = listFiles(type).map((f) => parseDoc(type, f)).filter(Boolean) as DocMeta[];
  return DOC_CONFIG[type].hasStatus ? docs.filter((d) => d.status === "open") : docs;
}

export function readDoc(type: DocType, num: number): string | null {
  const file = listFiles(type).find((f) => parseInt(f.slice(0, 3), 10) === num);
  return file ? readFileSync(join(docDir(type), file), "utf8") : null;
}

// ── 注册命令和工具 ──

function handleDocCommand(type: DocType, rawArgs: string, ctx: any): void {
  const cfg = DOC_CONFIG[type];
  const label = cfg.plural.toLowerCase();
  const a = rawArgs.trim();

  if (!a || a === "list" || a === "ls") {
    const docs = listOpen(type);
    if (!docs.length) { ctx.ui.notify(`没有${label}。`, "info"); return; }
    ctx.ui.notify(`${label}：\n` + docs.map((d: DocMeta) => `  #${pad(d.num)}  ${d.title}`).join("\n"), "info");
    return;
  }

  if (cfg.hasStatus) {
    const close = a.match(/^(?:close|fix|fixed|resolve|done|解决|关)\s+#?(\d+)$/i);
    if (close) {
      const n = parseInt(close[1], 10);
      ctx.ui.notify(setStatus(type, n, "fixed") ? `#${pad(n)} 标记已解决。` : `没找到 #${close[1]}。`, "info");
      return;
    }
  }

  const show = a.match(/^#?(\d+)$/);
  if (show) {
    const txt = readDoc(type, parseInt(show[1], 10));
    ctx.ui.notify(txt ?? `没找到 #${show[1]}。`, txt ? "info" : "warning");
    return;
  }

  const num = addDoc(type, a, "");
  ctx.ui.notify(`已记 ${type.toLowerCase()} #${pad(num)}：${a}`, "info");
}

export function installDocTracker(pi: ExtensionAPI): any[] {
  const _cmds: any[] = [{
    name: "docs",
    desc: "/docs <issue|lesson|norm> [描述|list|编号|close 编号]",
    handler: async (args: any, ctx: any) => {
      const raw = (typeof args === "string" ? args : "").trim();
      const spaceIdx = raw.indexOf(" ");
      const sub = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).toUpperCase() as DocType;
      const rest = spaceIdx === -1 ? "" : raw.slice(spaceIdx + 1);
      if (!DOC_CONFIG[sub]) {
        ctx.ui.notify("/docs issue|lesson|norm [描述|list|编号|close 编号]", "info");
        return;
      }
      handleDocCommand(sub, rest, ctx);
    },
  }];

  if (process.env.PI_DEV) {
    pi.registerTool({
      name: "devdoc",
      label: "DevDoc",
      messageDescription: "记录开发文档（ISSUE/LESSON/NORM）到 Docs/Dev/ 目录。自动编号 + 自动索引。",
      promptSnippet: "Log a dev document (issue/lesson/norm) — auto-numbered, auto-indexed",
      parameters: {
        type: "object" as any,
        properties: {
          doctype: { type: "string", messageDescription: "文档类型: ISSUE | LESSON | NORM" },
          title: { type: "string", messageDescription: "一句话标题" },
          detail: { type: "string", messageDescription: "详情内容" },
        },
        required: ["doctype", "title"],
      },
      async execute(_id: string, params: any) {
        const raw = String(params?.doctype ?? "").toUpperCase().trim();
        if (!(raw in DOC_CONFIG)) {
          return { content: [{ type: "text", text: `未知类型 "${raw}"。可选: ${Object.keys(DOC_CONFIG).join(", ")}` }], details: {} };
        }
        const type = raw as DocType;
        const num = addDoc(type, String(params?.title ?? "").trim() || "（无标题）", String(params?.detail ?? ""));
        return {
          content: [{ type: "text", text: `已记 ${type} #${pad(num)} → Docs/Dev/${DOC_CONFIG[type].plural}/` }],
          details: { num, type },
        };
      },
    });
  }
  return _cmds;
}
