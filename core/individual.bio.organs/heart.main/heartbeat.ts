import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSessionRole, getFuncPrompts } from "#runtime";
import { sendCustomMessage } from "#messages";
declare global { var __piEscJustPressed: boolean | undefined; }

const DEBUG = true;
function dlog(msg: string) {
  if (!DEBUG) return;
  try { const d=new Date(); const ts=`${d.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})}.${String(d.getMilliseconds()).padStart(3,'0')}`; appendFileSync("/tmp/continuous-debug.log", `[${ts}] [${process.title}] ${msg}\n`); } catch {}
}

const PROMPT = getFuncPrompts("heart.main").join("\n\n").replace("{role}", getSessionRole());

// ── 状态机 ─────────────────────────────────────────────────────────────────
// 心脏有 5 个互斥状态。transition() 清理旧状态的 timer，再切到新状态。
// 不再用 5 个 bool flag 编码（enabled/disabledByUser/isResting/hasUserMessage/lastHibernateTs）。

type Timer = ReturnType<typeof setTimeout>;
type Interval = ReturnType<typeof setInterval>;

type Heart =
  | { kind: "alive" }
  | { kind: "resting"; resumeTimer: Timer; countdownTimer: Interval }
  | { kind: "hibernating"; ts: number }
  | { kind: "stopped" }
  | { kind: "error-backoff"; retryTimer: Timer };

interface Limits {
  maxCount: number;
  timeLimitMs: number;
  count: number;
  startTime: number;
  timeLimitTimer: Timer | null;
}

