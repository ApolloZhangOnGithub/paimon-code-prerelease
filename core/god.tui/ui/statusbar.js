// god.tui/ui/statusbar.js
// ── StatusBar: 状态栏唯一真相源 ──────────────────────────────────────────────
// 所有状态文字、颜色、Working 计时器、token 统计、thinking 检测集中在此。
// 其他文件不允许硬编码状态标签/颜色——一律从这里取。

import { formatTokens } from "./footer.js";
import { theme } from "../theme/theme.js";

export const STATUS_DEFS = {
  "working":              { label: "Working...",        color: "warning" },
  "resting":              { label: "Waiting",           color: "accent" },
  "hibernated":           { label: "Hibernated",        color: "accent" },
  "paused":               { label: "Paused",            color: "accent" },
  "aborted":              { label: "Aborted",           color: "error" },
  "error-backoff":        { label: "Retrying",          color: "error" },
  "sleeping(compacting)": { label: "Compacting Memory", color: "accent" },
  "sleeping(nap)":        { label: "Nap",               color: "accent" },
  "sleeping(sleep)":      { label: "Sleeping",          color: "accent" },
};

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// 预格式化带颜色的状态文本（footer 直接渲染，不再二次上色）
function colored(color, label, detail) {
  if (!detail) return theme.fg(color, label);
  return theme.fg(color, label) + " " + `(${detail})`;
}

export class StatusBar {
  _status = null;
  _footer = null;
  _timer = null;
  _startTime = null;
  _turnTokensAtStart = 0;
  _isThinking = false;
  _thinkStartTime = null;
  _getOutputTokens = null;
  _getStreamingTokens = null;
  _requestRender = null;

  constructor(footer, requestRender) {
    this._footer = footer;
    this._requestRender = requestRender;
  }

  setTokenCallbacks(getOutput, getStreaming) {
    this._getOutputTokens = getOutput;
    this._getStreamingTokens = getStreaming;
  }

  transition(status) {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._status = status;
    const def = STATUS_DEFS[status] || { label: status, color: "dim" };

    if (status === "working") {
      this._startTime = Date.now();
      this._isThinking = false;
      this._thinkStartTime = null;
      this._footer?.setSpinner(colored(def.color, def.label), null);
      this._timer = setInterval(() => this._tick(), 1000);
    } else {
      this._startTime = null;
      this._footer?.setSpinner(colored(def.color, def.label), null);
    }
    this._requestRender?.();
  }

  resetTurnTokens(base) {
    this._turnTokensAtStart = base || 0;
  }

  setMessage(text) {
    if (!text) return;
    const def = STATUS_DEFS[this._status] || { color: "accent" };
    this._footer?.updateSpinnerText(colored(def.color, text));
  }

  setThinking(active) {
    if (active && !this._isThinking) {
      this._isThinking = true;
      this._thinkStartTime = Date.now();
    } else if (!active) {
      this._isThinking = false;
      this._thinkStartTime = null;
    }
  }

  stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _tick() {
    if (!this._startTime) return;
    const elapsed = fmtElapsed(Date.now() - this._startTime);
    const parts = [elapsed];

    const completed = (this._getOutputTokens?.() || 0) - this._turnTokensAtStart;
    const streaming = this._getStreamingTokens?.() || 0;
    const tk = completed + streaming;
    if (tk > 0) parts.push(`${formatTokens(tk)} tokens`);

    if (this._isThinking && this._thinkStartTime) {
      const thinkMs = Date.now() - this._thinkStartTime;
      if (thinkMs >= 1000) parts.push(`thinking for ${fmtElapsed(thinkMs)}`);
    }

    const detail = parts.join(" · ");
    this._footer?.updateSpinnerText(colored("warning", "Working...", detail));
  }

  getStatus() { return this._status; }

  dispose() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }
}
