// mouth.speak — 豆包 TTS 发声 (vivi 2.0)
// mouth 工具 → 出声 + 清爽显示
// 防重叠锁: speaking=true 时拒绝新请求
// 耳嘴互斥：说话时 ear 自动静音防回声

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import * as https from "node:https";
import { join } from "node:path";
import { homedir } from "node:os";
import { getPrompt } from "#runtime";

const MOUTH_STATE_FILE = join(homedir(), ".pi", "agent", "mouth_state");

const PROMPT = getPrompt("mouth.speak");
const DOUBAO_APP_ID = process.env.DOUBAO_APP_ID || "";
const DOUBAO_TOKEN = process.env.DOUBAO_TOKEN || "";
const TTS_VOICE = "zh_female_vv_uranus_bigtts";
const TTS_ENDPOINT = "openspeech.bytedance.com";
const TTS_PATH = "/api/v1/tts";

// 说话队列：后续 mouth 入队按顺序播，绝不丢弃；每段播完/失败/超时都一定收尾→放下一段。
let speaking = false;
let speakProc: ChildProcess | null = null;
let speakQueue: string[] = [];
let watchdog: ReturnType<typeof setTimeout> | null = null;
let lastSpokenText = "";
let lastSpokenAt = 0;
// /mouth on|off 持久化：存 ~/.pi/agent/mouth_state，重启后保持上次状态
let mouthOn = (() => { try { return require("node:fs").readFileSync(MOUTH_STATE_FILE, "utf8").trim() === "on"; } catch { return false; } })();