export function registerHeartbeat(pi: ExtensionAPI) {
  const _cmds: any[] = [];
  let heart: Heart = { kind: "alive" };
  let limits: Limits = { maxCount: -1, timeLimitMs: -1, count: 0, startTime: 0, timeLimitTimer: null };
  let errorBackoffMs = 0;
  let hasUserMessage = false;
  let lastHint = "";
  let _ui: any = null;

  function transition(to: Heart): void {
    if (heart.kind === "resting") {
      clearTimeout(heart.resumeTimer);
      clearInterval(heart.countdownTimer);
      try { _ui?.setWorkingMessage(); _ui?.setWorkingVisible(false); } catch {}
    }
    else if (heart.kind === "error-backoff") {
      clearTimeout(heart.retryTimer);
      try { _ui?.setWorkingMessage(); _ui?.setWorkingVisible(false); } catch {}
    }
    if (to.kind !== "alive" && limits.timeLimitTimer) { clearTimeout(limits.timeLimitTimer); limits.timeLimitTimer = null; }
    dlog(`transition: ${heart.kind} → ${to.kind}`);
    heart = to;
  }

  function resetLimits(): void {
    if (limits.timeLimitTimer) { clearTimeout(limits.timeLimitTimer); limits.timeLimitTimer = null; }
    limits = { maxCount: -1, timeLimitMs: -1, count: 0, startTime: Date.now(), timeLimitTimer: null };
  }

  // ── helpers ──
  function wakeRestartFile(ctx: any): string | null {
    try {
      const sf = ctx?.sessionManager?.getSessionFile?.() || "";
      const m = sf.match(/\.pi\/memory\/([a-f0-9]+)\//);
      return m ? join(homedir(), ".pi/memory", m[1], ".data", ".wake-restart") : null;
    } catch { return null; }
  }
  function isWorkerSession(ctx: any): boolean {
    try {
      const sf = ctx?.sessionManager?.getSessionFile?.() || "";
      return /conscious-sessions|hippocampus-sessions|sleep-sessions/.test(sf);
    } catch { return false; }
  }
  function isHibernateDisabled(): boolean { return process.env.PI_DISABLE_HIBERNATE === "1"; }
  function isWaitDisabled(): boolean { return process.env.PI_DISABLE_WAIT === "1"; }

  // ── /switches wait|hibernate [on|off] ──
  _cmds.push({
    name: "switches",
    desc: "/switches <wait|hibernate> [on|off]",
    handler: async (args: any, ctx: any) => {
      const parts = (args ?? "").trim().toLowerCase().split(/\s+/);
      const sub = parts[0];
      const a = parts[1] ?? "";
      if (sub === "hibernate") {
        if (a === "off") { process.env.PI_DISABLE_HIBERNATE = "1"; ctx.ui.notify("hibernate 已禁用。", "info"); }
        else if (a === "on") { delete process.env.PI_DISABLE_HIBERNATE; ctx.ui.notify("hibernate 已恢复。", "info"); }
        else { ctx.ui.notify(`hibernate 当前：${isHibernateDisabled() ? "禁用" : "启用"}`, "info"); }
      } else if (sub === "wait") {
        if (a === "off") { process.env.PI_DISABLE_WAIT = "1"; ctx.ui.notify("wait 已禁用。", "info"); }
        else if (a === "on") { delete process.env.PI_DISABLE_WAIT; ctx.ui.notify("wait 已恢复。", "info"); }
        else { ctx.ui.notify(`wait 当前：${isWaitDisabled() ? "禁用" : "启用"}`, "info"); }
      } else {
        ctx.ui.notify(`/switches wait|hibernate [on|off]\n  wait: ${isWaitDisabled() ? "禁用" : "启用"}  hibernate: ${isHibernateDisabled() ? "禁用" : "启用"}`, "info");
      }
    },
  });

  // ── next tool ──────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "next",
    label: "Next",
    messageDescription:
      "Call this at the end of every turn. REQUIRED — turn will fail if omitted. " +
      "Three modes — pick exactly one, cannot be empty: " +
      "(1) next({hint:'plan'}) = continue immediately, show plan in title. " +
      "(2) next({wait:N}) = pause N seconds then auto-resume. " +
      "(3) next({hibernate:'summary'}) = rest until user returns.",
    promptSnippet: "Turn end. Must call next() with one param: {hint:'plan'}, {wait:N}s, or {hibernate:'summary'}. Cannot be empty.",
    parameters: Type.Object({
      hint: Type.Optional(Type.String({ messageDescription: "(mode 1) What you will do next turn — displayed in title bar" })),
      wait: Type.Optional(Type.Number({ messageDescription: "(mode 2) Seconds to pause before auto-resuming (1-86400)" })),
      wait_for_user: Type.Optional(Type.Boolean({ messageDescription: "(mode 2) With wait: spend pause listening for user input" })),
      next_steps: Type.Optional(Type.String({ messageDescription: "(mode 2) With wait: what to do when you wake up" })),
      hibernate: Type.Optional(Type.String({ messageDescription: "(mode 3) Summary of what you accomplished — hibernate until user returns" })),
    }),
    renderCall(args: any, theme: any) {
      const { Text } = require("@earendil-works/pi-tui");
      const hb = args?.hibernate?.trim();
      const wt = args?.wait;
      const ht = args?.hint?.trim() || lastHint || "继续";
      if (hb) return new Text(theme.fg("toolTitle", "● " + theme.bold("Hibernate")) + " " + theme.fg("dim", hb.slice(0, 50)), 0, 0);
      if (wt != null) return new Text(theme.fg("toolTitle", "● " + theme.bold("Wait")) + " " + theme.fg("accent", `${wt}s`), 0, 0);
      return new Text(theme.fg("success", theme.bold("● Next")) + " " + ht.slice(0, 60), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!params.hint?.trim() && params.wait == null && !params.hibernate?.trim()) {
        return { content: [{ type: "text", text: "ERR: next 不能为空。必须带参数: next({hint:'...'}), next({wait:N}), next({hibernate:'...'})" }], details: {}, isError: true };
      }

      // ── hint: 继续 ──
      if (!params.hibernate?.trim() && params.wait == null) {
        lastHint = params.hint?.trim() || "";
        try { (globalThis as any).__piAbort?.(); } catch {}
        return { content: [], details: { hint: lastHint || "continue" }, terminate: true };
      }

      // ── hibernate ──
      if (params.hibernate?.trim()) {
        if (isHibernateDisabled()) {
          return { content: [{ type: "text", text: "ERR: hibernate 已被禁用（/hibernate off）。用 next({wait:N}) 代替。" }], details: {}, isError: true };
        }
        transition({ kind: "hibernating", ts: Date.now() });
        hasUserMessage = false;
        dlog("next:{hibernate}");
        try { (globalThis as any).__piAbort?.(); } catch {}
        try { ctx.ui.setWorkingVisible(false); } catch {}
        return { content: [], details: { hibernate: params.hibernate }, terminate: true };
      }

      // ── wait ──
      if (params.wait != null) {
        if (isWaitDisabled()) {
          return { content: [{ type: "text", text: "ERR: wait 已被禁用（/wait off）。用 next({hibernate:'...'}) 休息。" }], details: {}, isError: true };
        }
        const secs = Math.max(1, params.wait);
        const waiting = params.wait_for_user === true;
        hasUserMessage = false;

        let remaining = secs;
        const label = () => (waiting ? `Waiting for user ${remaining}s...` : `Resting ${remaining}s...`);

        const countdownTimer: Interval = setInterval(() => {
          if (heart.kind !== "resting") { clearInterval(countdownTimer); return; }
          if (globalThis.__piEscJustPressed === true) {
            globalThis.__piEscJustPressed = false;
            dlog("countdown: ESC → stopped");
            transition({ kind: "stopped" });
            hasUserMessage = false;
            return;
          }
          remaining--;
          if (remaining <= 0) { clearInterval(countdownTimer); return; }
          try { ctx.ui.setWorkingMessage(label()); } catch {}
        }, 1000);

        const resumeTimer: Timer = setTimeout(() => {
          if (heart.kind !== "resting") return;
          if (globalThis.__piEscJustPressed === true) {
            globalThis.__piEscJustPressed = false;
            dlog("resumeTimer: ESC → stopped");
            transition({ kind: "stopped" });
            return;
          }
          dlog("resumeTimer: FIRED → alive");
          transition({ kind: "alive" });
          try {
            const wakeMsg = params.next_steps ? `Woke up after ${secs}s. Continue: ${params.next_steps}` : `Woke up after ${secs}s. Continue working.`;
            sendCustomMessage(pi, "continuous-resume", wakeMsg);
          } catch {}
        }, secs * 1000);

        transition({ kind: "resting", resumeTimer, countdownTimer });
        setTimeout(() => { if (heart.kind !== "resting") return; try { ctx.ui.setWorkingMessage(label()); ctx.ui.setWorkingVisible(true); } catch {} }, 300);
        dlog(`next:{wait:${secs}}`);
        try { (globalThis as any).__piAbort?.(); } catch {}
        return { content: [], details: { wait: secs, waiting }, terminate: true };
      }

      return { content: [{ type: "text", text: "未知操作" }], details: {} };
    },
  });

  // ── prompt injection ──────────────────────────────────────────────────────
  pi.on("before_agent_start", async (event) => {
    if (heart.kind === "stopped" || heart.kind === "hibernating") return;
    if (getSessionRole() !== "main") return;
    return { systemPrompt: event.systemPrompt + "\n\n" + PROMPT };
  });

  // ── user typing ──────────────────────────────────────────────────────────
  pi.on("input", async (event: any) => {
    if (!event?.text?.trim() || event.text === "(see attached image)") return;
    hasUserMessage = true;
    errorBackoffMs = 0;
    if (heart.kind === "error-backoff") transition({ kind: "alive" });
  });

  // ── 睡醒 / 用户唤醒 ─────────────────────────────────────────────────────
  pi.on("message_start", async (event: any, ctx: any) => {
    const msg = event?.message;

    // sleep-done → 重启或原地唤醒
    if (msg?.messageType === "sleep-done" && heart.kind !== "alive") {
      const canRestart = process.env.PI_ALIVE_RESTART_LOOP === "1"
        && !isWorkerSession(ctx) && !hasUserMessage && !ctx?.hasPendingMessages?.();
      const wf = canRestart ? wakeRestartFile(ctx) : null;
      if (wf) {
        dlog("sleep-done → RESTART");
        try { writeFileSync(wf, String(Date.now()), "utf-8"); } catch (e) { dlog("wake nonce write failed: " + e); }
        setTimeout(() => { try { ctx.shutdown(); } catch (e) { dlog("shutdown failed: " + e); } }, 50);
        return;
      }
      dlog("sleep-done → re-enable in place");
      transition({ kind: "alive" });
      resetLimits();
      return;
    }

    // 用户消息 → 唤醒 hibernate（stopped 不自动唤醒——用户主动关的，要 /continuous 才开）
    if (msg?.role === "user" && !msg?.messageType && heart.kind === "hibernating") {
      const textContent = Array.isArray(msg.content)
        ? msg.content.find((c: any) => c.type === "text")?.text?.trim() || ""
        : (typeof msg.content === "string" ? msg.content.trim() : "");
      if (!textContent) { dlog("WAKE: empty → skip"); return; }
      dlog(`WAKE: text="${textContent.slice(0,80)}"`);
      transition({ kind: "alive" });
      resetLimits();
      try { ctx.ui.setWorkingVisible(true); } catch {}
    }
  });

  // ── session_start ────────────────────────────────────────────────────────
  pi.on("session_start", async (_event: any, ctx: any) => {
    if (isWorkerSession(ctx)) return;
    _ui = ctx.ui;
    transition({ kind: "alive" });
    resetLimits();

    // PID 锁：防同一 person 开多个主进程
    const pidMatch = process.title.match(/pi-coding-master:main:([a-f0-9]+)/);
    if (pidMatch) {
      const personId = pidMatch[1];
      const pidFile = join(homedir(), ".pi/memory", personId, ".data/.main.pid");
      try {
        const oldPid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
        if (oldPid && oldPid !== process.pid) {
          try { process.kill(oldPid, 0); dlog(`旧主进程 ${oldPid} 还在，杀掉`); process.kill(oldPid); } catch {}
        }
      } catch {}
      try { writeFileSync(pidFile, String(process.pid), "utf8"); } catch {}
    }

    // 睡醒踢一脚
    if (process.env.PI_ALIVE_WOKE === "1") {
      dlog("session_start: PI_ALIVE_WOKE → kick");
      setTimeout(() => {
        try {
          pi.sendMessage(
            { messageType: "sleep-wake-resume", content: "睡醒了。记忆已巩固进 cortex，context 已压缩。", isDisplayedInTUI: false },
            { deliverAs: "followUp", isTriggerNewTurn: true }
          );
        } catch {}
      }, 800);
    } else {
      dlog("session_start: normal → 等用户");
    }
  });

  // ── agent_end ─────────────────────────────────────────────────────────────
  pi.on("agent_end", async (event, ctx) => {
    dlog(`agent_end: kind=${heart.kind}`);

    if (heart.kind === "stopped" || heart.kind === "hibernating") {
      try { ctx.ui.setWorkingVisible(false); } catch {}
      return;
    }
    // resting / error-backoff: 各自的 timer 管续命，这里不拦（让 next() 检查等逻辑正常走）

    // 过滤假图片幻觉
    if (hasUserMessage) {
      const lastCustom = [...(event.messages ?? [])].reverse().find((m: any) => m.role === "custom");
      if (lastCustom?.content === "(see attached image)") { hasUserMessage = false; dlog("agent_end: phantom image filtered"); }
    }
    if (hasUserMessage) {
      dlog("agent_end: hasUserMessage (continuing)");
      hasUserMessage = false;
    }

    const msgs = event.messages ?? [];
    const last = [...msgs].reverse().find((m: any) => m.role === "assistant");
    if (!last) {
      dlog(`agent_end: NO assistant msg, roles=[${msgs.map((m: any) => m.role).join(",")}]`);
      return;
    }

    const sr = (last as any).stopReason;
    dlog(`agent_end: stopReason=${sr}`);

    // Aborted（ESC → stopped；语音 steer → 只停本轮；next() abort → 放行到 auto-continue）
    if (sr === "aborted") {
      if (globalThis.__piEscJustPressed === true) {
        globalThis.__piEscJustPressed = false;
        transition({ kind: "stopped" });
        hasUserMessage = false;
        dlog("agent_end: ESC → stopped");
        return;
      }
      const nextCalled = (last as any).content?.some?.((c: any) => c.type === "toolCall" && c.name === "next");
      if (!nextCalled) {
        if (heart.kind === "resting") {
          dlog("agent_end: aborted (steer) during resting → alive");
          transition({ kind: "alive" });
        } else {
          dlog(`agent_end: aborted (steer), kind=${heart.kind}`);
        }
        return;
      }
      dlog("agent_end: aborted by next() tool → fall through to auto-continue");
    }

    // Error → exponential backoff retry
    if (sr === "error") {
      const errObj = (last as any).error || (event as any).error;
      const errMsg = (last as any).errorMessage || errObj?.message || errObj || "unknown";
      const errStack = errObj?.stack || "";
      dlog(`agent_end: ERROR: ${errMsg}`);
      try { appendFileSync("/tmp/pi-coding-master-crash.log", `[${new Date().toISOString()}] [${process.title}] agent_end error:\nmsg: ${errMsg}\nstack: ${errStack}\n\n`); } catch {}

      errorBackoffMs = errorBackoffMs ? Math.min(errorBackoffMs * 2, 300_000) : 20_000;
      const waitMs = errorBackoffMs;
      const retryTimer: Timer = setTimeout(() => {
        if (heart.kind !== "error-backoff") return;
        transition({ kind: "alive" });
        try {
          pi.sendMessage(
            { messageType: "continuous-error-retry", content: `WARN: API 错误: ${String(errMsg).slice(0, 200)}。${Math.round(waitMs / 1000)}s 后重试。`, isDisplayedInTUI: true },
            { deliverAs: "followUp", isTriggerNewTurn: true }
          );
        } catch {}
      }, waitMs);
      transition({ kind: "error-backoff", retryTimer });
      try { ctx.ui.setWorkingMessage(`WARN: API 错误: ${String(errMsg).slice(0, 80)} — ${Math.round(waitMs / 1000)}s 后重试`); } catch {}
      try { ctx.ui.setWorkingVisible(true); } catch {}
      return;
    }

    // 成功 → 重置错误退避
    errorBackoffMs = 0;

    // 检查 next() 调用
    const stopCall = (last as any).content?.find?.((c: any) => c.type === "toolCall" && c.name === "next");
    if (stopCall) {
      const args = (stopCall as any).arguments || {};
      if (args.hibernate?.trim()) { dlog("agent_end: next:{hibernate}"); return; }
      if (args.wait != null) { dlog("agent_end: next:{wait} → timer handles"); return; }
    }

    // 没调 next() → 注入提示重试
    const hasNext = (last as any).content?.some?.((c: any) => c.type === "toolCall" && c.name === "next");
    if (!hasNext) {
      dlog("agent_end: NO next() → retry prompt");
      setTimeout(() => {
        pi.sendMessage(
          { messageType: "continuous-retry", content: "You ended without calling next(). You must call next({hint:'...'}), next({wait:N}), or next({hibernate:'...'}) at the end of every turn.", isDisplayedInTUI: false },
          { deliverAs: "followUp", isTriggerNewTurn: true }
        );
      }, 0);
      return;
    }

    // 检查 continuous 限制
    if (limits.maxCount > 0 && limits.count >= limits.maxCount) { dlog("agent_end: maxCount reached"); return; }
    if (limits.timeLimitMs > 0 && Date.now() - limits.startTime >= limits.timeLimitMs) { dlog("agent_end: timeLimit reached"); return; }

    // next({hint}) → 立即续命下一轮
    if (heart.kind === "resting") transition({ kind: "alive" });
    limits.count++;
    dlog(`agent_end: auto-continue (count=${limits.count})`);
    setTimeout(() => {
      pi.sendMessage(
        { messageType: "continuous-next", content: "Continue.", display: false },
        { deliverAs: "followUp", isTriggerNewTurn: true }
      );
    }, 0);
  });

  // ── session_shutdown ──────────────────────────────────────────────────────
  pi.on("session_shutdown", async () => {
    transition({ kind: "stopped" });
    hasUserMessage = false;
  });

  // ── agent_start ───────────────────────────────────────────────────────────
  pi.on("agent_start", async (_event, ctx) => {
    hasUserMessage = false;
    if (heart.kind === "resting") {
      dlog("agent_start: resting → alive (turn started)");
      transition({ kind: "alive" });
    }
    if (heart.kind !== "alive") {
      dlog(`agent_start: ${heart.kind} → preserving`);
      return;
    }
    limits.count = 0;
    limits.startTime = Date.now();
    try { ctx.ui.setWorkingMessage(); ctx.ui.setWorkingVisible(true); } catch {}
  });

  // ── /continuous command ───────────────────────────────────────────────────
  _cmds.push({
    name: "continuous",
    desc: "Toggle continuous mode. /continuous [on|off|<n>|<n>m|<n>s]",
    handler: async (args: any, ctx: any) => {
      const a = (args ?? "").trim().toLowerCase();

      if (a === "off" || a === "0") {
        transition({ kind: "stopped" });
      } else if (a === "" || a === "toggle") {
        if (heart.kind === "alive") transition({ kind: "stopped" });
        else { transition({ kind: "alive" }); resetLimits(); }
      } else if (a === "on" || a === "inf") {
        transition({ kind: "alive" });
        resetLimits();
      } else if (/^\d+m$/.test(a)) {
        transition({ kind: "alive" }); resetLimits();
        limits.timeLimitMs = parseInt(a) * 60 * 1000;
      } else if (/^\d+s$/.test(a)) {
        transition({ kind: "alive" }); resetLimits();
        limits.timeLimitMs = parseInt(a) * 1000;
      } else if (/^\d+$/.test(a)) {
        transition({ kind: "alive" }); resetLimits();
        limits.maxCount = parseInt(a, 10);
      } else {
        ctx.ui.notify("/continuous [on|off|<n>|<n>m|<n>s]", "warning");
        return;
      }

      dlog(`/continuous "${a}" → kind=${heart.kind}`);

      if (heart.kind === "alive") {
        const desc = limits.timeLimitMs > 0
          ? (limits.timeLimitMs >= 60000 ? `${Math.round(limits.timeLimitMs / 60000)}分钟` : `${Math.round(limits.timeLimitMs / 1000)}秒`)
          : limits.maxCount > 0 ? `最多 ${limits.maxCount} 次` : "∞";
        ctx.ui.notify(`continuous ON — ${desc}`, "info");
        if (limits.timeLimitMs > 0) {
          limits.timeLimitTimer = setTimeout(() => {
            try {
              pi.sendMessage(
                { messageType: "continuous-timeout", content: "Time limit reached. Call wait(seconds=30, wait_for_user=true) to wrap up.", isDisplayedInTUI: false },
                { isTriggerNewTurn: true }
              );
            } catch {}
          }, limits.timeLimitMs);
        }
      } else {
        ctx.ui.notify("continuous OFF", "info");
      }
    },
  });

  return _cmds;
}
