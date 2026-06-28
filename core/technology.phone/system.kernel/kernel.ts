// system.kernel/kernel.ts - 手机内核 // 2026-06-20-0841
// 唯一注册的 tool: phone。状态机 + app 路由 + 通知 + 提醒检查。
// 所有 app 通过 registerApp() 接入，不需要 manifest。

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadReminders, isOverdue, needsNudge } from "../apps.preinstalled/reminder/reminder.ts";
import { registerTerminal } from "../../god.pi.mod/tui.variants.userterminal/user_terminal.ts";
import path from "node:path";
import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { personDataDir as getPersonDir } from "../../god.pi.mod/paths.ts";
import { fileURLToPath } from "node:url";

// ── App 接口 ──

export interface PhoneApp {
  name: string;
  icon: string;
  messageDescription: string;
  onOpen(state: any, personDir: string): { screen: string; state: any };
  onAction(input: string, state: any, personDir: string): Promise<{ screen: string; state: any }> | { screen: string; state: any };
}

// ── 状态 ──

interface PhoneState {
  currentApp: string | null;
  appStates: Record<string, any>;
  notifications: string[];
}

const state: PhoneState = {
  currentApp: null,
  appStates: {},
  notifications: [],
};

const apps: Map<string, PhoneApp> = new Map();

// ── App 注册 ──

export function registerApp(app: PhoneApp) {
  apps.set(app.name, app);
}

// ── 通知 ──

export function pushNotification(text: string) {
  state.notifications.push(text);
  if (state.notifications.length > 50) state.notifications.shift();
}

// ── 屏幕渲染 ──

function renderHome(): string {
  const lines = ["═══ 手机主屏幕 ═══", ""];
  for (const app of apps.values()) {
    lines.push(`  ${app.name} - ${app.messageDescription}`);
  }
  if (state.notifications.length > 0) {
    lines.push("");
    lines.push(`  ${state.notifications.length} 条通知`);
  }
  lines.push("");
  lines.push("操作: 输入 app 名字打开 | 「通知」查看通知 | 「锁屏」锁定");
  return lines.join("\n");
}

function renderNotifications(): string {
  const lines = ["═══ 通知中心 ═══", ""];
  if (state.notifications.length === 0) {
    lines.push("  (无通知)");
  } else {
    for (const n of state.notifications.slice(-10)) {
      lines.push(`  · ${n}`);
    }
  }
  lines.push("");
  lines.push("操作: 「返回」回主屏幕");
  return lines.join("\n");
}

// ── 输入路由 ──

function findApp(input: string): PhoneApp | null {
  const lower = input.toLowerCase().trim();
  for (const [, app] of apps) {
    if (lower === app.name.toLowerCase() || lower === app.icon || input.includes(app.name)) {
      return app;
    }
  }
  return null;
}

function isBack(input: string): boolean {
  return /^(返回|back|主页|home|退出|exit|主屏幕)$/i.test(input.trim());
}

async function handleInput(input: string, personDir: string): Promise<string> {
  const trimmed = input.trim();

  if (isBack(trimmed)) {
    state.currentApp = null;
    return renderHome();
  }

  if (/^(通知|notifications?)$/i.test(trimmed)) {
    state.currentApp = null;
    return renderNotifications();
  }

  if (/^(锁屏|lock)$/i.test(trimmed)) {
    state.currentApp = null;
    return "手机已锁定。再次使用 phone 解锁。";
  }

  if (state.currentApp) {
    const app = apps.get(state.currentApp);
    if (!app) { state.currentApp = null; return renderHome(); }
    const appState = state.appStates[state.currentApp] ?? {};
    const result = await app.onAction(trimmed, appState, personDir);
    state.appStates[state.currentApp] = result.state;
    return result.screen;
  }

  const app = findApp(trimmed);
  if (app) {
    state.currentApp = app.name;
    const appState = state.appStates[app.name] ?? {};
    const result = app.onOpen(appState, personDir);
    state.appStates[app.name] = result.state;
    return result.screen;
  }

  return renderHome() + "\n\n没有找到「" + trimmed + "」，请从上面选择一个 app。";
}

// ── 入口 ──

