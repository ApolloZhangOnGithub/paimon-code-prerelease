import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getPrompt } from "#runtime";
import { createRequire } from "node:module";
import { sendCustomMessage } from "#messages";
const require = createRequire(import.meta.url);

const PROMPT = getPrompt("heart.commands");
const BG_THRESHOLD_MS = 1000;

interface RunningCmd {
  command: string;
  abort: AbortController;
  startTime: number;
  killedByUser: boolean;
  context: string;
}

export function registerProcess(pi: ExtensionAPI) {
  let nextId = 1;
  let _lastCmd = "";
  const running = new Map<number, RunningCmd>();

  pi.on("before_agent_start", async (event) => {
    try {
      const active = pi.getActiveTools();
      if (active.includes("bash")) pi.setActiveTools(active.filter((n: string) => n !== "bash"));
    } catch {}
    return { systemPrompt: event.systemPrompt + "\n\n" + PROMPT };
  });

  pi.registerTool({
    name: "execute",
    label: "Execute",
    messageDescription: "Execute a shell command. Fast commands return immediately. Slow commands auto-background.",
    promptSnippet: "Execute shell command",
    parameters: Type.Object({
      command: Type.String({ messageDescription: "Shell command to execute" }),
    }),
    renderCall(args: any, theme: any) {
      const { Text } = require("@earendil-works/pi-tui");
      const cmd = args?.command || _lastCmd || "...";
      return new Text(theme.fg("toolTitle", theme.bold("● Execute ")) + theme.fg("text", cmd), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const cmd = params.command;
      _lastCmd = cmd.split("\n")[0].slice(0, 80);

      if (/^\s*sleep\s+[\d.]+\s*$/.test(cmd) || /(^|&&|;|\|)\s*sleep\s+[\d.]+(\s*&&|\s*;|\s*\||$)/.test(cmd)) {
        return { content: [{ type: "text", text: "Sleep blocked" }], details: { blocked: true }, isError: true };
      }
      // NORM-009: 禁写 + execute ls 触发 markLs
      if (/(>\s+\S|>>\s+\S|tee\s+\S|dd\s+.*\bof=|\bsed\s+.*-i|\bcp\b|\bmv\b|\bmkdir\b|\btouch\b|\brm\b|\bchmod\b|\bchown\b|\bnpx\b|\bnpm\s+(i|install)|\bwget\b|\bcurl\b.*-[oO])/i.test(cmd)) {
        return { content: [{ type: "text", text: "execute 禁写。用 edit 修改文件，write 创建新文件。" }], details: { blocked: true }, isError: true };
      }
      if (/^ls\s+/.test(cmd)) { global.__ls_dir = cmd.replace(/^ls\s+/, "").trim(); }

      const ac = new AbortController();
      const startTime = Date.now();
      const execPromise = pi.exec("bash", ["-c", cmd], { signal: ac.signal });

      const race = await Promise.race([
        execPromise.then(r => ({ done: true as const, result: r })),
        new Promise<{ done: false }>(resolve => setTimeout(() => resolve({ done: false }), BG_THRESHOLD_MS)),
      ]);

      if (race.done) {
        const r = race.result;
        const output = [r.stdout, r.stderr].filter(Boolean).join("\n").slice(0, 50000);
        const exitInfo = r.code !== 0 ? `\n(exit ${r.code})` : "";
        return {
          content: [{ type: "text", text: `${output || "(no output)"}${exitInfo}` }],
          details: { exitCode: r.code },
        };
      }

      const id = nextId++;
      let context = "";
      try {
        const msgs = _ctx.sessionManager?.getBranch?.() ?? [];
        const recent = msgs.slice(-5);
        context = recent.map((e: any) => {
          const m = e.message ?? e;
          const role = m.role ?? e.type ?? "?";
          const text = typeof m.content === "string" ? m.content
            : Array.isArray(m.content) ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ") : "";
          return `[${role}] ${text.slice(0, 100)}`;
        }).filter(Boolean).join("\n");
      } catch {}
      running.set(id, { command: cmd, abort: ac, startTime, killedByUser: false, context });

      (async () => {
        try {
          const r = await execPromise;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const output = [r.stdout, r.stderr].filter(Boolean).join("\n").slice(0, 50000);
          try {
            pi.sendMessage(
              { messageType: "continuous-cmd-done", content: `完成 (${elapsed}s, exit ${r.code}):\n$ ${cmd}\n${output || "(no output)"}`, isDisplayedInTUI: false },
              { deliverAs: "steer", isTriggerNewTurn: true }
            );
          } catch {}
        } catch (err: any) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const entry = running.get(id);
          const msg = entry?.killedByUser
            ? `Command killed by user (${elapsed}s):\n$ ${cmd}`
            : `Command failed (${elapsed}s):\n$ ${cmd}\n${err?.message ?? err}`;
          try { sendCustomMessage(pi, "continuous-cmd-done", msg); } catch {}
        } finally {
          running.delete(id);
        }
      })();

      return {
        content: [{ type: "text", text: `Running in background (${running.size} running). Keep working.` }],
        details: {},
      };
    },
  });

}
