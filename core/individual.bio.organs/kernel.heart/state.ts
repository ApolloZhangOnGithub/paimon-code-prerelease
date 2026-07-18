import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSessionRole } from "#ribosome";
import { runtimeCacheDir } from "#paths";
import { setStatus } from "#status";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

declare global { var __piEscJustPressed: boolean | undefined; }

// ── debug ──
const DEBUG = true;
export function dlog(msg: string) {
  if (!DEBUG) return;
  try { const d = new Date(); const ts = `${d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`; appendFileSync("/tmp/continuous-debug.log", `[${ts}] [${process.title}] ${msg}\n`); } catch {}
}

// ── types ──
export type Timer = ReturnType<typeof setTimeout>;
export type Interval = ReturnType<typeof setInterval>;

export type Heart =
  | { kind: "working" }
  | { kind: "resting"; resumeTimer: Timer; countdownTimer: Interval }
  | { kind: "hibernated"; ts: number }
  | { kind: "paused"; reason: string }
  | { kind: "error-backoff"; retryTimer: Timer };

export interface Limits {
  maxCount: number;
  timeLimitMs: number;
  count: number;
  startTime: number;
  timeLimitTimer: Timer | null;
}

// ── 心脏运行时状态（各字段独立导出，不用猜 S 是什么）──
let _heart: Heart = { kind: "working" };
let _limits: Limits = { maxCount: -1, timeLimitMs: -1, count: 0, startTime: 0, timeLimitTimer: null };
let _errorBackoffMs = 0;
let _hasUserMessage = false;
let _ui: any = null;

export function heartState(): Heart["kind"] { return _heart.kind; }
export function heartRaw(): Heart { return _heart; }
export function limits(): Limits { return _limits; }
export function setUI(ui: any) { _ui = ui; }

export function hasUserMessage(): boolean { return _hasUserMessage; }
export function setHasUserMessage(v: boolean) { _hasUserMessage = v; }
export function errorBackoffMs(): number { return _errorBackoffMs; }
export function setErrorBackoffMs(v: number) { _errorBackoffMs = v; }

// ── state machine ──────────────────────────────────────────────────────────
//
//  working ─┬──→ resting ──┬──→ working  (timer fires)
//           │              └──→ paused   (ESC)
//           ├──→ hibernated ──→ working  (user message / sleep-done)
//           ├──→ paused ──────→ working  (user input / /pause toggle)
//           └──→ error-backoff → working (retry timer / user input)
//
//  入口：session_start → working
//  出口：session_shutdown → paused
//
// 设计原则：
//   1. transition() 是唯一修改 _heart 的地方
//   2. 退出旧状态：清 timer、清 UI、清磁盘标记
//   3. 工具自守卫：非 working 状态时 wait/hibernate 拒绝执行
//   4. 所有副作用集中在 transition() 内，event handler 只做条件判断 + 调 transition

function exitState(cur: Heart): void {
  if (cur.kind === "resting") {
    clearTimeout(cur.resumeTimer);
    clearInterval(cur.countdownTimer);
    try {
      const pid = personId();
      if (pid) require("fs").unlinkSync(join(runtimeCacheDir(pid), "main-resting"));
    } catch {}
  } else if (cur.kind === "error-backoff") {
    clearTimeout(cur.retryTimer);
  }
  if (cur.kind !== "working" && _limits.timeLimitTimer) {
    clearTimeout(_limits.timeLimitTimer);
    _limits.timeLimitTimer = null;
  }
}

function enterState(to: Heart): void {
  // 状态进入动作：只设 UI status。不做 abort——状态守卫在各工具 execute 入口。
  try { setStatus(to.kind as any); } catch {}
}

export function transition(to: Heart): void {
  const cur = _heart;
  dlog(`transition: ${cur.kind} → ${to.kind}`);
  exitState(cur);
  _heart = to;
  enterState(to);
}

// ── resetLimits ──
export function resetLimits(): void {
  if (_limits.timeLimitTimer) { clearTimeout(_limits.timeLimitTimer); _limits.timeLimitTimer = null; }
  _limits = { maxCount: -1, timeLimitMs: -1, count: 0, startTime: Date.now(), timeLimitTimer: null };
}

// ── helpers ──
export function personId(): string {
  const m = process.title.match(/paimon:[^(]+\([^,]+,\s*([^,)]+)/);
  return m?.[1] || "";
}

export function wakeRestartFile(): string | null {
  try {
    return (globalThis as any).__paimonRuntimeDir ? (globalThis as any).__paimonRuntimeDir + "/wake-restart" : null;
  } catch { return null; }
}

export function isWorkerSession(ctx: any): boolean {
  try {
    const sf = ctx?.sessionManager?.getSessionFile?.() || "";
    return /metaconsciousnessSessions|HippocampusSessions|SleepSessions/.test(sf);
  } catch { return false; }
}

export function isToolDisabled(toolName: string): boolean {
  try {
    const role = getSessionRole();
    // manifest role 检查
    const mf = JSON.parse(readFileSync(`${homedir()}/.paimon/agent/extensions/paimon-code/tools.manifest.json`, "utf8"));
    const roleDef = mf?.roles?.[role];
    if (roleDef && !roleDef.includes(toolName)) return true;
    // settings.json 禁用检查
    try {
      const sf = JSON.parse(readFileSync(`${homedir()}/.paimon/agent/config/settings.json`, "utf8"));
      if ((sf.tools?.disabled || []).includes(toolName)) return true;
    } catch {}
    // 元意识 hibernate 额外条件：主意识必须先 hibernate
    if (role === "metaconsciousness" && toolName === "hibernate") {
      const pid = (globalThis as any).__paimonPersonId || "";
      if (!pid || !existsSync(join(runtimeCacheDir(pid), "main-hibernate"))) return true;
    }
    return false;
  } catch { return false; }
}

export function isHibernateDisabled(): boolean { return isToolDisabled("hibernate"); }
export function isWaitDisabled(): boolean { return isToolDisabled("wait"); }
