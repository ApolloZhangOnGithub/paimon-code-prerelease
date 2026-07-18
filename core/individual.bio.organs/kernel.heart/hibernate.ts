// kernel.heart/hibernate — 独立 hibernate 工具（从 next.ts 拆出）
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSessionRole } from "#ribosome";
import { runtimeCacheDir } from "#paths";
import { registerPaimonTool } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";
import { heartState, setHasUserMessage, transition, dlog, personId, isHibernateDisabled } from "./state.ts";

export function registerHibernateTool(_pi: ExtensionAPI) {
  registerPaimonTool({
    name: "hibernate",
    label: "Hibernate",
    messageDescription:
      "Deep sleep until user returns. Call when you have nothing left to do.\n" +
      "Summary should describe what you accomplished.",
    promptSnippet: "hibernate({summary:'what you did'}) to deep sleep",
    parameters: Type.Object({
      summary: Type.String({ messageDescription: "Summary of what you accomplished" }),
    }),
    renderCall(args: any, theme: any) {
      return renderToolCall.label(theme, "Hibernate", args?.summary?.trim());
    },
    renderResult() {
      return renderMessage.spinner();
    },
    async execute(_id, rawParams, _signal, _onUpdate, _ctx) {
      const params = rawParams as { summary: string };
      // 已在阻塞态 → 不重复转移
      if (heartState() !== "working") {
        return { content: [{ type: "text", text: "" }], details: {} };
      }
      if (!params.summary?.trim()) {
        return { content: [{ type: "text", text: "ERR: summary 不能为空。" }], details: {}, isError: true };
      }
      if (getSessionRole() === "metaconsciousness") {
        return { content: [{ type: "text", text: "ERR: 元意识不能 hibernate。用 wait 代替。" }], details: {}, isError: true };
      }
      if (isHibernateDisabled()) {
        return { content: [{ type: "text", text: "ERR: hibernate 已被禁用（/hibernate off）。用 wait 代替。" }], details: {}, isError: true };
      }
      transition({ kind: "hibernated", ts: Date.now() });
      setHasUserMessage(false);
      dlog("hibernate");
      try {
        const pid = personId();
        const role = getSessionRole();
        const tag = role === "main" ? "main-hibernate" : role === "metaconsciousness" ? "mc-hibernate" : null;
        if (pid && tag) writeFileSync(join(runtimeCacheDir(pid), tag), String(Date.now()), "utf8");
      } catch {}
      // terminate:true is handled by the agent-session.js override (god.tui/overrides).
      // It calls runner.abortFn() which stops the agent loop before the next turn.
      return { content: [{ type: "text", text: `Hibernating: ${params.summary.trim()}` }], details: { hibernate: params.summary }, terminate: true };
    },
  });
}
