import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const SENSITIVE = [
  /\bgh\s+repo\s+create\b/,
  /\bgit\s+push\b.*\b--force\b/,
  /\bgit\s+push\b.*\b-f\b/,
  /\bgh\s+repo\s+delete\b/,
  /\bgit\s+reset\b.*\b--hard\b/,
  /\bgit\s+clean\b.*\b-f/,
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (isToolCallEventType("bash", event) || event.toolName === "execute") {
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
