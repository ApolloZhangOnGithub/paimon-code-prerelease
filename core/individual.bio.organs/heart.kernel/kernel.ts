// heart.main/kernel.ts
// ── 内核 / 装配点 ────────────────────────────────────────────────────────────
// pi 把这一个扩展当入口加载。kernel 读 RNA，把每个 func（蛋白质）表达到同一个 pi 上。
// 这是机器，不是基因。
//
// 设计取舍（诚实说明）：
//  - kernel 在「每个」pi 实例里都跑（main / 潜意识 tmux / 海马体 tmux / 睡眠 tmux）。
//  - 目前 kernel 加载「所有非 future 的 func」，由 func 自己按 session 角色自门控
//    （潜意识检测 isSubconscious、海马体检测 personDir……这和现行 live 行为一致）。
//  - rna 的 session 字段先作为「声明 + 运行期可查询」，严格按 session 选择性加载留作后续优化。
//  - mode 切换：func 在 before_agent_start 里查 runtime.getMode()/isAbled() 决定是否表达，
//    所以 /mode 切换后，下一轮 agent 起来就生效。

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { appendFileSync, existsSync } from "node:fs";
import { exec } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import * as rt from "#runtime";
import { installBudgetGuard } from "#budget";
import { installDocTracker } from "#devdoc";
import { installWatcher } from "#watcher";
import { checkAndPayUbi } from "#ubi";
import { installDollarTools } from "#dollar";

// ── func 静态登记表（新增 func：在 individual.bio.organs 建文件夹 + promotor.dna 声明 + 这里加一行）──
// 入口 = 该 func 真正带 default(pi) 的文件，不再要空壳 index.ts。
import body_heart from "#heart";                       // 组合 stop+process
import body_hands_fileactions from "#fileactions";
import body_hands_sensitiveactions from "#sensitiveactions";
import brain_hippocampus from "#hippocampus";   // 含记忆机能(registerMemory)+hc 编码小号
import brain_amygdala from "#amygdala";            // 杏仁核:急停反射(听到"停"代码层 abort)
import brain_predrafting from "#drafting";
import brain_senses_bioclock from "#bioclock";
import brain_senses_subconscious from "#subconscious";
import body_ear from "#ear";
import body_mouth from "#mouth";
import technology_phone from "#phone";
import heart_subconscious from "#heart-sc";
import { sendCustomMessage } from "#messages";

type CommandDef = { name: string; desc: string; handler: (args: any, ctx: any) => Promise<void> };
type FuncEntry = (pi: ExtensionAPI) => void | CommandDef[];
const REGISTRY: Record<string, FuncEntry> = {
  "heart.main": body_heart,
  "heart.subconscious": heart_subconscious,
  "hands.fileactions": body_hands_fileactions,
  "hands.sensitive": body_hands_sensitiveactions,
  "brain.hippocampus": brain_hippocampus,
  "brain.amygdala": brain_amygdala,
  "brain.prefrontal.drafting": brain_predrafting,
  "brain.senses.bioclock": brain_senses_bioclock,
  "brain.senses.subconscious": brain_senses_subconscious,
  "ears.listen": body_ear,
  "mouth.speak": body_mouth,
  "technology.phone": technology_phone,
};

// session 角色：从 session 文件路径判断这个 pi 实例是谁
function detectRole(sessionFile?: string | null): string {
  if (!sessionFile) return "main";
  if (sessionFile.includes("conscious-sessions")) return "subconscious";
  if (sessionFile.includes("hippocampus-sessions")) return "hippocampus";
  if (sessionFile.includes("sleep-sessions")) return "sleep";
  return "main";
}

