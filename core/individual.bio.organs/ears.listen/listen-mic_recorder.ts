#!/usr/bin/env bun
// listen-mic_recorder.ts — 麦克风 → 豆包 ASR → ear_output.jsonl
// 原 listen-mic_recorder.py 的 TS 重写（运行时 Bun）。
//
// 用法：
//   bun listen-mic_recorder.ts <output_jsonl_path> [--file <wav>]
//     output_jsonl_path: ~/.paimon/RuntimeCache/<id>/ear_output.jsonl
//
// 凭证：~/.paimon/config/services.json (doubao-voicengine)
//
// 输入源优先级：--file WAV > rtw mic_relay (TCP 7691) > ffmpeg avfoundation 本地麦克风

import { existsSync, mkdirSync, appendFileSync, readFileSync, unlinkSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, basename } from "node:path";
import { connect, type Socket } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import {
  DoubaoTranscriber, loadConfig, readWav, SAMPLE_RATE, CHUNK_SIZE, type EarResult,
} from "./listen-doubao_client.ts";

const CTL_FILE = "/tmp/ear_control.json";
const MUTE_FILE = "/tmp/pi_mouth_speaking";
const BYTES_PER_CHUNK = CHUNK_SIZE * 2;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Source {
  open(): Promise<void>;
  read(): Promise<Uint8Array>; // 空数组 = EOF（仅文件源）
  close(): void;
}

// ── 文件源（WAV → PCM 块，支持 pause/resume/seek/speed 控制）──
class FileSource implements Source {
  private data!: Uint8Array;
  private totalFrames = 0;
  private pos = 0; // 帧位置
  private paused = false;
  private speed = 1.0;
  constructor(private path: string) {}

  async open() {
    const wav = readWav(this.path);
    if (wav.channels !== 1) throw new Error(`WAV 需要单声道，实际 ${wav.channels}ch`);
    if (wav.bits !== 16) throw new Error(`WAV 需要 16bit，实际 ${wav.bits}bit`);
    if (wav.sampleRate !== SAMPLE_RATE) throw new Error(`WAV 需要 ${SAMPLE_RATE}Hz，实际 ${wav.sampleRate}Hz`);
    this.data = wav.pcm;
    this.totalFrames = wav.pcm.length / 2;
    console.log(`[ear] 文件源 "${basename(this.path)}" (${(this.totalFrames / SAMPLE_RATE).toFixed(0)}s, ${this.totalFrames} 帧)`);
  }

  get progressSec() { return this.pos / SAMPLE_RATE; }
  get durationSec() { return this.totalFrames / SAMPLE_RATE; }

  private pollControl() {
    // 一次性控制命令文件（action 形式），读完即删
    try {
      const cmd = JSON.parse(readFileSync(CTL_FILE, "utf8"));
      unlinkSync(CTL_FILE);
      const action = cmd.action || "";
      if (action === "pause") { this.paused = true; console.log(`[ear]  pause @ ${this.progressSec.toFixed(1)}s`); }
      else if (action === "resume") { this.paused = false; console.log(`[ear]  resume @ ${this.progressSec.toFixed(1)}s`); }
      else if (action === "seek") {
        const sec = Number(cmd.seconds || 0);
        this.pos = Math.floor(Math.max(0, Math.min(sec * SAMPLE_RATE, this.totalFrames)));
        console.log(`[ear]  seek to ${sec.toFixed(1)}s`);
      } else if (action === "speed") { this.speed = Number(cmd.value || 1.0); console.log(`[ear]  speed ${this.speed}x`); }
    } catch {}
  }

