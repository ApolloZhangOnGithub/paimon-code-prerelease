import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getPrompt } from "#runtime";

// 模型在输出任意位置写下这个标记 → 写作暂停 → 思考 → 从断点续写。
const MARKER = "<need think>";
// 防病态死循环:一轮里最多暂停这么多次(允许多次,但不是无限)。
const MAX_PAUSES_PER_TURN = 50;

// prompt 来自 coded.dna（coded drafting.think）。正文里的 {MARKER} 占位由本 func 填入真实标记。
const PROMPT = getPrompt("drafting.think").replace("{MARKER}", MARKER);

function assistantText(message: any): string {
  const content = message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let s = "";
  for (const c of content) {
    if (typeof c === "string") s += c;
    else if (c?.type === "text" && typeof c.text === "string") s += c.text;
  }
  return s;
}

export function registerAlwaysThink(pi: ExtensionAPI) {
  let enabled = true;
  let triggeredForCurrentMessage = false;
  let pausesThisTurn = 0;

  // ── 教模型 <need think> 的用法 ──────────────────────────────────
  pi.on("before_agent_start", async (event, _ctx) => {
    if (!enabled) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + PROMPT };
  });

  // ── 每轮开始:重置暂停计数 ──────────────────────────────────────
  pi.on("agent_start", async () => {
    pausesThisTurn = 0;
  });

  // ── 每条新 assistant 消息:重置"已触发"标志 ────────────────────
  pi.on("message_start", async () => {
    triggeredForCurrentMessage = false;
  });

  // ── 流式中检测标记 → 暂停 ───────────────────────────────────────
  pi.on("message_update", async (event, _ctx) => {
    if (!enabled) return;
    if (triggeredForCurrentMessage) return;          // 一个标记只触发一次
    if (pausesThisTurn >= MAX_PAUSES_PER_TURN) return; // 到顶不再触发

    const text = assistantText(event.message);
    if (!text.includes(MARKER)) return;

    // 暂停:投一条 steer 消息。经 continuous 的 steer→abort 补丁,当前生成被 abort
    // = 写作冻在断点;半截输出(以 <need think> 结尾)由 pi 原生 partial 机制保留。
    // 随后这条 steer 被处理 → 模型转入思考,再从断点续写。
    triggeredForCurrentMessage = true;
    pausesThisTurn++;

    pi.sendMessage(
      {
        messageType: "always-think-pause",
        content:
          "[你写下了 <need think> —— 写作已暂停。现在把它想透:你正要写的东西、你的直觉、" +
          "以及它和 spec/约束是否一致;想清楚后从断点继续写。想透了再写,别急着续。]",
        display: false,
      },
      { deliverAs: "steer", isTriggerNewTurn: true }
    );
  });

}
