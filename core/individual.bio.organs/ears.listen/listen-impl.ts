// listen-impl.ts — Ear 工具的热加载实现（纯逻辑，无副作用）
// 本文件修改后无需重启 paimon：listen.ts 用 import(?t=Date.now()) 动态加载

import { Type } from "@sinclair/typebox";
import { Text } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "listen-config.json");

// ── 状态类型 ──
export interface EarState {
  personDir: string | null;
  listening: boolean;
  recorderType: 'mic' | 'file';
  fileBackend: 'doubao' | 'whisper';
  fileSpeed: number;
}

export function initState(): EarState {
  return {
    personDir: null,
    listening: false,
    recorderType: 'mic',
    fileBackend: 'doubao',
    fileSpeed: 1.0,
  };
}

// ── Action 描述（由 shell 执行副作用） ──
export type EarAction =
  | { type: 'startRecorder', filePath?: string }
  | { type: 'stopRecorder' }
  | { type: 'startWatch' }
  | { type: 'stopWatch' }
  | { type: 'startKeepAlive' }
  | { type: 'stopKeepAlive' }
  | { type: 'writeControl', json: any };

// ── 工具参数 schema ──
export const earParamsSchema = Type.Object({
  action: Type.Optional(Type.String({ messageDescription: "on/off/file/status/pause/resume/seek/stop" })),
  path: Type.Optional(Type.String({ messageDescription: "WAV 文件路径（action=file 时必填）" })),
  backend: Type.Optional(Type.String({ messageDescription: "ASR 后端：doubao 或 whisper（action=file 时可选）" })),
  speed: Type.Optional(Type.Number({ messageDescription: "播放速度倍数 0.25-4.0（action=file 时可选，默认 1.0）" })),
  seconds: Type.Optional(Type.Number({ messageDescription: "跳转秒数（action=seek 时必填）" })),
});

// ── 渲染 ──
export function renderCall(args: any, theme: any): Text {
  const act = args?.action;
  const fpath = args?.path;
  if (act === 'on') return new Text(theme.fg("success", theme.bold("• Ear On")), 0, 0);
  if (act === 'off') return new Text(theme.fg("error", theme.bold("• Ear Off")), 0, 0);
  if (act === 'file') return new Text(theme.fg("toolTitle", theme.bold(`• Ear File: ${fpath || ''}`)), 0, 0);
  if (act === 'pause') return new Text(theme.fg("warn", theme.bold("• Ear Paused")), 0, 0);
  if (act === 'resume') return new Text(theme.fg("success", theme.bold("• Ear Resume")), 0, 0);
  if (act === 'seek') return new Text(theme.fg("toolTitle", theme.bold(`• Ear Seek: ${args?.seconds || 0}s`)), 0, 0);
  if (act === 'stop') return new Text(theme.fg("error", theme.bold("• Ear Stop")), 0, 0);
  return new Text(theme.fg("toolTitle", theme.bold("• Ear")), 0, 0);
}

// ── 配置 ──
function loadConfig(): any {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

// ── 核心执行逻辑（纯函数） ──
export interface ExecuteResult {
  content: any[];
  details?: any;
  isError?: boolean;
  newState: EarState;
  actions: EarAction[];
}

export function execute(state: EarState, params: any): ExecuteResult {
  const act = params?.action || "";
  const actions: EarAction[] = [];
  let st = { ...state };

  // ── ear on ──
  if (act === "on") {
    if (!st.personDir) return err("没有 personDir（需先 session_start）", st, actions);
    st.listening = true;
    st.recorderType = 'mic';
    actions.push({ type: 'startRecorder' });
    actions.push({ type: 'startKeepAlive' });
    actions.push({ type: 'startWatch' });
    return ok("耳朵已开启。语音输入将实时转写并注入", st, actions);
  }

  // ── ear file ──
  if (act === "file") {
    const fpath = params?.path || '';
    if (!fpath) return err("path 参数必填", st, actions);
    if (!st.personDir) return err("没有 personDir", st, actions);
    const backend = params?.backend || st.fileBackend;
    if (backend === 'whisper' || backend === 'doubao') st.fileBackend = backend;
    const speed = parseFloat(params?.speed) || 1.0;
    st.fileSpeed = Math.max(0.25, Math.min(4.0, speed));
    st.recorderType = 'file';
    actions.push({ type: 'stopRecorder' });
    actions.push({ type: 'stopKeepAlive' });
    actions.push({ type: 'stopWatch' });
    st.listening = true;
    actions.push({ type: 'startRecorder', filePath: fpath });
    actions.push({ type: 'startWatch' });
    return ok(`耳朵已开启（文件模式）：${fpath}，后端=${st.fileBackend}，速度=${st.fileSpeed}x`, st, actions);
  }

  // ── ear off ──
  if (act === "off") {
    st.listening = false;
    actions.push({ type: 'stopRecorder' });
    actions.push({ type: 'stopKeepAlive' });
    actions.push({ type: 'stopWatch' });
    return ok("耳朵已关闭", st, actions);
  }

  // ── 播放控制 ──
  if (act === "pause") {
    if (st.recorderType !== 'file') return err("仅文件模式支持暂停", st, actions);
    actions.push({ type: 'writeControl', json: { action: "pause" } });
    return ok("耳朵已暂停", st, actions);
  }
  if (act === "resume") {
    if (st.recorderType !== 'file') return err("仅文件模式支持恢复", st, actions);
    actions.push({ type: 'writeControl', json: { action: "resume" } });
    return ok("耳朵已恢复", st, actions);
  }
  if (act === "seek") {
    if (st.recorderType !== 'file') return err("仅文件模式支持跳转", st, actions);
    const sec = parseFloat(params?.seconds) || 0;
    actions.push({ type: 'writeControl', json: { action: "seek", seconds: sec } });
    return ok(`耳朵跳转到 ${sec}s`, st, actions);
  }
  if (act === "stop") {
    if (st.recorderType !== 'file') return err("仅文件模式支持停止", st, actions);
    actions.push({ type: 'writeControl', json: { action: "stop" } });
    st.listening = false;
    actions.push({ type: 'stopRecorder' });
    actions.push({ type: 'stopKeepAlive' });
    actions.push({ type: 'stopWatch' });
    return ok("耳朵已停止", st, actions);
  }

  // ── status ──
  let msg: string;
  if (st.listening) {
    msg = st.recorderType === 'file'
      ? `耳朵监听中（文件模式，${st.fileBackend}，${st.fileSpeed}x）`
      : "耳朵开启中";
  } else {
    msg = "耳朵已关闭。ear({action:'on'}) 开启";
  }
  return ok(msg, st, actions);
}

// ── session_start 逻辑 ──
export function onSessionStart(state: EarState, personDir: string | null): { newState: EarState; actions: EarAction[] } {
  if (!personDir) return { newState: state, actions: [] };
  const st = { ...state, personDir, listening: false };
  const cfg = loadConfig();
  if (cfg.asr_backend === 'whisper') st.fileBackend = 'whisper';
  return { newState: st, actions: [] };
}

// ── helpers ──
function ok(text: string, st: EarState, actions: EarAction[]): ExecuteResult {
  return { content: [{ type: "text", text }], details: {}, newState: st, actions };
}
function err(text: string, st: EarState, actions: EarAction[]): ExecuteResult {
  return { content: [{ type: "text", text: `ERR: ${text}` }], details: {}, isError: true, newState: st, actions };
}