  async read(): Promise<Uint8Array> {
    this.pollControl();
    if (this.paused) return new Uint8Array(BYTES_PER_CHUNK); // 静音
    const readSamples = Math.floor(CHUNK_SIZE * this.speed);
    const start = this.pos * 2, end = Math.min(start + readSamples * 2, this.data.length);
    if (start >= this.data.length) return new Uint8Array(0);
    this.pos += readSamples;
    let audio = new Int16Array(this.data.buffer, this.data.byteOffset + start, Math.floor((end - start) / 2));
    if (audio.length === 0) return new Uint8Array(0);
    // 调速重采样到 CHUNK_SIZE
    const out = new Int16Array(CHUNK_SIZE);
    if (this.speed !== 1.0 || audio.length !== CHUNK_SIZE) {
      for (let i = 0; i < CHUNK_SIZE; i++) {
        const x = (i / CHUNK_SIZE) * audio.length;
        const i0 = Math.min(audio.length - 1, Math.floor(x));
        out[i] = i < audio.length || this.speed > 1.0 ? audio[Math.min(i0, audio.length - 1)] : 0;
      }
      if (this.speed <= 1.0 && audio.length < CHUNK_SIZE) {
        out.fill(0); out.set(audio); // 减速末尾补零（镜像 py pad 行为）
      }
    } else out.set(audio);
    return new Uint8Array(out.buffer, 0, CHUNK_SIZE * 2);
  }

  close() {}
}

// ── 远端麦克风（rtw mic_relay TCP 桥接浏览器麦克风）────────────
class RemoteMicrophone implements Source {
  static HOST = "127.0.0.1";
  static PORT = 7691;
  private sock: Socket | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private closed = false;

  static available(): Promise<boolean> {
    return new Promise(res => {
      const s = connect({ host: RemoteMicrophone.HOST, port: RemoteMicrophone.PORT, timeout: 300 });
      s.once("connect", () => { s.destroy(); res(true); });
      s.once("error", () => res(false));
      s.once("timeout", () => { s.destroy(); res(false); });
    });
  }

  async open() {
    await new Promise<void>((res, rej) => {
      this.sock = connect({ host: RemoteMicrophone.HOST, port: RemoteMicrophone.PORT });
      this.sock.once("connect", () => res());
      this.sock.once("error", rej);
    });
    this.sock!.on("data", (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); });
    this.sock!.on("close", () => { this.closed = true; });
    console.log(`[ear] 远端麦克风 (rtw mic_relay ${RemoteMicrophone.HOST}:${RemoteMicrophone.PORT})`);
  }

  async read(): Promise<Uint8Array> {
    while (this.buf.length < BYTES_PER_CHUNK) {
      if (this.closed) throw new Error("mic relay disconnected");
      await sleep(10);
    }
    const chunk = this.buf.subarray(0, BYTES_PER_CHUNK);
    this.buf = this.buf.subarray(BYTES_PER_CHUNK);
    return new Uint8Array(chunk);
  }

  close() { try { this.sock?.destroy(); } catch {} }
}

// ── 本地麦克风（ffmpeg：macOS=avfoundation, Linux=pulse/alsa）───────────
class FfmpegMicrophone implements Source {
  private proc: ChildProcess | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private dead = false;

  private inputCandidates(): Array<{ fmt: string; devs: string[] }> {
    if (process.platform === "darwin") {
      const dev = process.env.EAR_MIC_DEVICE || ":default";
      return [{ fmt: "avfoundation", devs: [dev, ":0"] }];
    }
    const dev = process.env.EAR_MIC_DEVICE || "default";
    return [
      { fmt: "pulse", devs: [dev] },
      { fmt: "alsa", devs: [dev, "hw:0"] },
    ];
  }

