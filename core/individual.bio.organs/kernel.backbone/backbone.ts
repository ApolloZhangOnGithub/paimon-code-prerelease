// blood.runtime/backbone — 统一注册表（消息 + 工具）
// 所有 messageType / tool 必须在此注册，禁止各器官直接调 pi.sendMessage / pi.registerTool。

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ══════════════════════════════════════════════════════════════════════════════
// 消息管线
// ══════════════════════════════════════════════════════════════════════════════
//
// 每条消息两个独立维度：
//   feed:   是否/怎么注入给模型
//   render: 是否渲染给用户
//
// 五个语义分类（category）：
//   resume       — 内部续命信号（触发新 turn）
//   notice       — 系统/器官的通知和警告
//   external     — 外部世界来的消息（微信、语音、提醒）
//   async-result — 工具的延迟返回（和同步 tool result 同语义）
//   context      — 上下文注入（模型需要，用户不需要看 raw data）

export type MessageCategory =
  | "resume"
  | "notice"
  | "external"
  | "async-result"
  | "context";

export interface MessageTypeDef {
  messageType: string;
  category: MessageCategory;
  source: string;
  label: string;
  feed: boolean;
  feedAs: "followUp" | "steer" | "nextTurn";
  triggerNewTurn: boolean;
  render: boolean;
  description: string;
}

