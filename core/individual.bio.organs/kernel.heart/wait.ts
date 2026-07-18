// kernel.heart/wait — 独立 wait 工具（从 next.ts 拆出）
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { join } from "node:path";
import { runtimeCacheDir } from "#paths";
import { registerPaimonTool, sendCustomMessage, resultContent } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";
import { heartState, setHasUserMessage, transition, dlog, personId, isWaitDisabled } from "./state.ts";

export function registerWaitTool(pi: ExtensionAPI) {
  registerPaimonTool({
    name: "wait",
    label: "Wait",
    messageDescription:
      "Pause for N seconds before auto-resuming. Use when you need to wait for something or give the user time.\n" +
      "- wait_for_user: true = spend pause listening for user input\n" +
      "- next_steps: what to do when you wake up",
    promptSnippet: "wait({seconds:N}) to pause, wait({seconds:N, wait_for_user:true}) to listen",
    parameters: Type.Object({
      seconds: Type.Number({ messageDescription: "Seconds to pause (1-86400)" }),
      wait_for_user: Type.Optional(Type.Boolean({ messageDescription: "Listen for user input during wait" })),
      next_steps: Type.Optional(Type.String({ messageDescription: "What to do when you wake up" })),
    }),
    renderCall(args: any, theme: any) {
      const s = args?.seconds ?? "?";
      const wu = args?.wait_for_user ? " (for user)" : "";
      return renderToolCall.label(theme, "Wait", `${s}s${wu}`);
    },
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      // wait 由 spinner 系统接管显示，结束后由 continuous-resume 消息渲染 "• Waited XXs"
      return renderMessage.silent();
    },
    async execute(_id, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as { seconds: number; wait_for_user?: boolean; next_steps?: string };
      // 已在阻塞态 → 不覆盖（hibernate 不该被 wait 降级）
      if (heartState() !== "working") {
        return { content: [{ type: "text", text: `Already ${heartState()}. Ignoring wait.` }] };
      }
      if (isWaitDisabled()) {
        return { content: [{ type: "text", text: "ERR: wait 已被禁用（/wait off）。用 hibernate 休息。" }], details: {}, isError: true };
      }
      const secs = Math.max(1, params.seconds);
      const waiting = params.wait_for_user === true;
      setHasUserMessage(false);

      let remaining = secs;
      const label = () => (waiting ? `Waiting for user ${remaining}s...` : `Waiting ${remaining}s...`);

      const countdownTimer = setInterval(() => {
        if (heartState() !== "resting") { clearInterval(countdownTimer); return; }
        if (globalThis.__piEscJustPressed === true) {
          globalThis.__piEscJustPressed = false;
          dlog("countdown: ESC → paused");
          const elapsed = secs - remaining;
          try { sendCustomMessage(pi, "continuous-cmd-done", `${waiting ? "Listened" : "Waited"} ${elapsed}s (interrupted after ${elapsed}/${secs}s)`); } catch {}
          transition({ kind: "paused", reason: "esc" });
          setHasUserMessage(false);
          return;
        }
        remaining--;
        if (remaining <= 0) { clearInterval(countdownTimer); return; }
        try { ctx.ui.setWorkingMessage(label()); } catch {}
      }, 1000);

      const resumeTimer = setTimeout(() => {
        if (heartState() !== "resting") return;
        if (globalThis.__piEscJustPressed === true) {
          globalThis.__piEscJustPressed = false;
          dlog("resumeTimer: ESC → paused");
          const elapsed = secs;
          try { sendCustomMessage(pi, "continuous-cmd-done", `${waiting ? "Listened" : "Waited"} ${elapsed}s (interrupted after ${elapsed}/${secs}s)`); } catch {}
          transition({ kind: "paused", reason: "esc" });
          return;
        }
        dlog("resumeTimer: FIRED → alive");
        transition({ kind: "working" });
        try {
          const wakeMsg = params.next_steps ? `[wait ${secs}s 结束] ${params.next_steps}` : `[wait ${secs}s 结束]`;
          sendCustomMessage(pi, "continuous-resume", wakeMsg, { resumeType: "wait" });
        } catch {}
      }, secs * 1000);

      transition({ kind: "resting", resumeTimer, countdownTimer });
      try {
        const pid = personId();
        if (pid) require("fs").writeFileSync(join(runtimeCacheDir(pid), "main-resting"), String(Date.now()), "utf8");
      } catch {}
      try { ctx.ui.setWorkingMessage(label()); } catch {}
      dlog(`wait:${secs}s`);
      // terminate:true is handled by the agent-session.js override (god.tui/overrides).
      // It calls runner.abortFn() which stops the agent loop before the next turn.
      // renderResult 已改为 spinner(.75)，content 不再显示，保留 details 供状态机使用
      return { content: [{ type: "text", text: "" }], details: { wait: secs, waiting }, terminate: true };
    },
  });
}
