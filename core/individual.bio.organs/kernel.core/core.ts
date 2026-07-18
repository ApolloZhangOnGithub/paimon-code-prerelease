// kernel.core/core.ts
// ── 内核 / 装配点 ────────────────────────────────────────────────────────────
// pi 把这一个扩展当入口加载。kernel 读 RNA，把每个 func（蛋白质）表达到同一个 pi 上。
// 这是机器，不是基因。
//
// 设计取舍（诚实说明）：
//  - kernel 在「每个」paimon 实例里都跑（main / 元意识 tmux / 海马体 tmux / 睡眠 tmux）。
//  - 目前 kernel 加载「所有非 future 的 func」，由 func 自己按 session 角色自门控
//    （元意识检测 ismetaconsciousness、海马体检测 personDir……这和现行 live 行为一致）。
//  - rna 的 session 字段先作为「声明 + 运行期可查询」，严格按 session 选择性加载留作后续优化。
//  - mode 切换：func 在 before_agent_start 里查 runtime.getMode()/isAbled() 决定是否表达，
//    所以 /mode 切换后，下一轮 agent 起来就生效。

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { logerr, userFile } from "#paths";

// ── i18n 辅助 ──
export function t(zh: string, en: string): string {
  return ((globalThis as any).__paimonLang === "zh") ? zh : en;
}
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { DIRS, IS_DEV } from "#paths";
import * as rt from "#ribosome";
// dollar 经济系统已冷冻移除,别名已从 package.json 移除。
// import { checkAndPayUbi } from "#world_economy_ubi";
// import { installDollarTools } from "#world_economy_transactions";

// ── func 静态登记表（新增 func：在 individual.bio.organs 建文件夹 + promotor.dna 声明 + 这里加一行）──
// 入口 = 该 func 真正带 default(pi) 的文件，不再要空壳 index.ts。
import body_heart from "#kernel_heart";                       // 心脏 func 入口（状态机+continuous loop）。曾指向 kernel 自身导致递归自表达栈爆，见 LESSON 030
import body_hands_execute from "#hands_execute";               // execute tool（从 heart 分离）
import body_hands_fileactions from "#hands_fileactions";
import body_hands_sensitiveactions from "#sensitiveactions";
import { registerMemory as brain_hippocampus } from "#brain_hippocampus";   // 记忆机能
import brain_hippocampus_spawn from "#brain_hippocampus";   // 海马体 spawn（default export）
// @Dep import brain_amygdala from "#brain_amygdala";  // @ABANDONED 杏仁核
import brain_senses_bioclock from "#brain_bioclock";
import brain_senses_metaconsciousness from "#brain_metaconsciousness";
import brain_intentions from "../brain.intentions/intentions.ts";
import body_ear from "#ear";
import body_mouth from "#mouth";
import technology_mobile from "#technology_mobile";
import technology_laptop from "#technology_laptop";
import { sendCustomMessage, MESSAGE_TYPES, flushTools } from "#kernel_backbone";
import { initBlockrender } from "#tui_blockrender";
import { Text, Container } from "@earendil-works/pi-tui";
initBlockrender(Text, Container);
import { registerGodCommands } from "../../god.tui/commands/register.ts";
import { initStatusUI } from "#status";

type FuncEntry = (pi: ExtensionAPI) => void;
const REGISTRY: Record<string, FuncEntry> = {
  "kernel.heart": body_heart,
  "hands.execute": body_hands_execute,
  "hands.fileactions": body_hands_fileactions,
  "hands.sensitive": body_hands_sensitiveactions,
  "brain.hippocampus": brain_hippocampus,
  // @Dep "brain.amygdala": brain_amygdala,  // @ABANDONED
  "brain.bioclock": brain_senses_bioclock,
  "brain.metaconsciousness": brain_senses_metaconsciousness,
  "brain.intentions": brain_intentions,
  "ears.listen": body_ear,
  "mouth.speak": body_mouth,
  "technology.local.mobile": technology_mobile,
  "technology.local.laptop": technology_laptop,
};