// 一段结束（正常播完 / 合成失败 / 网络错 / 看门狗超时）统一走这里：
// 解锁、清看门狗，再去放队列里的下一段。保证 speaking 永远会被复位——
// 不会再卡在 speaking=true 把后续 mouth 全堵死（"不知道自己说完了"的根）。
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
    // 队列空了 = 真的全说完了 → 撤掉静音标记，耳朵恢复监听。
    try { unlinkSync("/tmp/pi_mouth_speaking"); } catch {}
    return;
  }
  speaking = true;
  lastSpokenText = text;
  lastSpokenAt = Date.now();
  try { writeFileSync("/tmp/pi_mouth_speaking", "1", "utf-8"); } catch {}

  const body = JSON.stringify({
    app: { appid: DOUBAO_APP_ID, token: DOUBAO_TOKEN, cluster: "volcano_tts" },
    user: { uid: "pi-mouth" },
    audio: { voice_type: TTS_VOICE, encoding: "mp3", rate: 24000 },
    request: { reqid: `${Date.now()}`, text, text_type: "plain", operation: "query" },
  });

  const req = https.request({
    hostname: TTS_ENDPOINT, path: TTS_PATH, method: "POST",
    headers: { Authorization: `Bearer;${DOUBAO_TOKEN}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    timeout: 15000,
  }, (res) => {
    let data = "";
    res.on("data", (chunk: Buffer) => data += chunk.toString());
    res.on("end", () => {
      try {
        const resp = JSON.parse(data);
        if (resp.code === 3000 && resp.data) {
          const mp3 = Buffer.from(resp.data, "base64");
          writeFileSync("/tmp/pi_mouth.mp3", mp3);
          // 不再 detached/unref —— 那会让 afplay 的 close 事件不可靠。普通 spawn，close 必触发，
          // 收尾才稳；进程退出时 session_shutdown 会 kill 掉它。
          speakProc = spawn("afplay", ["/tmp/pi_mouth.mp3"], { stdio: "ignore" });
          const thisProc = speakProc;
          const maxMs = Math.min(180000, 8000 + text.length * 350);
          watchdog = setTimeout(() => { try { thisProc.kill(); } catch {} if (speakProc === thisProc) finishCurrent(); }, maxMs);
          thisProc.on("close", () => { if (speakProc === thisProc) finishCurrent(); });
          thisProc.on("error", () => { if (speakProc === thisProc) finishCurrent(); });
        } else {
          finishCurrent(); // 合成失败也要收尾+继续队列，绝不卡死
        }
      } catch {
        finishCurrent();
      }
    });
  });
  req.on("error", () => finishCurrent());
  req.on("timeout", () => { try { req.destroy(); } catch {} finishCurrent(); });
  req.write(body);
  req.end();
}

function doSpeak(text: string) {
  if (!mouthOn) return { content: [{ type: "text", text: "mouth is off (/mouth on to enable)" }], details: {}, isError: true };
  if (!text || !text.trim()) return;
  // 防"从头重说"：turn 被打断 / continuous 续命会让模型重发同一句 → 同一段话 10s 内重复就跳过。
  if (text === lastSpokenText && Date.now() - lastSpokenAt < 10000) return;
  speakQueue.push(text);   // 关键：后续 mouth 入队，不再被 speaking 锁直接丢掉。
  processQueue();
}

export default function (pi: ExtensionAPI) {
  const _cmds: any[] = [];
  let personId: string | null = null;

  // 只在主意识 session 启用 mouth。hc/sc/sleep 不需要说话。
  pi.on("session_start", async (_event, ctx) => {
    const sf = ctx.sessionManager.getSessionFile();
    if (!sf) return;
    if (sf.includes("conscious-sessions") || sf.includes("hippocampus-sessions") || sf.includes("sleep-sessions")) {
      return;
    }
    const m = sf.match(/\.pi\/memory\/([a-f0-9]+)\//);
    if (!m) return;
    personId = m[1];
  });

  // ── mouth 工具：出声 + 清爽显示 ───
  pi.registerTool({
    name: "mouth",
    label: "Mouth (TTS)",
    messageDescription: "Speak text aloud via 豆包 TTS (vivi 2.0 voice). Ear auto-mutes. Single speech at a time.",
    promptSnippet: "Speak text aloud via 豆包 TTS (vivi 2.0 voice, clean display)",
    parameters: {
      type: "object" as any, properties: {
        text: { type: "string", messageDescription: "Text to speak aloud." }
      }, required: ["text"]
    },
    // 工具调用本身就渲染成一行清爽的语音(柔和青色,像"说话")——
    // 不显示"mouth"工具框、不显示结果框。颜色区别于潜意识的黄。
    renderCall(args: any, _theme: any) {
      const { Text } = require("@earendil-works/pi-tui");
      const SPEAK = "\x1b[38;5;116m", RESET = "\x1b[39m";
      return new Text(SPEAK + "● " + (args?.text ?? "") + RESET, 0, 0); // 普通bullet色,让replaceDot根据状态着色;文字保留语音青色
    },
    async execute(_id: string, params: any) {
      if (!personId) return { content: [], details: {} };
      const result = doSpeak(params.text as string);
      if (result && result.isError) return result;
      return { content: [], details: {} }; // 空结果 → 无结果框；显示交给 renderCall
    },
  });

  // (mouth-speak 消息渲染器已去掉：显示改由工具的 renderCall 直接渲染一行，不再发单独消息。)

  // ── /mouth on|off：开关说话（和耳朵 /ears 一样）。off=调 mouth 工具不出声。 ──
  _cmds.push({
    name: "body-mouth",
    desc: "说话开关：/body-mouth on|off。off=不出声（mouth 工具照常调用、只是不合成播放）。",
    handler: async (args: any, ctx: any) => {
      const a = (typeof args === "string" ? args : "").trim().toLowerCase();
      if (a === "off") { mouthOn = false; try { require("node:fs").writeFileSync(MOUTH_STATE_FILE, "off"); } catch {} ctx.ui?.notify?.("mouth off", "info"); }
      else if (a === "on") { mouthOn = true; try { require("node:fs").writeFileSync(MOUTH_STATE_FILE, "on"); } catch {} ctx.ui?.notify?.("mouth on", "info"); }
      else ctx.ui?.notify?.(`mouth ${mouthOn ? "on" : "off"}`, "info");
    },
  });

  pi.on("before_agent_start", async (event) => {
    // 只在主意识 session 注入 prompt
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

  return _cmds;
}

export { speaking };