export const MESSAGE_TYPES: Record<string, MessageTypeDef> = {

  // ── resume: 内部续命信号 ──────────────────────────────────────────────────
  "continuous-next": {
    messageType: "continuous-next",
    category: "resume",
    source: "heart",
    label: "Auto-Resume",
    feed: true, feedAs: "followUp", triggerNewTurn: true,
    render: false,
    description: "turn 结束后自动续命",
  },
  "continuous-resume": {
    messageType: "continuous-resume",
    category: "resume",
    source: "heart",
    label: "Resumed From Wait",
    feed: true, feedAs: "followUp", triggerNewTurn: true,
    render: true,
    description: "wait 倒计时结束 / 进程重启回顾",
  },
  "continuous-retry": {
    messageType: "continuous-retry",
    category: "resume",
    source: "heart",
    label: "Retrying",
    feed: true, feedAs: "followUp", triggerNewTurn: true,
    render: false,
    description: "意图栈为空时的续命提示",
  },
  "continuous-timeout": {
    messageType: "continuous-timeout",
    category: "resume",
    source: "heart",
    label: "Alert Of Timeout",
    feed: true, feedAs: "followUp", triggerNewTurn: true,
    render: false,
    description: "超时通知",
  },
  "sleep-wake-resume": {
    messageType: "sleep-wake-resume",
    category: "resume",
    source: "hippocampus",
    label: "Resumed From Sleep",
    feed: true, feedAs: "followUp", triggerNewTurn: true,
    render: false,
    description: "睡眠唤醒后的恢复",
  },

  // ── notice: 系统/器官通知 ─────────────────────────────────────────────────
  "conscious-aware": {
    messageType: "conscious-aware",
    category: "notice",
    source: "metaconsciousness",
    label: "Notice From Metaconsciousness",
    feed: true, feedAs: "nextTurn", triggerNewTurn: false,
    render: true,
    description: "元意识觉察",
  },
  "memory-capacity": {
    messageType: "memory-capacity",
    category: "notice",
    source: "hippocampus",
    label: "Alert From System: memory",
    feed: true, feedAs: "nextTurn", triggerNewTurn: false,
    render: true,
    description: "上下文容量警告",
  },
  "budget-trip": {
    messageType: "budget-trip",
    category: "notice",
    source: "budget",
    label: "Alert From System: budget",
    feed: true, feedAs: "nextTurn", triggerNewTurn: true,
    render: true,
    description: "预算超限告警",
  },
  "memory-hippocampus-disabled": {
    messageType: "memory-hippocampus-disabled",
    category: "notice",
    source: "hippocampus",
    label: "Alert From System: hippocampus disabled",
    feed: true, feedAs: "nextTurn", triggerNewTurn: false,
    render: true,
    description: "海马体被禁用",
  },
  "memory-metaconsciousness-disabled": {
    messageType: "memory-metaconsciousness-disabled",
    category: "notice",
    source: "metaconsciousness",
    label: "Alert From System: metaconsciousness disabled",
    feed: true, feedAs: "nextTurn", triggerNewTurn: false,
    render: true,
    description: "元意识被禁用",
  },
  "continuous-error-retry": {
    messageType: "continuous-error-retry",
    category: "notice",
    source: "heart",
    label: "Alert From System: API error",
    feed: true, feedAs: "followUp", triggerNewTurn: true,
    render: true,
    description: "API 错误后自动重试",
  },
  "system-error": {
    messageType: "system-error",
    category: "notice",
    source: "system",
    label: "Alert From System: error",
    feed: true, feedAs: "nextTurn", triggerNewTurn: false,
    render: true,
    description: "系统错误",
  },
  "syntax-error": {
    messageType: "syntax-error",
    category: "notice",
    source: "fileactions",
    label: "Alert From System: syntax error",
    feed: true, feedAs: "followUp", triggerNewTurn: true,
    render: true,
    description: "语法错误",
  },
  "hippocampus-error": {
    messageType: "hippocampus-error",
    category: "notice",
    source: "hippocampus",
    label: "Alert From System: hippocampus error",
    feed: true, feedAs: "nextTurn", triggerNewTurn: false,
    render: true,
    description: "海马体异常",
  },
  "memory-reminder": {
    messageType: "memory-reminder",
    category: "notice",
    source: "hippocampus",
    label: "Reminder",
    feed: true, feedAs: "nextTurn", triggerNewTurn: false,
    render: true,
    description: "提醒到期",
  },

  // ── external: 外部世界来的消息 ────────────────────────────────────────────
  "mobile-notification": {
    messageType: "mobile-notification",
    category: "external",
    source: "mobile",
    label: "Message From Mobile",
    feed: true, feedAs: "steer", triggerNewTurn: true,
    render: true,
    description: "手机通知/微信消息",
  },
  "ear": {
    messageType: "ear",
    category: "external",
    source: "ears",
    label: "Hear",
    feed: true, feedAs: "steer", triggerNewTurn: true,
    render: true,
    description: "语音转录",
  },
  "reminder-check": {
    messageType: "reminder-check",
    category: "external",
    source: "bioclock",
    label: "Reminder",
    feed: true, feedAs: "followUp", triggerNewTurn: false,
    render: true,
    description: "闹钟/提醒检查",
  },

  // ── async-result: 工具的延迟返回 ─────────────────────────────────────────
  "continuous-cmd-done": {
    messageType: "continuous-cmd-done",
    category: "async-result",
    source: "execute",
    label: "Result From Execute",
    feed: true, feedAs: "steer", triggerNewTurn: true,
    render: true,
    description: "后台命令执行完成",
  },

  // ── context: 上下文注入 ──────────────────────────────────────────────────
  "memory-snapshot": {
    messageType: "memory-snapshot",
    category: "context",
    source: "hippocampus",
    label: "Context: memory snapshot",
    feed: true, feedAs: "followUp", triggerNewTurn: false,
    render: false,
    description: "记忆快照注入",
  },
  "memory-frozen-delta": {
    messageType: "memory-frozen-delta",
    category: "context",
    source: "hippocampus",
    label: "Context: memory delta",
    feed: true, feedAs: "followUp", triggerNewTurn: false,
    render: false,
    description: "冻结 delta 注入",
  },
  "sleep-done": {
    messageType: "sleep-done",
    category: "context",
    source: "hippocampus",
    label: "Context: sleep done",
    feed: true, feedAs: "followUp", triggerNewTurn: false,
    render: false,
    description: "睡眠完成信号",
  },
  "continuous-date": {
    messageType: "continuous-date",
    category: "context",
    source: "bioclock",
    label: "Context: date",
    feed: true, feedAs: "nextTurn", triggerNewTurn: false,
    render: true,
    description: "日期变更",
  },
  "metaconsciousness-heartbeat": {
    messageType: "metaconsciousness-heartbeat",
    category: "context",
    source: "metaconsciousness",
    label: "Context: heartbeat",
    feed: true, feedAs: "followUp", triggerNewTurn: true,
    render: false,
    description: "元意识心跳",
  },
  "tool-result-debug": {
    messageType: "tool-result-debug",
    category: "context",
    source: "debug",
    label: "Context: debug",
    feed: true, feedAs: "followUp", triggerNewTurn: true,
    render: false,
    description: "工具结果调试",
  },
  "always-think-pause": {
    messageType: "always-think-pause",
    category: "context",
    source: "heart",
    label: "Context: think pause",
    feed: true, feedAs: "followUp", triggerNewTurn: false,
    render: false,
    description: "always-think 暂停信号",
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// 工具管线
// ══════════════════════════════════════════════════════════════════════════════
//
// 所有工具通过 registerPaimonTool() 注册。两个独立维度：
//   renderResult — TUI 怎么渲染结果（必填）
//   feedResult   — execute 返回的 content 是否回传给模型（默认 true）
//
// feedResult: false 时，管线拦截：
//   - 原始 content 存入 details._content 供 renderResult 读取
//   - 发给模型的 content 清空为 []
//   - isError 时不拦截，错误信息始终回传

const TOOL_QUEUE: any[] = [];

let _pi: ExtensionAPI | null = null;

export function registerPaimonTool(toolDef: any): void {
  if (!toolDef?.name) throw new Error(`registerPaimonTool: name required`);
  if (!toolDef.renderCall || !toolDef.renderResult) {
    const missing = [!toolDef.renderCall && "renderCall", !toolDef.renderResult && "renderResult"].filter(Boolean).join(", ");
    const msg = `registerPaimonTool(${toolDef.name}): 缺少 ${missing} — 跳过注册`;
    try { require("fs").appendFileSync("/tmp/paimon-tool-error.log", `[${new Date().toISOString()}] ERROR: ${msg}\n`); } catch {}
    console.error(`[ERROR] ${msg}`);
    return;
  }
  toolDef.renderShell = "self";
  if (_pi) {
    _pi.registerTool(toolDef);
  } else {
    TOOL_QUEUE.push(toolDef);
  }
}

export function resultContent(result: any): any[] {
  return result?.details?._content || result?.content || [];
}

export function flushTools(pi: ExtensionAPI): void {
  _pi = pi;
  for (const def of TOOL_QUEUE) {
    pi.registerTool(def);
  }
  TOOL_QUEUE.length = 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// 统一发送函数
// ══════════════════════════════════════════════════════════════════════════════

export function sendCustomMessage(
  pi: ExtensionAPI,
  messageType: string,
  content: string,
  details?: unknown,
  overrides?: { deliverAs?: string; isTriggerNewTurn?: boolean; isDisplayedInTUI?: boolean },
) {
  const def = MESSAGE_TYPES[messageType];
  if (!def) {
    throw new Error(
      `消息类型 "${messageType}" 未在 MESSAGE_TYPES 注册。` +
      `所有消息必须走 sendCustomMessage()。`
    );
  }
  pi.sendMessage(
    {
      customType: messageType,
      content,
      display: overrides?.isDisplayedInTUI ?? def.render,
      details,
    },
    {
      deliverAs: (overrides?.deliverAs ?? def.feedAs) as any,
      triggerTurn: overrides?.isTriggerNewTurn ?? def.triggerNewTurn,
    }
  );
}
