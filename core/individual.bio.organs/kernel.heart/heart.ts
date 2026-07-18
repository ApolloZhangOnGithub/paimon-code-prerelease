import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSessionRole, getPrompt } from "#ribosome";
import { runtimeCacheDir, memoryDir, memoryDataDir, logerr } from "#paths";
import { sendCustomMessage } from "#kernel_backbone";
import { GUTTER, dot, renderMessage } from "#tui_blockrender";
import { heartState, limits, setUI, hasUserMessage, setHasUserMessage, errorBackoffMs, setErrorBackoffMs, transition, resetLimits, dlog, personId, wakeRestartFile, isWorkerSession } from "./state.ts";
import { registerPauseHandler } from "./next.ts";
import { registerWaitTool } from "./wait.ts";
import { registerHibernateTool } from "./hibernate.ts";
import { getIntentions } from "../brain.intentions/intentions.ts";

const HEARTBEAT_PROMPT = [
  getPrompt("heart.continuous"),
  getPrompt("heart.commands"),
  getPrompt("assets.mobile"),
  getPrompt("assets.wallet"),
  getPrompt("core.typeRef"),
].join("\n\n");

export default function (pi: ExtensionAPI) {
  // ── tools ──
  registerPauseHandler(pi);
  registerWaitTool(pi);
  registerHibernateTool(pi);

  // ── message renderers ──
  pi.registerMessageRenderer("continuous-resume", (message: any, _opts: any, theme: any) => {
    const raw = (message.content ?? "").toString();
    const clean = raw.replace(/^\[系统\]\s*/, "");
    // 用 details.resumeType 区分（不靠字符串匹配）
    const resumeType = (message.details as any)?.resumeType;
    switch (resumeType) {
      case "wait": {
        // [wait 35s 结束] → Waited 35s
        const match = clean.match(/\[wait\s+(\d+)s/);
        const label = match ? `Waited ${match[1]}s` : "Resumed From Waiting";
        return renderMessage.notice(theme, label, "");
      }
      case "restart":
        return renderMessage.notice(theme, "Process Restarted", clean);
      default:
        return renderMessage.notice(theme, "Resumed From History Sessions", clean);
    }
  });
  pi.registerMessageRenderer("sleep-wake-resume", (message: any, _opts: any, theme: any) => {
    const raw = (message.content ?? "").toString();
    return renderMessage.notice(theme, "Resumed From Sleep", raw);
  });
  pi.registerMessageRenderer("continuous-date", (message: any, _opts: any, theme: any) => {
    return renderMessage.notice(theme, "Date", (message.content ?? "").toString().replace(/^Current date: /, ""));
  });
  pi.registerMessageRenderer("continuous-error-retry", (message: any, _opts: any, theme: any) => {
    return renderMessage.notice(theme, "Error", (message.content ?? "").toString());
  });
  pi.registerMessageRenderer("continuous-cmd-done", (message: any, _opts: any, theme: any) => {
    const { Text, Container } = require("@earendil-works/pi-tui");
    const raw = (message.content ?? "").toString();
    // 格式1 (desktop): "完成 (Ns, exit CODE):\n$ CMD\nOUTPUT"
    // 格式2 (desktop error): "Command failed/killed (Ns):\n$ CMD\nERROR"
    // 格式3 (mobile): " mobile 完成 (Ns):\nOUTPUT"
    const dsMatch = raw.match(/^(.*?)\s*\((\d+)s,\s*exit\s+(\d+)\):\n\$\s+(.*?)\n([\s\S]*)$/);
    const dsFail = raw.match(/^Command (failed|killed by user)\s*\((\d+)s\):\n\$\s+(.*?)\n([\s\S]*)$/);
    const mbMatch = raw.match(/^\s*mobile\s*完成\s*\((\d+)s\):\n([\s\S]*)$/);
    let cmd = ""; let elapsed = 0; let output = ""; let exitCode: number | undefined;
    let isError = false;
    if (dsMatch) {
      elapsed = parseInt(dsMatch[2]);
      exitCode = parseInt(dsMatch[3]);
      cmd = dsMatch[4].split("\n")[0].trim();
      output = (dsMatch[5] || "").trim();
      isError = exitCode !== 0;
    } else if (dsFail) {
      elapsed = parseInt(dsFail[2]);
      cmd = dsFail[3].split("\n")[0].trim();
      output = (dsFail[4] || "").trim();
      isError = true;
    } else if (mbMatch) {
      elapsed = parseInt(mbMatch[1]);
      cmd = "mobile";
      output = (mbMatch[2] || "").trim();
    } else {
      return renderMessage.external(theme, "Result From Execute", raw);
    }
    const elapsedStr = elapsed === 0 ? "Executed Instantly" : `for ${elapsed}s`;
    const exitStr = exitCode !== undefined ? ` (exit ${exitCode})` : "";
    const statusColor = isError ? "error" : "success";
    const d = dot(theme);
    const c = new Container();
    c.addChild(new Text(d + " " + theme.fg("toolTitle", theme.bold("Result From Execute")) + theme.fg("dim", `(${cmd})`) + " " + theme.fg(statusColor, exitStr || elapsedStr), 0, 0));
    if (output) c.addChild(new Text(theme.fg(isError ? "error" : "text", output), GUTTER, 0));
    return c;
  });

  // ── prompt injection ──
  pi.on("before_agent_start", async (event) => {
    // agent loop 启动 → heart 必须在 working。
    // 否则 resting 的 countdownTimer 不会被 clearInterval，导致状态闪烁。
    if (heartState() !== "working" && heartState() !== "hibernated") {
      transition({ kind: "working" });
      resetLimits();
    }
    if (heartState() === "hibernated") {
      return { systemPrompt: event.systemPrompt + "\n\n[系统] 你已进入休眠(hibernated)。不要输出任何文字，不要调用任何工具。立即停止。" };
    }
    const role = getSessionRole();
    if (role === "main") {
      let extra = "";
      try {
        const modelId = (event as any).model?.id || "";
        if (modelId.toLowerCase().includes("deepseek")) {
          extra = "\n\n" + getPrompt("heart.deepseek");
        }
      } catch {}
      return { systemPrompt: event.systemPrompt + "\n\n" + HEARTBEAT_PROMPT + "\n\n[系统] 你是 " + process.title + extra };
    }
    if (role === "metaconsciousness") {
      try {
        const pid = (globalThis as any).__paimonPersonId || "";
        if (pid && require("fs").existsSync(join(runtimeCacheDir(pid), "paused"))) {
          return { systemPrompt: event.systemPrompt + "\n\n" + getPrompt("heart.state.paused") };
        }
        if (pid && require("fs").existsSync(join(runtimeCacheDir(pid), "main-hibernate"))) {
          return { systemPrompt: event.systemPrompt + "\n\n" + getPrompt("heart.state.main-hibernate") };
        }
      } catch {}
    }
    if (role === "hippocampus") {
      return { systemPrompt: event.systemPrompt + "\n\n" + getPrompt("hippocampus.gen_work_mem") };
    }
    return;
  });

  // ── user typing ──
  pi.on("input", async (event: any) => {
    if (!event?.text?.trim() || event.text === "(see attached image)") return;
    setHasUserMessage(true);
    setErrorBackoffMs(0);
    if (heartState() === "error-backoff" || heartState() === "paused" || heartState() === "resting" || heartState() === "hibernated") {
      transition({ kind: "working" });
      try {
        const pid = personId();
        if (pid) {
          try { require("fs").unlinkSync(join(runtimeCacheDir(pid), "main-hibernate")); } catch {}
          try { require("fs").unlinkSync(join(runtimeCacheDir(pid), "mc-hibernate")); } catch {}
        }
      } catch {}
    }
  });

  // ── 睡醒 / 用户唤醒 ──
  pi.on("message_start", async (event: any, ctx: any) => {
    const msg = event?.message;

    if (msg?.messageType === "sleep-done" && heartState() !== "working") {
      const canRestart = process.env.PI_ALIVE_RESTART_LOOP === "1"
        && !isWorkerSession(ctx) && !hasUserMessage();
      const wf = canRestart ? wakeRestartFile() : null;
      if (wf) {
        dlog("sleep-done → RESTART");
        try { writeFileSync(wf, String(Date.now()), "utf-8"); } catch (e) { dlog("wake nonce write failed: " + e); }
        setTimeout(() => { try { ctx.shutdown(); } catch (e) { dlog("shutdown failed: " + e); } }, 50);
        return;
      }
      dlog("sleep-done → re-enable in place");
      transition({ kind: "working" });
      resetLimits();
      return;
    }

    if (msg?.role === "user" && !msg?.messageType && heartState() === "hibernated") {
      const textContent = Array.isArray(msg.content)
        ? msg.content.find((c: any) => c.type === "text")?.text?.trim() || ""
        : (typeof msg.content === "string" ? msg.content.trim() : "");
      if (!textContent) { dlog("WAKE: empty → skip"); return; }
      dlog(`WAKE: text="${textContent.slice(0, 80)}"`);
      transition({ kind: "working" });
      resetLimits();
    }
  });

  // ── session_start ──
  pi.on("session_start", async (_event: any, ctx: any) => {
    if (isWorkerSession(ctx)) return;
    setUI(ctx.ui);
    transition({ kind: "working" });
    resetLimits();
    if (getSessionRole() === "main") {
      setTimeout(() => {
        try {
          const tty = require("child_process").execSync("ps -o tty= -p " + process.pid, { encoding: "utf8" }).trim();
          if (tty === "??") { dlog("orphan: no TTY, shutting down"); ctx.shutdown(); }
        } catch {}
      }, 60000);
    }

    let personId = "";
    try {
      const sf = ctx.sessionManager.getSessionFile();
      const m = sf?.match(/\/.paimon\/SessionData\/([a-f0-9]+)\//) || sf?.match(/\.paimon\/sessions\/([a-f0-9]+)\//);
      if (m) personId = m[1];
    } catch {}
    if (personId && !isWorkerSession(ctx)) {
      const pidFile = join(memoryDir(personId), "main.pid");
      try {
        const oldPid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
        if (oldPid && oldPid !== process.pid) {
          try { process.kill(oldPid, 0); dlog(`旧主进程 ${oldPid} 还在，杀掉`); process.kill(oldPid); } catch {}
        }
      } catch {}
      try { writeFileSync(pidFile, String(process.pid), "utf8"); } catch {}
      const _heartbeatInterval = setInterval(() => {
        try { const now = new Date(); const fd = require("fs").openSync(pidFile, "a"); require("fs").futimesSync(fd, now, now); require("fs").closeSync(fd); } catch {}
      }, 30000);
      if (_heartbeatInterval.unref) _heartbeatInterval.unref();
      try {
        const ctxPath = join(memoryDir(personId), "context.md");
        const { existsSync: ex, statSync: st } = require("fs");
        const ok = ex(ctxPath) && st(ctxPath).size > 100;
        const isReload = _event?.reason === "reload";
        dlog(`recap: personId=${personId} ctxPath=${ctxPath} exists=${ex(ctxPath)} size=${ex(ctxPath) ? st(ctxPath).size : 'N/A'} ok=${ok} reload=${isReload}`);
        if (ok && !isReload) {
          setTimeout(() => {
            try {
              dlog("recap: sending recap message");
              (globalThis as any).__piRecapPending = true;
              let lastEnded = "未知";
              try {
                const plistPath = join(memoryDataDir(), "plist.json");
                const list = JSON.parse(readFileSync(plistPath, "utf8"));
                const p = list.find((x: any) => x.id === personId);
                if (p?.lastEnded) {
                  lastEnded = new Date(p.lastEnded).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
                }
              } catch {}
              const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
              const recapMsg = `[系统] 你的进程重启了。当前时间：${now}，上次退出：${lastEnded}。你是 ${process.title}。直接简要或按照你的想法全面和详细的回顾之前做了什么，回顾完ing使用用 hibernate({summary:'{回顾摘要}'}) 休眠。`;
              sendCustomMessage(pi, "continuous-resume", recapMsg, { resumeType: "restart" }, { isTriggerNewTurn: true, deliverAs: "followup", isDisplayedInTUI: true });
              dlog("recap: message sent");
            } catch (e: any) { dlog(`recap: sendMessage error: ${e?.message}`); }
          }, 1000);
        }
      } catch (e: any) { dlog(`recap: outer error: ${e?.message}`); }
    }

    if (process.env.PI_ALIVE_WOKE === "1") {
      dlog("session_start: PI_ALIVE_WOKE → kick");
      setTimeout(() => {
        try {
          sendCustomMessage(pi, "sleep-wake-resume", "睡醒了。记忆已巩固进 cortex，context 已压缩。");
        } catch {}
      }, 800);
    } else {
      dlog("session_start: normal → 等用户");
    }
  });

  // ── agent_end: intentions 驱动续命 ──
  pi.on("agent_end", async (event, ctx) => {
    dlog(`agent_end: kind=${heartState()}`);

    // 阻塞态不续命（wait/hibernate/pause 的 transition 已在工具里完成）
    // 注意：不调 setWorkingVisible(false)，否则会清掉 wait 的倒计时和 hibernate/pause 的状态文字
    if (heartState() === "hibernated" || heartState() === "paused" || heartState() === "resting") {
      // dual hibernate 检测（主意识 + 元意识都 hibernate → 写 paused 文件）
      if (heartState() === "hibernated") {
        try {
          const pid = personId();
          if (pid) {
            const mh = require("fs").existsSync(join(runtimeCacheDir(pid), "main-hibernate"));
            const sh = require("fs").existsSync(join(runtimeCacheDir(pid), "mc-hibernate"));
            if (mh && sh) {
              require("fs").writeFileSync(join(runtimeCacheDir(pid), "paused"), String(Date.now()), "utf8");
              dlog("agent_end: dual hibernate → paused");
            }
          }
        } catch {}
      }
      return;
    }

    // 用户消息过滤
    if (hasUserMessage()) {
      const lastCustom = [...(event.messages ?? [])].reverse().find((m: any) => m.role === "custom");
      if ((lastCustom as any)?.content === "(see attached image)") { setHasUserMessage(false); dlog("agent_end: phantom image filtered"); }
    }
    if (hasUserMessage()) {
      dlog("agent_end: hasUserMessage (continuing)");
      setHasUserMessage(false);
    }

    if ((globalThis as any).__piRecapPending) {
      (globalThis as any).__piRecapPending = false;
      dlog("agent_end: recap done");
    }

    const msgs = event.messages ?? [];
    const last = [...msgs].reverse().find((m: any) => m.role === "assistant");
    if (!last) {
      dlog(`agent_end: NO assistant msg`);
      return;
    }

    const sr = (last as any).stopReason;
    dlog(`agent_end: stopReason=${sr}`);

    // ESC → paused
    if (sr === "aborted") {
      if (globalThis.__piEscJustPressed === true) {
        globalThis.__piEscJustPressed = false;
        dlog("agent_end: ESC → paused");
        transition({ kind: "paused", reason: "esc" });
        return;
      }
      // 非 ESC 的 abort（steer 消息被 abort）→ 不续命，等下次触发
      dlog("agent_end: aborted (non-ESC)");
      return;
    }

    // error → 指数退避
    if (sr === "error") {
      const errObj = (last as any).error || (event as any).error;
      const errMsg = (last as any).errorMessage || errObj?.message || errObj || "unknown";
      dlog(`agent_end: ERROR: ${errMsg}`);
      try {
        const pid = (globalThis as any).__paimonPersonId || "unknown";
        const ed = `${homedir()}/.paimon/ErrorData/${pid}`;
        mkdirSync(ed, { recursive: true });
        const ts = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
        appendFileSync(`${ed}/crash.log`, `[${ts}] ${errMsg} (${process.title})\n`);
      } catch {}
      setErrorBackoffMs(errorBackoffMs() ? Math.min(errorBackoffMs() * 2, 300_000) : 20_000);
      const waitMs = errorBackoffMs();
      const retryTimer = setTimeout(() => {
        if (heartState() !== "error-backoff") return;
        transition({ kind: "working" });
        try { sendCustomMessage(pi, "continuous-error-retry", `WARN: API 错误: ${String(errMsg).slice(0, 200)}。${Math.round(waitMs / 1000)}s 后重试。`); } catch {}
      }, waitMs);
      transition({ kind: "error-backoff", retryTimer });
      return;
    }

    setErrorBackoffMs(0);

    // wait/hibernate 工具已调用 → 状态已转移，不续命（上面的阻塞态检查兜底）
    const calledWait = (last as any).content?.some?.((c: any) => c.type === "toolCall" && c.name === "wait");
    const calledHibernate = (last as any).content?.some?.((c: any) => c.type === "toolCall" && c.name === "hibernate");
    if (calledWait || calledHibernate) {
      dlog(`agent_end: ${calledWait ? "wait" : "hibernate"} tool called`);
      return;
    }

    // limits 检查
    if (limits().maxCount > 0 && limits().count >= limits().maxCount) { dlog("agent_end: maxCount reached"); return; }
    if (limits().timeLimitMs > 0 && Date.now() - limits().startTime >= limits().timeLimitMs) { dlog("agent_end: timeLimit reached"); return; }

    // ── intentions 驱动续命 ──
    // 只在 working 状态续命；resting/hibernated 说明 agent 刚调了 wait/hibernate，不应打搅
    if (heartState() !== "working") { dlog(`agent_end: state=${heartState()}, skip auto-continue`); return; }
    limits().count++;
    const intentions = getIntentions();
    if (intentions) {
      dlog(`agent_end: intentions non-empty → auto-continue (count=${limits().count})`);
      setTimeout(() => {
        sendCustomMessage(pi, "continuous-next",
          `继续工作。你的计划：\n${intentions}\n\n做完的删掉（intentions({old_string:'done item', new_string:''})），有新的加上。没事做了就调 wait 或 hibernate。`);
      }, 0);
    } else {
      dlog(`agent_end: intentions empty → prompt to plan (count=${limits().count})`);
      setTimeout(() => {
        sendCustomMessage(pi, "continuous-next",
          `你的意图栈为空。如果有事做，用 intentions 工具写入计划再继续。如果无事可做，调 wait({seconds:N}) 等待或 hibernate({summary:'...'}) 休眠。`);
      }, 0);
    }
  });

  // ── session_shutdown ──
  pi.on("session_shutdown", async () => {
    transition({ kind: "paused", reason: "shutdown" });
    setHasUserMessage(false);
  });

  // ── agent_start ──
  pi.on("agent_start", async (_event, ctx) => {
    setHasUserMessage(false);
    if (heartState() === "working") {
      limits().count = 0;
      limits().startTime = Date.now();
    } else {
      dlog(`agent_start: ${heartState()} (non-working, tools will self-guard)`);
    }
  });
}
