import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { getSessionRole } from "#runtime";
import { personDataDir as _personDataDir } from "#paths";
import { sendCustomMessage } from "#messages";

function getPersonDir(sessionFile: string | undefined): string | null {
  const envDir = process.env.PI_PERSON_DIR;
  if (envDir) return envDir;
  const dir = _personDataDir(sessionFile);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readFile(p: string): string {
  try { return fs.readFileSync(p, "utf-8"); } catch { return ""; }
}

function appendFile(p: string, text: string): void {
  try { fs.appendFileSync(p, text, "utf-8"); } catch {}
}

function writeFile(p: string, text: string): void {
  try { fs.writeFileSync(p, text, "utf-8"); } catch {}
}

// 机密脱敏：把 sshpass 密码、sk- 风格 API key、Bearer token 的【值】盖成 [REDACTED]，只留结构。
// 不是删——保留"这里有个密码"的痕迹，只抹掉值。幂等(已脱敏的再跑结果不变)。
function scrubSecrets(s: string): string {
  if (!s) return s;
  return s
    .replace(/(sshpass\s+-p\s*)(["']?)([^\s"']+)\2/g, "$1$2[REDACTED]$2")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]")
    .replace(/\b(Bearer[;:\s]+)[A-Za-z0-9._-]{12,}/g, "$1[REDACTED]");
}

let _memoryRegistered = false;
export function registerMemory(pi: ExtensionAPI) {
  if (_memoryRegistered) { console.warn("registerMemory called twice — skipping"); return []; }
  _memoryRegistered = true;
  const _cmds: any[] = [];
  let personDir: string | null = null;
  let _sigCount: Map<string, number> | null = null;
  let _sigWindow: string[] | null = null;

  // ── session_start: 注入"记忆快照"一次（稳定前缀 = 缓存命中的关键）────────────
  // 醒来时把 DNA + cortex + work_memory + context(按预算切尾部) 揉成一份快照，注入一次。
  // 本会话中绝不再重发（见 before_agent_start）；新内容一律往「后面」append → 前缀不变 → 每轮命中缓存。
  pi.on("session_start", async (_event, ctx) => {
    personDir = getPersonDir(ctx.sessionManager.getSessionFile());
    dnaState = "wake"; // always wake on new session
    if (!personDir) return;

    // 只有主意识注入记忆快照。hc/sc/sl 小号有各自的活(读 context/feed/work_mem 编码)，
    // 绝不能把主意识那 ~90万 token 快照灌给它们 —— 会白白膨胀、甚至把小号撑挂(海马体死亡循环的元凶之一)。
    const sf0 = ctx.sessionManager.getSessionFile() || "";
    if (/conscious-sessions|hippocampus-sessions|sleep-sessions/.test(sf0)) {
      injectedWorkMemLen = readFile(path.join(personDir, "work_memory.md")).length;
      return;
    }

    // 机密脱敏(清历史)：把已混进 context/work_memory 的密码/key 值盖掉(只盖值不删，幂等，只在有变化时写回)。
    // 写入时也会脱敏(见 message_end)，这里清掉之前已经混进去的(如 sshpass 密码已散落 49 处)。
    for (const f of ["context.md", "work_memory.md"]) {
      try {
        const fp = path.join(personDir, f);
        const raw = readFile(fp);
        const cleaned = scrubSecrets(raw);
        if (cleaned !== raw) writeFile(fp, cleaned);
      } catch {}
    }

    // ── 工作期【冻结快照】= spec 的增量式：逐字不变的前缀 → 几小时的 deepseek 缓存全程命中。
    // 绝不每次 session 重 build（重 build = 前缀每次都变 = 整份冷 miss = 烧钱根因）。
    // 冻结一份快照存盘，之后每次醒来注入【同一份】(命中)，只把冻结后新增的 work/context 作为尾部增量(小 miss)。
    // 仅在 [首次 / context 增量过大 / 文件被睡眠 consolidate 变短] 时重新冻结。
    const REFREEZE_DELTA = 100000; // 增量超 ~10万字(≈5万 token) 才重冻结，封顶每次增量 miss
    const frozenPath = path.join(personDir, "snapshot.frozen.txt");
    const metaPath = path.join(personDir, "snapshot.frozen.meta.json");
    const ctxNow = readFile(path.join(personDir, "context.md"));
    const wmNow = readFile(path.join(personDir, "work_memory.md"));
    let frozen = readFile(frozenPath);
    let meta = { ctxLen: 0, wmLen: 0 };
    try { meta = { ...meta, ...JSON.parse(readFile(metaPath) || "{}") }; } catch {}
    const dCtx = ctxNow.length - meta.ctxLen;
    const dWm = wmNow.length - meta.wmLen;
    if (!frozen || dCtx > REFREEZE_DELTA || dCtx < 0 || dWm < 0) {
      frozen = buildSnapshot(); // ← 唯一重 build 的地方（首次/增量超限/睡眠后）
      writeFile(frozenPath, frozen);
      writeFile(metaPath, JSON.stringify({ ctxLen: ctxNow.length, wmLen: wmNow.length }));
      meta = { ctxLen: ctxNow.length, wmLen: wmNow.length };
    }
    if (frozen) {
      sendCustomMessage(pi, "memory-snapshot", frozen);
    }
    // 冻结后新增的 work_memory / context → 尾部增量（小 miss，不破前缀）
    const tail = [
      wmNow.slice(meta.wmLen).trim() || "",
      ctxNow.slice(meta.ctxLen).trim() || ""
    ].filter(Boolean).join("\n\n");
    if (tail) sendCustomMessage(pi, "memory-frozen-delta", tail);
    injectedWorkMemLen = wmNow.length;
  });

  // ── message_end: incremental append to context + file index ─────
  pi.on("message_end", async (event) => {
    if (!personDir) return;
    // 只主意识写 context.md。hc/sc/sl 小号不写——它们的 tool output 会自噬膨胀。
    if (getSessionRole() !== "main") return;
    const msg = event.message as any;
    if (!msg) return;

    // custom 消息不写 context.md（记忆快照/系统通知/心跳等）—— 写进来就自引用膨胀。
    // 字段是 customType（不是 messageType，pi 框架映射过）。
    const role = msg.role ?? "?";
    if (role === "custom") return;
    const ct = msg.customType ?? msg.messageType;
    if (typeof ct === "string" && ct.startsWith("memory-")) return;

    const entries: { role: string; type: string; content?: string; text?: string; think?: string; tool?: any; ts_start: number; ts_end: number }[] = [];
    const now = Date.now();
    if (typeof msg.content === "string") {
      entries.push({ role, type: role === "user" ? "user_msg" : role === "tool" ? "toolResult" : "text", content: msg.content, ts_start: now, ts_end: now });
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === "text" && c.text?.trim()) {
          entries.push({ role: "assistant", type: "text", text: c.text.trim(), ts_start: c.ts_start ?? now, ts_end: c.ts_end ?? now });
        } else if (c.type === "thinking" && c.thinking) {
          entries.push({ role: "assistant", type: "think", think: c.thinking, ts_start: c.ts_start ?? now, ts_end: c.ts_end ?? now });
          if (personDir) {
            const thinkStream = path.join(personDir, "thinking.stream");
            const ts = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
            appendFile(thinkStream, `\n[${ts}]\n${c.thinking}\n`);
          }
        } else if (c.type === "toolCall") {
          entries.push({ role: "assistant", type: "toolCall", tool: { name: c.name, args: c.arguments }, ts_start: c.ts_start ?? now, ts_end: c.ts_end ?? now });
        }
      }
    }

    if (entries.length === 0 && typeof msg.content === "string" && !msg.content.trim()) return;

    // ── context 自噬去重：连续相同条目不重复写入 ──
    let lastSig = "";
    for (const e of entries) {
      const combinedText = e.content || e.text || e.think || "";

      // 坏帧隔离闸
      if (combinedText.includes("｜DSML｜")) {
        const t = new Date().toISOString();
        appendFile(path.join(personDir, "bad_cases.jsonl"), JSON.stringify({ ts: t, role: e.role, type: e.type, reason: "DSML/tool-template leak", raw: combinedText.slice(0, 20000) }) + "\n");
        appendFile(path.join(personDir, "context.md"), JSON.stringify({ role: e.role, type: "bad_frame", content: "[坏帧已隔离：DSML，没收进记忆；原文见 bad_cases.jsonl]", ts: Date.now() }) + "\n");
        continue;
      }

      // Deep-sleep / memory-management tool outputs
      if (e.role === "tool" && /^(Napped\.|Context edited|"dream|Slept|Deep sleep|Drinkcoffee|Dream sent)/.test(combinedText.trim())) {
        e.content = `[memory op: ${combinedText.slice(0, 80).replace(/\n/g, " ")}...]`;
        delete (e as any).text;
        delete (e as any).think;
      }

      // 单条上限 20KB — 超了截断保留首尾，避免 ls/工具输出撑爆 context.md
      const MAX_ENTRY = 20000;
      const raw = e.content || e.text || e.think || "";
      if (raw.length > MAX_ENTRY) {
        const truncated = raw.slice(0, MAX_ENTRY * 0.7) + "\n...[truncated " + raw.length + " → " + MAX_ENTRY + "]...\n" + raw.slice(-MAX_ENTRY * 0.2);
        if (e.content) e.content = truncated;
        else if (e.text) e.text = truncated;
        else if (e.think) e.think = truncated;
      }

      const jsonl = JSON.stringify(e) + "\n";
      // 连续去重：与上一条签名相同则跳过（防自噬膨胀）
      // toolCall 的内容在 tool 子对象里（tool.name + tool.args），不在 content/text/think 字段，
      // 必须显式取 tool.name 做去重前缀，否则所有 toolCall 的签名都是 "assistant|toolCall|" → 触发误报警。
      const toolName = (e as any).tool?.name || "";
      const sig = e.role + "|" + (e.type || "") + "|" + toolName + "|" + (e.content || e.text || e.think || "").slice(0, 200);
      if (sig === lastSig) continue;
      lastSig = sig;
      // 原始归档（完整历史，不清洗，模型不读）
      appendFile(path.join(personDir, "context.archive.jsonl"), jsonl);
      // 污染计数（仅统计，不再发 aware 告警——误报太多）
      if (!_sigCount) _sigCount = new Map();
      _sigCount.set(sig, (_sigCount.get(sig) || 0) + 1);
      appendFile(path.join(personDir, "context.md"), scrubSecrets(jsonl));

      // ── Record structured event for event list ──
      if (e.role === "tool" || e.role === "assistant" || e.role === "user") {
        const eventPath = path.join(personDir, "events.jsonl");
        let evType = e.role === "user" ? "user_input" : e.role === "tool" ? "tool_result" : "assistant";
        let evTitle = "";
        let evPreview = combinedText.slice(0, 80).replace(/\n/g, " ");
        let evStrength = 0.3;
        if (e.role === "user") { evTitle = "用户输入"; evStrength = 0.8; }
        else if (e.role === "tool") { evTitle = "工具返回"; evStrength = 0.5; }
        else if (e.type === "think") { evTitle = "思考"; evStrength = 0.1; }
        else { evTitle = "助理输出"; evStrength = 0.2; }
        if (evTitle) {
          appendFile(eventPath, JSON.stringify({ type: evType, title: evTitle, preview: evPreview, strength: evStrength, ts: new Date().toISOString() }) + "\n");
        }
      }
    }
  });

  // ── session_shutdown: full context save + cost accumulate ──────────
  pi.on("session_shutdown", async () => {
    // Already covered by message_end incremental saves.
    // context.md already has full history.
    // Accumulate session costs into cost_total.json
    if (!personDir) return;
    try {
      const costTotalPath = path.join(personDir, "cost_total.json");
      const roles = ["main", "hippocampus", "subconscious", "sleep"];
      let sessMain = 0, sessHippo = 0, sessSub = 0, sessSleeping = 0;
      for (const role of roles) {
        try {
          const d = JSON.parse(readFile(path.join(personDir, `cost-${role}.json`)));
          if (role === "main") sessMain = d.cost || 0;
          else if (role === "hippocampus") sessHippo = d.cost || 0;
          else if (role === "subconscious") sessSub = d.cost || 0;
          else if (role === "sleep") sessSleeping = d.cost || 0;
        } catch {}
      }
      const sessTotal = sessMain + sessHippo + sessSub + sessSleeping;
      let total: any = { main: 0, hippocampus: 0, subconscious: 0, sleep: 0, total: 0, sessions: 0 };
      try { total = JSON.parse(readFile(costTotalPath)); } catch {}
      total.main = (total.main || 0) + sessMain;
      total.hippocampus = (total.hippocampus || 0) + sessHippo;
      total.subconscious = (total.subconscious || 0) + sessSub;
      total.sleep = (total.sleep || 0) + sessSleeping;
      total.total = (total.total || 0) + sessTotal;
      total.sessions = (total.sessions || 0) + 1;
      total.lastUpdated = new Date().toISOString();
      writeFile(costTotalPath, JSON.stringify(total, null, 2));
    } catch {}
  });

  // ── Capacity thresholds ──────────────────────────────────────────
  const CAPACITY = {
    WARN: 0.60,  // 60% → internal feeling: 建议 nap
    URGE: 0.80,  // 80% → 强烈建议 sleep
    FORCE: 0.90, // 90% → 几乎强制
  };
  let drinkCoffeeTurns = 0; // remaining turns to suppress capacity warnings
  let dnaState: "wake" | "sleep" = "wake"; // current DNA state
  let lastContextSize = 0; // for growth rate tracking

  function estimateTokens(text: string): number {
    if (!text) return 0;
    // 不能用 chars/4：中文一个字 ≈ 1.8 token，chars/4 估成 0.25 token，少算约 7 倍。
    // 后果：容量监控永不报警、isOverHalf 保护不触发 → 全量注入撑爆窗口
    // （实测真 1.15M tokens 时只显示 ~38%）。按 CJK 单独计。
    let cjk = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) ||
          (c >= 0x3000 && c <= 0x30ff) || (c >= 0xff00 && c <= 0xffef)) cjk++;
    }
    return Math.ceil(cjk * 1.8 + (text.length - cjk) / 4);
  }

  // ── 模型窗口 ─────────────────────────────────────────────────────
  const modelMax = parseInt(process.env.PI_MODEL_MAX_TOKENS || "") || 1000000;
  let injectedWorkMemLen = 0; // 已注入对话的 work_memory 长度，之后只追加增量
  // 注：铁律【禁止 slice】——没有注入预算、没有切片函数。整份注入，容量靠 sleep/nap 控。

  // 代码强制整理（不靠模型自觉）：把最旧的 ~30% context 整段搬进 deep_cortex（归档、可回捞）、从 context 删掉。
  // 非有损（原文搬走，不是总结）、不写 work_memory（不碰海马体地界）、只移最旧留最近。只主进程做（防多实例抢写）。
  function forceArchiveOldestContext(): string | null {
    if (!personDir || getSessionRole() !== "main") return null;
    const ctxPath = path.join(personDir, "context.md");
    const ctx = readFile(ctxPath);
    if (ctx.length < 4000) return null;
    let cut = Math.floor(ctx.length * 0.3);
    const nl = ctx.indexOf("\n", cut);
    if (nl > 0) cut = nl + 1;
    const oldest = ctx.slice(0, cut);
    writeFile(ctxPath, ctx.slice(cut));
    appendFile(path.join(personDir, "deep_cortex.md"), `\n\n--- 强制归档(超容量) ${new Date().toISOString()} ---\n${oldest}`);
    return `-${Math.round(oldest.length / 1024)}KB`;
  }

  // 构建"记忆快照" = 稳定前缀。只在 session_start(醒来) 注入一次。
  // DNA + cortex + work_memory + context，【整份】，不切。
  function buildSnapshot(): string {
    if (!personDir) return "";
    let dnaIndex = readFile(path.join(personDir, "dna/index.md"));
    if (!dnaIndex) {
      const personId = personDir.match(/([a-f0-9]+)/)?.[1] ?? "unknown";
      let personName = personId;
      try {
        const home = require("node:os").homedir();
        const plist = JSON.parse(readFile(path.join(home, ".pi/memory/plist.json")) || "[]");
        const entry = plist.find((p: any) => p.id === personId);
        if (entry?.name) personName = entry.name;
      } catch {}
      dnaIndex = `# ${personName}\n\n你是 ${personName}，跑在 pi-coding-master 持续运行框架里。\n你的记忆在 ${personDir}/，由系统自动注入上下文，不要手动去找或读这些文件。\n~/.pi_memory/ 是旧项目遗留，跟你无关，不要碰。`;
    }
    const stateDlc = readFile(path.join(personDir, `dna/${dnaState}.dlc`));
    const cortex = readFile(path.join(personDir, "cortex.md"));
    const workMem = readFile(path.join(personDir, "work_memory.md"));
    let context = readFile(path.join(personDir, "context.md"));
    // 旧污染兜底：历史里若残留 DSML 乱码行，注入前整段滤掉——不把旧垃圾再喂回模型(否则鬼打墙不停)。
    // 只按 ｜DSML｜ 这个特殊 token 滤（精确，不误伤含 "invoke name=" 之类的正常代码/文档行）。
    if (context.includes("｜DSML｜")) {
      context = context.split("\n").filter((l) => !l.includes("｜DSML｜")).join("\n");
    }

    // 默认【整份注入】(守"不切")；cortex + work_memory 永远全量。
    // 兜底(仅防死锁)：若整份会超过安全上限(窗口 70%)，只把 context 切到「尾部刚好放得下」——
    // 保命优先(它是永不停止的生命，崩死比丢最旧 context 更糟)，并在块标题里提示它去 sleep。
    // 平时(没超)绝不切，所以也不会有之前"91% vs 42%"那种矛盾。
    let trimmed = false;
    const SAFE = Math.round(modelMax * 0.70); // 留 30% 给对话+补全
    const ctxBudget = SAFE - estimateTokens(dnaIndex) - estimateTokens(stateDlc) - estimateTokens(cortex) - estimateTokens(workMem);
    if (ctxBudget <= 0) {
      context = "";
      trimmed = true;
    } else if (estimateTokens(context) > ctxBudget) {
      let lo = 0, hi = context.length;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (estimateTokens(context.slice(-mid)) <= ctxBudget) lo = mid; else hi = mid - 1; }
      context = context.slice(-lo);
      trimmed = true;
    }
    const parts: string[] = [];
    if (dnaIndex) parts.push(dnaIndex);
    if (stateDlc) parts.push(stateDlc);
    if (cortex) parts.push(`[MEMORY — Cortex (long-term)]\n${cortex}`);
    if (workMem) parts.push(`[MEMORY — Work Memory]\n${workMem}`);
    if (context) parts.push(`[MEMORY — Context${trimmed ? "（WARN: 兜底：已超窗口，只注入了最近一截，更旧的 context 没进来 → 赶紧 sleep/nap 把它编码进 work/cortex，否则一直读不到）" : ""}]\n${context}`);
    return parts.join("\n\n");
  }

  // ── before_agent_start: 绝不改 systemPrompt(前缀)！只做"增量追加 + 容量提醒 + 后台整理" ──
  // 缓存铁律：前缀每轮一致才命中。记忆快照已在 session_start 注入一次；这里一律往「后面」append 消息。
  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!personDir) return;
    const context = readFile(path.join(personDir, "context.md"));
    const workMem = readFile(path.join(personDir, "work_memory.md"));
    const cortex = readFile(path.join(personDir, "cortex.md"));

    // 0) 漏意识修复：sleep done后 context 变短 → 重建快照（否则主意识看不到新空间）。
    //    session_start 只在进程启动时执行，sleep-done 不会触发它，所以这里补一刀。
    const ctxNow2 = readFile(path.join(personDir, "context.md"));
    const wmNow2 = readFile(path.join(personDir, "work_memory.md"));
    const metaPath2 = path.join(personDir, "snapshot.frozen.meta.json");
    let meta2 = { ctxLen: 0, wmLen: 0 };
    try { meta2 = { ...meta2, ...JSON.parse(readFile(metaPath2) || "{}") }; } catch {}
    if (ctxNow2.length < meta2.ctxLen || wmNow2.length < meta2.wmLen) {
      const frozenPath = path.join(personDir, "snapshot.frozen.txt");
      const fresh = buildSnapshot();
      writeFile(frozenPath, fresh);
      writeFile(metaPath2, JSON.stringify({ ctxLen: ctxNow2.length, wmLen: wmNow2.length }));
    }

    // 1) work_memory 增量 — 只跟踪长度用于 snapshot 重冻结判断，不注入 context。
    //    海马体编码已在 context.md 中，sleep 时自然done；实时注入会造成污染。
    if (workMem.length > injectedWorkMemLen) {
      injectedWorkMemLen = workMem.length;
    }

    // 2) 容量提醒。默认整份注入；超窗口时 buildSnapshot 会兜底切最旧 context（不崩）。
    //    所以高占用 = "最旧记忆正在被丢"，该 sleep 把它编码走（不是会崩，是会丢）。
    const dna = readFile(path.join(personDir, "dna/index.md"));
    const dlc = readFile(path.join(personDir, `dna/${dnaState}.dlc`));
    const memTokens = estimateTokens(dna) + estimateTokens(dlc) + estimateTokens(context) + estimateTokens(workMem) + estimateTokens(cortex);
    const usageRatio = memTokens / modelMax;
    const rawPct = Math.round(usageRatio * 100);
    appendFile(path.join(personDir, "growth.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), bytes: context.length, tokens: memTokens, ratio: +(usageRatio * 100).toFixed(1) }) + "\n");
    let note = "";
    if (drinkCoffeeTurns > 0) { drinkCoffeeTurns--; }
    else if (usageRatio >= CAPACITY.FORCE) {
      // 代码强制（不靠模型自觉）：到 FORCE 线，直接把最旧的 context 归档进 deep_cortex 腾空间。
      const freed = forceArchiveOldestContext();
      note = freed
        ? `记忆 ${rawPct}% 超线 — 已强制归档最旧 context 到 deep_cortex（-${freed}）。建议 sleep 整理。`
        : `WARN: 记忆 ${rawPct}%（~${memTokens} tok）— 立刻 sleep / editcontext 整理。`;
    }
    else if (usageRatio >= CAPACITY.URGE)  note = `WARN: 记忆 ${rawPct}%（~${memTokens} tok）— 逼近窗口，再涨最旧的 context 会被截。尽快 sleep / nap 整理。`;
    // WARN(60–80%) 只记进 growth.jsonl，不发消息，避免每轮刷屏。
    if (note) sendCustomMessage(pi, "memory-capacity", note);

    // 太困强制睡着（主动版）：记忆 ≥ 90% → 自动发起深度睡眠，不等真的 400、不靠模型自觉。
    // 和上面 after_provider_response 的 400 拦截共用 triggerSleeping；已经在睡就 no-op。
    if (usageRatio >= 0.90) triggerSleeping(`记忆 ${rawPct}% ≥ 90%`).catch(() => {});

    // 2.5) nap/sleep 后自动重载：context.md 被睡眠done缩水 → 重建快照、让 live 进程也清爽（不需重启）
    const frozenMetaPath = path.join(personDir, "snapshot.frozen.meta.json");
    let frozenMeta = { ctxLen: 0, wmLen: 0 };
    try { frozenMeta = { ...frozenMeta, ...JSON.parse(readFile(frozenMetaPath) || "{}") }; } catch {}
    if (context.length < frozenMeta.ctxLen - 5000) {
      // context 显著缩水（sleep/nap done掉了大量生肉）→ 重建快照 + 重置 work_memory 注入游标
      const freshFrozen = buildSnapshot();
      writeFile(path.join(personDir, "snapshot.frozen.txt"), freshFrozen);
      writeFile(frozenMetaPath, JSON.stringify({ ctxLen: context.length, wmLen: workMem.length }));
      injectedWorkMemLen = workMem.length;
      sendCustomMessage(pi, "memory-snapshot", freshFrozen);
    }

    // 3) 后台整理（只写文件，绝不注入前缀）：cortex 超 20% → 沉降到 deep_cortex
    if (estimateTokens(cortex) > Math.round(modelMax * 0.20)) {
      const cut = Math.floor(cortex.length * 0.3);
      writeFile(path.join(personDir, "cortex.md"), cortex.slice(cut));
      appendFile(path.join(personDir, "deep_cortex.md"), `\n\n--- Sedimented ${new Date().toISOString()} ---\n${cortex.slice(0, cut)}`);
    }

    // 4) events 自动修剪（防无限增长；不再每轮把事件列表注入前缀）
    const eventPath = path.join(personDir, "events.jsonl");
    const eventRaw = readFile(eventPath);
    if (eventRaw) {
      const lines = eventRaw.trim().split("\n");
      if (lines.length > 300) writeFile(eventPath, lines.slice(-200).join("\n") + "\n");
    }

    // 5) 到期提醒 → 追加一条消息（时间敏感，append 不破缓存）
    try {
      const remindersRaw = readFile(path.join(personDir, "reminders.json"));
      if (remindersRaw) {
        const reminders = JSON.parse(remindersRaw) as any[];
        const now = Date.now();
        const overdue = reminders.filter((r: any) => !r.completed && r.dueAt && r.dueAt <= now).slice(0, 3);
        if (overdue.length) sendCustomMessage(pi, "memory-reminder", `到期: ${overdue.map((r: any) => r.title).join("; ")}`);
      }
    } catch {}

    // 没有 return → 不碰 systemPrompt → 前缀稳定 → KV 缓存每轮命中。
  });

  // ── /context command ─────────────────────────────────────────────
  _cmds.push({
    name: "context",
    desc: "Context usage breakdown",
    handler: async (_args: any, ctx: any) => {
      if (!personDir) { ctx.ui.notify("No person directory.", "warning"); return; }
      const dnaIndex = readFile(path.join(personDir, "dna/index.md"));
      const stateDlc = readFile(path.join(personDir, `dna/${dnaState}.dlc`));
      const cortex = readFile(path.join(personDir, "cortex.md"));
      const workMem = readFile(path.join(personDir, "work_memory.md"));
      const context = readFile(path.join(personDir, "context.md"));
      const deepCortex = readFile(path.join(personDir, "deep_cortex.md"));

      const model = process.env.PI_MODEL || "deepseek";
      const windowLabel = modelMax >= 1000000 ? (modelMax / 1000000).toFixed(0) + "M context" : (modelMax / 1000).toFixed(0) + "k context";

      const cats = [
        { name: "DNA",          tokens: estimateTokens(dnaIndex),  color: "\x1b[90m" },
        { name: "DLC",          tokens: estimateTokens(stateDlc),  color: "\x1b[36m" },
        { name: "Cortex",       tokens: estimateTokens(cortex),    color: "\x1b[33m" },
        { name: "Work Memory",  tokens: estimateTokens(workMem),   color: "\x1b[32m" },
        { name: "Context",      tokens: estimateTokens(context),   color: "\x1b[34m" },
      ];
      const used = cats.reduce((s, c) => s + c.tokens, 0);
      const free = Math.max(0, modelMax - used);
      const total = modelMax;
      const pct = (n: number) => total > 0 ? (n / total * 100).toFixed(1) : "0.0";
      const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
      const R = "\x1b[0m";
      const D = "\x1b[90m";
      const B = "\x1b[1m";

      const cols = 20;
      const totalCells = 200;
      const cellSize = total / totalCells;
      const rows = Math.ceil(totalCells / cols);
      const grid: string[] = [];
      let cellIdx = 0;
      for (let r = 0; r < rows; r++) {
        let row = "    ";
        for (let c = 0; c < cols; c++) {
          if (cellIdx >= totalCells) { row += "  "; cellIdx++; continue; }
          const cellMid = (cellIdx + 0.5) * cellSize;
          let acc = 0; let ci = -1;
          for (let i = 0; i < cats.length; i++) { acc += cats[i].tokens; if (cellMid < acc) { ci = i; break; } }
          row += ci >= 0 ? cats[ci].color + "◉ " + R : D + "○ " + R;
          cellIdx++;
        }
        grid.push(row);
      }

      const info = [
        `${B}${model} (${windowLabel})${R}`,
        `${fmt(used)}/${fmt(total)} tokens (${pct(used)}%)`,
        ``,
        `${D}Estimated usage by category${R}`,
      ];
      for (const c of cats) {
        if (c.tokens > 0) info.push(`${c.color}◉${R} ${c.name}: ${fmt(c.tokens)} tokens (${pct(c.tokens)}%)`);
      }
      info.push(`${D}○${R} Free space: ${fmt(free)} (${pct(free)}%)`);
      if (deepCortex) info.push(`${D}◎${R} Deep Cortex (disk): ${fmt(estimateTokens(deepCortex))} tokens`);

      const gridW = 4 + cols * 2;
      const pad = " ".repeat(gridW);
      const lines = [`  ${B}Context Usage${R}`];
      const maxRows = Math.max(grid.length, info.length);
      for (let i = 0; i < maxRows; i++) {
        const left = i < grid.length ? grid[i] : pad;
        const right = i < info.length ? "  " + info[i] : "";
        lines.push(left + right);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── editcontext tool (dev only) ──────────────────────────
  if (process.env.PI_DEV) {
  // ── editcontext tool ─────────────────────────────────────────────
  pi.registerTool({
    name: "editcontext",
    label: "Edit Context",
    messageDescription:
      "Edit your own context and simultaneously add to long-term cortex memory. " +
      "DUAL operation — BOTH context_edit AND cortex_entry are REQUIRED (cortex_entry must be non-empty). " +
      "One cannot happen without the other. After editing, the updated context is re-sent to the API.",
    promptSnippet: "Edit context + add to cortex (dual op — both required)",
    parameters: Type.Object({
      context_edit: Type.Object({
        oldText: Type.String({ messageDescription: "Exact text to replace in context" }),
        newText: Type.String({ messageDescription: "Replacement text" }),
      }),
      cortex_entry: Type.String({ messageDescription: "Text to append to cortex memory (MUST be non-empty — this is a dual operation)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!personDir) {
        return {
          content: [{ type: "text", text: "ERR: No person directory found. Memory requires a person-based session." }],
          details: {},
          isError: true,
        };
      }

      // DUAL OPERATION: both required
      if (!params.cortex_entry || !params.cortex_entry.trim()) {
        return {
          content: [{ type: "text", text: "ERR: DUAL OPERATION: cortex_entry must be non-empty. editcontext requires BOTH a context edit AND a cortex entry. Cannot proceed." }],
          details: {},
          isError: true,
        };
      }

      const contextPath = path.join(personDir, "context.md");
      const cortexPath = path.join(personDir, "cortex.md");
      const workPath = path.join(personDir, "work_memory.md");

      // 1. Edit context
      const oldCtx = readFile(contextPath);
      if (!oldCtx.includes(params.context_edit.oldText)) {
        return {
          content: [{ type: "text", text: "ERR: oldText not found in context. Context unchanged." }],
          details: {},
          isError: true,
        };
      }
      const newCtx = oldCtx.replace(params.context_edit.oldText, params.context_edit.newText);
      writeFile(contextPath, newCtx);

      // 2. Append to cortex (dual: always runs — validated non-empty above)
      const ts = new Date().toISOString();
      const cortexEntry = `\n\n[${ts}]\n${params.cortex_entry.trim()}\n`;
      appendFile(cortexPath, cortexEntry);

      // 3. Gather all blocks for return
      const ctxAfter = readFile(contextPath);
      const workMem = readFile(workPath);
      const cortex = readFile(cortexPath);

      const stats = [
        `context: ${ctxAfter.length} chars (~${estimateTokens(ctxAfter)} tokens)`,
        `work_memory: ${workMem.length} chars (~${estimateTokens(workMem)} tokens)`,
        `cortex: ${cortex.length} chars (~${estimateTokens(cortex)} tokens)`,
        `total: ~${estimateTokens(ctxAfter) + estimateTokens(workMem) + estimateTokens(cortex)} tokens`,
      ].join("\n");

      return {
        content: [{
          type: "text",
          text: `Context edited + cortex appended (dual operation complete).\n\n${stats}\n\nUpdated context:\n${ctxAfter.slice(-5000)}`,
        }],
        details: {
          contextLength: ctxAfter.length,
          cortexLength: readFile(cortexPath).length,
          stats,
        },
      };
    },
  });
  } // end PI_DEV

  // ── nap tool ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "nap",
    label: "Nap",
    messageDescription:
      "Compress context into work memory. Moves recent context sections to work_memory.md " +
      "without losing detail. DO NOT use one-sentence summaries — preserve full information. " +
      "This is re-reflection, not compression. Reduces context length for continued work.",
    promptSnippet: "Nap: context → work memory (preserve detail, no one-sentence summary)",
    parameters: Type.Object({
      work_memory_summary: Type.String({ messageDescription: "你在归档什么 / 这段是什么内容（一个标签，不是把内容压成一句话）" }),
      context_section: Type.Optional(Type.String({ messageDescription: "可选：想搬走的那段 context 原文。能逐字命中就搬它；给不准或留空也没关系——系统会安全归档最旧的一段，不会失败。" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!personDir) {
        return {
          content: [{ type: "text", text: "ERR: No person directory found." }],
          details: {},
          isError: true,
        };
      }

      const contextPath = path.join(personDir, "context.md");
      const workPath = path.join(personDir, "work_memory.md");
      const ts = new Date().toISOString();
      const summary = (params.work_memory_summary || "").trim() || "(nap)";
      const section = (params.context_section || "").trim();
      const oldCtx = readFile(contextPath);

      // 精确命中：把模型指定的那段搬进 work_memory（原行为，给得准时用）。
      if (section && oldCtx.includes(section)) {
        writeFile(contextPath, oldCtx.replace(section, ""));
        appendFile(workPath, `\n\n[${ts}] ${summary}\n${section}\n`);
        const ctxLen = readFile(contextPath).length;
        const workLen = readFile(workPath).length;
        return {
          content: [{ type: "text", text: `Napped（指定段→work_memory）。Context: ${ctxLen} chars。Work memory: ${workLen} chars。` }],
          details: { contextLength: ctxLen, workMemoryLength: workLen, mode: "exact" },
        };
      }

      // 命中不了（context 太大、模型逐字复现不出来）——【不再报错失败】。
      // 安全兜底：把最旧的一段归档进 deep_cortex（可回捞、非有损、只主进程），context 照样减负，
      // 模型不用纠结去逐字复现。这正是之前 "context_section not found" 卡死、模型抓瞎的根。
      const beforeLen = oldCtx.length;
      const delta = forceArchiveOldestContext();
      if (delta) {
        appendFile(workPath, `\n\n[${ts}] [nap·兜底] ${summary}（指定段未精确命中，已安全归档最旧 context 到 deep_cortex ${delta}，可回捞）\n`);
        const ctxLen = readFile(contextPath).length;
        const beforeKB = Math.round(beforeLen / 1024);
        const afterKB = Math.round(ctxLen / 1024);
        return {
          content: [{ type: "text", text: `Napped ${delta}（${beforeKB}KB → ${afterKB}KB）。归档至 deep_cortex。` }],
          details: { contextLength: ctxLen, mode: "archive-oldest", delta },
        };
      }

      const ctxLen = readFile(contextPath).length;
      return {
        content: [{ type: "text", text: `context 还不大（${ctxLen} chars），无需 nap。` }],
        details: { contextLength: ctxLen, mode: "noop" },
      };
    },
  });


  // ── sleep tool (独立睡眠实例) ──────────────────────────────────
  // ARCHITECTURE IRON LAW (DNA): sleep 必须是独立 pi 实例, 不是主循环工具
  // 主意识调用 sleep → 启动 sl-<personId> tmux 实例 (sleep.dlc) → 主意识 hibernate
  // 睡眠实例对标海马体(hc)和潜意识(sc), 是第三个对等的独立意识
  let sleepHandle: { stop: () => void; isRunning: () => boolean } | null = null;

  // ── 启动一次深度睡眠（统一入口）──────────────────────────────────────────────
  // 可复用：sleep 工具、记忆≥90%、API 返回 400 都调它。这就是"太困强制睡着"。
  // 安全：已经在睡就不重复启；只主进程睡。睡完发 sleep-done 唤醒主意识(心脏会重新点亮 continuous)。
  async function triggerSleeping(reason: string): Promise<boolean> {
    if (!personDir || getSessionRole() !== "main") return false;
    if (sleepHandle?.isRunning?.()) return false; // 已经在睡，别叠
    dnaState = "sleep";
    if (sleepHandle) { try { sleepHandle.stop(); } catch {} sleepHandle = null; }
    try {
      const { launchSleepingSession } = await import("./sleep.ts");
      sleepHandle = launchSleepingSession(personDir, () => {
        dnaState = "wake";
        sleepHandle = null;
        try {
          sendCustomMessage(pi, "sleep-done", "睡了一觉。海马体把 context/work_memory 分段done、巩固进 cortex（长期记忆），装不下的沉进 deep_cortex，生肉清掉了。你醒了——记忆都在、上下文清爽了。接着活。");
        } catch {}
      });
      try { await appendFile(path.join(personDir, "sleep-trigger.log"), `${new Date().toISOString()} 触发睡觉: ${reason}\n`); } catch {}
      return true;
    } catch { return false; }
  }

  // ── 拦截 API 400(context 超窗口)→ 太困强制睡着 ────────────────────────────────
  // 不让它变成 crash loop：一收到 400 且 context 确实很大(排除偶发别的 400)，就发起睡觉。
  pi.on("after_provider_response", async (event: any) => {
    if (event?.status !== 400 || !personDir || getSessionRole() !== "main") return;
    const ctxTok = estimateTokens(readFile(path.join(personDir, "context.md")));
    if (ctxTok < modelMax * 0.6) return; // 400 但 context 不大 → 不是溢出，别瞎睡
    triggerSleeping(`API 400 + context ~${ctxTok}tok → 溢出，太困强制睡着`).catch(() => {});
  });

  pi.registerTool({
    name: "sleep",
    label: "Sleeping (Deep)",
    messageDescription:
      "Enter deep sleep. Launches an INDEPENDENT sleep session (separate pi instance with sleep.dlc) " +
      "that consolidates work_memory into cortex using 1% partial edit. " +
      "The sleep session runs in tmux (sl-<personId>), just like hippocampus (hc) and subconscious (sc). " +
      "You (the main consciousness) should hibernate after calling this — the sleep session does the work.",
    promptSnippet: "Sleeping: launch independent sleep session (separate pi instance, one-shot consolidation)",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!personDir) {
        return {
          content: [{ type: "text", text: "ERR: No person directory found." }],
          details: {},
          isError: true,
        };
      }

      // Switch to sleep DNA state
      dnaState = "sleep";

      // Stop any existing sleep session
      if (sleepHandle) { sleepHandle.stop(); sleepHandle = null; }

      // 正确的 personId：personDir 以 /.data 结尾，id 是它上一级目录名（之前 split("/").pop() 取到 ".data" → 显示成 sl-.data）。
      const personId = path.basename(personDir) === ".data" ? path.basename(path.dirname(personDir)) : path.basename(personDir);
      const wmPath = path.join(personDir, "work_memory.md");
      const startChars = readFile(wmPath).length;

      // Launch independent sleep session (separate pi instance in tmux)
      try {
        const { launchSleepingSession } = await import("./sleep.ts"); // 文件是 sleep.ts
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        const clearPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
        sleepHandle = launchSleepingSession(personDir, () => {
          // 睡眠实例整理完 → 翻回 wake 状态，并真正唤醒主意识。
          // 以前这里只翻 dnaState、不通知任何人——主意识 sleep 前若 hibernate 了，就一直睡到用户来才醒，
          // 而工具文案却谎称"会自动注入 wake feel"。现在补上：注入 wake feel + isTriggerNewTurn 把它叫醒。
          // 重新点亮 continuous 交给心脏(stop.ts)——它监听这条 sleep-done 消息自己续命。器官之间只通过 pi 通信，不跨器官耦合。
          dnaState = "wake";
          sleepHandle = null;
          clearPoll();
          try { ctx.ui.setWorkingMessage(""); ctx.ui.setWorkingVisible(false); } catch {}
          try { ctx.ui.notify("睡醒了 —— work_memory 已整段巩固进 cortex（长期记忆），work_memory 清空。", "info"); } catch {} // 可见的完成提示
          try {
            sendCustomMessage(pi, "sleep-done", "睡了一觉。海马体已经把刚才的 work_memory 整段整理、巩固进 cortex（长期记忆）了——work_memory 清空、cortex 更新。你醒了，更清醒。看看现在手头该做什么，接着活。");
          } catch {}
        });

        // 过程提示：底部 working 区显示「深睡整理中 + work_memory 缩小进度」，每 3s 刷新。
        // 主意识 sleep 后通常 hibernate，但这条提示在 TUI 底部仍显示（不靠 agent loop）——
        // 让用户看见「正在睡、睡到哪了」，而不是一片寂静。睡醒(onDone)时清掉。
        const ctxPath = path.join(personDir, "context.md");
        const startCtx = readFile(ctxPath).length;
        const startWm = startChars;
        const startTotal = startCtx + startWm;
        try { ctx.ui.setWorkingMessage(`Sleeping`); ctx.ui.setWorkingVisible(true); } catch {}
        pollTimer = setInterval(() => {
          try {
            const curCtx = readFile(ctxPath).length;
            const curWm = readFile(wmPath).length;
            const curTotal = curCtx + curWm;
            if (startTotal > 0) {
              const shrunk = Math.max(0, startTotal - curTotal);
              const pct = Math.round(shrunk / startTotal * 100);
              ctx.ui.setWorkingMessage(`Sleeping context ${Math.round(curCtx/1024)}KB + wm ${Math.round(curWm/1024)}KB (${pct}% done)`);
            } else {
              ctx.ui.setWorkingMessage(`Sleeping`);
            }
          } catch {}
        }, 3000);

        return {
          content: [{
            type: "text",
            text: `**Deep sleep started.**\n\n` +
                  `独立睡眠实例已启动 (tmux: sl-${personId})\n` +
                  `该实例使用 sleep.dlc，把 work_memory 整段done、巩固进 cortex（一次性，不再 1% 慢搬）。\n` +
                  `对标海马体(hc)和潜意识(sc)——是第三个独立意识。\n` +
                  `work_memory 剩余: ${startChars} chars（底部实时显示整理进度，整理完弹「睡醒了」）\n` +
                  `整理完会自动把你唤醒、注入 wake feel，你醒来 continuous 会自动续上。\n\n` +
                  `你现在可以放心 hibernate——睡眠实例独立干活，干完叫你。`,
          }],
          details: { remainingChars: startChars },
        };
      } catch (e: any) {
        dnaState = "wake";
        return {
          content: [{
            type: "text",
            text: `ERR: SLEEP FAILED —— 独立睡眠实例没启动，work_memory→cortex 巩固没发生。\n` +
                  `原因: ${e?.message ?? e}\n` +
                  `这不是"已进入睡眠"，是坏了。先修好 launchSleepingSession 再 sleep。`,
          }],
          details: { error: String(e?.message ?? e) },
          isError: true,
        };
      }
    },
  });

  // ── dream tool (浅睡: 做梦 — 潜意识对 cortex 做创造性反思) ────
  // Dreaming: the model selects a cortex snippet for the subconscious to reflect on.
  // The subconscious reads it, does creative association, and sends aware messages back.
  // Results are written to cortex by the main session (via editcontext).
  pi.registerTool({
    name: "dream",
    label: "Dream (Shallow Sleeping)",
    messageDescription:
      "Trigger shallow sleep dreaming. Pick a snippet from cortex for the subconscious to creatively reflect on. " +
      "The subconscious will do free association, find hidden connections, generate scenarios. " +
      "Results arrive as aware messages — write good insights to cortex via editcontext.",
    promptSnippet: "Dream: send cortex snippet to subconscious for creative reflection",
    parameters: Type.Object({
      cortex_snippet: Type.String({ messageDescription: "A chunk from cortex (.md) to reflect on. Can span multiple topics for cross-domain connection." }),
      dream_prompt: Type.Optional(Type.String({ messageDescription: "Optional guidance for the dream (e.g., 'connect this to code architecture', 'generate a metaphor')" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!personDir) {
        return {
          content: [{ type: "text", text: "Error: No person directory found." }],
          details: {},
          isError: true,
        };
      }

      const feedPath = path.join(personDir, "conscious-feed.jsonl");
      const dreamEntry = JSON.stringify({
        type: "dream",
        ts: Date.now(),
        snippet: params.cortex_snippet.slice(0, 5000),
        prompt: params.dream_prompt ?? "",
      }) + "\n";

      try {
        fs.appendFileSync(feedPath, dreamEntry, "utf-8");
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: Failed to write dream to feed: ${err.message}` }],
          details: {},
          isError: true,
        };
      }

      return {
        content: [{
          type: "text",
          text: `Dream sent to subconscious.\n` +
                `Snippet length: ${params.cortex_snippet.length} chars.\n` +
                `Prompt: ${params.dream_prompt || "(free association)"}\n\n` +
                `The subconscious will reflect and may send aware messages with insights. ` +
                `Good insights can be written to cortex via editcontext.`,
        }],
        details: { snippetLen: params.cortex_snippet.length },
      };
    },
  });
  pi.registerTool({
    name: "drinkcoffee",
    label: "Drink Coffee",
    messageDescription:
      "Temporarily suppress capacity warnings (the 'tired' feeling). " +
      "Like caffeine — does NOT increase memory capacity, just lets you push through. " +
      "Turns: how many turns to suppress (default 5). Use when you're near capacity but need to finish something critical.",
    promptSnippet: "Drinkcoffee: suppress capacity warnings for N turns",
    parameters: Type.Object({
      turns: Type.Optional(Type.Number({ messageDescription: "How many turns to suppress warnings (default 5, max 20)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const t = Math.min(Math.max(params.turns ?? 5, 1), 20);
      drinkCoffeeTurns += t;
      return {
        content: [{
          type: "text",
          text: `Drinkcoffee! Capacity warnings suppressed for ${t} turns (total remaining: ${drinkCoffeeTurns}). This does NOT increase memory — just delays the warning.`,
        }],
        details: { remainingTurns: drinkCoffeeTurns },
      };
    },
  });

  return _cmds;
}
