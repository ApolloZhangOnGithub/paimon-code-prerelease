// god.technology/phone/phone.ts
// ── 人类手机 TUI ──────────────────────────────────────────────────────────
// 给造物主（人类用户）直接操作手机的 TUI 界面。
// 和 agent 的手机 (technology.local.mobile) 共享 app 代码，但数据独立。
//
// 数据存储: ~/.paimon/UserAccount/phone/
// 启动方式: paimon --phone (god.cli/launcher.sh 路由到这里)
//
// 架构:
//   agent 手机: technology.local.mobile/ → pi.registerTool("mobile") → agent 通过 tool_use 操作
//   人类手机: god.technology/phone/      → 独立 TUI 进程 → 人类直接交互
//   两者共享: technology.local.mobile/apps/* 的 app 代码
//   两者独立: 数据目录不同（agent 按 personId，人类在 UserAccount）

import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const PHONE_DATA = join(homedir(), ".paimon/UserAccount/phone");

// 确保数据目录
if (!existsSync(PHONE_DATA)) mkdirSync(PHONE_DATA, { recursive: true });

// ── App 注册表 ──
interface PhoneApp {
  name: string;
  icon: string;
  handler: (input: string, dataDir: string) => Promise<string>;
}

const apps: Map<string, PhoneApp> = new Map();

export function registerApp(app: PhoneApp) {
  apps.set(app.name, app);
}

// ── 主屏渲染 ──
function renderHome(): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("  Phone (Human)");
  lines.push("  " + "-".repeat(40));
  let col = 0;
  let row = "";
  for (const [name, app] of apps) {
    row += `  ${app.icon} ${name.padEnd(14)}`;
    col++;
    if (col >= 3) {
      lines.push(row);
      row = "";
      col = 0;
    }
  }
  if (row) lines.push(row);
  lines.push("");
  lines.push("  Type app name to open, 'q' to quit");
  return lines.join("\n");
}

// ── 交互循环 ──
export async function runPhoneTUI() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => new Promise<string>(resolve => rl.question("phone> ", resolve));

  // 加载 apps（从 technology.local.mobile/apps/ 共享代码）
  // 具体 app 注册在这里按需 import
  console.log(renderHome());

  while (true) {
    const input = await prompt();
    const trimmed = input.trim().toLowerCase();

    if (trimmed === "q" || trimmed === "quit" || trimmed === "exit") {
      rl.close();
      break;
    }

    if (trimmed === "" || trimmed === "home") {
      console.log(renderHome());
      continue;
    }

    // 解析: "appname input" 或 "appname"
    const spaceIdx = trimmed.indexOf(" ");
    const appName = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
    const appInput = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1) : "";

    const app = apps.get(appName);
    if (!app) {
      console.log(`  App "${appName}" not found. Type 'home' to see available apps.`);
      continue;
    }

    const appDataDir = join(PHONE_DATA, appName);
    if (!existsSync(appDataDir)) mkdirSync(appDataDir, { recursive: true });

    try {
      const result = await app.handler(appInput, appDataDir);
      if (result) console.log(result);
    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
    }
  }
}

// 直接运行
if (import.meta.url === `file://${process.argv[1]}`) {
  runPhoneTUI();
}
