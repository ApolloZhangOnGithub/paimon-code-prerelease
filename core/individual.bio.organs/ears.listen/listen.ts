// ears.listen — Voice input (bios func) — THIN SHELL
// 工具注册在此（启动时固化），执行逻辑在 listen-impl.ts（热加载：import(?t=)）
// 副作用（进程管理、文件监听）在此，状态在此。

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { openSync, readFileSync, statSync, unlinkSync, writeSync, writeFileSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Text } from "@earendil-works/pi-tui";
import { getPrompt } from "#ribosome";
import { personDir as getPersonDir } from "#paths";
import { registerPaimonTool, sendCustomMessage, resultContent } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";
import { logerr } from "#paths";
const PROMPT = getPrompt("ear.listen");
// recorder 是 TS（Bun 运行时——WebSocket 自定义 header 需要）
const BUN = (() => {
  try { return execSync("which bun", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  const home = process.env.HOME;
  if (home) { const p = `${home}/.bun/bin/bun`; try { execSync(`test -x "${p}"`, { stdio: "ignore" }); return p; } catch {} }
  return "bun";
})();
const __dirname = dirname(fileURLToPath(import.meta.url));
const RECORDER_SCRIPT = resolve(__dirname, "listen-mic_recorder.ts");
const FILE_RECORDER_SCRIPT = resolve(__dirname, "listen-file_recorder.ts");
const CONFIG_PATH = resolve(__dirname, "listen-config.json");

// ── 动态加载 impl（热加载） ──
type EarImpl = typeof import("./listen-impl.ts");
async function loadImpl(): Promise<EarImpl> {
  return import(`./listen-impl.ts?t=${Date.now()}`);
}

function isRecorderAlive(): boolean {
  try { execSync("pgrep -f 'listen-mic_recorder.ts'", { stdio: "ignore" }); return true; }
  catch { return false; }
}

export default function (pi: ExtensionAPI) {
  // ── 持久状态（壳持有，不随热加载重置） ──
  let state: import("./listen-impl.ts").EarState = {
    personDir: null, listening: false, recorderType: 'mic', fileBackend: 'doubao', fileSpeed: 1.0
  };
  let watcher: ReturnType<typeof watch> | null = null;
  let offset = 0;
  let recorderProc: ChildProcess | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  // NORM-011: ear 运行时数据放 RuntimeCache，不污染 MemoryData
  const earFile = () => (state.personDir
    ? `${state.personDir.replace('/MemoryData/', '/RuntimeCache/')}/ear_output.jsonl`
    : '/tmp/ear_output.jsonl');

  function loadConfig(): any {
    try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
  }

  function startRecorder(filePath: string = '') {
    if (isRecorderAlive()) return;
    recorderProc = null;
    const file = earFile();
    const logFile = `${state.personDir}/ear_debug.log`;
    const logFd = openSync(logFile, "a");
    let args: string[];
    if (filePath) {
      const cfg = loadConfig();
      const backend = state.fileBackend || cfg.asr_backend || 'doubao';
      const lang = cfg.src_lang || 'zhen';
      args = [FILE_RECORDER_SCRIPT, filePath, file, "--backend", backend, "--lang", lang, "--speed", String(state.fileSpeed)];
    } else {
      args = [RECORDER_SCRIPT, file];
    }
    writeSync(logFd, `${new Date().toISOString()} [keep-alive] spawn ${args.join(' ')}\n`);
    recorderProc = spawn(BUN, args, { detached: true, stdio: ["ignore", logFd, logFd] });
    recorderProc.unref();
  }

  function stopRecorder() {
    if (recorderProc) { recorderProc.kill(); recorderProc = null; }
    try { execSync("pkill -f 'listen-mic_recorder.ts' 2>/dev/null"); } catch {}
    try { execSync("pkill -f 'listen-file_recorder.ts' 2>/dev/null"); } catch {}
  }

  function startKeepAlive() {
    if (keepAliveTimer) return;
    keepAliveTimer = setInterval(() => {
      if (!state.listening || !state.personDir) return;
      if (state.recorderType === 'mic' && !isRecorderAlive()) startRecorder();
    }, 5000);
  }

  function stopKeepAlive() {
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
  }

  // ── 语音缓冲 ──
  let speechBuffer: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_DELAY = 3000;

  function flushBuffer() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (speechBuffer.length === 0) return;
    const combined = speechBuffer.join(" ");
    speechBuffer = [];
    sendCustomMessage(pi, "ear", combined);
  }

  function startWatch() {
    // 强制清理残留引用，确保每次都是全新 watcher
    if (watcher) { try { watcher.close(); } catch {} watcher = null; }
    if (!state.personDir) return;
    try { execSync(`touch "${earFile()}"`); } catch {}
    try { const existing = readFileSync(earFile(), "utf8"); offset = existing.length; } catch {}
    watcher = watch(earFile(), async () => {
      if (!state.listening || !state.personDir) return;
      try {
        const muteStat = statSync("/tmp/pi_mouth_speaking");
        if (Date.now() - muteStat.mtimeMs < 30000) return;
        unlinkSync("/tmp/pi_mouth_speaking");
      } catch {}
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
    flushBuffer();
    if (watcher) { try { watcher.close(); } catch {} watcher = null; }
    // 确保 watcher 被彻底清理，避免 restartWatch 因闭包残留提前返回
    watcher = null;
    offset = 0;
  }

  // ── Action 执行器 ──
  function applyAction(a: import("./listen-impl.ts").EarAction) {
    switch (a.type) {
      case 'startRecorder': startRecorder(a.filePath); break;
      case 'stopRecorder': stopRecorder(); break;
      case 'startWatch': startWatch(); break;
      case 'stopWatch': stopWatch(); break;
      case 'startKeepAlive': startKeepAlive(); break;
      case 'stopKeepAlive': stopKeepAlive(); break;
      case 'writeControl':
        try { writeFileSync("/tmp/ear_control.json", JSON.stringify(a.json)); } catch {}
        break;
    }
  }
  function applyActions(actions: import("./listen-impl.ts").EarAction[]) {
    for (const a of actions) applyAction(a);
  }

  // ── ear 参数 schema（壳内固化，避免未定义导致 API 收到 type:null）──
  const earParamsSchema = Type.Object({
    action: Type.Optional(Type.String({ messageDescription: "on/off/file/status/pause/resume/seek/stop" })),
    path: Type.Optional(Type.String({ messageDescription: "WAV 文件路径（action=file 时必填）" })),
    backend: Type.Optional(Type.String({ messageDescription: "ASR 后端：doubao 或 whisper（action=file 时可选）" })),
    speed: Type.Optional(Type.Number({ messageDescription: "播放速度倍数 0.25-4.0（action=file 时可选，默认 1.0）" })),
    seconds: Type.Optional(Type.Number({ messageDescription: "跳转秒数（action=seek 时必填）" })),
  });

  // ── ear 工具（壳固化，impl 热加载）──
  registerPaimonTool({
    name: "ear",
    label: "Ear",
    messageDescription: "开关语音监听（豆包 ASR 实时转写）。on/off/file/status/pause/resume/seek/stop。改 listen-impl.ts 后无需重启。",
    promptSnippet: "ear({action:'on|off|file|status|pause|resume|seek|stop'})",
    parameters: earParamsSchema,
    renderCall(args: any, theme: any) {
      const act = args?.action || "";
      const detail = act === 'file' ? args?.path : act === 'seek' ? `${args?.seconds || 0}s` : "";
      return renderToolCall.label(theme, `Ear ${act}`, detail);
    },
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      const content = resultContent(result);
      return renderMessage.summary(theme, ctx, content?.[0]?.text);
    },
    async execute(_id: string, params: any) {
      const impl = await loadImpl();
      const result = impl.execute(state, params);
      state = result.newState;
      applyActions(result.actions);
      return { content: result.content, details: result.details, isError: result.isError };
    },
  });

  // ── session_start ──
  pi.on("session_start", async (_event, ctx) => {
    const sf = ctx.sessionManager.getSessionFile();
    if (!sf) return;
    if (sf.includes("metaconsciousnessSessions") || sf.includes("HippocampusSessions") || sf.includes("SleepSessions")) return;
    const pd = getPersonDir(sf);
    const impl = await loadImpl();
    const r = impl.onSessionStart(state, pd);
    state = r.newState;
    applyActions(r.actions);
  });

  // ── 注入 prompt ──
  pi.on("before_agent_start", async (event) => {
    if (!state.listening) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + PROMPT };
  });

  // ── 清理 ──
  pi.on("session_shutdown", () => {
    state.listening = false;
    stopRecorder();
    stopWatch();
    stopKeepAlive();
  });

}
