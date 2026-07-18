import { homedir } from "node:os";
// mouth.speak — 豆包 TTS 发声 (vivi 2.0)

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ChildProcess, spawn, execSync } from "node:child_process";
import { writeFileSync, unlinkSync, appendFileSync, mkdirSync } from "node:fs";
import { platform } from "node:os";

// TTS 输出 MP3——fallback 链里只放能播 MP3 的播放器（paplay/aplay 只支持 WAV，不能用）
let _cachedPlayer: { cmd: string; args: string[] } | null = null;
function audioPlayer(): { cmd: string; args: string[] } {
  if (_cachedPlayer) return _cachedPlayer;
  if (platform() === "darwin") { _cachedPlayer = { cmd: "afplay", args: [] }; return _cachedPlayer; }
  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet"] },
    { cmd: "mpv",    args: ["--no-video", "--really-quiet"] },
    { cmd: "cvlc",   args: ["--play-and-exit", "--quiet"] },
  ];
  for (const c of candidates) {
    try { execSync(`which ${c.cmd}`, { stdio: "ignore" }); _cachedPlayer = c; return c; } catch {}
  }
  _cachedPlayer = { cmd: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet"] };
  return _cachedPlayer;
}
import * as https from "node:https";
import { Text } from "@earendil-works/pi-tui";
import { getPrompt } from "#ribosome";
import { logerr, serviceKey } from "#paths";
import { registerPaimonTool } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";

const PROMPT = getPrompt("mouth.speak");
const DOUBAO_APP_ID = serviceKey("doubao-voicengine", "appId") || "";
const DOUBAO_TOKEN = serviceKey("doubao-voicengine", "token") || "";

// ── 持久状态（队列、锁、播放——绝不随热加载重建）──
let speaking = false;
let speakProc: ChildProcess | null = null;
let speakQueue: string[] = [];
let watchdog: ReturnType<typeof setTimeout> | null = null;
let lastSpokenText = "";
let lastSpokenAt = 0;
let speakResolve: (() => void) | null = null;

function finishCurrent() {
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  speakProc = null;
  speaking = false;
  processQueue();
}

function processQueue() {
  if (speaking) return;
  const text = speakQueue.shift();
  if (text === undefined) {
    try { unlinkSync("/tmp/pi_mouth_speaking"); } catch {}
    if (speakResolve) { speakResolve(); speakResolve = null; }
    return;
  }
  speaking = true;
  lastSpokenText = text;
  lastSpokenAt = Date.now();
  try { writeFileSync("/tmp/pi_mouth_speaking", "1", "utf-8"); } catch {}

  // TTS API 调用
  doTTSRequest(text, DOUBAO_APP_ID, DOUBAO_TOKEN).then((mp3Base64) => {
      const mp3 = Buffer.from(mp3Base64, "base64");
      writeFileSync("/tmp/pi_mouth.mp3", mp3);
      const player = audioPlayer();
      speakProc = spawn(player.cmd, [...player.args, "/tmp/pi_mouth.mp3"], { stdio: "ignore" });
      const thisProc = speakProc;
      const maxMs = Math.min(180000, 8000 + text.length * 350);
      watchdog = setTimeout(() => { try { thisProc.kill(); } catch {} if (speakProc === thisProc) finishCurrent(); }, maxMs);
      thisProc.on("close", () => { if (speakProc === thisProc) finishCurrent(); });
      thisProc.on("error", () => { if (speakProc === thisProc) finishCurrent(); });
    }).catch(() => {
      finishCurrent();
    });
}

// ── TTS API 实现 ──
function doTTSRequest(text: string, appId: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      app: { appid: appId, token, cluster: "volcano_tts" },
      user: { uid: "pi-mouth" },
      audio: { voice_type: "zh_female_vv_uranus_bigtts", encoding: "mp3", rate: 24000 },
      request: { reqid: `${Date.now()}`, text, text_type: "plain", operation: "query", cluster: "volcano_tts" },
    });
    const req = https.request({
      hostname: "openspeech.bytedance.com",
      path: "/api/v1/tts",
      method: "POST",
      headers: { Authorization: `Bearer;${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => data += chunk.toString());
      res.on("end", () => {
        try {
          const resp = JSON.parse(data);
          if (resp.code === 3000 && resp.data) { resolve(resp.data); }
          else { const errMsg = `TTS error code=${resp.code} msg=${resp.message}`;
            try { const pid = (globalThis as any).__paimonPersonId || "unknown"; const ed = `${homedir()}/.paimon/ErrorData/${pid}`; mkdirSync(ed, { recursive: true }); appendFileSync(`${ed}/mouth_err.log`, `${new Date().toISOString()} ${errMsg}\n`); } catch {}
            reject(new Error(errMsg)); }
        } catch { reject(new Error("TTS response parse error")); }
      });
    });
    req.on("error", (err) => reject(new Error(`TTS request error: ${err.message}`)));
    req.on("timeout", () => { try { req.destroy(); } catch {} reject(new Error("TTS timeout")); });
    req.write(body);
    req.end();
  });
}

export default function (pi: ExtensionAPI) {
  let personId: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    const sf = ctx.sessionManager.getSessionFile();
    if (!sf) return;
    if (sf.includes("metaconsciousnessSessions") || sf.includes("HippocampusSessions") || sf.includes("SleepSessions")) return;
    personId = global.__paimonPersonId as string;
  });

  registerPaimonTool({
    name: "mouth",
    label: "Mouth (TTS)",
    feedResult: false,
    messageDescription: "Speak text aloud via 豆包 TTS (vivi 2.0 voice). Ear auto-mutes. Single speech at a time.",
    promptSnippet: "Speak text aloud via 豆包 TTS (vivi 2.0 voice, clean display)",
    parameters: {
      type: "object" as any,
      properties: { text: { type: "string", messageDescription: "Text to speak aloud." } },
      required: ["text"]
    },
    renderCall(args: any, theme: any) {
      return renderToolCall.label(theme, "Mouth", (args?.text ?? "").slice(0, 50));
    },
    renderResult() {
      return renderMessage.silent();
    },
    async execute(_id: string, params: any) {
      const pid = (globalThis as any).__paimonPersonId;
      if (!pid) return { content: [{ type: "text", text: "mouth: personId 未设置" }], isError: true };
      if (!DOUBAO_APP_ID || !DOUBAO_TOKEN) return { content: [{ type: "text", text: "mouth: 缺少 DOUBAO_APP_ID / DOUBAO_TOKEN 环境变量" }], isError: true };
      const text = params?.text;
      if (!text || !text.trim()) return { content: [{ type: "text", text: "mouth: 文本为空" }], isError: true };
      if (text === lastSpokenText && Date.now() - lastSpokenAt < 10000) return { content: [{ type: "text", text: "skipped (duplicate)" }] };
      speakQueue.push(text);
      processQueue();
      await new Promise<void>(resolve => { speakResolve = resolve; });
      return { content: [{ type: "text", text: "spoke" }] };
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (!personId) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + PROMPT };
  });

  pi.on("session_shutdown", () => {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (speakProc) { speakProc.kill(); speakProc = null; }
    speaking = false;
    speakQueue = [];
    try { unlinkSync("/tmp/pi_mouth_speaking"); } catch {}
  });

  return [];
}

export { speaking };
