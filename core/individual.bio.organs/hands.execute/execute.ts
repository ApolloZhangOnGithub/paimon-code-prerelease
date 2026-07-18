import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { exec } from "node:child_process";
import { registerPaimonTool, sendCustomMessage, resultContent } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";
import { validateExecute } from "../hands.fileactions/fileactions.ts";

// ── shell 工具函数（terminal.ts 等外部模块也用）──

export function asyncSh(cmd: string, timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: "utf8", timeout }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function asyncShSafe(cmd: string, timeout = 5000): Promise<string> {
  try { return await asyncSh(cmd, timeout); } catch { return ""; }
}

// ── execute tool ──

const BG_THRESHOLD_MS = 1000;

interface RunningCmd {
  command: string;
  abort: AbortController;
  startTime: number;
  killedByUser: boolean;
  context: string;
}

export default function registerExecute(pi: ExtensionAPI) {
  let nextExecId = 1;
  let _lastCmd = "";
  const running = new Map<number, RunningCmd>();

  pi.on("before_agent_start", async () => {
    try {
      const active = pi.getActiveTools();
      if (active.includes("bash")) pi.setActiveTools(active.filter((n: string) => n !== "bash"));
    } catch {};
  });

  registerPaimonTool({
    name: "execute",
    label: "Execute",
    messageDescription: "Execute shell command (只读。删除文件请用 trash 命令)。Fast commands return immediately. Slow commands auto-background.",
    promptSnippet: "Execute shell command (只读，删除用 trash)",
    parameters: Type.Object({
      command: Type.String({ messageDescription: "Shell command to execute" }),
      stream: Type.Optional(Type.Boolean({ messageDescription: "Stream output as command runs (long commands only)" })),
      timeout: Type.Optional(Type.Number({ messageDescription: "Timeout in seconds (optional, no default timeout)" })),
    }),
    renderCall(args: any, theme: any) {
      return renderToolCall.command(theme, "Execute", args?.command || _lastCmd || "...");
    },
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      const rc = result?.details?.renderText != null
        ? [{ type: "text", text: result.details.renderText }]
        : resultContent(result);
      return renderMessage.output(theme, ctx, rc);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const cmd = params.command;
      _lastCmd = cmd.split("\n")[0].slice(0, 80);

      if (/^\s*sleep\s+[\d.]+\s*$/.test(cmd) || /(^|&&|;|\|)\s*sleep\s+[\d.]+(\s*&&|\s*;|\s*\||$)/.test(cmd)) {
        return { content: [{ type: "text", text: "Sleep blocked" }], details: { blocked: true }, isError: true };
      }
      const v = validateExecute(cmd);
      if (v.blocked) {
        return { content: [{ type: "text", text: v.message! }], details: { blocked: true }, isError: true };
      }
      if (/^ls\s+/.test(cmd)) { (global as any).__ls_dir = cmd.replace(/^ls\s+/, "").trim(); }

      const timeoutSec: number | undefined = params.timeout;
      const ac = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      if (timeoutSec !== undefined && timeoutSec > 0) {
        timeoutHandle = setTimeout(() => ac.abort(), timeoutSec * 1000);
      }
      const startTime = Date.now();
      const wantStream = params.stream === true;
      const execPromise = pi.exec("bash", ["-c", cmd], { signal: ac.signal, timeout: timeoutSec !== undefined ? timeoutSec * 1000 : undefined });

      const race = await Promise.race([
        execPromise.then(r => ({ done: true as const, result: r })),
        new Promise<{ done: false }>(resolve => setTimeout(() => resolve({ done: false }), BG_THRESHOLD_MS)),
      ]);

      if (timeoutHandle) clearTimeout(timeoutHandle);

      if (race.done) {
        const r = race.result;
        const output = [r.stdout, r.stderr].filter(Boolean).join("\n").slice(0, 50000);
        if (r.killed && timeoutSec) {
          return {
            content: [{ type: "text", text: `${output || "(no output)"}\n(超时 ${timeoutSec}s)` }],
            details: { exitCode: r.code, timedOut: true },
            isError: true,
          };
        }
        const exitInfo = r.code !== 0 ? `\n(exit ${r.code})` : "";
        return {
          content: [{ type: "text", text: `${output || "(no output)"}${exitInfo}` }],
          details: { exitCode: r.code },
        };
      }

      const id = nextExecId++;
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

      if (wantStream) {
        // 流式：用 spawn 实时推送 stdout/stderr 增量
        const { spawn } = require("child_process");
        const child = spawn("bash", ["-c", cmd], { signal: ac.signal, stdio: ["ignore", "pipe", "pipe"] });
        let accum = "";
        const push = (chunk: string) => {
          accum += chunk;
          try { _onUpdate({ content: [{ type: "text", text: chunk }] }); } catch {}
        };
        child.stdout.on("data", (d: Buffer) => push(d.toString()));
        child.stderr.on("data", (d: Buffer) => push(d.toString()));
        (async () => {
          try {
            const code = await new Promise<number>((resolve, reject) => {
              child.on("close", resolve);
              child.on("error", reject);
            });
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const output = accum.slice(0, 50000);
            try {
              sendCustomMessage(pi, "continuous-cmd-done", `完成 (${elapsed}s, exit ${code}):\n$ ${cmd}\n${output || "(no output)"}`);
            } catch {}
          } catch (err: any) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            try { sendCustomMessage(pi, "continuous-cmd-done", `Command failed (${elapsed}s):\n$ ${cmd}\n${err?.message ?? err}`); } catch {}
          } finally {
            running.delete(id);
          }
        })();
        return {
          content: [{ type: "text", text: `Running in background (streaming, ${running.size} running).` }],
          details: {},
        };
      }

      (async () => {
        try {
          const r = await execPromise;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const output = [r.stdout, r.stderr].filter(Boolean).join("\n").slice(0, 50000);
          try {
            sendCustomMessage(pi, "continuous-cmd-done", `完成 (${elapsed}s, exit ${r.code}):\n$ ${cmd}\n${output || "(no output)"}`);
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
        details: { renderText: `Running in background (${running.size} running).` },
      };
    },
  });
}
