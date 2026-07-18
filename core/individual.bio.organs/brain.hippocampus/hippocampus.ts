import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync, writeFileSync, statSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
let _errorLogPath = "/tmp/pi-silent-err.log";
const _log = (code: string, e: unknown) => { try { const d = _errorLogPath.replace(/\/[^/]+$/, ""); if (!existsSync(d)) mkdirSync(d, { recursive: true }); appendFileSync(_errorLogPath, `[${new Date().toISOString()}] [hippocampus][${code}] ${e}\n`); } catch {} };
function setErrorLog(personDir: string) { _errorLogPath = personDir.replace("/MemoryData/", "/ErrorData/") + "/error.log"; }
import { getPrompt } from "#ribosome";
import { personDir as getPersonDir } from "#paths";
import { registerMemory } from "./hippocampus-memory.ts";
export { registerMemory };
import { sendCustomMessage } from "#kernel_backbone";

// 海马体(后台编码)开关：每人持久化(JSON 布尔，不删文件)。off=停后台编码；主意识记忆快照/nap/sleep 不受影响。
function hcFlag(personDir: string): string { return `${personDir}/hippocampus.json`; }
function hcDisabled(personDir: string): boolean {
  try { return !!JSON.parse(readFileSync(hcFlag(personDir), "utf8")).disabled; } catch { return false; }
}
function setHcDisabled(personDir: string, disabled: boolean): void {
  try { writeFileSync(hcFlag(personDir), JSON.stringify({ disabled, ts: new Date().toISOString() })); } catch (e) { _log("setHcDisabled", e); }
}

export interface HippocampusHandle {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  getSessionId(): string;
}

export function createHippocampus(
  pi: ExtensionAPI,
  onError: (msg: string) => void,
  personDir: string,
): HippocampusHandle {
  setErrorLog(personDir);
  const personId = personDir.match(/([a-f0-9]+)$/)?.[1] ?? "x";
  const tmuxName = `hc-${personId}`;
      const sessionDir = path.join(personDir, "..", "..", "SessionData", personId, "HippocampusSessions");
  let running = false;

  function tmuxHas(): boolean {
    try {
      execSync(`tmux has-session -t ${tmuxName} 2>/dev/null`);
      return true;
    } catch { return false; }
  }

  const self: HippocampusHandle = {
    async start() {
      running = true;
      // 不检查 isRunning——总是先杀旧再建新，重启后 PID 变了旧 session 变孤儿，直接收割

      await mkdir(sessionDir, { recursive: true });

      // Write conv.json with system prompt so pi loads it on start
      const convPath = `${sessionDir}/conv.json`;
      await writeFile(convPath, JSON.stringify([
        { role: "system", content: getPrompt("hippocampus.gen_work_mem") }
      ]));

      // 重启后把 offset 对齐到 context.md 当前大小，让海马体从"现在"开始编码
      try { writeFileSync(`${personDir}/hc-offset`, String(statSync(`${personDir}/context.md`).size)); } catch (e) { _log("writeHcOffset", e); }

      // Write launch script
      const launchScript = `${personDir}/hippocampus-launch.sh`;
      const templatePath = fileURLToPath(new URL("./hippocampus-launcher.sh.template", import.meta.url));
      const script = readFileSync(templatePath, "utf8")
        .replaceAll("{{SESSION_DIR}}", sessionDir)
        .replaceAll("{{PERSON_DIR}}", personDir);
      await writeFile(launchScript, script);
      execSync(`chmod +x "${launchScript}"`, { stdio: "ignore" });

      try {
        try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {} // 先清掉同名僵尸 session（spawn failed 的根）
        execSync(
          `tmux new-session -d -s ${tmuxName} -c "${personDir}" 'bash "${launchScript}"'`,
          { stdio: "ignore" }
        );
      } catch (err: any) {
        onError(`Hippocampus tmux spawn failed: ${err?.message ?? err}`);
        running = false;
      }
    },

    stop() {
      running = false;
      try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {}
    },

    isRunning() { return tmuxHas(); },
    getSessionId() { return tmuxName; },
  };

  return self;
}

// ── func 入口（default(pi)）：海马体编码器进程的装配 ─────────────────────────
// 检测 personDir，agent 起来后 spawn hc-<id> tmux 持续编码（gen_work_mem）。
export default function (pi: ExtensionAPI) {
  if (process.env.PAIMON_NO_MC) return;
  // 只负责海马体 spawn（hc- tmux），registerMemory 由 kernel 通过 named import 单独调用
  let handle: HippocampusHandle | null = null;
  let personDir: string | null = null;
  let hcDisabledNotified = false;

  pi.on("session_start", async (_event, ctx) => {
    const sf = ctx.sessionManager.getSessionFile();
    personDir = getPersonDir(sf);
    try { appendFileSync("/tmp/hc-debug.log", `[${new Date().toISOString()}] session_start: sf=${sf} personDir=${personDir} hcDisabled=${personDir?hcDisabled(personDir):'N/A'}\n`); } catch {}
    // 立即启动海马体
    if (personDir && !hcDisabled(personDir)) {
      handle = createHippocampus(
        pi,
        (msg) => sendCustomMessage(pi, "hippocampus-error", `WARN: Hippocampus error: ${msg}`),
        personDir,
      );
      try { await handle.start(); (globalThis as any).__paimonHippocampusHandle = handle; } catch (e: any) {
        try { sendCustomMessage(pi, "hippocampus-error", `WARN: 海马体启动异常（已隔离，不影响主意识）: ${e?.message ?? e}`); } catch (e2) { _log("sendHcError", e2); }
      }
    }
  });

  pi.on("session_shutdown", async () => {
    handle?.stop();
    handle = null;
    personDir = null;
  });

  return [];
}
