import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, isBashToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { access, readFile, appendFile, rename as fsRename, mkdir, readdir, stat as fsStat } from "node:fs/promises";
import { dirname, basename, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";

import { getPrompt } from "#ribosome";
import { registerPaimonTool, sendCustomMessage, resultContent } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";
import { IS_DEV } from "#paths";

// ══════ Trust / Authorization —— agent-based 白名单（设计见 Docs/Dev/Wiki/Trust.WIKI）══════
// 状态存 ~/.paimon/config/authorize.json：在代码树外（部署 rsync 不清零），
// 又在 ~/.paimon 系统黑名单内（agent 改不了 = 不能自授权）。
const AUTH_FILE = join(homedir(), ".paimon/config/authorize.json");
const AGENT_WORK_ROOT = join(homedir(), ".paimon/AgentWorkDir/Individual");
export interface TrustEntry { path: string; until?: number }
export interface AgentTrust { all?: boolean; trusted: TrustEntry[] }
let authDb: { agents: Record<string, AgentTrust> } = { agents: {} };

// agent 身份：process.title = paimon:name(main,personId,sessionHash)，与 hands.terminal 同源
export function agentId(): string {
  const m = process.title.match(/paimon:[^(]+\([^,]+,\s*([^,)]+)/);
  return (m?.[1] || "unknown").trim().slice(0, 8);
}
export function agentWorkDir(): string { return join(AGENT_WORK_ROOT, agentId()); }
function isOwnWorkDir(abs: string): boolean { const w = agentWorkDir(); return abs === w || abs.startsWith(w + "/"); }

export async function loadTrust() {
  try {
    const data = JSON.parse(await fsReadFile(AUTH_FILE, "utf8"));
    authDb = data && typeof data === "object" && data.agents ? data : { agents: {} };
  } catch {
    authDb = { agents: {} };
  }
}

export async function saveTrust() {
  await mkdir(dirname(AUTH_FILE), { recursive: true }).catch(() => {});
  await fsWriteFile(AUTH_FILE, JSON.stringify(authDb, null, 2), "utf8");
}

export function agentEntry(): AgentTrust {
  return (authDb.agents[agentId()] ??= { trusted: [] });
}

// null=允许；string=拒绝理由（自带出路，不留死局）
function checkAuth(targetPath: string): string | null {
  if (!targetPath) return null;
  const abs = resolve(targetPath);
  if (isOwnWorkDir(abs)) return null; // 自己的 AgentWorkDir 常开
  const e = authDb.agents[agentId()];
  if (e?.all) return null; // 全量白名单（系统黑名单在上游 gate 已拦掉）
  const now = Date.now();
  for (const t of e?.trusted ?? []) {
    if (t.until && t.until <= now) continue;
    if (abs === t.path || abs.startsWith(t.path + "/")) return null;
  }
  const hint = basename(abs).includes(".") ? dirname(abs) : abs; // 文件 → 建议授权其所在目录
  return `${targetPath} 不在你的白名单内。两条出路：\n` +
    `1. 只是想落盘、不挑路径 → 写到你的工作目录: ${agentWorkDir()}/\n` +
    `2. 确实需要写这个路径 → 说明理由并把下面这行原样给用户，由用户在输入框执行（/authdir 是用户侧斜杠命令，agent 自己无法执行）：\n` +
    `   /authdir ${hint}`;
}

// ══════ File Rules (pattern-based bash blocking) ══════════════════════
const FILE_RULES = [
  { on: "bash", pattern: "gh\\s+repo\\s+(create|delete)|git\\s+push.*--force", block: "GitHub 敏感操作拦截" },
  { on: "bash", pattern: "mv.*UNREGULATED", block: "UNREGULATED 文件不能 mv 出去" },
];

const COMPANIONS = [".SPEC", ".CHANGELOG", ".HISTORY", ".NAMETRACE", ".LOCATIONTRACE"];

// prompt 来自 coded.dna（coded fileactions.wise + fileactions.rules），由 runtime 取，不再硬编码。
const PROMPT = getPrompt("fileactions.wise");
const RULES_PROMPT = (() => { try { return getPrompt("fileactions.rules"); } catch { return ""; } })();

function isExempt(path: string): boolean {
  // #human 目录下的 companion 文件也受保护，不豁免
  if (isHumanProtected(path)) return false;
  for (const ext of COMPANIONS) if (path.endsWith(ext)) return true;
  if (path.includes("/.git/") || path.startsWith(".git/")) return true;
  return false;
}

function isHumanProtected(path: string): boolean {
  return path.includes("#human.") || path.includes("#human/");
}

function isWalletProtected(path: string): boolean {
  const base = path.split("/").pop() || "";
  return base === "wallet.json" || base === "wallet.log" || base === "ubi.json";
}

function isSystemProtected(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return p.includes("/.ssh/") || p.includes("/.ssh") ||
    p.includes("/.paimon/agent/config/auth.json") ||
    p.includes("/.paimon/trust.json") ||
    p.includes("/.paimon/agent/config/models.json") ||
    p.includes("/fileactions.ts") ||
    p.includes("/pi-coding-agent/dist/") ||
    p.includes("/.paimon/") ||
    p.includes("/paimon-code.RELEASE/") ||
    p.includes("/.local/bin/pi") || p.includes("/.local/bin/paimon") ||
    isWalletProtected(path);
}

function fmt(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

// 沿着路径往上找到第一个【真实存在】的目录（要落进去的那个环境）。
async function nearestExistingDir(path: string): Promise<string> {
  let d = dirname(resolve(path));
  for (let i = 0; i < 60 && d.length > 1; i++) {
    if (await exists(d)) return d;
    d = dirname(d);
  }
  return d;
}

async function nonEmpty(path: string): Promise<boolean> {
  try { const c = await readFile(path, "utf8"); return c.trim().length > 0; } catch { return false; }
}

async function lastLine(path: string): Promise<string> {
  try {
    const c = await readFile(path, "utf8");
    const lines = c.trim().split("\n");
    return lines[lines.length - 1]?.trim() ?? "";
  } catch { return ""; }
}

async function moveCompanions(oldPath: string, newPath: string): Promise<void> {
  for (const ext of COMPANIONS) {
    const from = `${oldPath}${ext}`;
    const to = `${newPath}${ext}`;
    if (await exists(from)) {
      await mkdir(dirname(to), { recursive: true }).catch(() => {});
      await fsRename(from, to).catch(() => {});
    }
  }
}

function parseMv(cmd: string): { src: string; dst: string; isRename: boolean } | null {
  const m = cmd.match(/\bmv\s+(?:-[a-zA-Z]+\s+)*["']?([^\s"']+)["']?\s+["']?([^\s"']+)["']?\s*$/);
  if (!m) return null;
  const src = m[1]!;
  const dst = m[2]!;
  const srcDir = dirname(src);
  const dstDir = dst.endsWith("/") ? dst.slice(0, -1) : dirname(dst);
  const isRename = srcDir === dstDir || dirname(resolve(src)) === dirname(resolve(dst));
  return { src, dst, isRename };
}

// ── Execute 命令校验（由 kernel.heart/process.ts 调用）──
export function validateExecute(cmd: string): { blocked: boolean; message?: string } {
  if (/\brm\b/i.test(cmd)) return { blocked: true, message: "请使用 trash 移入回收站。" };
  if (/\bsed\b/i.test(cmd)) return { blocked: true, message: "请使用 read 命令读取文件，不要用 sed。" };
  if (/(kill|pkill|killall)\s.*paimon/i.test(cmd)) return { blocked: true, message: "禁止杀掉 paimon 进程。用 paimon -k <序号> 或 /stop 正常终止。" };
  if (/(>\s+\S|>>\s+\S|tee\s+\S|dd\s+.*\bof=|\btouch\b|\bchmod\b|\bchown\b|\bnpm\s+(i|install)|\bwget\b|\bcurl\b.*-[oO])/i.test(cmd)) {
    return { blocked: true, message: "禁止使用 Execute 命令 写入内容。请 Edit 命令 修改文件，或使用 Write 命令 创建文件。" };
  }
  // 禁止操作 ~/.paimon/ 目录（读也不行，走 DEV 源码）
  if (/(?:~\/.paimon\/|\$HOME\/.paimon\/|\$\{HOME\}\/.paimon\/)/i.test(cmd)) {
    return { blocked: true, message: "禁止 Execute 操作 ~/.paimon/。要读源码请用 Read 指定 DEV 路径。" };
  }
  // mv 改名（同目录）= 元数据操作，放行。跨目录 mv 拦截。
  if (/\bmv\b/i.test(cmd)) {
    const parsed = parseMv(cmd);
    if (!parsed) return { blocked: true, message: "mv 格式不对。用法: mv <旧名> <新名>" };
    // if (!parsed.isRename) return { blocked: true, message: "跨目录 mv 被拦截。用 edit 改文件内容，write 创建新文件。" };
    return { blocked: false };
  }
  return { blocked: false };
}

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer("syntax-error", (message: any, _opts: any, theme: any) => {
    return renderMessage.notice(theme, "Syntax", (message.content ?? "").toString());
  });
  loadTrust();

  const editedThisTurn = new Set<string>();
  const changelogUpdatedThisTurn = new Set<string>();
  const dirsSeen = new Set<string>();
  const readmesSeen = new Set<string>(); // 已读过的 dir.README，resolve 绝对路径
  const redirectedWrites = new Map<string, { from: string; to: string }>(); // write 软着陆：toolCallId → 重定向信息

  // ── write 重定向告知：agent 必须知道文件实际落在哪 ──
  pi.on("tool_result", async (event, _ctx) => {
    const r = redirectedWrites.get(event.toolCallId);
    if (!r) return;
    redirectedWrites.delete(event.toolCallId);
    if (event.isError) return;
    const note = `\n[自动重定向] ${r.from} 不在白名单，新文件已写入你的工作目录: ${r.to}\n（需要写原路径请让用户执行: /authdir ${dirname(r.from)}）`;
    return { content: [...(event.content ?? []), { type: "text", text: note }], details: event.details };
  });

  // ── prompt ───────────────────────────────────────────────────────
  pi.on("before_agent_start", async (event, _ctx) => {
    return { systemPrompt: event.systemPrompt + "\n\n" + PROMPT + (RULES_PROMPT ? "\n\n" + RULES_PROMPT : "") };
  });

  // ── tool_call: Write gate (spec required) ────────────────────────
  pi.on("tool_call", async (event, _ctx) => {
    // ── Authorization check: 写/改/bash 必须在 workDir 或 trusted dir ──
    let authPath = (event.input as any).path ?? (event.input as any).file_path ?? "";
    // bash 没有 path 字段 → 从 command 抠目标路径。尽量抠全：重定向 > >> >| / cp mv ln install dest /
    // dd of= / tee / rm rmdir mkdir touch truncate。（以前抠不到就 fail-open 放行 = 沙箱被绕过的根。）
    if (!authPath && event.toolName === "bash") {
      const cmd: string = (event.input as any).command ?? "";
      const m = cmd.match(/(?:>>?|>\|)\s*['"]?([^\s'"&|;]+)/) ??
                cmd.match(/\b(?:cp|mv|ln|install)\s+(?:-\S+\s+)*\S+\s+['"]?([^\s'"&|;]+)/) ??
                cmd.match(/\bdd\s+.*\bof=['"]?([^\s'"&|;]+)/) ??
                cmd.match(/\btee\s+(?:-\S+\s+)*['"]?([^\s'"&|;]+)/) ??
                cmd.match(/\b(?:rm|rmdir|mkdir|touch|truncate)\s+(?:-\S+\s+)*['"]?([^\s'"&|;]+)/);
      if (m) authPath = m[1]!;
      else if (/\b(?:rm|rmdir)\b/.test(cmd)) {
        // 有删除操作却抠不到目标(复杂引号/变量/通配) → 绝不 fail-open。误删工作区外的东西比拦一下严重得多。
        return { block: true, reason: "这条 bash 含 rm/rmdir 删除操作，但抠不到能核对的目标路径 —— 为防误删工作区外的东西，先拦下。把要删的路径写明确（绝对路径）再来。" };
      }
    }

    // ── AgentWorkDir 自由区：agent 自己的目录常开，越过系统保护与治理 gate（bash 不豁免，仍走下方各拦截）──
    if (authPath && event.toolName !== "bash" && isOwnWorkDir(resolve(authPath))) {
      await mkdir(agentWorkDir(), { recursive: true }).catch(() => {});
      return undefined;
    }

    // ── 系统保护: SSH密钥/凭证/钱包/自身代码/pi dist ──
    if (authPath && isSystemProtected(authPath)) {
      const isRead = ["read","view","ls","list","glob","grep","find"].includes(event.toolName);
      if (authPath.includes("/.ssh/") || authPath.includes("auth.json") || authPath.includes("models.json")) {
        return { block: true, reason: `系统保护 — ${authPath.split("/").pop()} 是凭证文件，agent 不可访问。` };
      }
      if (authPath.includes("/pi-coding-agent/dist/") || authPath.includes("/.paimon/agent/")) {
        if (!isRead) {
          return { block: true, reason: `请不要修改 ~/.paimon/agent/ 下的文件或dist live文件。请修改/paimon-code.DEV/开发目录然后make部署。` };
        }
        if (IS_DEV) {
          return { block: true, reason: `请不要读 ~/.paimon/agent/。请阅读/paimon-code.DEV/开发目录中的源文件。` };
        }
      }
      if (authPath.includes("/paimon-code.RELEASE/") && !isRead) {
        return { block: true, reason: `RELEASE 保护 — 不要改已经发布的版本。` };
      }
      if (!isRead) {
        return { block: true, reason: `系统保护 — ${authPath.split("/").pop()} 由系统管理，agent 不可修改。` };
      }
    }

    // ── #human 保护: agent 默认不可修改 #human 目录下的任何文件（含 companion） ──
    if (authPath && isHumanProtected(authPath) && !["read","view","ls","list","glob","grep","find"].includes(event.toolName)) {
      return { block: true, reason: `#human 保护 — ${authPath} 位于 #human 目录，agent 默认不可修改。如需允许，请确认。` };
    }

    if (authPath && !["read","view","ls","list","glob","grep","find"].includes(event.toolName)) {
      const authReason = checkAuth(authPath);
      if (authReason) {
        // write 新文件 → 软着陆：不拦，自动重定向到 agent 工作目录（混淆串防重名），tool_result 里告知落点
        if (event.toolName === "write" && !(await exists(authPath))) {
          const base = basename(authPath);
          const dot = base.lastIndexOf(".");
          const stem = dot > 0 ? base.slice(0, dot) : base;
          const ext = dot > 0 ? base.slice(dot) : "";
          const newPath = join(agentWorkDir(), `${stem}-${randomBytes(3).toString("hex")}${ext}`);
          await mkdir(agentWorkDir(), { recursive: true }).catch(() => {});
          if ((event.input as any).path !== undefined) (event.input as any).path = newPath;
          if ((event.input as any).file_path !== undefined) (event.input as any).file_path = newPath;
          redirectedWrites.set(event.toolCallId, { from: authPath, to: newPath });
          return undefined;
        }
        return { block: true, reason: authReason };
      }
    }

    // ── dir.README gate ─────────────
    const dirREADME = async (targetPath: string) => {
      if (!targetPath || isExempt(targetPath)) return;
      const parentDir = (await exists(targetPath)) ? targetPath : dirname(targetPath);
      const readmePath = join(resolve(parentDir), "dir.README");
      try {
        if ((await exists(readmePath)) && !readmesSeen.has(readmePath)) {
          return { block: true, reason: `${parentDir} 下有 dir.README。先 read 它了解目录规则，再操作。` };
        }
      } catch {}
    };

    if (isToolCallEventType("ls", event)) return await dirREADME((event.input as any).path ?? (event.input as any).dir ?? "");
    if (isToolCallEventType("read", event)) {
      const rp = (event.input as any).path ?? (event.input as any).file_path ?? "";
      if (basename(rp) === "dir.README") return; // 允许读 README 本身
      return await dirREADME(dirname(rp));
    }

    // ── FILE_RULES enforcement ─────────────────────────────────
    for (const rule of FILE_RULES) {
      const tn = event.toolName;
      if (rule.on !== tn) continue;
      if (rule.pattern) {
        const cmd = tn === "bash" ? ((event.input as any).command ?? "") : "";
        if (new RegExp(rule.pattern).test(cmd)) {
          return { block: true, reason: rule.block };
        }
      }
    }

    // ── tool_call: Write gate (spec required) ────────────────────────
    if (isToolCallEventType("write", event)) {
      const path = (event.input as any).path ?? (event.input as any).file_path;
      if (!path || isExempt(path)) return;

      // 文件已存在 → 提前拦截，避免 Execute 阶段才抛错浪费 token
      if (await exists(path)) {
        return { block: true, reason: `文件已存在: ${path}。用 edit 修改已有文件，write 只能创建新文件。` };
      }

      // 建新文件前看过目录的要求暂时关闭——模型被这个拦截搞得太痛苦。
      // if (!(await exists(path))) {
      //   const dir = await nearestExistingDir(path);
      //   if (dir && !dirsSeen.has(dir)) {
      //     return { block: true, reason: `先 ls 一下目录再建文件。` };
      //   }
      // }

      if (path.endsWith(".CHANGELOG")) {
        return { block: true, reason: `Cannot overwrite ${basename(path)}. CHANGELOG is append-only — use edit to add lines.` };
      }

      // 编号文档检查：ISSUE/NORM/LESSON 必须有 NNN- 前缀
      const basen = basename(path);
      if (/\.(ISSUE|NORM|LESSON|COURSE|EXAM)$/i.test(basen) && !/^\d{3,}-/.test(basen)) {
        const dir = dirname(path);
        let maxNum = 0;
        try {
          const files = await readdir(dir);
          for (const f of files) {
            const m = f.match(/^(\d+)-/);
            if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
          }
        } catch {}
        const next = String(maxNum + 1).padStart(3, "0");
        return { block: true, reason: `缺少编号前缀。当前目录最大编号 ${maxNum}，请用 ${next}-${basen} 格式。` };
      }

      // 自描述文件不需要 .SPEC
      const SELF_DESCRIBING = ['.md','.txt','.json','.yaml','.yml','.csv','.xml','.html','.css','.toml'];
      const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
      if (!SELF_DESCRIBING.includes(ext)) {
        const specPath = `${path}.SPEC`;
        if (!(await exists(specPath))) {
          return { block: true, reason: `No spec found. Write ${specPath} first (any format, non-empty), then retry.` };
        }
        if (!(await nonEmpty(specPath))) {
          return { block: true, reason: `${specPath} is empty. Write your design/plan in it, then retry.` };
        }
      }
      return;
    }

    // ── tool_call: Edit gate (CHANGELOG append-only + SPEC hash protection) ──
    if (isToolCallEventType("edit", event)) {
      const path = (event.input as any).path ?? (event.input as any).file_path;
      if (!path) return;

      if (path.endsWith(".CHANGELOG")) {
        const oldStr = (event.input as any).old_string ?? (event.input as any).oldText ?? "";
        const newStr = (event.input as any).new_string ?? (event.input as any).newText ?? "";
        if (newStr.split("\n").length < oldStr.split("\n").length) {
          return { block: true, reason: `CHANGELOG is append-only. You removed lines. Only add.` };
        }
      }

      if (path.endsWith(".SPEC")) {
        const oldStr = (event.input as any).old_string ?? (event.input as any).oldText ?? "";
        const newStr = (event.input as any).new_string ?? (event.input as any).newText ?? "";
        if (/^source:\s*\S+\s*@\s*[a-f0-9]/.test(oldStr) || /^source:\s*\S+\s*@\s*[a-f0-9]/.test(newStr)) {
          return { block: true, reason: `source hash 行由系统自动维护，不能手动编辑。修改 SPEC 内容即可，hash 会在写入后自动更新。` };
        }
      }
      return;
    }

    // ── tool_call: Bash gate (rename/move checks) ───────────────────
    if (isToolCallEventType("bash", event)) {
      const cmd = (event.input as any).command;
      if (!cmd) return;

      // 禁止 rm——只能用 remove 工具标记为 .REMOVED，不能直接删
      if (/\brm\b/.test(cmd) && !cmd.includes("UNREGULATED")) {
        return { block: true, reason: "禁止 rm！用 trash 工具删除文件。" };
      }

      // 禁止 npx/npm install——包安装由 install.sh 管理
      if (/\bnpx\b|\bnpm\s+(i|install)\b/.test(cmd)) {
        return { block: true, reason: "禁止 npx/npm install！包管理由 install.sh 统一处理。" };
      }

      // 检查 bash 新建文件——不拦截(管道数据不能丢)，但事后补 .SPEC
      // (拦截在 tool_result 里自动处理)

      const mv = parseMv(cmd);
      if (!mv) return;
      if (isExempt(mv.src)) return;

      if (mv.isRename) {
        const tracePath = `${mv.src}.NAMETRACE`;
        if (!(await exists(tracePath))) {
          return { block: true, reason: `Rename blocked. Write ${tracePath} with the new name on the last line, then retry.` };
        }
        const last = await lastLine(tracePath);
        const newName = basename(mv.dst.endsWith("/") ? mv.src : mv.dst);
        if (!last.includes(newName)) {
          return { block: true, reason: `${tracePath} last line doesn't contain "${newName}". Update it, then retry.` };
        }
      } else {
        const tracePath = `${mv.src}.LOCATIONTRACE`;
        if (!(await exists(tracePath))) {
          return { block: true, reason: `Move blocked. Write ${tracePath} with the new path on the last line, then retry.` };
        }
        const last = await lastLine(tracePath);
        const dstDir = mv.dst.endsWith("/") ? mv.dst : dirname(mv.dst);
        if (!last.includes(dstDir.replace(/\/$/, ""))) {
          return { block: true, reason: `${tracePath} last line doesn't contain "${dstDir}". Update it, then retry.` };
        }
      }
      return;
    }
  });

  // ── tool_result: track edits for changelog ───────────────────────
  pi.on("input", async (event: any, _ctx) => {
    if (event.toolName !== undefined) {
      try { sendCustomMessage(pi, "tool-result-debug", `tool_result: ${event.toolName}`); } catch {}
      // 记录"看过哪些目录"：ls/read/grep/glob、bash 里的 ls/find，以及成功写过的目录(写过就算看过了)。
      if (!event.isError) {
      const inp = (event.input as any) || {};
      const ip = inp.path ?? inp.file_path ?? inp.dir ?? "";
      const mark = (p: string) => { try { dirsSeen.add(resolve(p)); } catch {} };
      const tn = event.toolName;
      if (tn === "read" || tn === "view") { if (ip) mark(dirname(ip)); const readme = join(dirname(ip), "dir.README"); if (ip && basename(ip) === "dir.README") { try { readmesSeen.add(resolve(ip)); } catch {} } }
      else if (tn === "ls" || tn === "list" || tn === "glob" || tn === "grep" || tn === "find") { if (ip) mark(ip); }
      else if (tn === "write") { if (ip) mark(dirname(ip)); }
      else if (tn === "bash") {
        const m = (inp.command || "").match(/\b(?:ls|find|tree|cat)\b[^|;&<>]*?\s(\/?[\w.~@/+-]+)/);
        if (m) mark(m[1]);
      }
      }
    }

    // ── 语法检查（edit/write 共用）──
    async function syntaxCheck(filePath: string, result: any) {
      const ext = filePath.split(".").pop()?.toLowerCase();
      const checker = ext === "ts" || ext === "tsx" ? "npx tsc --noEmit"
        : ext === "js" || ext === "mjs" || ext === "cjs" ? "node --check"
        : ext === "py" ? "python3 -m py_compile"
        : ext === "go" ? "go build"
        : ext === "rs" ? "cargo check --quiet"
        : null;
      if (checker) {
        try {
          const { execSync } = await import("node:child_process");
          execSync(`${checker} "${filePath}"`, { encoding: "utf8", timeout: 10000 });
        } catch (e: any) {
          const err = (e.stderr || e.stdout || e.message || "").toString().slice(0, 500);
          result.content.push({ type: "text", text: `WARN: 语法错误:\n${err}\n请立即修复。` });
          try { sendCustomMessage(pi, "syntax-error", `WARN: 语法错误 ${basename(filePath)}:\n${err}`); } catch {}
        }
      }
    }

    // ── write 后语法检查 ──
    if (event.toolName === "write" && !event.isError) {
      const path = (event.input as any)?.path ?? (event.input as any)?.file_path;
      if (path && !isExempt(path)) await syntaxCheck(path, event);
    }

    if (event.toolName === "edit" && !event.isError) {
      const path = (event.input as any)?.path ?? (event.input as any)?.file_path;
      if (!path || isExempt(path)) return;

      await syntaxCheck(path, event);

      // 编辑 DNA 文件后自动编译
      if (path.endsWith("coded.dna") || path.endsWith("promotor.dna")) {
        try {
          const { execSync } = await import("node:child_process");
          const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
          const out = execSync(`cd ${root} && bun Codebase/core/individual.bio.gene/transpiler.ts`, { encoding: "utf8", timeout: 10000 });
          if (out.includes("✗ error") || out.includes("WARN:")) {
            // 直接追加到 event 结果，模型立即可见
            const lines = out.split("\n").filter((l: string) => l.includes("✗") || l.includes("WARN:"));
            (event as any).result.content.unshift({ type: "text", text: `\nDNA 编译反馈:\n${lines.join("\n")}` });
          }
        } catch (e: any) {
          (event as any).result.content.unshift({ type: "text", text: `\nDNA 编译失败: ${e.message}` });
        }
      }

      if (path.endsWith(".HISTORY") || path.endsWith(".CHANGELOG")) {
        // 不记录对 HISTORY/CHANGELOG 本身的编辑
      } else {
        const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
        const oldStr = (event.input as any)?.old_string ?? (event.input as any)?.oldText ?? "";
        const newStr = (event.input as any)?.new_string ?? (event.input as any)?.newText ?? "";
        const diffLines: string[] = [`[${ts}] edit ${basename(path)}`];
        if (oldStr || newStr) {
          for (const l of oldStr.split("\n")) diffLines.push(`  - ${l}`);
          for (const l of newStr.split("\n")) diffLines.push(`  + ${l}`);
        }
        diffLines.push("");
        mkdir(dirname(path + ".HISTORY"), { recursive: true }).catch(() => {});
        appendFile(path + ".HISTORY", diffLines.join("\n"), "utf8").catch(() => {});
        changelogUpdatedThisTurn.add(path);
        editedThisTurn.add(path);
      }
    }

    // ── tool_result: auto-compute SPEC source hash ────────────────
    if ((event.toolName === "write" || event.toolName === "edit") && !event.isError) {
      const path = (event.input as any)?.path ?? (event.input as any)?.file_path;
      if (path && path.endsWith(".SPEC")) {
        const srcPath = path.slice(0, -".SPEC".length);
        try {
          const srcContent = await fsReadFile(srcPath);
          const hash = createHash("sha256").update(srcContent).digest("hex").slice(0, 8);
          const srcName = basename(srcPath);
          const hashLine = `source: ${srcName} @ ${hash}`;
          let specContent = await fsReadFile(path, "utf8");
          if (/^source:\s*\S+\s*@\s*[a-f0-9]+/.test(specContent)) {
            specContent = specContent.replace(/^source:\s*\S+\s*@\s*[a-f0-9]+/, hashLine);
          } else {
            specContent = hashLine + "\n\n" + specContent;
          }
          await fsWriteFile(path, specContent, "utf8");
        } catch {}
      }
    }

    // ── tool_result: auto-create CHANGELOG on write ─────────────────
    if (event.toolName === "write" && !event.isError) {
      const path = (event.input as any)?.path ?? (event.input as any)?.file_path;
      if (!path || isExempt(path)) return;

      const clPath = `${path}.CHANGELOG`;
      if (!(await exists(clPath))) {
        await appendFile(clPath, `[${fmt()}] created\n`, "utf8").catch(() => {});
      }
    }

    // ── tool_result: auto-move companions after mv ──────────────────
    if (event.toolName === "bash" && !event.isError) {
      // 检查 bash 是否创建了没有 .SPEC 的新文件
      const cmd = (event.input as any)?.command ?? "";
      const catMatch = cmd.match(/(?:cat|echo|tee)\s+>+\s*(\S+)/);
      const cpMatch = cmd.match(/\bcp\s+\S+\s+(\S+)/);
      const newFilePath = catMatch?.[1] ?? cpMatch?.[1];
      if (newFilePath && !isExempt(newFilePath)) {
        const filePath = resolve(newFilePath);
        const ext2 = newFilePath.includes('.') ? newFilePath.slice(newFilePath.lastIndexOf('.')) : '';
        const SELF = ['.md','.txt','.json','.yaml','.yml','.csv','.xml','.html','.css','.toml'];
        if (!SELF.includes(ext2) && !(await exists(`${filePath}.SPEC`))) {
          // 不 block——文件已创建——但追加 warn
          await appendFile(`${filePath}.SPEC`, "(auto-created: no spec provided)\n", "utf8").catch(() => {});
        }
      }

      const mv = parseMv(cmd);
      if (!mv || isExempt(mv.src)) return;

      // 禁止从 UNREGULATED 移出（绕过 SPEC 检查）
      if (mv.src.includes("/UNREGULATED/") || mv.src.includes(".UNREGULATED")) {
        return { block: true, reason: `${mv.src} 在 UNREGULATED 中。不能通过 mv 绕过 SPEC。先写 .SPEC 再用 write 工具重建。` };
      }

      const newPath = mv.dst.endsWith("/")
        ? join(mv.dst, basename(mv.src))
        : mv.dst;

      await moveCompanions(mv.src, newPath);

      const clPath = `${newPath}.CHANGELOG`;
      const action = mv.isRename ? "renamed" : "moved";
      await appendFile(clPath, `[${fmt()}] ${action} from ${mv.src}\n`, "utf8").catch(() => {});

      if (mv.isRename) {
        const ntPath = `${newPath}.NAMETRACE`;
        await appendFile(ntPath, `[${fmt()}] ${basename(mv.src)} → ${basename(newPath)}\n`, "utf8").catch(() => {});
      } else {
        const ltPath = `${newPath}.LOCATIONTRACE`;
        await appendFile(ltPath, `[${fmt()}] ${dirname(mv.src)} → ${dirname(newPath)}\n`, "utf8").catch(() => {});
      }
    }
  });

  // ── read 元数据：OS stat + git log（有 git 仓库时）──
  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName !== "read" || event.isError) return;
    const path = (event.input as any)?.path ?? (event.input as any)?.file_path;
    if (!path) return;
    try {
      const { statSync } = await import("node:fs");
      const abs = resolve(path);
      const st = statSync(abs);
      const size = st.size < 1024 ? `${st.size}B` : st.size < 1024*1024 ? `${(st.size/1024).toFixed(1)}KB` : `${(st.size/1024/1024).toFixed(1)}MB`;
      const mtime = new Date(st.mtimeMs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
      let meta = `@ ${size}  ${mtime}`;
      // git 检测：从文件所在目录向上找 .git
      let gitMsg = "";
      try {
        const { execSync } = await import("node:child_process");
        const dir = dirname(abs);
        if (execSync(`cd "${dir}" && git rev-parse --git-dir 2>/dev/null`, { timeout: 3000 }).toString().trim()) {
          const log = execSync(`cd "${dir}" && git log -1 --format="%s" -- "${abs}" 2>/dev/null`, { timeout: 3000 }).toString().trim();
          if (log) gitMsg = `\n  ${log}`;
        }
      } catch {}
      // 行数统计
      const input = event.input as any;
      const offset = input?.offset;
      const limit = input?.limit;
      const truncation = (event as any)?.details?.truncation;
      let shownLines = truncation?.outputLines;
      if (!shownLines) {
        const raw = (event as any)?.content?.[0]?.text || "";
        shownLines = raw.split("\n").length;
      }
      let lineInfo = `Read  ${shownLines} line${shownLines !== 1 ? "s" : ""}`;
      if (offset != null || limit != null) {
        const start = offset ?? 1;
        const end = start + (limit ?? shownLines) - 1;
        lineInfo += ` (lines ${start}-${end}`;
        if (truncation?.totalLines) lineInfo += ` of ${truncation.totalLines}`;
        lineInfo += ")";
      }
      const header = lineInfo;
      if ((event as any)?.content?.[0]?.type === "text") {
          return {
            content: [{ type: "text", text: header + "\n" + (event as any).content[0].text }],
            details: (event as any).details,
          };
      }
    } catch {}
  });

  // ── remove tool: move file to bin/ with .REMOVED suffix, or scan/clean ──
  registerPaimonTool({
    name: "remove",
    label: "Remove",
    messageDescription:
      "Remove files safely: mark for removal or move to bin/. " +
      "Three modes: (1) action=mark: rename <path> to <path>.REMOVED (in-place, reversible). " +
      "(2) action=scan: list all .REMOVED files under <dir>. " +
      "(3) action=clean: move all .REMOVED files under <dir> to <dir>/bin/. ",
    promptSnippet: "Remove: mark|scan|clean files via .REMOVED suffix",
    renderCall(args: any, theme: any) {
      const act = args?.action || "";
      const p = args?.path || "";
      return renderToolCall.command(theme, "Remove", `${act}${p ? " " + p : ""}`);
    },
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      const content = resultContent(result);
      return renderMessage.summary(theme, ctx, content?.[0]?.text);
    },
    parameters: Type.Object({
      action: Type.String({ messageDescription: "'mark'=rename to .REMOVED, 'scan'=list .REMOVED, 'clean'=move to bin/" }),
      path: Type.Optional(Type.String({ messageDescription: "File path (for mark) or project dir (for scan/clean)" })),
    }),
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      const action = params.action;
      const p = params.path || "";

      if (action === "mark") {
        if (!p) return { content: [{ type: "text", text: `mark 需要指定文件路径` }], details: {}, isError: true };
        if (!(await exists(p))) return { content: [{ type: "text", text: `文件不存在: ${p}` }], details: {}, isError: true };
        const markedPath = p + ".REMOVED";
        if (await exists(markedPath)) return { content: [{ type: "text", text: `${markedPath} 已存在` }], details: {}, isError: true };
        await fsRename(p, markedPath);
        return { content: [{ type: "text", text: `${p} -> ${markedPath}` }], details: { markedPath } };
      }

      if (action === "scan" || action === "clean") {
        const baseDir = resolve(p || ".");
        if (!(await exists(baseDir))) return { content: [{ type: "text", text: `目录不存在: ${baseDir}` }], details: {}, isError: true };

        // 递归扫描所有 .REMOVED 文件
        const found: string[] = [];
        async function walk(dir: string) {
          let entries: string[];
          try { entries = await readdir(dir); } catch { return; }
          for (const entry of entries) {
            const full = join(dir, entry);
            try {
              const s = await fsStat(full);
              if (s.isDirectory() && !entry.startsWith(".") && entry !== "bin") {
                await walk(full);
              } else if (entry.endsWith(".REMOVED")) {
                found.push(full);
              }
            } catch {}
          }
        }
        await walk(baseDir);

        if (action === "scan") {
          if (found.length === 0) return { content: [{ type: "text", text: `没有找到 .REMOVED 文件` }], details: { count: 0 } };
          return { content: [{ type: "text", text: `找到 ${found.length} 个 .REMOVED 文件:\n${found.map(f=>`  ${f}`).join("\n")}` }], details: { count: found.length, files: found } };
        }

        if (action === "clean") {
          if (found.length === 0) return { content: [{ type: "text", text: `没有 .REMOVED 文件需要清理` }], details: { count: 0 } };
          const binDir = join(baseDir, "bin");
          await mkdir(binDir, { recursive: true });
          let moved = 0;
          for (const f of found) {
            const dest = join(binDir, basename(f));
            try {
              await fsRename(f, dest);
              moved++;
            } catch {}
          }
          return { content: [{ type: "text", text: `已移动 ${moved}/${found.length} 个 .REMOVED 文件到 ${binDir}` }], details: { moved, total: found.length, binDir } };
        }
      }

      return { content: [{ type: "text", text: `未知 action: ${action}。用 mark / scan / clean。` }], details: {}, isError: true };
    },
  });

  // ── turn_end: auto-append changelog for missed edits ─────────────
  pi.on("turn_end", async (_event, _ctx) => {
    for (const path of editedThisTurn) {
      if (changelogUpdatedThisTurn.has(path)) continue;
      const clPath = `${path}.CHANGELOG`;
      await mkdir(dirname(clPath), { recursive: true }).catch(() => {});
      await appendFile(clPath, `[${fmt()}] edited (auto-logged, no messageDescription)\n`, "utf8").catch(() => {});
    }
    editedThisTurn.clear();
    changelogUpdatedThisTurn.clear();
  });
}