export default function (pi: ExtensionAPI) {
  let personDir: string | null = null;
  let registered = false;

  pi.on("session_start", async (_event, ctx) => {
    // if (registered) return; // 调试：允许重注册，打 jiti 缓存绕过
    const sf = (ctx as any).sessionManager?.getSessionFile?.();
    if (!sf) return;
    personDir = getPersonDir(sf);
    if (!personDir) return;

    // ── 注册 phone tool（唯一入口）──
    pi.registerTool({
      name: "phone",
      label: "Phone",
      messageDescription: "手机 - 打开查看主屏幕，输入 app 名字打开应用，在应用内操作",
      promptSnippet: "Use your phone: open apps, check notifications, play games, browse web",
      parameters: {
        type: "object" as any,
        properties: {
          input: { type: "string", messageDescription: "操作内容（app名/动作/返回）。空=查看当前屏幕" },
        },
      },
      async execute(_id: string, args: any) {
        const input = String(args?.input ?? "").trim();
        if (!input) {
          if (state.currentApp) {
            const app = apps.get(state.currentApp);
            if (app) {
              const result = app.onOpen(state.appStates[state.currentApp] ?? {}, personDir!);
              return { content: [{ type: "text", text: result.screen }], details: {} };
            }
          }
          return { content: [{ type: "text", text: renderHome() }], details: {} };
        }
        const screen = await handleInput(input, personDir!);
        return { content: [{ type: "text", text: screen }], details: {} };
      },
    });

    // ── 终端工具 ──
    registerTerminal(pi);

    // ── App 自动发现：扫描 apps.* 目录，导入所有导出 app 的模块 ──
    const phoneDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    for (const tier of ["apps.preinstalled", "apps.system", "apps.thirdparty"]) {
      const tierDir = path.join(phoneDir, tier);
      if (!existsSync(tierDir)) continue;
      for (const appFolder of readdirSync(tierDir)) {
        if (appFolder.endsWith(".FUTURE")) continue;
        const appDir = path.join(tierDir, appFolder);
        try {
          const candidates = readdirSync(appDir).filter((f: string) => f.endsWith(".ts") && !f.includes(".SPEC") && !f.includes(".CHANGELOG"));
          for (const file of candidates) {
            try {
              const mod = await import(path.join(appDir, file) + `?t=${Date.now()}`);
              if (mod.app && mod.app.name && mod.app.onOpen && mod.app.onAction) {
                registerApp(mod.app);
                break;
              }
            } catch {}
          }
        } catch {}
      }
    }

    // ── /phone-reload 热重载 App ──
    const reloadApps = async () => {
      for (const tier of ["apps.preinstalled", "apps.system", "apps.thirdparty"]) {
        const tierDir = path.join(phoneDir, tier);
        if (!existsSync(tierDir)) continue;
        for (const appFolder of readdirSync(tierDir)) {
          if (appFolder.endsWith(".FUTURE")) continue;
          const appDir = path.join(tierDir, appFolder);
          try {
            const candidates = readdirSync(appDir).filter((f: string) => f.endsWith(".ts") && !f.includes(".SPEC") && !f.includes(".CHANGELOG"));
            for (const file of candidates) {
              try {
                const mod = await import(path.join(appDir, file) + `?t=${Date.now()}`);
                if (mod.app && mod.app.name && mod.app.onOpen && mod.app.onAction) {
                  registerApp(mod.app);
                  break;
                }
              } catch {}
            }
          } catch {}
        }
      }
      };
    // phone-reload 命令已移除(v0.2 命令精简)

  // ── 提醒检查（before_agent_start 主动推送）──
    pi.on("before_agent_start", async () => {
      if (!personDir) return;
      try {
        const reminders = loadReminders(personDir);
        const overdue = reminders.filter((r: any) => isOverdue(r) && !r.completed);
        const nudges = reminders.filter((r: any) => needsNudge(r) && !r.completed);
        const seen = new Set<string>();
        const critical = [...overdue, ...nudges].filter((r: any) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

        if (critical.length > 0) {
          const lines = ["**Reminder Check**"];
          for (const r of critical.slice(0, 3)) {
            const status = isOverdue(r) ? "OVERDUE" : "nudge";
            lines.push(`  ${status}: **${r.title}**${r.due ? ` (due ${r.due.slice(0, 16)})` : ""}`);
            if (needsNudge(r)) {
              const reminders2 = loadReminders(personDir);
              const target = reminders2.find((x: any) => x.id === r.id);
              if (target) {
                target.lastNudged = new Date().toISOString();
                writeFileSync(path.join(personDir, "reminders.json"), JSON.stringify(reminders2, null, 2));
              }
            }
          }
          if (critical.length > 3) lines.push(`  ... and ${critical.length - 3} more`);
          pi.sendMessage({
            messageType: "reminder-check",
            content: lines.join("\n"),
            display: true,
          }, { deliverAs: "followUp", isTriggerNewTurn: false });
        }
      } catch {}
    });
  });
}
