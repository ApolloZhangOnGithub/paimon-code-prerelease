import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { getPrompt } from "#runtime";
import { personDir as getPersonDir } from "#paths";
import { registerMemory } from "./memory.ts";
import { sendCustomMessage } from "#messages";

// 海马体(后台编码)开关：每人持久化(JSON 布尔，不删文件)。off=停后台编码；主意识记忆快照/nap/sleep 不受影响。
function hcFlag(personDir: string): string { return `${personDir}/.data/hippocampus.json`; }
function hcDisabled(personDir: string): boolean {
  try { return !!JSON.parse(readFileSync(hcFlag(personDir), "utf8")).disabled; } catch { return false; }
}
function setHcDisabled(personDir: string, disabled: boolean): void {
  try { writeFileSync(hcFlag(personDir), JSON.stringify({ disabled, ts: new Date().toISOString() })); } catch {}
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
  const personId = personDir.match(/([a-f0-9]+)$/)?.[1] ?? "x";
  const tmuxName = `hc-${personId}`;
  const sessionDir = `${personDir}/.data/hippocampus-sessions`;
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
      if (tmuxHas()) return; // already alive

      await mkdir(sessionDir, { recursive: true });

      const dataDir = `${personDir}/.data`;

      // Write conv.json with system prompt so pi loads it on start
      const convPath = `${sessionDir}/conv.json`;
      await writeFile(convPath, JSON.stringify([
        { role: "system", content: getPrompt("hippocampus.gen_work_mem") }
      ]));

      // 重启后把 offset 对齐到 context.md 当前大小，让海马体从"现在"开始编码
      try { writeFileSync(`${dataDir}/.hc-offset`, String(statSync(`${dataDir}/context.md`).size)); } catch {}

      // Write launch script
      const launchScript = `${personDir}/.data/hippocampus-launch.sh`;
      const templatePath = new URL("./hippocampus-launcher.sh.template", import.meta.url).pathname;
      const script = readFileSync(templatePath, "utf8")
        .replaceAll("{{SESSION_DIR}}", JSON.stringify(sessionDir))
        .replaceAll("{{DATA_DIR}}", JSON.stringify(dataDir))
        .replaceAll("{{MAIN_PID}}", String(process.pid))
        .replaceAll("{{TMUX_NAME}}", tmuxName);
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
  const _cmds: any[] = [];
  // 海马体 = 记忆 func（tag memory）。两部分：
  //  1) 主意识里的记忆机能（注入各层 / editcontext / 容量监控 / nap·sleep 触发）
  const _memoryCmds = registerMemory(pi);
  if (_memoryCmds) _cmds.push(..._memoryCmds);
  //  2) 后台独立 pi 小号（hc-）持续把 context 再反思进 work_memory
  let handle: HippocampusHandle | null = null;
  let personDir: string | null = null;
  let hcDisabledNotified = false;

  // ── /hippocampus 开关：禁用/启用后台记忆编码（每人持久，重启仍生效；不影响主意识快照/nap/sleep）──
  _cmds.push({
    name: "brain-hippocampus",
    desc: "海马体(后台编码)开关：/brain-hippocampus [on|off]。off=停后台编码(主意识快照/nap/sleep 不受影响)，持久、重启仍生效。",
    handler: async (args: any, ctx: any) => {
      const pd = personDir;
      if (!pd) { ctx.ui.notify("当前无 person 目录（主意识 session 才能切）。", "warning"); return; }
      const a = (args ?? "").trim().toLowerCase();
      if (a === "off") {
        setHcDisabled(pd, true);
        try { handle?.stop(); } catch {}
        handle = null;
        ctx.ui.notify("海马体已禁用（持久，重启仍生效）。主意识快照/nap/sleep 照常，只是不再后台自动编码 work_memory。/hippocampus on 恢复。", "info");
      } else if (a === "on") {
        setHcDisabled(pd, false);
        hcDisabledNotified = false;
        ctx.ui.notify("海马体已启用（下一轮起后台编码恢复）。", "info");
      } else {
        ctx.ui.notify(`海马体当前：${hcDisabled(pd) ? "禁用" : "启用"}。/hippocampus [on|off] 切换。`, "info");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const sf = ctx.sessionManager.getSessionFile();
    personDir = getPersonDir(sf);
  });

  pi.on("agent_start", async () => {
    if (handle?.isRunning()) return;
    if (!personDir) return;
    if (hcDisabled(personDir)) {
      if (!hcDisabledNotified) {
        hcDisabledNotified = true;
        sendCustomMessage(pi, "memory-hippocampus-disabled", "海马体已禁用（/hippocampus on 恢复）");
      }
      return;
    }
    handle = createHippocampus(
      pi,
      (msg) => sendCustomMessage(pi, "hippocampus-error", `WARN: Hippocampus error: ${msg}`),
      personDir,
    );
    // 防御：海马体启动出任何错（launcher 模板/tmux/任意异常）只记一条，绝不带崩主意识 pi。
    // 这次 ${CAP} 写错就是因为没这层防护——一个小号 launcher 的 bug 直接 uncaughtException 把整个主意识崩了。
    handle.start().catch((e: any) => {
      try { sendCustomMessage(pi, "hippocampus-error", `WARN: 海马体启动异常（已隔离，不影响主意识）: ${e?.message ?? e}`); } catch {}
    });
  });

  pi.on("session_shutdown", async () => {
    handle?.stop();
    handle = null;
    personDir = null;
  });

  return _cmds;
}
