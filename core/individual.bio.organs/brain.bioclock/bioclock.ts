import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sendCustomMessage } from "#kernel_backbone";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    // 只在 resume/wake 时发日期（不是新 session）
    if (event.reason === "reload" || event.reason === "resume") {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      sendCustomMessage(pi, "continuous-date", `Current date: ${date}. Timestamps are wall-clock.`);
    }
  });

  function fmt(ts: number): string {
    const d = new Date(ts);
    const p2 = (n: number) => String(n).padStart(2, "0");
    const p3 = (n: number) => String(n).padStart(3, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
  }

  // Only stamp user and toolResult messages (input side).
  // Assistant messages are the model's own output — it knows when it spoke.
  // Return { message } to properly replace, not mutate in place.
  pi.on("message_end", async (event, _ctx) => {
    const msg = event.message;
    if (!msg) return;

    const role = (msg as any).role;
    if (role !== "user") return;

    const ts = (msg as any).timestamp;
    if (!ts || typeof ts !== "number") return;

    const tag = ` [${fmt(ts)}]`;
    const content = (msg as any).content;

    if (typeof content === "string") {
      return { message: { ...msg, content: content.replace(/\s+$/, "") + tag } };
    }

    if (!Array.isArray(content)) return;

    const newContent = content.map((c: any, i: number, arr: any[]) => {
      // Find last text block
      const isLastText =
        c.type === "text" &&
        typeof c.text === "string" &&
        !arr.slice(i + 1).some((x: any) => x.type === "text");
      if (isLastText) {
        return { ...c, text: c.text.replace(/\s+$/, "") + tag };
      }
      return c;
    });

    return { message: { ...msg, content: newContent } };
  });

  // ── Per-tool timing: stamp each tool result with finish time + duration ──
  // Embedded in the result itself, so the model knows exactly how long
  // each command took. No duplicate-timestamp noise.
  const toolStart = new Map<string, number>();

  pi.on("tool_execution_start", async (event) => {
    const id = (event as any).toolCallId;
    if (id) toolStart.set(id, Date.now());
  });

  pi.on("tool_result", async (event, _ctx) => {
    const toolName = (event as any).toolName;
    // 元工具（intentions/hibernate/wait）不需要时间戳
    if (toolName === "intentions" || toolName === "hibernate" || toolName === "wait") return;
    const id = (event as any).toolCallId;
    const start = id ? toolStart.get(id) : undefined;
    if (id) toolStart.delete(id);

    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const time = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3,'0')}`;
    const dur = start ? ` +${((Date.now() - start) / 1000).toFixed(1)}s` : "";
    const tag = `\n[${time}${dur}]`;

    const content = (event as any).content;
    if (!Array.isArray(content)) return;

    const textBlocks = content.filter((c: any) => c.type === "text" && typeof c.text === "string");
    if (textBlocks.length === 0) return;

    const newContent = content.map((c: any) => {
      if (c === textBlocks[textBlocks.length - 1]) {
        return { ...c, text: c.text.replace(/\s+$/, "") + tag };
      }
      return c;
    });

    return { content: newContent };
  });
}
