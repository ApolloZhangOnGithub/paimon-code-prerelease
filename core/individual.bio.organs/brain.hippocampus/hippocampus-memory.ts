import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { getSessionRole, getPrompt } from "#ribosome";
import { memoryDir,  personDataDir as _personDataDir, memoryDataDir, sessionDirFor } from "#paths";
import { registerPaimonTool, sendCustomMessage, resultContent } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";
import { execSync } from "node:child_process";
import { logerr } from "#paths";

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

function _errLogPath(p: string): string {
  const m = p.match(/MemoryData\/([a-f0-9]+)/);
  if (!m) return "/tmp/pi-silent-err.log";
  return `${process.env.HOME ?? "/tmp"}/.paimon/ErrorData/${m[1]}/error.log`;
}

function appendFile(p: string, text: string): void {
  try { fs.appendFileSync(p, text, "utf-8"); } catch (e) { try { const d = path.dirname(_errLogPath(p)); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(_errLogPath(p), `[${new Date().toISOString()}] [memory] appendFile ${p}: ${e}\n`); } catch {} }
}

function writeFile(p: string, text: string): void {
  try { fs.writeFileSync(p, text, "utf-8"); } catch (e) { try { const d = path.dirname(_errLogPath(p)); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(_errLogPath(p), `[${new Date().toISOString()}] [memory] writeFile ${p}: ${e}\n`); } catch {} }
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
  if (_memoryRegistered) {  return; }
  _memoryRegistered = true;
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
    if (/metaconsciousnessSessions|HippocampusSessions|SleepSessions/.test(sf0)) {
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
    // 不依赖 global.__paimonChannelDir（session_start 时 kernel 可能还没设置），自己推导
    const runtimeCacheDir = global.__paimonChannelDir || (personDir ? path.join(path.dirname(personDir), "..", "RuntimeCache", path.basename(personDir)) : "");
    const frozenPath = runtimeCacheDir + "/snapshot.frozen.txt";
    const metaPath = runtimeCacheDir + "/snapshot.frozen.meta.json";
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
    // 字段是 customType（不是 messageType，paimon 框架映射过）。
    const role = msg.role ?? "?";
    if (role === "custom") return;
    const ct = msg.customType ?? msg.messageType;
    if (typeof ct === "string" && ct.startsWith("memory-")) return;

    const entries: { role: string; type: string; content?: string; text?: string; think?: string; tool?: any; ts_start: number; ts_end: number }[] = [];
    const now = Date.now();
    if (typeof msg.content === "string") {
      const msgType = msg.customType ?? msg.messageType;
      const entryType = typeof msgType === "string" ? msgType : (role === "user" ? "user_msg" : role === "tool" ? "toolResult" : "text");
      entries.push({ role, type: entryType, content: msg.content, ts_start: now, ts_end: now });
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === "text" && c.text?.trim()) {
          entries.push({ role, type: "text", text: c.text.trim(), ts_start: c.ts_start ?? now, ts_end: c.ts_end ?? now });
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
        appendFile(path.join(personDir, "bad_cases.jsonl"), JSON.stringify({ ts: t, role: e.role, type: e.type, reason: "DSML/tools-template leak", raw: combinedText.slice(0, 20000) }) + "\n");
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

  // ── tool_call: 禁止 main session 直接写记忆文件（海马体领地）─────
  const MEMORY_FILES = ["work_memory.md", "context.md", "neocortex.md", "deep_cortex.md"];
  pi.on("tool_call", async (event) => {
    if (getSessionRole() !== "main") return;
    if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash") return;

    // extract target path: write/edit use path/file_path; bash extracts from command
    let p: string = (event.input as any)?.path ?? (event.input as any)?.file_path ?? "";
    if (event.toolName === "bash") {
      const cmd: string = (event.input as any)?.command ?? "";
      // match write redirections and destructive ops targeting memory files
      const m = cmd.match(/(?:>>?|>\||\bcat\s+>|\btee\s|\bcp\s+\S+\s+|\bmv\s+\S+\s+|\brm\s+(?:-f\s+)?|\btruncate\s+(?:-s\s+\S+\s+)?)['"]?([^\s'"&|;]+)/);
      if (m) p = m[1]!;
      else if (/\brm\b/.test(cmd)) {
        return { block: true, reason: `bash 含 rm 操作但无法确定目标路径。内存文件删除操作禁止。` };
      }
    }
    if (!p || !personDir) return;
    const base = p.split("/").pop() || "";
    if (MEMORY_FILES.includes(base)) {
      const abs = path.resolve(p);
      const pd = path.resolve(personDir);
      if (abs.startsWith(pd)) {
        // 海马体 session 可以读写 work_memory（蓝图的 hebbian 编码）
        const isHc = getSessionRole() === "hippocampus";
        const isWorkMem = base === "work_memory.md";
        const isContext = base === "context.md" || base === "hc-new-slice.md";
        if (isHc && (isWorkMem || (isContext && event.toolName === "read"))) return;
        return { block: true, reason: `记忆文件 ${base} 由海马体管理，主 session 不能直接修改。使用 editcontext / nap / sleep 工具。` };
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
      const costTotalPath = global.__paimonAgentFileDir + "/../MonitorData/" + global.__paimonPersonId + "/cost_total.json";
      const roles = ["main", "hippocampus", "metaconsciousness", "sleep"];
      let sessMain = 0, sessHippo = 0, sessSub = 0, sessSleeping = 0;
      for (const role of roles) {
        try {
          const d = JSON.parse(readFile(path.join(personDir, `cost-${role}.json`)));
          if (role === "main") sessMain = d.cost || 0;
          else if (role === "hippocampus") sessHippo = d.cost || 0;
          else if (role === "metaconsciousness") sessSub = d.cost || 0;
          else if (role === "sleep") sessSleeping = d.cost || 0;
        } catch {}
      }
      const sessTotal = sessMain + sessHippo + sessSub + sessSleeping;
      let total: any = { main: 0, hippocampus: 0, metaconsciousness: 0, sleep: 0, total: 0, sessions: 0 };
      try { total = JSON.parse(readFile(costTotalPath)); } catch {}
      total.main = (total.main || 0) + sessMain;
      total.hippocampus = (total.hippocampus || 0) + sessHippo;
      total.metaconsciousness = (total.metaconsciousness || 0) + sessSub;
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
      const personId = personDir.split("/").pop() ?? "unknown";
      let personName = personId;
      try {
        const plist = JSON.parse(readFile(path.join(memoryDataDir(), "plist.json")) || "[]");
        const entry = plist.find((p: any) => p.id === personId);
        if (entry?.name) personName = entry.name;
      } catch {}
      dnaIndex = `# ${personName}\n\n你是 ${personName}，跑在 paimon-code 持续运行框架里。\n你的记忆在 ${personDir}/，由系统自动注入上下文，不要手动去找或读这些文件。\n~/.pi_memory/ 是旧项目遗留，跟你无关，不要碰。`;
    }
    const stateDlc = readFile(path.join(personDir, `dna/${dnaState}.dlc`));
    const cortex = readFile(path.join(personDir, "neocortex.md"));
    const workMem = readFile(path.join(personDir, "work_memory.md"));
    let context = readFile(path.join(personDir, "context.md"));
    // 旧污染兜底：历史里若残留 DSML 乱码行，注入前整段滤掉——不把旧垃圾再喂回模型(否则鬼打墙不停)。
    // 只按 ｜DSML｜ 这个特殊 token 滤（精确，不误伤含 "invoke name=" 之类的正常代码/文档行）。
    if (context.includes("｜DSML｜")) {
      context = context.split("\n").filter((l) => !l.includes("｜DSML｜")).join("\n");
    }

    // 快照去 tool_result：context.md 里混入的 toolResult JSONL 行不进快照——原样重放会被当成假工具结果且自噬膨胀。
    // 非 JSON 行（含空行）原样保留；正常 toolResult 压缩成一行 [tool: 前500字]；bad_frame 整行剔除。
    context = context.split("\n").map((line: string): string | null => {
      const t = line.trim();
      if (!t.startsWith("{")) return line;
      try {
        const obj = JSON.parse(t);
        if (obj && obj.role === "toolResult") {
          if (obj.type === "bad_frame") return null;
          let text: any = obj.text ?? obj.content ?? "";
          if (Array.isArray(text)) text = text.map((b: any) => (b && typeof b.text === "string" ? b.text : "")).join(" ");
          text = String(text).trim();
          return text ? `[tool: ${text.slice(0, 500).replace(/\n/g, " ")}]` : null;
        }
      } catch {}
      return line;
    }).filter((l): l is string => l !== null).join("\n");

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
    // 注入消息类型参考表（从 prompts.json 的 dna.core.typeRef 读取）
    const typeRef = getPrompt("core.typeRef");
    if (typeRef) parts.push(typeRef);
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
    const cortex = readFile(path.join(personDir, "neocortex.md"));

    // 0) 漏意识修复：sleep done后 context 变短 → 重建快照（否则主意识看不到新空间）。
    //    session_start 只在进程启动时执行，sleep-done 不会触发它，所以这里补一刀。
    const ctxNow2 = readFile(path.join(personDir, "context.md"));
    const wmNow2 = readFile(path.join(personDir, "work_memory.md"));
    const metaPath2 = (global.__paimonChannelDir || personDir.replace("MemoryData", "RuntimeCache")) + "/snapshot.frozen.meta.json";
    let meta2 = { ctxLen: 0, wmLen: 0 };
    try { meta2 = { ...meta2, ...JSON.parse(readFile(metaPath2) || "{}") }; } catch {}
    if (ctxNow2.length < meta2.ctxLen || wmNow2.length < meta2.wmLen) {
      const frozenPath = (global.__paimonChannelDir || personDir.replace("MemoryData", "RuntimeCache")) + "/snapshot.frozen.txt";
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
    appendFile(global.__paimonPersonDir + "/../MonitorData/" + global.__paimonPersonId + "/growth.jsonl",
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
    const _rcDir = global.__paimonChannelDir || personDir.replace("MemoryData", "RuntimeCache");
    const frozenMetaPath = _rcDir + "/snapshot.frozen.meta.json";
    let frozenMeta = { ctxLen: 0, wmLen: 0 };
    try { frozenMeta = { ...frozenMeta, ...JSON.parse(readFile(frozenMetaPath) || "{}") }; } catch {}
    if (context.length < frozenMeta.ctxLen - 5000) {
      // context 显著缩水（sleep/nap done掉了大量生肉）→ 重建快照 + 重置 work_memory 注入游标
      const freshFrozen = buildSnapshot();
      writeFile(_rcDir + "/snapshot.frozen.txt", freshFrozen);
      writeFile(frozenMetaPath, JSON.stringify({ ctxLen: context.length, wmLen: workMem.length }));
      injectedWorkMemLen = workMem.length;
      sendCustomMessage(pi, "memory-snapshot", freshFrozen);
    }

    // 3) 后台整理（只写文件，绝不注入前缀）：cortex 超 20% → 沉降到 deep_cortex
    if (estimateTokens(cortex) > Math.round(modelMax * 0.20)) {
      const cut = Math.floor(cortex.length * 0.3);
      writeFile(path.join(personDir, "neocortex.md"), cortex.slice(cut));
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

  // /context command 已迁移到 god.tui/commands/context.ts

  // ── editcontext tool (dev only) ──────────────────────────
  if (process.env.PI_DEV) {
  // ── editcontext tool ─────────────────────────────────────────────
  registerPaimonTool({
    name: "editcontext",
    label: "Edit Context",
    messageDescription:
      "Edit your own context and simultaneously add to long-term cortex memory. " +
      "DUAL operation — BOTH context_edit AND cortex_entry are REQUIRED (cortex_entry must be non-empty). " +
      "One cannot happen without the other. After editing, the updated context is re-sent to the API.",
    promptSnippet: "Edit context + add to cortex (dual op — both required)",
    renderCall(_args: any, theme: any) {
      return renderToolCall.label(theme, "Edit Context");
    },
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      const content = resultContent(result);
      return renderMessage.summary(theme, ctx, content?.[0]?.text);
    },
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
      const cortexPath = path.join(personDir, "neocortex.md");
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
  // 午睡十分钟：启动独立 paimon 实例，把过量 context 编码进 work_memory，然后裁剪。
  let napHandle: { stop: () => void; isRunning: () => boolean } | null = null;

  registerPaimonTool({
    name: "nap",
    label: "Nap",
    feedResult: false,
    messageDescription:
      "Launch a quick nap session to encode overflowing context into work_memory and trim. " +
      "Like a 10-minute power nap — lightweight, fast.",
    promptSnippet: "Nap: trim context up to hippocampus offset",
    renderCall(_args: any, theme: any) {
      return renderToolCall.label(theme, "Nap");
    },
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      const content = resultContent(result);
      const text = content?.[0]?.text || "";
      return renderMessage.summary(theme, ctx, text);
    },
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!personDir || getSessionRole() !== "main") {
        return { content: [{ type: "text", text: "ERR: 只有主 session 可以 nap。" }], details: {}, isError: true };
      }
      if (napHandle?.isRunning?.()) {
        return { content: [{ type: "text", text: "nap 已在运行中。" }], details: {} };
      }

      const personId = path.basename(personDir);
      const tmuxName = `nav-${personId}`;
      const sessionDir = path.join(sessionDirFor(personId), "NapSessions");

      // Build nap prompt
      await fs.promises.mkdir(sessionDir, { recursive: true });
      const napPrompt = `你是海马体的午睡实例。主意识的原始对话堆积了（43%+），海马体后台编码跟不上。你需要快速做两件事。

【文件目录】${personDir}

【第一步：context → work_memory】
1. 读 context.md，从 hc-offset 往前找还没编码的最旧 300~500 行
2. 编码进 work_memory.md：结构化、按主题分段、保留关键对话和决策
3. 这是最大的瓶颈——海马体后台太慢，你要帮它追赶

【第二步：work_memory → neocortex】
4. 读 work_memory.md，把已定论的内容巩固进 neocortex.md
5. 按主题合并、保留具体事实和时间线
6. 清空 work_memory 里已迁移的部分

【第三步：裁剪】
7. 把已编码的 context 头部删掉，更新 hc-offset
8. hibernate

【编码要求】
- 不要 copy-paste。消化、合并、重组。
- 保留具体内容：文件名、决策、时间线。不要抽象成"教训"。
- 同一个主题的多次对话合并为一条。

做完一段就 hibernate，别贪多。`;

      const promptFile = path.join(personDir, "nap-prompt.md");
      writeFile(promptFile, napPrompt);

      const launchScript = path.join(personDir, "nap-launch.sh");
      writeFile(launchScript, `#!/bin/bash
set -e
export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }--experimental-transform-types"
PERSON_DIR=${JSON.stringify(personDir)}
SESSION_DIR=${JSON.stringify(sessionDir)}
PROMPT_FILE=${JSON.stringify(promptFile)}

# 读 hc-offset，只编码海马体已经处理过的部分
mkdir -p "$SESSION_DIR"

# Write conv.json for pi to read the nap prompt
NODE_SCRIPT="
const fs = require('fs');
const h = require('os').homedir();
const conv = JSON.stringify([{role:'user',content:fs.readFileSync(\"$PROMPT_FILE\",'utf8')}]);
fs.writeFileSync(\"$SESSION_DIR/conv.json\", conv);
// 清空 hc-offset，nap 自己从头编码
fs.writeFileSync(\"$PERSON_DIR/hc-offset\", '0');
console.log('nap ready');
"
node -e "$NODE_SCRIPT"

# 启动 nap pi
cd "$PERSON_DIR/../.."
while true; do
  START=\$(date +%s)
  
  LOCKDIR="$PERSON_DIR/memory-lock"
  LOCK_WAIT=0
  while [ "$LOCK_WAIT" -lt 120 ]; do
    if mkdir "$LOCKDIR" 2>/dev/null; then
      echo "{\"owner\":\"nav\",\"ts\":\$(date +%s)000}" > "$LOCKDIR/stamp" 2>/dev/null
      break
    fi
    LOCK_WAIT=\$((LOCK_WAIT + 2))
    sleep 2
  done

  timeout 120 pi -s "$SESSION_DIR" -k coding-agent --name "nap-\$(date +%H%M)" --append-system-prompt "$(cat $PROMPT_FILE)" 2>/dev/null || echo "[nap] pi launch failed (non-fatal)" >&2

  rm -rf "$LOCKDIR" 2>/dev/null
  
  ELAPSED=\$(( \$(date +%s) - START ))
  [ "$ELAPSED" -lt 10 ] && sleep 5
  
  # Check if context is small enough
  CTX_SIZE=\$(wc -c < "$PERSON_DIR/context.md" 2>/dev/null || echo 0)
  [ "$CTX_SIZE" -lt 5000 ] && break
  
  # Or check if work_memory is big enough
  WM_SIZE=\$(wc -c < "$PERSON_DIR/work_memory.md" 2>/dev/null || echo 0)
  CTX_SIZE=\$(wc -c < "$PERSON_DIR/context.md" 2>/dev/null || echo 0)
  [ "$WM_SIZE" -gt 10240 ] && break
  [ "$CTX_SIZE" -lt 5120 ] && break
  
  sleep 2
done
# Trim context: only keep what hippocampus has encoded
CTX=\$(cat "$PERSON_DIR/context.md" 2>/dev/null || echo "")
OFFSET=0
try { OFFSET = parseInt(require('fs').readFileSync('$PERSON_DIR/hc-offset','utf8').trim()) || 0; } catch {}
if [ "$OFFSET" -gt 100 ] && [ \${#CTX} -gt 500 ]; then
  CUT=\$(( OFFSET < \${#CTX} - 500 ? OFFSET : \${#CTX} - 500 ))
  echo "\${CTX:\$CUT}" > "$PERSON_DIR/context.md"
  echo "0" > "$PERSON_DIR/hc-offset"
fi
echo "[nav] done"
`);

      try { execSync(`chmod +x ${launchScript}`); } catch {}

      // Kill old nap if exists
      try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {}

      // Launch in tmux
      execSync(`tmux new-session -d -s ${tmuxName} bash ${launchScript}`);

      napHandle = {
        stop: () => { try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {} },
        isRunning: () => { try { execSync(`tmux has-session -t ${tmuxName} 2>/dev/null`); return true; } catch { return false; } },
      };

      return {
        content: [{ type: "text", text: `nap session 已启动 (tmux ${tmuxName})。正在编码 context → work_memory，完成后自动裁剪。` }],
        details: {},
      };
    },
  });


  // ── sleep tool (独立睡眠实例) ──────────────────────────────────
  // ARCHITECTURE IRON LAW (DNA): sleep 必须是独立 paimon 实例, 不是主循环工具
  // 主意识调用 sleep → 启动 sl-<personId> tmux 实例 (sleep.dlc) → 主意识 hibernate
  // 睡眠实例对标海马体(hc)和元意识(sc), 是第三个对等的独立意识
  let sleepHandle: { stop: () => void; isRunning: () => boolean } | null = null;

  // ── 启动一次深度睡眠（统一入口）──────────────────────────────────────────────
  // 可复用：sleep 工具、记忆≥90%、API 返回 400 都调它。这就是"太困强制睡着"。
  // 安全：已经在睡就不重复启；只主进程睡。睡完发 sleep-done 唤醒主意识(心脏会重新点亮 continuous)。
  async function triggerSleeping(reason: string): Promise<boolean> {
    // sleep 暂时禁用
    return false;
  }

  // ── 拦截 API 400(context 超窗口)→ 太困强制睡着 ────────────────────────────────
  // 不让它变成 crash loop：一收到 400 且 context 确实很大(排除偶发别的 400)，就发起睡觉。
  pi.on("after_provider_response", async (event: any) => {
    if (event?.status !== 400 || !personDir || getSessionRole() !== "main") return;
    const ctxTok = estimateTokens(readFile(path.join(personDir, "context.md")));
    if (ctxTok < modelMax * 0.6) return; // 400 但 context 不大 → 不是溢出，别瞎睡
    triggerSleeping(`API 400 + context ~${ctxTok}tok → 溢出，太困强制睡着`).catch(() => {});
  });

  registerPaimonTool({
    name: "sleep",
    label: "Sleeping (Deep)",
    messageDescription:
      "Enter deep sleep. Launches an INDEPENDENT sleep session (separate pi instance with sleep.dlc) " +
      "that consolidates work_memory into cortex using 1% partial edit. " +
      "The sleep session runs in tmux (sl-<personId>), just like hippocampus (hc) and metaconsciousness (sc). " +
      "You (the main consciousness) should hibernate after calling this — the sleep session does the work.",
    promptSnippet: "Sleeping: launch independent sleep session (separate pi instance, one-shot consolidation)",
    renderCall(_args: any, theme: any) {
      return renderToolCall.label(theme, "Sleep");
    },
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      const content = resultContent(result);
      return renderMessage.summary(theme, ctx, content?.[0]?.text);
    },
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      return {
        content: [{ type: "text", text: "Sleep 不可用。请使用 nap 代替。" }],
        details: {},
        isError: true,
      };
    },
  });

  // [abandon] dream + drinkcoffee 已废弃
  /*
  // ── dream tool (浅睡: 做梦 — 元意识对 cortex 做创造性反思) ────
  // Dreaming: the model selects a cortex snippet for the metaconsciousness to reflect on.
  // The metaconsciousness reads it, does creative association, and sends aware messages back.
  // Results are written to cortex by the main session (via editcontext).
  pi.registerTool({
    name: "dream",
    label: "Dream (Shallow Sleeping)",
    messageDescription:
      "Trigger shallow sleep dreaming. Pick a snippet from cortex for the metaconsciousness to creatively reflect on. " +
      "The metaconsciousness will do free association, find hidden connections, generate scenarios. " +
      "Results arrive as aware messages — write good insights to cortex via editcontext.",
    promptSnippet: "Dream: send cortex snippet to metaconsciousness for creative reflection",
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
        fs.appendFile(feedPath, dreamEntry, "utf-8", () => {});
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
          text: `Dream sent to metaconsciousness.\n` +
                `Snippet length: ${params.cortex_snippet.length} chars.\n` +
                `Prompt: ${params.dream_prompt || "(free association)"}\n\n` +
                `The metaconsciousness will reflect and may send aware messages with insights. ` +
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
  */

}
