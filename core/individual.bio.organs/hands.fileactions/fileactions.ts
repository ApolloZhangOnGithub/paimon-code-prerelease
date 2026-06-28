import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType, isBashToolResult } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { access, readFile, appendFile, rename as fsRename, mkdir, readdir, stat as fsStat } from "node:fs/promises";
import { dirname, basename, resolve, join } from "node:path";
import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { createHash } from "node:crypto";

let FILE_RULES: any[] = [];
(async () => {
  try {
    const raw = await fsReadFile(resolve(dirname(new URL(import.meta.url).pathname), "file_rules.json"), "utf8");
    FILE_RULES = JSON.parse(raw).rules ?? [];
  } catch {}
})();
import { getPrompt } from "#runtime";
import { loadTrust, checkAuth, getWorkDir, setWorkDir, addTrust, removeTrust } from "./authorize.ts";
import { startWatcher } from "./filewatch.ts";
import { sendCustomMessage } from "#messages";

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
    p.includes("/.pi/agent/auth.json") ||
    p.includes("/.pi/agent/trust.json") ||
    p.includes("/.pi/agent/models.json") ||
    p.includes("/fileactions.ts") ||
    p.includes("/pi-coding-agent/dist/") ||
    p.includes("/pi-coding-master.RELEASE/") ||
    p.includes("/.local/bin/pi") ||
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

export default function (pi: ExtensionAPI) {
  startWatcher();
  loadTrust();

  const editedThisTurn = new Set<string>();
  const changelogUpdatedThisTurn = new Set<string>();
  const dirsSeen = new Set<string>();
  const readmesSeen = new Set<string>(); // 已读过的 dir.README，resolve 绝对路径

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

    // ── 系统保护: SSH密钥/凭证/钱包/自身代码/pi dist ──
    if (authPath && isSystemProtected(authPath)) {
      const isRead = ["read","view","ls","list","glob","grep","find"].includes(event.toolName);
      if (authPath.includes("/.ssh/") || authPath.includes("auth.json") || authPath.includes("models.json")) {
        return { block: true, reason: `系统保护 — ${authPath.split("/").pop()} 是凭证文件，agent 不可访问。` };
      }
      if (authPath.includes("/pi-coding-agent/dist/") && !isRead) {
        return { block: true, reason: `pi dist 保护 — 不要直接改 live dist。改 Codebase/deploy/dist-overrides/ 里的 golden 文件，然后跑 bash install.sh 部署。` };
      }
      if (authPath.includes("/pi-coding-master.RELEASE/") && !isRead) {
        return { block: true, reason: `RELEASE 保护 — 不要改发布版。改 pi-coding-master.DEV/ 下的开发版。` };
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
        return { block: true, reason: authReason + "\n可用命令请求授权: web auth.ask <目录> [分钟数]" };
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

      const specPath = `${path}.SPEC`;
      if (!(await exists(specPath))) {
        return { block: true, reason: `No spec found. Write ${specPath} first (any format, non-empty), then retry.` };
      }
      if (!(await nonEmpty(specPath))) {
        return { block: true, reason: `${specPath} is empty. Write your design/plan in it, then retry.` };
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
        return { block: true, reason: "禁止 rm！用 remove({action:'mark', path:'...'}) 工具把文件标记为 .REMOVED（重命名）。" };
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
  pi.on("tool_result", async (event, _ctx) => {
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

    // ── 语法检查（edit/write 共用）──
    async function syntaxCheck(filePath: string, result: any) {
      require("fs").appendFileSync("/tmp/syntax-check.log", `SC:${filePath}\n`);
      const ext = filePath.split(".").pop()?.toLowerCase();
      const checker = ext === "ts" ? "bun --check" : ext === "js" ? "node --check" : ext === "py" ? "python3 -m py_compile" : null;
      if (checker) {
        try {
          const { execSync } = await import("node:child_process");
          execSync(`${checker} "${filePath}"`, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
        } catch (e: any) {
          const stderr = (e.stderr || e.stdout || e.message || "").toString().slice(0, 500);
          result.content.push({ type: "text", text: `WARN: 语法错误:\n${stderr}\n请立即修复。` });
          try { sendCustomMessage(pi, "syntax-error", `WARN: 语法错误 ${basename(filePath)}:\n${stderr}`); } catch {}
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
          const root = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
          const out = execSync(`cd ${root} && bun Codebase/core/individual.bio.gene/dna.transpiler/transpiler.ts`, { encoding: "utf8", timeout: 10000 });
          if (out.includes("✗ error") || out.includes("WARN:")) {
            // 直接追加到 event 结果，模型立即可见
            const lines = out.split("\n").filter((l: string) => l.includes("✗") || l.includes("WARN:"));
            event.result.content.unshift({ type: "text", text: `\nDNA 编译反馈:\n${lines.join("\n")}` });
          }
        } catch (e: any) {
          event.result.content.unshift({ type: "text", text: `\nDNA 编译失败: ${e.message}` });
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
        if (!(await exists(`${filePath}.SPEC`))) {
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

  // ── remove tool: move file to bin/ with .REMOVED suffix, or scan/clean ──
  pi.registerTool({
    name: "remove",
    label: "Remove",
    messageDescription:
      "Remove files safely: mark for removal or move to bin/. " +
      "Three modes: (1) action=mark: rename <path> to <path>.REMOVED (in-place, reversible). " +
      "(2) action=scan: list all .REMOVED files under <dir>. " +
      "(3) action=clean: move all .REMOVED files under <dir> to <dir>/bin/. ",
    promptSnippet: "Remove: mark|scan|clean files via .REMOVED suffix",
    parameters: Type.Object({
      action: Type.String({ messageDescription: "'mark'=rename to .REMOVED, 'scan'=list .REMOVED, 'clean'=move to bin/" }),
      path: Type.Optional(Type.String({ messageDescription: "File path (for mark) or project dir (for scan/clean)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
