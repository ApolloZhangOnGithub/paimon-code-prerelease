#!/usr/bin/env node
// laptop-cli.mjs — Claude Code 接入 paimon laptop 内核
// 用法: node laptop-cli.mjs [input]
// 例:   node laptop-cli.mjs                          → 看桌面
//       node laptop-cli.mjs 'click Dock:+Terminal'   → 开终端
//       node laptop-cli.mjs 'type W1:"ls"'           → 输入命令
//       node laptop-cli.mjs 'press W1:Enter'         → 执行
//
// 不改 laptop 内核任何代码。状态持久化在 STATE_FILE,跨调用保持。

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const __dir = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(__dir, "../..");
const STATE_FILE = join(process.env.HOME || "/tmp", ".paimon/accessibility/laptop-state.json");
const WORKSPACE = join(process.env.HOME || "/tmp", ".paimon/accessibility/laptop-workspace");

// 确保目录存在
mkdirSync(dirname(STATE_FILE), { recursive: true });
mkdirSync(WORKSPACE, { recursive: true });

// 动态 import laptop 内核
const mod = await import(join(CORE, "technology.local.laptop/system.kernel/kernel.ts"));
const laptopInit = mod.default;

// 最小 ExtensionAPI mock — 只实现 laptop 内核用到的接口
const tools = {};
const listeners = {};
const pi = {
  registerTool(t) { tools[t.name] = t; },
  on(event, fn) { if (!listeners[event]) listeners[event] = []; listeners[event].push(fn); },
  sendMessage() {},
  registerMessageRenderer() {},
};

laptopInit(pi);

// laptop 内核从 sessionFile 路径正则提取 8 字符 hex 作为 ID,
// 然后用 runtimeCacheDir(id) 读写状态。
// 我们只需要路径里包含一个合法 hex ID,不需要真的创建 session。
const FAKE_SID = "a11ac1a0";
const RUNTIME_DIR = join(process.env.HOME || "/tmp", ".paimon/RuntimeCache", FAKE_SID);
mkdirSync(RUNTIME_DIR, { recursive: true });
// sessionFile 只是给正则提取 ID 用的虚拟路径,不需要真实存在
const sessionFile = join(process.env.HOME || "/tmp", `.paimon/accessibility/${FAKE_SID}/session.jsonl`);

const mockCtx = {
  sessionManager: { getSessionFile: () => sessionFile },
};

// 触发 session_start (加载状态、设置工作区)
for (const fn of (listeners["session_start"] || [])) {
  await fn({}, mockCtx);
}

// 执行
const input = process.argv.slice(2).join(" ").trim();
const result = await tools["laptop"].execute("cli", { input });
const screen = result?.content?.[0]?.text || "(no output)";
console.log(screen);
