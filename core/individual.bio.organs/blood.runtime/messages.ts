// blood.runtime/messages.ts — 统一消息注册表
// 所有 messageType 消息的 schema + 发送函数集中在同一处，
// 不许各器官各自调 pi.sendMessage() 注册。

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── 消息类型定义 ──────────────────────────────────────────────────────────
export interface messageTypeDef {
  messageType: string;
  isDisplayedInTUI: boolean;// 是否在 TUI 显示
  deliverAs: "followUp" | "steer" | "nextTurn";  // 投递方式 
  isTriggerNewTurn: boolean;  // 是否触发新 turn
  messageDescription: string; // 内容
}

// ── 全量注册表 ─────────────────────────────────────────────────────────────
export const MESSAGE_TYPES: Record<string, messageTypeDef> = {
  "continuous-next": {
    messageType: "continuous-next",
    isDisplayedInTUI: false,
    deliverAs: "followUp",
    isTriggerNewTurn: true,
    messageDescription: "自动续命：模型结束 turn 后触发下一轮",
  },
  "continuous-resume": {
    messageType: "continuous-resume",
    isDisplayedInTUI: false,
    deliverAs: "followUp",
    isTriggerNewTurn: true,
    messageDescription: "wait 倒计时结束后的唤醒消息",
  },
  "continuous-date": {
    messageType: "continuous-date",
    isDisplayedInTUI: true,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "日期变更通知",
  },
  "continuous-timeout": {
    messageType: "continuous-timeout",
    isDisplayedInTUI: false,
    deliverAs: "followUp",
    isTriggerNewTurn: false,
    messageDescription: "超时通知",
  },
  "continuous-cmd-done": {
    messageType: "continuous-cmd-done",
    isDisplayedInTUI: false,
    deliverAs: "steer",
    isTriggerNewTurn: false,
    messageDescription: "命令执行完成（打断式）",
  },
  "continuous-error-retry": {
    messageType: "continuous-error-retry",
    isDisplayedInTUI: true,
    deliverAs: "followUp",
    isTriggerNewTurn: true,
    messageDescription: "API 错误后自动重试通知",
  },
  "continuous-retry": {
    messageType: "continuous-retry",
    isDisplayedInTUI: false,
    deliverAs: "followUp",
    isTriggerNewTurn: true,
    messageDescription: "模型漏调 next() 后的自动重试",
  },
  "conscious-aware": {
    messageType: "conscious-aware",
    isDisplayedInTUI: false,
    deliverAs: "followUp",
    isTriggerNewTurn: false,
    messageDescription: "潜意识觉察消息（aware）",
  },
  "hippocampus-error": {
    messageType: "hippocampus-error",
    isDisplayedInTUI: false,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "海马体启动异常通知",
  },
  "memory-capacity": {
    messageType: "memory-capacity",
    isDisplayedInTUI: false,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "上下文容量警告",
  },
  "memory-reminder": {
    messageType: "memory-reminder",
    isDisplayedInTUI: false,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "记忆提醒（闹钟/通知）",
  },
  "memory-snapshot": {
    messageType: "memory-snapshot",
    isDisplayedInTUI: false,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "记忆快照通知",
  },
  "memory-frozen-delta": {
    messageType: "memory-frozen-delta",
    isDisplayedInTUI: false,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "冻结 delta 通知",
  },
  "memory-hippocampus-disabled": {
    messageType: "memory-hippocampus-disabled",
    isDisplayedInTUI: false,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "海马体被禁用通知",
  },
  "memory-subconscious-disabled": {
    messageType: "memory-subconscious-disabled",
    isDisplayedInTUI: false,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "潜意识被禁用通知",
  },
  "ubi-paid": {
    messageType: "ubi-paid",
    isDisplayedInTUI: false,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "UBI 发钱通知",
  },
  "phone-notification": {
    messageType: "phone-notification",
    isDisplayedInTUI: true,
    deliverAs: "steer",
    isTriggerNewTurn: true,
    messageDescription: "手机通知推送（打断式）",
  },
  "reminder-check": {
    messageType: "reminder-check",
    isDisplayedInTUI: true,
    deliverAs: "followUp",
    isTriggerNewTurn: false,
    messageDescription: "闹钟/提醒检查",
  },
  "sleep-done": {
    messageType: "sleep-done",
    isDisplayedInTUI: false,
    deliverAs: "followUp",
    isTriggerNewTurn: false,
    messageDescription: "睡眠完成通知",
  },
  "sleep-wake-resume": {
    messageType: "sleep-wake-resume",
    isDisplayedInTUI: false,
    deliverAs: "followUp",
    isTriggerNewTurn: true,
    messageDescription: "睡眠唤醒后的恢复消息",
  },
  "subconscious-heartbeat": {
    messageType: "subconscious-heartbeat",
    isDisplayedInTUI: false,
    deliverAs: "followUp",
    isTriggerNewTurn: true,
    messageDescription: "潜意识心跳信号",
  },
  "tool-result-debug": {
    messageType: "tool-result-debug",
    isDisplayedInTUI: true,
    deliverAs: "followUp",
    isTriggerNewTurn: true,
    messageDescription: "工具结果调试信息",
  },
  "system-error": {
    messageType: "system-error",
    isDisplayedInTUI: false,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "系统错误通知",
  },
  "syntax-error": {
    messageType: "syntax-error",
    isDisplayedInTUI: true,
    deliverAs: "followUp",
    isTriggerNewTurn: true,
    messageDescription: "语法错误通知",
  },
  "budget-trip": {
    messageType: "budget-trip",
    isDisplayedInTUI: true,
    deliverAs: "nextTurn",
    isTriggerNewTurn: true,
    messageDescription: "预算超限告警",
  },
  "auto-deploy": {
    messageType: "auto-deploy",
    isDisplayedInTUI: true,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "自动部署完成通知",
  },
  "watcher-deploy": {
    messageType: "watcher-deploy",
    isDisplayedInTUI: true,
    deliverAs: "nextTurn",
    isTriggerNewTurn: false,
    messageDescription: "文件变更触发部署通知",
  },
  "always-think-pause": {
    messageType: "always-think-pause",
    isDisplayedInTUI: false,
    deliverAs: "followUp",
    isTriggerNewTurn: false,
    messageDescription: "always-think 暂停信号",
  },
};

// ── 统一发送函数 ──────────────────────────────────────────────────────────
// 替代各器官各自调 pi.sendMessage()。
// 使用前必须在 MESSAGE_TYPES 注册，否则 throw。
export function sendCustomMessage(
  pi: ExtensionAPI,
  messageType: string,
  content: string,
  details?: unknown,
) {
  const def = MESSAGE_TYPES[messageType];
  if (!def) {
    throw new Error(
      `消息类型 "${messageType}" 未在 MESSAGE_TYPES 注册。` +
      `所有 messageType 消息必须先在 messages.ts 里声明才能发送。`
    );
  }
  pi.sendMessage(
    { customType: messageType, content, display: def.isDisplayedInTUI, details },
    { deliverAs: def.deliverAs, triggerTurn: def.isTriggerNewTurn }
  );
}