// session 角色：从 session 文件路径判断这个 paimon 实例是谁
function detectRole(sessionFile?: string | null): string {
  if (!sessionFile) return "main";
  if (sessionFile.includes("metaconsciousnessSessions")) return "metaconsciousness";
  if (sessionFile.includes("HippocampusSessions")) return "hippocampus";
  if (sessionFile.includes("SleepSessions")) return "sleep";
  return "main";
}

export default function kernelMain(pi: ExtensionAPI) {
  // ── 收集工具描述：注册时记录 messageDescription，before_agent_start 时注入 system prompt ──
  const _toolDescs = new Map<string, string>();
  const _origRegisterTool = pi.registerTool.bind(pi);
  pi.registerTool = (def: any) => {
    if (def.name && def.messageDescription) {
      _toolDescs.set(def.name, def.messageDescription);
    }
    return _origRegisterTool(def);
  };

  // ── 字段别名：paimon-code 的命名 → paimon 框架的命名。拦截 sendMessage 自动映射。
  // paimon-code: messageType / isDisplayedInTUI / isTriggerNewTurn
  // pi:  customType   / display          / triggerTurn
  const _origSendMessage = pi.sendMessage.bind(pi);
  (pi as any).sendMessage = (msg: any, opts?: any) => {
    if (msg) {
      if ('messageType' in msg && !('customType' in msg)) msg.customType = msg.messageType;
      if ('isDisplayedInTUI' in msg && !('display' in msg)) msg.display = msg.isDisplayedInTUI;
    }
    if (opts) {
      if ('isTriggerNewTurn' in opts && !('triggerTurn' in opts)) opts.triggerTurn = opts.isTriggerNewTurn;
    }
    // 强制校验：所有 customType 必须在 backbone MESSAGE_TYPES 注册
    const ct = msg?.customType || msg?.messageType;
    if (ct && !MESSAGE_TYPES[ct]) {
      const err = `[backbone] 消息类型 "${ct}" 未注册。所有消息必须走 sendCustomMessage()，不能直接调 pi.sendMessage()。`;
      logerr("MSG_UNREG", err);
      if (process.env.NODE_ENV !== "production") throw new Error(err);
    }
    return _origSendMessage(msg, opts);
  };

  // 崩溃记录器：写进 agent 自身 ErrorData，不是 /tmp。
  // 用 prependListener 抢在 pi 自己的退出处理器之前先落盘。
  try {
    const crashLog = (tag: string, e: any) => {
      try {
        const pid = (globalThis as any).__paimonPersonId || "unknown";
        const ed = `${homedir()}/.paimon/ErrorData/${pid}`;
        mkdirSync(ed, { recursive: true });
        appendFileSync(`${ed}/crash.log`, `[${new Date().toISOString()}] [${process.title}] ${tag}:\n${e?.stack ?? e}\n\n`);
      } catch (e2) { logerr("K001", e2); }
    };
    process.prependListener("uncaughtException", (e) => crashLog("uncaughtException", e));
    process.prependListener("unhandledRejection", (e: any) => crashLog("unhandledRejection", e));
  } catch (e) { logerr("K002", e); }

  // 余额硬闸最先装上（代码强制，不靠模型）：余额到地板/烧钱超速 → 连小号一起停。


  // 钱包工具（agent 查余额/交易记录）—— dollar 系统已冷冻,禁用
  // installDollarTools(pi);

  // ── 读 core.dna（身份）──
  let _coreDna = "";
  try {
    _coreDna = readFileSync(DIRS.geneCore, "utf8").trim();
  } catch (e: any) { logerr("K010", `core.dna 读取失败: ${e?.message ?? e}`); }

  // ── 身份 + 工具概览注入（替换框架默认 system prompt）──
  pi.on("before_agent_start", async (event) => {
    const active: string[] = pi.getActiveTools?.() ?? [];
    const toolLines = active
      .filter((name: string) => _toolDescs.has(name))
      .map((name: string) => `- ${name}: ${_toolDescs.get(name)}`);
    const toolSection = toolLines.length ? "\n\n## Tools\n" + toolLines.join("\n") : "";

    // 用 core.dna 身份替换框架默认的 "expert coding assistant" 模板，
    // 保留框架追加的尾部信息（date/cwd/context files）
    if (_coreDna) {
      const base = event.systemPrompt || "";
      // 框架尾部：从 "Current date:" 开始的部分
      const dateIdx = base.lastIndexOf("\nCurrent date:");
      const tail = dateIdx >= 0 ? base.slice(dateIdx) : "";
      return { systemPrompt: _coreDna + toolSection + tail };
    }

    if (!toolLines.length) return;
    return { systemPrompt: event.systemPrompt + toolSection };
  });

  // 读 RNA（含错误会抛 → 整个扩展拒绝加载，fail loud）
  const raw = rt.rnaRaw();
  const loaded: string[] = [];
  const missing: string[] = [];

  // 提前检测 session 角色（从环境/进程信息推断）
  const earlyRole = (() => {
    const cwd = process.cwd();
    if (cwd.includes("metaconsciousnessSessions")) return "metaconsciousness";
    if (cwd.includes("HippocampusSessions")) return "hippocampus";
    if (cwd.includes("SleepSessions")) return "sleep";
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
    // 自指防护：entry 指回 kernel 自己（别名配错）会无限递归自表达直到栈爆，跳过并告警
    if ((entry as unknown) === kernelMain) {
      try { sendCustomMessage(pi, "system-error", `WARN: func ${f.name} 的 REGISTRY entry 指向 kernel 自身（#别名配错?），已跳过以防递归`); } catch (e2) { logerr("K016", e2); }
      continue;
    }
    try {
      entry(pi);
      loaded.push(f.name);
    } catch (e: any) {
      try {
        sendCustomMessage(pi, "system-error", `WARN: func ${f.name} 加载失败: ${e?.message ?? e}`);
      } catch (e2) { logerr("K003", e2); }
    }
  }
  // 海马体 spawn 逻辑在 default export，单独调用
  try { brain_hippocampus_spawn(pi); } catch (e: any) {
    try { sendCustomMessage(pi, "system-error", `WARN: 海马体 spawn 加载失败: ${e?.message ?? e}`); } catch (e2) { logerr("K004", e2); }
  }
  // 笔记本桌面（technology.local.laptop）在 promotor.dna 已声明、由上面的 RNA 表达循环加载，
  // 这里不能再单独调一次，否则 laptop 的 handler/工具全部重复注册。

  // ── 工具统一注册（所有 organ 加载完后 flush）──
  try { flushTools(pi); } catch (e: any) { logerr("K005", e); }

  // promotor.dna 声明了、但 REGISTRY 里没登记的 func —— 提醒（不致命）
  if (missing.length) {
    try {
      sendCustomMessage(pi, "system-error", `WARN: 这些 func 在 promotor.dna 已声明但 kernel 未登记: ${missing.join(", ")}（在 kernel.core/core.ts REGISTRY 加 import）`);
    } catch (e2) { logerr("K006", e2); }
  }

  // ── session 角色检测 + 进程自报家门（不可伪造）──────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    try { initStatusUI(ctx.ui); } catch {}
    const sf = ctx.sessionManager.getSessionFile();
    const role = detectRole(sf);
    rt.setSessionRole(role);

    // ── 工具过滤（代码层强制，所有 role 都过滤）──
    {
      const ROLE_TOOLS: Record<string, string[]> = {};
      try {
        const manifestPath = resolve(DIRS.core, "tools.manifest.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (manifest.roles) Object.assign(ROLE_TOOLS, manifest.roles);
      } catch (e) { logerr("K007", e); }

      let allowed: Set<string>;
      if (role === "main") {
        try {
          const manifestPath = resolve(DIRS.core, "tools.manifest.json");
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
          const tools = manifest.tools || {};
          allowed = new Set(Object.entries(tools).filter(([_, v]: [string, any]) => v.default && !v.abandoned).map(([k]) => k));
        } catch { allowed = new Set(); }
      } else {
        allowed = new Set(ROLE_TOOLS[role] || []);
      }

      if (allowed.size > 0) {
        const current: string[] = pi.getActiveTools() ?? [];
        const filtered = current.filter((t: string) => allowed.has(t));
        pi.setActiveTools(filtered);
      }

      // ── 用户设置的工具禁用（settings.json tools.disabled）──
      try {
        const settingsPath = userFile("settings.json");
        if (existsSync(settingsPath)) {
          const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
          const disabled: string[] = settings?.tools?.disabled || [];
          if (disabled.length > 0) {
            const current = pi.getActiveTools();
            pi.setActiveTools(current.filter((t: string) => !disabled.includes(t)));
          }
        }
      } catch (e) { logerr("K009", e); }
    }

    // ── 启动硬检查：manifest 声明但未注入的工具 → throw Error ──
    if (role === "main") {
      try {
        const manifestPath = resolve(DIRS.core, "tools.manifest.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        const tools = manifest.tools || {};
        const expected = Object.entries(tools)
          .filter(([_, v]: [string, any]) => v.default && !v.abandoned)
          .map(([k]) => k);
        const settingsPath = userFile("settings.json");
        let disabled: string[] = [];
        if (existsSync(settingsPath)) {
          disabled = JSON.parse(readFileSync(settingsPath, "utf8"))?.tools?.disabled || [];
        }
        const active = pi.getActiveTools();
        const missing = expected.filter((t: string) => !disabled.includes(t) && !active.includes(t));
        if (missing.length > 0) {
          const msg = `[K020] 工具未注入: ${missing.join(", ")}。manifest 声明 default:true 且未被 settings 禁用，但未注入。检查对应 func 是否在 export default 顶层调用了 registerPaimonTool。`;
          logerr("K020", msg);
          throw new Error(msg);
        }
      } catch (e: any) {
        if (e?.message?.includes("[K020]")) throw e;
        logerr("K021", e);
      }
    }

    // 角色和 id 都从 session 文件路径推出来 —— 路径是启动时 --session-dir 定死的，
    // 模型运行中改不了它，也没有任何改 process.title 的工具，所以【不可伪造】。
    // 不设角色的 env 覆盖（避免被人/模型用环境变量假冒角色）。
    // 结果：ps / pgrep 里直接显示 paimon-code:<role>:<id>，杀进程可精确定位、绝不误伤工作进程。
    //   例：pgrep -fl "paimon-code:hippocampus"   只列海马体小号
    const id = sf?.match(/(?:\.paimon\/SessionData|\.paimon\/sessions|\.pi\/memory)\/([a-f0-9]+)\//)?.[1] ?? "unknown";
    const sid = sf?.split("/").pop()?.replace(".jsonl","").slice(-12) || "?";
    try { process.title = `paimon:${process.env.PAIMON_AGENT_NAME || id}(${role},${id},${sid})`; } catch (e) { logerr("K010", e); }
    // 启动版本记录
    try {
      const verPath = join(homedir(), ".paimon/agent/version.json");
      if (existsSync(verPath)) {
        const ver = JSON.parse(readFileSync(verPath, "utf8"));
        const logDir = join(homedir(), ".paimon/MemoryData", id);
        mkdirSync(logDir, { recursive: true });
        appendFileSync(join(logDir, "startup.log"), JSON.stringify({ ts: new Date().toISOString(), paimon: ver.paimon, pi: ver.pi, channel: ver.channel || "minutely", role }) + "\n");
      }
    } catch {}
    // 全局路径——所有代码从这里读，不再解析路径
    try {
      global.__paimonPersonId = id;
      global.__paimonPersonName = process.env.PAIMON_AGENT_NAME || id;
      global.__paimonPersonDir = join(homedir(), ".paimon/MemoryData", id);
      global.__paimonRuntimeDir = join(homedir(), ".paimon/RuntimeCache", id);
      try { mkdirSync(global.__paimonRuntimeDir, { recursive: true }); } catch {}
      global.__paimonChannelDir = join(homedir(), ".paimon/RuntimeCache", id);
      global.__paimonSessionDir = join(homedir(), ".paimon/SessionData", id);
      global.__paimonAgentFileDir = join(homedir(), ".paimon/AgentFileData", id);
      // 读取用户语言偏好
      try {
        const settingsPath = userFile("settings.json");
        if (existsSync(settingsPath)) {
          const s = JSON.parse(readFileSync(settingsPath, "utf8"));
          global.__paimonLang = s.lang === "zh" ? "zh" : "en";
        }
      } catch { global.__paimonLang = "en"; }
    } catch {}

    // 更新 lastSeen——重新读文件拿最新 archived 状态，已归档的不碰
    try {
      const plistPath = join(homedir(), ".paimon/MemoryData/plist.json");
      const freshList = JSON.parse(readFileSync(plistPath, "utf8"));
      const p = freshList.find((x: any) => x.id === id);
      if (p && !p.archived) { p.lastSeen = new Date().toISOString(); writeFileSync(plistPath, JSON.stringify(freshList, null, 2)); }
    } catch {}

    // 心跳文件：每 30s 更新一次，hc/sc session 用它检测主意识是否存活（替代 PID 看门狗）
    // 不再写 heartbeat 文件——sc/hc 用 kill -0 检测主进程

    // 启动回顾由心跳的 recap 负责（continuous-resume，见 heartbeat.ts）。旧的 greeting 已弃用移除。

    // ── UBI 发放 —— dollar 系统已冷冻至 @FUTURE.,整块禁用 ──
    // if (role === "main" && id !== "unknown" && process.env.PI_DISABLE_UBI !== "1") {
    //   const personDir = global.__paimonPersonDir;
    //   try {
    //     const ubi = checkAndPayUbi(personDir);
    //     if (ubi.paid) {
    //       try { sendCustomMessage(pi, "ubi-paid", `UBI: +$${ubi.amount}`); } catch {}
    //     }
    //   } catch {}
    // }

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

    // ── 部署检测（仅 dev 模式，deployed 版不探测）──
    if (IS_DEV) {
      try {
        let devRoot = process.env.PI_DEV_ROOT;
        if (devRoot && !existsSync(join(devRoot, "Codebase/core/individual.bio.organs"))) devRoot = "";
        if (!devRoot) {
          const probe = resolve(DIRS.core, "../..");
          if (existsSync(join(probe, "Codebase/core/individual.bio.organs"))) devRoot = probe;
        }
      } catch {}
    }

    // ── 反方向健康检查：主意识定时监控 hc/sc 是否存活 ──
    if (role === "main") {
      // session_start 可能重复触发（reload/rebind），先清旧 interval，否则堆积后 execSync 会磨死事件循环
      try { clearInterval((globalThis as any).__paimonHealthInterval); } catch {}
      const _hcInterval = setInterval(() => {
        try {
          const h = (globalThis as any).__paimonHippocampusHandle;
          if (h && !h.isRunning()) { h.start().catch(() => {}); }
          const s = (globalThis as any).__paimonMetaconsciousnessHandle;
          if (s && !s.isRunning()) { s.start().catch(() => {}); }
        } catch {}
      }, 30000);
      (globalThis as any).__paimonHealthInterval = _hcInterval;
    }
  });

  // ── session_shutdown：写 lastEnded + 清理健康检查 ──
  pi.on("session_shutdown", async () => {
    // 清理健康检查定时器
    try { const hi = (globalThis as any).__paimonHealthInterval; if (hi) clearInterval(hi); } catch {}
    try {
      const id = (globalThis as any).__paimonPersonId;
      if (id) {
        const plistPath = join(homedir(), ".paimon/MemoryData/plist.json");
        const freshList = JSON.parse(readFileSync(plistPath, "utf8"));
        const p = freshList.find((x: any) => x.id === id);
        if (p && !p.archived) { p.lastEnded = new Date().toISOString(); writeFileSync(plistPath, JSON.stringify(freshList, null, 2)); }
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
  //  /switches      kernel.heart               wait/hibernate 开关
  //  /continuous    kernel.heart               连续对话模式
  //  /function      kernel (dispatch)        器官管理:brain-*/body-*
  //    brain-metaconsciousness  brain.senses       元意识开关
  //    brain-hippocampus   brain.hippocampus  海马体开关
  //    body-ears           ears.listen        语音输入开关
  //    body-mouth          mouth.speak        语音输出开关
  //  /context       brain.hippocampus/hippocampus-memory 上下文用量
  // ══════════════════════════════════════════════════════════════════

  // ── Commands — god 层注册用户命令，headless 模式(PAIMON_HEADLESS=1)跳过 ──
  if (!process.env.PAIMON_HEADLESS) registerGodCommands(pi);
}
