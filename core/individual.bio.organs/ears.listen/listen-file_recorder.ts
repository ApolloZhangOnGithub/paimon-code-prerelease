#!/usr/bin/env bun
// listen-file_recorder.ts - 音视频文件 → ASR → ear_output.jsonl
// 原 listen-file_recorder.py 的 TS 重写（运行时 Bun）。
// 支持 WAV/MP3/MP4/MOV/MKV/WEBM 等格式，视频自动用 ffmpeg 提取音频轨道。
// whisper 后端经 python3 -c 调 faster-whisper（Python 生态独有，无 TS 等价物）。

import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DoubaoTranscriber, loadConfig, readWav, type EarResult } from "./listen-doubao_client.ts";

const CTL_FILE = "/tmp/ear_control.json";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function readControl(): any {
  try { return JSON.parse(readFileSync(CTL_FILE, "utf8")); } catch { return {}; }
}

async function runDoubao(wavPath: string, outputJsonl: string, _lang: string, speed: number, chunk: number) {
  const cfg = loadConfig();
  if (!cfg.doubao_app_key) { console.error("[ear-file] doubao key missing"); return; }
  const wav = readWav(wavPath);
  const rate = wav.sampleRate;
  const totalFrames = wav.pcm.length / (wav.bits / 8) / wav.channels;

  const t = new DoubaoTranscriber(cfg.doubao_app_key, cfg.doubao_access_key);
  let count = 0;
  let fedFrames = 0;
  t.start((rec: EarResult) => {
    if (rec.text && rec.is_final) {
      const posSec = Math.round((fedFrames / rate) * 10) / 10;
      appendFileSync(outputJsonl, JSON.stringify({ ts: Date.now() / 1000, position: posSec, feed: posSec, text: rec.text, backend: "doubao" }) + "\n");
      console.log(`[${posSec.toFixed(0)}s] ${rec.text}`);
      count++;
    }
  });

  let state = "play";
  let pos = 0; // 帧
  let chunkSize = chunk; // 每次 feed 的帧数
  const bytesPerFrame = (wav.bits / 8) * wav.channels;

  while (pos < totalFrames) {
    const ctl = readControl();
    if (ctl.state === "stop") break;
    if (ctl.state === "pause") { state = "pause"; await sleep(100); continue; }
    if (ctl.state === "play") state = "play";
    // 动态调速/调块（一次性键，读完擦除）
    if (ctl.speed != null) {
      speed = Number(ctl.speed);
      delete ctl.speed; try { writeFileSync(CTL_FILE, JSON.stringify(ctl)); } catch {}
      console.error(`[ear-file] speed → ${speed}x`);
    }
    if (ctl.chunk != null) {
      chunkSize = Math.floor(Number(ctl.chunk));
      delete ctl.chunk; try { writeFileSync(CTL_FILE, JSON.stringify(ctl)); } catch {}
      console.error(`[ear-file] chunk → ${chunkSize}`);
    }
    // seek：兼容 {"seek": 秒} 和 ipod 写的 {"state":"seek","seconds":秒} 两种形式
    let seekTo: number | null = null;
    if (ctl.seek != null) seekTo = Number(ctl.seek);
    else if (ctl.state === "seek" && ctl.seconds != null) seekTo = Number(ctl.seconds);
    if (seekTo != null) {
      const np = Math.floor(seekTo * rate);
      if (np >= 0 && np < totalFrames) pos = np;
      delete ctl.seek; delete ctl.seconds;
      if (ctl.state === "seek") ctl.state = "play";
      try { writeFileSync(CTL_FILE, JSON.stringify(ctl)); } catch {}
    }
    if (state !== "play") { await sleep(100); continue; }

    const start = pos * bytesPerFrame;
    const end = Math.min(start + chunkSize * bytesPerFrame, wav.pcm.length);
    if (start >= wav.pcm.length) break;
    pos += chunkSize;
    fedFrames = pos;
    t.feed(wav.pcm.subarray(start, end));
    await sleep(100 / speed); // paced: speed up = bigger chunks + less sleep
  }
  // 喂完后等空闲收尾（idle_close → FinishSession → drain），否则最后一句结果收不到
  const deadline = Date.now() + 15000;
  while (t.active && Date.now() < deadline) await sleep(200);
  await t.stop();
  console.error(`[ear-file] done (${count} segs)`);
}

function runWhisper(wavPath: string, outputJsonl: string, lang: string, model: string) {
  // faster-whisper 是 Python 生态独有；这里把 python3 当外部工具用（如同 ffmpeg），模块内不留 .py 文件
  console.error(`[ear-file] whisper (${model})...`);
  const script = `
import json, sys, time
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[3], device="cpu", compute_type="int8")
segs, _ = m.transcribe(sys.argv[1], language=sys.argv[2], beam_size=5)
count = 0
for seg in segs:
    rec = {"ts": time.time(), "start": round(seg.start,1), "end": round(seg.end,1), "text": seg.text.strip(), "backend": "whisper"}
    open(sys.argv[4], 'a').write(json.dumps(rec, ensure_ascii=False) + "\\n")
    print(f"[{seg.start:.1f}s] {seg.text.strip()}", flush=True)
    count += 1
print(f"[ear-file] done ({count} segs)", file=sys.stderr)
`;
  execFileSync("python3", ["-c", script, wavPath, lang, model, outputJsonl], { stdio: ["ignore", "inherit", "inherit"] });
}

const MEDIA_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg", ".3gp", ".m4a", ".mp3", ".ogg", ".wma", ".aac", ".flac"]);

function isVideo(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return MEDIA_EXT.has(ext) && ext !== ".wav";
}

function extractAudio(videoPath: string): string {
  // 用 ffmpeg 提取音频为临时 WAV (16kHz mono 16bit)
  const tmp = join(tmpdir(), `ear-extract-${randomUUID()}.wav`);
  let dur = 0;
  try {
    const r = execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath], { encoding: "utf8", timeout: 10000 });
    dur = parseFloat(r.trim()) || 0;
  } catch {}
  console.error(`[ear-file] 提取音频: ${basename(videoPath)} (${dur.toFixed(0)}s) → WAV`);
  execFileSync("ffmpeg", ["-y", "-v", "quiet", "-i", videoPath, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", "-f", "wav", tmp], { timeout: 120000 });
  return tmp;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name: string, def: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { i++; continue; }
    positional.push(argv[i]);
  }
  const [mediaFile, outputJsonl] = positional;
  if (!mediaFile || !outputJsonl) { console.error("[ear-file] 缺少参数"); process.exit(2); }
  const backend = opt("backend", "doubao");
  const lang = opt("lang", "en");
  const speed = parseFloat(opt("speed", "1.0")) || 1.0;
  const chunk = parseInt(opt("chunk", "1600")) || 1600;
  const model = opt("model", "small");

  // 视频文件 → 提取音频
  let audioPath = mediaFile;
  let tmpWav: string | null = null;
  if (isVideo(mediaFile)) {
    tmpWav = extractAudio(mediaFile);
    audioPath = tmpWav;
  }

  try {
    if (backend === "whisper") runWhisper(audioPath, outputJsonl, lang, model);
    else await runDoubao(audioPath, outputJsonl, lang, speed, chunk);
  } finally {
    if (tmpWav && existsSync(tmpWav)) unlinkSync(tmpWav); // 清理自己的临时提取文件
    process.exit(0);
  }
}

main().catch(e => { console.error(`[ear-file] ${e?.message || e}`); process.exit(1); });
