// individual.abio.status/status.ts
// 统一的 agent 状态管理

export type AgentStatus =
  | "working"
  | "resting"
  | "hibernated"
  | "paused"
  | "aborted"
  | "error-backoff"
  | "sleeping(compacting)"
  | "sleeping(nap)"
  | "sleeping(sleep)";

let _current: AgentStatus = "working";
let _ui: any = null;

export function initStatusUI(ui: any) { _ui = ui; }

export function getStatus(): AgentStatus { return _current; }

// 传 status kind 给 UI 层，由 statusbar.js 统一管理标签和颜色
export function setStatus(status: AgentStatus) {
  _current = status;
  try {
    _ui?.setStatus?.("paimon-status", status);
  } catch {}
}