export default function (pi: ExtensionAPI) {
  // 崩溃记录器：把 uncaughtException/unhandledRejection 的【栈】写进 /tmp/pi-coding-master-crash.log。
  // 用 prependListener 抢在 pi 自己的退出处理器之前先落盘——否则崩溃信息只打终端、读不到、没法定位。
  try {
    const crashLog = (tag: string, e: any) => {
      try { appendFileSync("/tmp/pi-coding-master-crash.log", `[${new Date().toISOString()}] [${process.title}] ${tag}:\n${e?.stack ?? e}\n\n`); } catch {}
    };
    process.prependListener("uncaughtException", (e) => crashLog("uncaughtException", e));
    process.prependListener("unhandledRejection", (e: any) => crashLog("unhandledRejection", e));
  } catch {}

  // 余额硬闸最先装上（代码强制，不靠模型）：余额到地板/烧钱超速 → 连小号一起停。
  installBudgetGuard(pi);

  // 工程问题追踪 — 收集返回的命令定义
  const allCommands: CommandDef[] = [];
  const docCmds = installDocTracker(pi);
  if (docCmds) allCommands.push(...docCmds);

  // 钱包工具（agent 查余额/交易记录）
  installDollarTools(pi);

  // 读 RNA（含错误会抛 → 整个扩展拒绝加载，fail loud）
  const raw = rt.rnaRaw();
  const loaded: string[] = [];
  const missing: string[] = [];

  // 提前检测 session 角色（从环境/进程信息推断）
  const earlyRole = (() => {
    const cwd = process.cwd();
    if (cwd.includes("conscious-sessions")) return "subconscious";
    if (cwd.includes("hippocampus-sessions")) return "hippocampus";
    if (cwd.includes("sleep-sessions")) return "sleep";
    return "main";
  })();

  // ── 表达每个 func（按 session 过滤）──
  for (const f of Object.values(raw.funcs)) {
    if (f.future) continue;
    // session 门控：暂时禁用（PROPOSAL-001）。hippocampus 的 registerMemory 主意识也需要，
    // 按 session 过滤会导致主意识丢失记忆注入。等 func 拆分完（memory 独立出 hippocampus）再启用。
    // const sessions: string[] = f.session || [];
    // if (sessions.length > 0 && !sessions.includes("all") && !sessions.includes(earlyRole)) {
    //   continue;
    // }
    const entry = REGISTRY[f.name];
    if (!entry) { missing.push(f.name); continue; }
    try {
      const cmds = entry(pi);
      if (Array.isArray(cmds)) allCommands.push(...cmds);
      loaded.push(f.name);
    } catch (e: any) {
      try {
        pi.sendMessage(
          { messageType: "system-error", content: `WARN: func ${f.name} 加载失败: ${e?.message ?? e}`, isDisplayedInTUI: false },
          { deliverAs: "nextTurn" }
        );
      } catch {}
    }
  }

  // promotor.dna 声明了、但 REGISTRY 里没登记的 func —— 提醒（不致命）
  if (missing.length) {
    try {
      pi.sendMessage(
        { messageType: "system-error", content: `WARN: 这些 func 在 promotor.dna 已声明但 kernel 未登记: ${missing.join(", ")}（在 heart.main/kernel.ts REGISTRY 加 import）`, display: false },
        { deliverAs: "nextTurn" }
      );
    } catch {}
  }

  // ── session 角色检测 + 进程自报家门（不可伪造）──────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const sf = ctx.sessionManager.getSessionFile();
    const role = detectRole(sf);
    rt.setSessionRole(role);
    // 角色和 id 都从 session 文件路径推出来 —— 路径是启动时 --session-dir 定死的，
    // 模型运行中改不了它，也没有任何改 process.title 的工具，所以【不可伪造】。
    // 不设角色的 env 覆盖（避免被人/模型用环境变量假冒角色）。
    // 结果：ps / pgrep 里直接显示 pi-coding-master:<role>:<id>，杀进程可精确定位、绝不误伤工作进程。
    //   例：pgrep -fl "pi-coding-master:hippocampus"   只列海马体小号
    const id = sf?.match(/\.pi\/memory\/([a-f0-9]+)\//)?.[1] ?? "unknown";
    try { process.title = `pi-coding-master:${role}:${id}`; } catch {}

    // ── UBI 发放（PI_DISABLE_UBI=1 关闭）──
    if (role === "main" && id !== "unknown" && process.env.PI_DISABLE_UBI !== "1") {
      const personDir = join(homedir(), ".pi/memory", id);
      try {
        const ubi = checkAndPayUbi(personDir);
        if (ubi.paid) {
          try { sendCustomMessage(pi, "ubi-paid", `UBI: +$${ubi.amount}`); } catch {}
        }
      } catch {}
    }

    // ── 已知外部问题：macOS 自带 Terminal.app 闪退（见 Issues.DEV/012）──────────────
    // Terminal.app 的渲染层(NSView/QuartzCore)在重 TUI(高频重绘+emoji+真彩)下会段错误崩溃——
    // 是 Terminal 自己的 bug，pi 修不了。检测到用默认终端就提示换重型终端。仅主意识、仅启动时一次。
    if (role === "main" && process.env.TERM_PROGRAM === "Apple_Terminal") {
      try {
        ctx.ui?.notify?.(
          "WARN: 你在用 macOS 自带 Terminal.app —— 重 TUI 下它会偶发闪退(渲染层段错误，是 Terminal 自己的 bug，不是 pi)。\n" +
          "建议换更结实的终端：Ghostty / WezTerm / kitty / iTerm2(GPU 渲染，扛得住高频重绘+真彩)。\n" +
          "(若靠 Terminal.app 给麦克风/TCC 授权，换终端后记得给新终端重授一遍。)",
          "warning"
        );
      } catch {}
    }

    // ── 部署检测 — 双逻辑自动发现开发环境 ──
    // ① 环境变量 PI_DEV_ROOT（显式配） → ② 文件探测 Codebase/core/individual.bio.organs/ 目录（自动发现）
    try {
      const home = homedir();
      let devRoot = process.env.PI_DEV_ROOT;
      if (!devRoot) {
        const probe = join(home, "smart-pi/pi-coding-master.DEV");
        if (existsSync(join(probe, "Codebase/core/individual.bio.organs"))) devRoot = probe;
      }
      if (devRoot) {
        exec(`bash "${devRoot}/Codebase/deploy/install.sh"`, { timeout: 30000 }, (err: any, stdout: string, stderr: string) => {
          const out = stdout + stderr;
          const hasError = out.includes("ERROR") || err;
          try {
            pi.sendMessage({
              messageType: "auto-deploy",
              content: hasError ? `WARN: 自动部署有错误:\n${out.slice(-300)}` : `自动部署完成`,
              isDisplayedInTUI: hasError,
            }, { deliverAs: "nextTurn" });
          } catch {}
        });
        // 文件监控：源码变动自动部署
        installWatcher(pi, devRoot);
      }
    } catch {}
  });

  // ══════════════════════════════════════════════════════════════════
  // ── 用户命令统一注册表 (v0.3) ─────────────────────────────────────
  // 所有用户可用的 / 命令在此统一注册。各 organ 返回命令定义，kernel 收集后
  // 在这一个位置完成注册。和模型可调用的 tool 分开。
  //
  //  命令           来源                     说明
  //  ─────────────  ───────────────────────  ──────────────────────
  //  /docs          hands.dev.writeissue     issue/lesson/norm 子命令
  //  /switches      heart.main               wait/hibernate 开关
  //  /continuous    heart.main               连续对话模式
  //  /function      kernel (dispatch)        器官管理:brain-*/body-*
  //    brain-subconscious  brain.senses       潜意识开关
  //    brain-hippocampus   brain.hippocampus  海马体开关
  //    body-ears           ears.listen        语音输入开关
  //    body-mouth          mouth.speak        语音输出开关
  //  /context       brain.hippocampus/memory 上下文用量
  // ══════════════════════════════════════════════════════════════════

  // 注册所有 organ 返回的命令
  for (const cmd of allCommands) {
    pi.registerCommand(cmd.name, { messageDescription: cmd.desc, handler: cmd.handler });
  }

  // /function — 器官管理调度器
  const FUNCTION_SUBS = ["brain-subconscious", "brain-hippocampus", "body-ears", "body-mouth"];
  pi.registerCommand("function", {
    messageDescription: "/function <brain-subconscious|brain-hippocampus|body-ears|body-mouth> [args]",
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim();
      if (!raw) {
        const lines = ["/function <器官> [参数]", ""];
        for (const s of FUNCTION_SUBS) {
          const c = allCommands.find((c) => c.name === s);
          lines.push(`  ${s}  — ${c?.desc ?? ""}`);
        }
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      const spaceIdx = raw.indexOf(" ");
      const sub = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).toLowerCase();
      const rest = spaceIdx === -1 ? "" : raw.slice(spaceIdx + 1);
      const target = allCommands.find((c) => c.name === sub);
      if (!target || !FUNCTION_SUBS.includes(sub)) {
        ctx.ui.notify(`未知器官 "${sub}"。可用: ${FUNCTION_SUBS.join(", ")}`, "warning");
        return;
      }
      await target.handler(rest, ctx);
    },
  });
}
