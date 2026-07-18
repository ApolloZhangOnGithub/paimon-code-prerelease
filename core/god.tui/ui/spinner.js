// god.tui/ui/spinner.js
// ── paimon-code spinner 状态管理 ──────────────────────────────────────────────
// 统一管理 statusContainer 里的 spinner 指示器。
// paimon 的状态（hibernated/waiting/paused 等）和 agent 的运行状态（working/retry）
// 都经过这里渲染成带颜色的 spinner 动画。
//
// 谁用它：
//   - interactive-mode.js: setExtensionStatus 拦截 paimon-status
//   - status.ts: setStatus() → ui.setStatus("paimon-status", label)
//
// 不要直接 import status-indicator.js 的类去 interactive-mode 里 new，走这里。

import { StatusIndicator } from "./status-indicator.js";
import { theme } from "../theme/theme.js";

// 状态 → 颜色映射
// key 必须和 state.ts 里 Heart.kind 的值一致：working / resting / hibernated / paused / error-backoff
const STATUS_COLORS = {
    "hibernated": "accent",
    "resting": "warning",       // wait 工具 → "resting"，显示黄色
    "paused": "warning",
    "working": "border",
    "error-backoff": "error",   // API 错误退避重试 → 红色
    // 以下为兼容旧 key（可能被其他地方引用）
    "waiting": "warning",
    "retrying": "error",
    "compacting memory": "muted",
    "nap": "muted",
    "sleeping": "muted",
};

/**
 * 判断 paimon-status 文本是否应该显示为 spinner。
 * "working" 不显示（让位给 WorkingStatusIndicator）。
 * 空/undefined 不显示。
 */
export function shouldShowAsSpinner(text) {
    return !!(text && text !== "working");
}

/**
 * 创建 paimon 状态的 spinner 指示器。
 * @param {object} ui - TUI 实例
 * @param {string} text - 状态文本（hibernated/waiting/paused 等）
 * @returns {StatusIndicator}
 */
export function createPaimonStatusIndicator(ui, text) {
    const color = STATUS_COLORS[text] || "muted";
    return new StatusIndicator(
        "paimon-status", ui,
        (s) => theme.fg(color, s),
        (t) => theme.fg(color, t),
        text
    );
}

/**
 * 获取状态对应的颜色名。
 * @param {string} text - 状态文本
 * @returns {string} 主题颜色名
 */
export function getStatusColor(text) {
    return STATUS_COLORS[text] || "muted";
}