  async open() {
    for (const { fmt, devs } of this.inputCandidates()) {
      for (const dev of devs) {
        const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error",
          "-f", fmt, "-i", dev, "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "-"],
          { stdio: ["ignore", "pipe", "pipe"] });
        const ok = await new Promise<boolean>(res => {
          const t = setTimeout(() => res(true), 1500);
          p.once("exit", () => { clearTimeout(t); res(false); });
          p.once("error", () => { clearTimeout(t); res(false); });
        });
        if (ok) {
          this.proc = p;
          p.stdout!.on("data", (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); });
          p.once("exit", () => { this.dead = true; });
          console.log(`[ear] 麦克风 ffmpeg ${fmt} "${dev}" (${SAMPLE_RATE}Hz, 1ch)`);
          return;
        }
      }
    }
    const tried = this.inputCandidates().map(c => c.fmt).join("/");
    throw new Error(`无法打开麦克风（ffmpeg：已尝试 ${tried}）`);
  }

  async read(): Promise<Uint8Array> {
    while (this.buf.length < BYTES_PER_CHUNK) {
      if (this.dead) throw new Error("ffmpeg 麦克风进程退出");
      await sleep(10);
    }
    const chunk = this.buf.subarray(0, BYTES_PER_CHUNK);
    this.buf = this.buf.subarray(BYTES_PER_CHUNK);
    return new Uint8Array(chunk);
  }

  close() { try { this.proc?.kill(); } catch {} }
}

// ── 主循环 ────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const fileIdx = argv.indexOf("--file");
  const filePath = fileIdx >= 0 ? (argv[fileIdx + 1] || "") : "";
  const positional = argv.filter((a, i) => a !== "--file" && (fileIdx < 0 || i !== fileIdx + 1));
  const outputPath = positional[0];
  if (!outputPath) { console.error("[ear] 缺少输出路径参数"); process.exit(2); }

  mkdirSync(dirname(outputPath), { recursive: true });

  const cfg = loadConfig();
  if (!cfg.doubao_app_key || !cfg.doubao_access_key) {
    console.log("[ear] doubao-voicengine 未配置，使用 /config 编辑");
    process.exit(1);
  }

  console.log(`[ear] 启动 — 源语言=${cfg.src_lang} 目标=${cfg.tgt_lang}`);
  console.log(`[ear] 输出 ${outputPath}`);

  let source: Source;
  const isFile = !!filePath;
  if (filePath) source = new FileSource(filePath);
  else if (await RemoteMicrophone.available()) source = new RemoteMicrophone();
  else source = new FfmpegMicrophone();
  await source.open();

  const transcriber = new DoubaoTranscriber(
    cfg.doubao_app_key, cfg.doubao_access_key, cfg.src_lang, cfg.tgt_lang,
    isFile ? 999.0 : Number(cfg.idle_close_s), // 文件模式不断开
  );

  transcriber.start((rec: EarResult) => {
    // 只写整句(final)，delta 太碎忽略
    if (rec.is_final && rec.text) {
      appendFileSync(outputPath, JSON.stringify(rec) + "\n");
      console.log(`[ear ✓] ${rec.text}`);
    }
  });

  const silenceRms = Number(cfg.silence_rms);
  const hangoverS = Number(cfg.silence_hangover_s);
  let voiceUntil = 0;
  let running = true;
  process.on("SIGINT", () => { running = false; });
  process.on("SIGTERM", () => { running = false; });

  try {
    while (running) {
      const pcm = await source.read();
      if (isFile && pcm.length === 0) {
        const fs2 = source as FileSource;
        console.log(`[ear] 文件播放完毕 (${fs2.progressSec.toFixed(0)}/${fs2.durationSec.toFixed(0)}s)`);
        break;
      }
      // mouth 正在说话时跳过，防止回声
      if (existsSync(MUTE_FILE)) continue;
      if (isFile) {
        transcriber.feed(pcm);
      } else {
        const audio = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
        let sum = 0;
        for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
        const rms = audio.length ? Math.sqrt(sum / audio.length) : 0;
        const now = performance.now() / 1000;
        if (rms >= silenceRms) voiceUntil = now + hangoverS;
        if (now <= voiceUntil) transcriber.feed(pcm);
      }
    }
  } finally {
    console.log("[ear] 关闭");
    await transcriber.stop();
    source.close();
    process.exit(0);
  }
}

main().catch(e => { console.log(`[ear] ${e?.message || e}`); process.exit(1); });
