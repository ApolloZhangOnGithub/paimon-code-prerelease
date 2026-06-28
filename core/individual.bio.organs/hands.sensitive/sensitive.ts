import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

const SENSITIVE = [
  /\bgh\s+repo\s+create\b/,
  /\bgit\s+push\b.*\b--force\b/,
  /\bgh\s+repo\s+delete\b/,
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (isToolCallEventType("bash", event)) {
      const cmd = (event.input as any).command ?? "";
      for (const p of SENSITIVE) {
        if (p.test(cmd)) {
          return {
            block: true,
            reason: "GitHub 敏感操作被拦截。新建/删除 repo、force push 需要用户授权。",
          };
        }
      }
    }
  });
}
