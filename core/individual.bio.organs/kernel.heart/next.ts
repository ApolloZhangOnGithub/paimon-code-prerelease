// kernel.heart/next.ts — /pause 命令处理器（wait/hibernate 已拆为独立工具）
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { join } from "node:path";
import { memoryDir } from "#paths";
import { heartState, transition, personId } from "./state.ts";

export function registerPauseHandler(_pi: ExtensionAPI) {
  (globalThis as any).__paimonPauseHandler = async (_args: any, ctx: any) => {
    const pid = personId();
    const pauseFile = join(memoryDir(pid), "paused");
    if (heartState() === "paused") {
      try { require("fs").unlinkSync(pauseFile); } catch {}
      transition({ kind: "working" });
      ctx.ui.notify("已恢复。", "info");
    } else {
      try { require("fs").mkdirSync(memoryDir(pid), { recursive: true }); require("fs").writeFileSync(pauseFile, String(Date.now())); } catch {}
      transition({ kind: "paused", reason: "command" });
      ctx.ui.notify("已暂停。发任意消息恢复。", "info");
    }
  };
}
