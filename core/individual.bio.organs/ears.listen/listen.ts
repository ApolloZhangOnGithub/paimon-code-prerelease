// ears.listen — Voice input (bios func)
// /ears on  → 启动录音+豆包ASR, 监听语音
// /ears off → 关闭录音, 停止监听
// /ears     → 查看状态
//
// keep-alive: 每 5s 检测 recorder 进程是否活着，死了自动复活。
// session_shutdown: 主意识退出时自动清理所有 ear 进程。

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { getPrompt } from "#runtime";

const PROMPT = getPrompt("ear.listen");
const PYTHON = "/opt/homebrew/Caskroom/miniforge/base/bin/python3";
const RECORDER_SCRIPT = resolve(dirname(new URL(import.meta.url).pathname), "listen_recorder.py");

function isRecorderAlive(): boolean {
  try { execSync("pgrep -f 'listen_recorder.py'", { stdio: "ignore" }); return true; }
  catch { return false; }
}

export default function (pi: ExtensionAPI) {
  const _cmds: any[] = [];
  let personDir: string | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  let offset = 0;
  let listening = false;
  let recorderProc: ChildProcess | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  const earFile = () => `${personDir}/ear_output.jsonl`;

  function startRecorder() {
    if (isRecorderAlive()) return;  // 已经活着就不杀
    recorderProc = null;

    const file = earFile();
    const logFile = `${personDir}/ear_debug.log`;
    const logFd = require("node:fs").openSync(logFile, "a");
    require("node:fs").writeSync(logFd, `${new Date().toISOString()} [keep-alive] spawn ${RECORDER_SCRIPT} ${file}\n`);
    recorderProc = spawn(PYTHON, ["-u", RECORDER_SCRIPT, file], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    recorderProc.unref();
  }

  function stopRecorder() {
    if (recorderProc) { recorderProc.kill(); recorderProc = null; }
    try { execSync("pkill -f 'listen_recorder.py' 2>/dev/null"); } catch {}
  }

  function startKeepAlive() {
    if (keepAliveTimer) return;
    keepAliveTimer = setInterval(() => {
      if (!listening || !personDir) return;
      if (!isRecorderAlive()) {
        startRecorder();
      }
    }, 5000);
  }

  function stopKeepAlive() {
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
  }

  // ── 语音缓冲 ─────────────────────────────────────────
  // 只用 final(整句) → 进缓冲，攒到 1.5s 无新输入后一起发送
  // delta 太碎（豆包逐字返回），不展示中间态。
  let speechBuffer: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_DELAY = 3000; // 3s 无新输入 → 说完了，一起发送

  function flushBuffer() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (speechBuffer.length === 0) return;
    const combined = speechBuffer.join(" ");
    speechBuffer = [];
    // 整句说完 → steer 打断模型，开始回复
    pi.sendUserMessage(combined, { deliverAs: "steer" });
  }

  function startWatch() {
    if (watcher || !personDir) return;
    try { execSync(`touch "${earFile()}"`); } catch {}
    try {
      const existing = require("node:fs").readFileSync(earFile(), "utf8");
      offset = existing.length;
    } catch {}
    watcher = watch(earFile(), async () => {
      if (!listening || !personDir) return;
      // mouth 正在说话时静音，防止回声（带超时：文件超过30s没人更新就自动清除）
      try {
        const muteStat = require("node:fs").statSync("/tmp/pi_mouth_speaking");
        if (Date.now() - muteStat.mtimeMs < 30000) return; // 30s内更新过 → 真在说话
        require("node:fs").unlinkSync("/tmp/pi_mouth_speaking"); // 超时 → 清理僵尸文件
      } catch { /* 文件不存在，正常 */ }
      try {
        const content = await readFile(earFile(), "utf8");
        if (content.length <= offset) return;
        const newPart = content.slice(offset);
        offset = content.length;
        for (const line of newPart.trim().split("\n").filter(Boolean)) {
          try {
            const entry = JSON.parse(line);
            const text = entry.text || entry.translation || "";
            if (!text.trim()) continue;
            // 只用 final(整句)，delta 太碎不展示
            if (entry.is_final !== false && text.trim()) {
              speechBuffer.push(text);
              if (flushTimer) clearTimeout(flushTimer);
              flushTimer = setTimeout(flushBuffer, FLUSH_DELAY);
            }
          } catch {}
        }
      } catch {}
    });
  }

  function stopWatch() {
    flushBuffer(); // 发送未发送的缓冲内容
    if (watcher) { watcher.close(); watcher = null; }
  }

  // ── 语音路由：当前语音发给哪个 agent ───────────────────
  let routeTarget: "main" | "auto" = "main";

  // ── /ears 命令 ────────────────────────────────────────────
  _cmds.push({
    name: "body-ears",
    desc: "语音输入控制 — /body-ears on|off|route main|auto",
    handler: async (args: any, ctx: any) => {
      const action = (typeof args === "string" && args.trim()) || "status";
      const sub = (action.includes(" ") ? action.split(" ") : [action]) as string[];

      if (sub[0] === "route") {
        const target = sub[1];
        if (target === "main" || target === "auto") {
          routeTarget = target;
          ctx.ui.notify(`ear route: ${target}`, "info");
        } else {
          ctx.ui.notify(`用法: /ears route main|auto`, "warning");
        }
        return;
      }

      if (action === "on") {
        if (!personDir) { ctx.ui.notify("person dir not found", "warning"); return; }
        listening = true;
        startRecorder();
        startWatch();
        startKeepAlive();
        ctx.ui.notify("ear on", "info");
      } else if (action === "off") {
        listening = false;
        stopRecorder();
        stopWatch();
        stopKeepAlive();
        ctx.ui.notify("ear off", "info");
      } else {
        const alive = isRecorderAlive();
        ctx.ui.notify(
          `ear ${listening ? "on" : "off"}, recorder ${alive ? "running" : "stopped"}`,
          "info"
        );
      }
    },
  });

  // ── 主意识 session 启动 → 默认打开耳朵 ─────────────────
  pi.on("session_start", async (_event, ctx) => {
    const sf = ctx.sessionManager.getSessionFile();
    if (!sf) return;

    // 跳过子进程 session（潜意识/海马体/睡眠）
    if (sf.includes("conscious-sessions") ||
        sf.includes("hippocampus-sessions") ||
        sf.includes("sleep-sessions")) return;

    const match = sf.match(/\.pi\/memory\/([a-f0-9]+)\//);
    if (!match) return;
    personDir = `${process.env.HOME}/.pi/memory/${match[1]}/.data`;

    // 默认关闭耳朵（需 /ears on 手动开启）
    listening = false;
  });

  // ── 注入 prompt ─────────────────────────────────────────
  pi.on("before_agent_start", async (event) => {
    if (!listening) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + PROMPT };
  });

  // 语音输入通过 sendUserMessage 发送，复用 pi 原生用户消息渲染。

  // ── 清理 ─────────────────────────────────────────────────
  pi.on("session_shutdown", () => {
    listening = false;
    stopRecorder();
    stopWatch();
    stopKeepAlive();
  });

  return _cmds;
}
