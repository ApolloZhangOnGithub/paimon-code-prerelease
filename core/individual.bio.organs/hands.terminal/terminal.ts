import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { asyncSh, asyncShSafe } from "#hands_execute";
import { writeFileSync } from "node:fs";
import { validateExecute } from "../../individual.bio.organs/hands.fileactions/fileactions.ts";
import { logerr } from "#paths";
import { registerPaimonTool, resultContent } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";

// 归属：用 process.title 里的 personId 做命名空间。
// process.title 格式: paimon:name(main,personId,sessionHash)
function getAgentScope(): string {
  const m = process.title.match(/paimon:[^(]+\([^,]+,\s*([^,)]+)/);
  return (m?.[1] || "unknown").slice(0, 8);
}

// 用户可见的「开发终端」= 一个 tmux session，前缀 dev-{scope}- 做到 agent 隔离。
const PFX_BASE = "dev-";
const pfx = () => PFX_BASE + getAgentScope() + "-";
const clean = (n: string) => pfx() + (n || `t${Date.now().toString().slice(-5)}`).replace(/[^a-zA-Z0-9_]/g, "");
const has = async (n: string): Promise<boolean> => {
  try { await asyncSh(`tmux has-session -t ${n} 2>/dev/null`); return true; } catch { return false; }
};

export function registerTerminal(pi: ExtensionAPI) {
  registerPaimonTool({
    name: "terminal",
    label: "Terminal",
    messageDescription:
      "Open a REAL terminal the USER can watch (a tmux session) and run a long/interactive command in it. " +
      "Unlike run(): this is a live TTY, so tqdm progress bars, training logs, and \\r-refreshing output render correctly — " +
      "the user can attach and watch in real time. Use it for anything the user should SEE live (model training, long builds, servers). " +
      "actions: run | peek | list | close.",
    promptSnippet: "Open a user-watchable terminal (tmux live TTY) — tqdm/training/long runs",
    renderCall(args: any, theme: any) {
      const act = args?.action || "run";
      const n = args?.name || "";
      return renderToolCall.command(theme, "Terminal", `${act}${n ? " " + n : ""}`);
    },
    parameters: Type.Object({
      action: Type.Union([Type.Literal("run"), Type.Literal("peek"), Type.Literal("list"), Type.Literal("close")], {
        messageDescription: "run=开终端跑命令; peek=看当前画面(进度); list=列出在跑的; close=关掉",
      }),
      command: Type.Optional(Type.String({ messageDescription: "run: 要在终端里跑的 shell 命令" })),
      name: Type.Optional(Type.String({ messageDescription: "终端短名(如 train)。run 不给则自动生成；peek/close 必须给" })),
      cwd: Type.Optional(Type.String({ messageDescription: "run: 工作目录(可选)" })),
    }),
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      return renderMessage.output(theme, ctx, resultContent(result));
    },
    async execute(_id, rawP) { const p = rawP as any;
      const scope = pfx(); // dev-{personId}-
      if (p.action === "list") {
        const rows = (await asyncShSafe(`tmux ls 2>/dev/null`)).split("\n").filter((l) => l.startsWith(scope));
        return { content: [{ type: "text", text: rows.length ? "在跑的终端：\n" + rows.map((l) => "  " + l).join("\n") : "没有在跑的终端。" }], details: {} };
      }
      if (p.action === "peek" || p.action === "close") {
        if (!p.name) return { content: [{ type: "text", text: `${p.action} 需要 name` }], details: {}, isError: true };
        const n = clean(p.name);
        if (p.action === "close") { await asyncShSafe(`tmux kill-session -t ${n} 2>/dev/null`); return { content: [{ type: "text", text: `已关闭终端 ${n}。` }], details: {} }; }
        if (!(await has(n))) return { content: [{ type: "text", text: `终端 ${n} 不在跑（可能已结束）。` }], details: {} };
        const screen = (await asyncShSafe(`tmux capture-pane -pt ${n} -S -200 2>/dev/null`)).split("\n").filter(Boolean).slice(-60).join("\n");
        return { content: [{ type: "text", text: `[${n} 当前画面]\n${screen || "(空)"}` }], details: {} };
      }
      // ── run ──
      if (!p.command) return { content: [{ type: "text", text: "run 需要 command" }], details: {}, isError: true };
      const check = validateExecute(p.command);
      if (check.blocked) return { content: [{ type: "text", text: check.message || "命令被拦截" }], details: {}, isError: true };
      const n = clean(p.name || "");
      if (await has(n)) await asyncShSafe(`tmux kill-session -t ${n} 2>/dev/null`);
      const script = `/tmp/pi-terminal-${n}.sh`;
      writeFileSync(
        script,
        `#!/bin/bash\n${p.cwd ? `cd ${JSON.stringify(p.cwd)} || exit 1\n` : ""}${p.command}\nec=$?\necho\necho "[${n} 完成 exit=$ec —— 离开: Ctrl-b d]"\nexec bash -i\n`,
      );
      await asyncShSafe(`chmod +x ${script}; tmux new-session -d -s ${n} "bash ${script}"`);
      const name = n.slice(pfx().length);
      return {
        content: [{
          type: "text",
          text: ` ${name} — terminal(action="peek", name="${name}")`,
        }],
        details: { session: n },
      };
    },
  });

  // ── shutdown 自动清理 ──
  pi.on("session_shutdown", async () => {
    const scope = pfx();
    try {
      const sessions = (await asyncShSafe(`tmux ls 2>/dev/null`)).split("\n").filter((l) => l.startsWith(scope));
      for (const s of sessions) {
        const name = s.split(":")[0];
        if (name) await asyncShSafe(`tmux kill-session -t ${name} 2>/dev/null`);
      }
    } catch {}
  });
}