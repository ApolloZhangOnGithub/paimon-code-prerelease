import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { watch, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createSubconscious, type SubconsciousHandle } from "./spawner.ts";
import { createReadConscious } from "./tools.ts";
import { GUTTER } from "#blockrender"; // 统一块渲染引擎:内容列常量
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
import { personDir as getPersonDir } from "#paths";

// 潜意识开关：每人持久化(JSON 布尔，不删文件、避开删除禁令)。off=不再启动潜意识；记忆不受影响。
function scFlag(personDir: string): string { return `${personDir}/.data/subconscious.json`; }
function scDisabled(personDir: string): boolean {
  try { return !!JSON.parse(readFileSync(scFlag(personDir), "utf8")).disabled; } catch { return false; }
}
function setScDisabled(personDir: string, disabled: boolean): void {
  try { writeFileSync(scFlag(personDir), JSON.stringify({ disabled, ts: new Date().toISOString() })); } catch {}
}

function isSubconsciousSession(sessionFile: string | undefined): boolean {
  return !!sessionFile?.includes("conscious-sessions");
}

export default function (pi: ExtensionAPI) {
  const _cmds: any[] = [];
  let lastError = "";
  let sub: SubconsciousHandle | null = null;
  let feedFile = "";
  let awareFile = "";
  let awareWatcher: ReturnType<typeof watch> | null = null;
  let awareOffset = 0;
  let isSubconscious = false;
  let curPersonDir: string | null = null;

  // ── /subconscious 开关：禁用/启用潜意识（每人持久，重启仍生效；不影响记忆）──
  _cmds.push({
    name: "brain-subconscious",
    desc: "潜意识开关：/brain-subconscious [on|off]。off=不再启动潜意识(记忆不受影响)，持久、重启仍生效。",
    handler: async (args: any, ctx: any) => {
      const pd = curPersonDir;
      if (!pd) { ctx.ui.notify("当前无 person 目录（主意识 session 才能切）。", "warning"); return; }
      const a = (args ?? "").trim().toLowerCase();
      if (a === "off") {
        setScDisabled(pd, true);
        try { sub?.stop(); } catch {}
        ctx.ui.notify("潜意识已禁用（持久，重启仍生效）。记忆不受影响。/subconscious on 恢复。", "info");
      } else if (a === "on") {
        setScDisabled(pd, false);
        try { sub?.start(); } catch {}
        ctx.ui.notify("潜意识已启用。", "info");
      } else {
        ctx.ui.notify(`潜意识当前：${scDisabled(pd) ? "禁用" : "启用"}。用 /subconscious [on|off] 切换。`, "info");
      }
    },
  });

  // ── aware renderer: header line + content below ───────────────────
  pi.registerMessageRenderer("conscious-aware", (message, _opts, theme) => {
    const { Markdown } = _require("@earendil-works/pi-tui");
    const raw = (message.content ?? "").toString();
    let title = "潜意识";
    let body = raw;
    const wrapped = raw.match(/^---\[subconscious(?:::([^\]]*))?\]---\r?\n?([\s\S]*?)\r?\n?---\[\/subconscious\]---\s*$/);
    if (wrapped) {
      title = (wrapped[1] || "潜意识").trim();
      body = wrapped[2].trim();
    } else {
      const m = raw.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
      if (m) { title = m[1]; body = m[2]; }
    }
    // 红● + 白粗 Subconscious + 红色细体内容
    const { Container, Spacer, Text } = _require("@earendil-works/pi-tui");
    const head = theme.fg("error", "●") + " " + theme.bold("Subconscious")
      + (title && title !== "潜意识" ? "  " + theme.fg("error", title) : "");
    const c = new Container();
    c.addChild(new Text(head, 0, 0));
    c.addChild(new Text(theme.fg("error", body), GUTTER, 0));
    return c;
  });

  // ── feed writer (main session only) ──────────────────────────────
  async function feed(type: string, data: any) {
    if (!feedFile || isSubconscious) return;
    try { await appendFile(feedFile, JSON.stringify({ type, ts: Date.now(), ...data }) + "\n"); } catch {}
  }

  // ── feed writer — conscious-feed.jsonl 统一格式见 feed-format.SPEC ──
  // role: user|assistant|system  type: 见 SPEC
  function feedEntry(entry: Record<string, any>) {
    if (!feedFile || isSubconscious) return;
    try { appendFileSync(feedFile, JSON.stringify({ ...entry, ts: Date.now() }) + "\n"); } catch {}
  }

  pi.on("message_end", async (event) => {
    const msg = event.message as any;
    if (!msg) return;
    const ct = msg.messageType;
    // 系统包裹消息 → type=start_msg
    if (ct === "continuous-date") { feedEntry({ role: "system", type: "start_msg", content: msg.content }); return; }
    if (ct === "memory-snapshot" || ct === "memory-capacity" || ct === "sleep-done") return;  // 不写 feed
    if (ct) return;  // 其他 messageType 跳过

    // message_end: content 是数组 [{type:"thinking",thinking:"..."}, {type:"text",text:"..."}, ...]
    const parts = Array.isArray(msg.content) ? msg.content : [];
    for (const p of parts) {
      if (p.type === "thinking" && p.thinking) {
        feedEntry({ role: "assistant", type: "think", think: p.thinking });
      } else if (p.type === "text" && p.text?.trim()) {
        feedEntry({ role: "assistant", type: "text", text: p.text.trim() });
      } else if (p.type === "toolCall") {
        feedEntry({ role: "assistant", type: "toolCall", tool: { name: p.name, args: p.arguments } });
      }
    }
  });

  pi.on("tool_execution_end", async (event) => {
    feedEntry({ role: "system", type: "toolResult", content: (event as any).result?.content?.[0]?.text || "" });
  });

  pi.on("input", async (event) => {
    feedEntry({ role: "user", type: "user_msg", content: (event as any).text });
  });

  // ── lifecycle ────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();

    // 海马体 / 睡眠小号也加载了本扩展，但它们既不是主意识也不是潜意识——什么都别做：
    // 不喂 feed、不 spawn 潜意识、不监听 aware。否则它们会把自己的活动写进共享的 conscious-feed.jsonl，
    // 污染真潜意识读的那份历史（feed 里混入海马体工具调用，正是之前的污染源之一）。
    if (sessionFile && (sessionFile.includes("hippocampus-sessions") || sessionFile.includes("sleep-sessions"))) {
      isSubconscious = false;
      feedFile = "";
      return;
    }

    isSubconscious = isSubconsciousSession(sessionFile);

    if (isSubconscious) {
      // ── I AM the subconscious. Register read_conscious + aware, don't spawn. ──
      const personDir = sessionFile!.match(/(.*\.pi\/memory\/[a-f0-9]+)\//)?.[1] ?? "";
      const feedPath = `${personDir}/.data/conscious-feed.jsonl`;
      awareFile = `${personDir}/.data/conscious-aware.jsonl`;

      // read_conscious: read the main session's history
      const rc = createReadConscious(pi, () => feedPath);
      pi.registerTool({
        name: rc.name,
        label: rc.label,
        messageDescription: rc.messageDescription,
        promptSnippet: "Read main session history (recent/search/range)",
        parameters: rc.parameters,
        renderCall(_args: any, theme: any) {
          const { Text } = _require("@earendil-works/pi-tui");
          return new Text(theme.fg("toolTitle", "● " + theme.bold("Read_conscious ")) + theme.fg("dim", "reading main session..."), 0, 0); // ● 顶格 + paddingX0(统一管线)
        },
        async execute(id: string, params: any) { return rc.execute(id, params); },
      });

      pi.registerTool({
        name: "aware",
        label: "Aware",
        messageDescription: "Send a structured event to the main consciousness. Each event has title, preview, strength, and can interrupt streaming.",
        promptSnippet: "Send a thought to the main session",
        parameters: Type.Object({
          title: Type.String({ messageDescription: "Short event title (≤50 chars)" }),
          preview: Type.String({ messageDescription: "Brief summary (≤100 chars)" }),
          thought: Type.String({ messageDescription: "Full observation or reminder" }),
          strength: Type.Optional(Type.Number({ messageDescription: "0.0–1.0: low (0.1), normal (0.5), high (0.8), critical (1.0). High+ interrupts streaming.", minimum: 0, maximum: 1 })),
        }),
        async execute(_id, params) {
          const event = {
            type: "subconscious",
            title: params.title,
            preview: params.preview,
            thought: params.thought,
            strength: params.strength ?? 0.5,
            ts: Date.now(),
          };
          await appendFile(awareFile, JSON.stringify(event) + "\n");
          return { content: [{ type: "text", text: `Event sent: [${event.title}] (strength=${event.strength})` }], details: {} };
        },
      });
      return;
    }

    // ── I am the MAIN session. Spawn subconscious + watch aware. ──
    sub?.stop();
    if (awareWatcher) { awareWatcher.close(); awareWatcher = null; }

    const personDir = getPersonDir(sessionFile);
    if (!personDir) { feedFile = ""; return; }
    curPersonDir = personDir;

    feedFile = `${personDir}/.data/conscious-feed.jsonl`;
    awareFile = `${personDir}/.data/conscious-aware.jsonl`;
    try { await mkdir(`${personDir}/.data`, { recursive: true }); } catch {}
    try { await appendFile(awareFile, "", { flag: "a" }); } catch {}

    // Track current offset so we only inject NEW thoughts
    try { awareOffset = (await readFile(awareFile, "utf8")).length; } catch { awareOffset = 0; }

    // Watch aware file → inject new thoughts into main session
    const eventStore = `${personDir}/.data/events.jsonl`;
    let awareProcessing = false;
    awareWatcher = watch(awareFile, async () => {
      if (awareProcessing) return;
      awareProcessing = true;
      try {
        const content = await readFile(awareFile, "utf8");
        if (content.length <= awareOffset) return;
        const newPart = content.slice(awareOffset);
        // 只消费"完整行"(以 \n 结尾)；末尾写了一半的行留到下次事件，
        // 否则半截 JSON 会 parse 失败被跳过、offset 又推过去 → 那条 aware 彻底丢失。
        const lastNL = newPart.lastIndexOf("\n");
        if (lastNL < 0) return;
        const complete = newPart.slice(0, lastNL + 1);
        awareOffset += complete.length;

        for (const line of complete.split("\n").filter(Boolean)) {
          try {
            const entry = JSON.parse(line);
            // Support both old format {thought, urgency} and new {type, title, preview, thought, strength}
            const title = entry.title || "潜意识";
            const thought = entry.thought || "";
            const preview = entry.preview || thought.slice(0, 80);
            const strength = entry.strength ?? (entry.urgency === "high" ? 0.8 : entry.urgency === "low" ? 0.2 : 0.5);
            const interrupt = strength >= 0.8; // high+ strength interrupts streaming

            // Also write to event store for event list
            const ev = JSON.stringify({
              type: "aware", title, preview, strength,
              ts: new Date().toISOString()
            }) + "\n";
            try { await appendFile(eventStore, ev, { flag: "a" }); } catch {}
            // 默认全送达：每条 aware 都 isTriggerNewTurn=true，确保进主意识上下文（哪怕它在歇/hibernate）。
            // 不再用强度阈值丢弃普通 aware——潜意识那么多好反思，丢了太可怕。发不发由潜意识自己判断
            // （它的提示词管"没事就闭嘴"），一旦发出就一定送到。strength 只决定要不要【打断当前流】：
            // 高(≥0.8)=主意识可能正在犯错，steer 立刻插进去；否则 followUp 在 turn 边界送达，不打断它当前的活。
            pi.sendMessage(
              {
                messageType: "conscious-aware",
                content: `[${title}] ${thought}`,
                isDisplayedInTUI: true,
              },
              { deliverAs: interrupt ? "steer" : "followUp", isTriggerNewTurn: true }
            );
          } catch {}
        }
      } catch {} finally { awareProcessing = false; }
    });

    sub = createSubconscious(
      pi,
      () => feedFile,
      (msg: string) => { lastError = msg; },
      () => {},
      personDir,
    );
    if (scDisabled(personDir)) {
      // 手动禁用(/subconscious off)：不启动潜意识，重启仍生效，并提示。
      // 记忆不受影响——主意识的记忆注入(memory.ts)与潜意识无关。
      pi.sendMessage(
        { messageType: "memory-subconscious-disabled", content: "潜意识已禁用（/subconscious on 恢复）", isDisplayedInTUI: false },
        { deliverAs: "nextTurn" }
      );
    } else {
      sub.start().catch((e: any) => { lastError = String(e?.message ?? e); });
    }
  });

  pi.on("session_shutdown", async () => {
    sub?.stop();
    if (awareWatcher) { awareWatcher.close(); awareWatcher = null; }
  });

  return _cmds;
}
