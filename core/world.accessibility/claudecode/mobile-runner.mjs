// mobile-runner.mjs — mobile CLI 核心逻辑
// Claude Code 和 paimon 共用。通过 mobile-cli.sh 调用。
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || "/tmp";
const EXT_DIR = path.join(HOME, ".local/lib/paimon/extensions/paimon-code/technology.local.mobile");
const STATE_FILE = path.join(HOME, ".paimon/mobile-cli-state.json");
const PERSON_DIR = path.join(HOME, ".paimon/MemoryData/mobile-cli");
const input = process.argv.slice(2).join(" ").trim();

let state = { currentApp: null, appStates: {} };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch(e) { try { require("fs").appendFileSync("/tmp/paimon-catch-errors.log", "[B0001] " + (e?.stack||e) + "\n"); } catch {} }
fs.mkdirSync(PERSON_DIR, { recursive: true });

const PF_MOBILE = path.join(HOME, ".paimon/ProgramFiles/Mobile");

async function loadApps() {
  const apps = new Map();
  if (!fs.existsSync(PF_MOBILE)) return apps;
  let folders;
  try { folders = fs.readdirSync(PF_MOBILE); } catch { return apps; }
  for (const folder of folders) {
    if (folder.startsWith(".") || folder.startsWith("@FUTURE.") || folder.startsWith("@removed.")) continue;
    const appDir = path.join(PF_MOBILE, folder);
    try { if (!fs.statSync(appDir).isDirectory()) continue; } catch { continue; }
    const files = fs.readdirSync(appDir).filter(f =>
      f.endsWith(".ts") && !f.includes(".SPEC") && !f.includes(".CHANGELOG") && !f.includes(".test") && !f.includes("test.ts")
    );
    for (const file of files) {
      try {
        const mod = await import(path.join(appDir, file));
        if (mod.app?.name && mod.app.onOpen && mod.app.onAction) {
          apps.set(mod.app.name, mod.app);
          break;
        }
      } catch (e) {
        // app import failed — skip silently
      }
    }
  }
  return apps;
}

function findApp(apps, s) {
  const l = s.toLowerCase().trim();
  for (const [, a] of apps) {
    if (l === a.name.toLowerCase() || l === a.icon.toLowerCase()) return a;
  }
  return null;
}

function renderHome(apps) {
  const lines = ["\x1b[1m═══ 手机主屏幕 ═══\x1b[0m", ""];
  for (const a of apps.values()) {
    lines.push(`  \x1b[36m${a.name}\x1b[0m — ${a.messageDescription || ""}`);
  }
  lines.push("", "  输入 app 名字打开 | 输入「返回」回主屏幕");
  return lines.join("\n");
}

function save() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function checkUnread() {
  try {
    const { checkUnreadMessages } = await import(path.join(EXT_DIR, "system.notifications/notifications.ts"));
    const result = await checkUnreadMessages();
    if (!result || !result.count) return "";
    const text = result.last.text.length > 30 ? result.last.text.slice(0, 30) + "…" : result.last.text;
    return `\x1b[43m\x1b[30m ${result.count}条未读 \x1b[0m \x1b[33m${result.last.from}: ${text}\x1b[0m\n`;
  } catch { return ""; }
}

const apps = await loadApps();
const notif = await checkUnread();
let screen;

if (!input) {
  if (state.currentApp) {
    const a = apps.get(state.currentApp);
    if (a) {
      const r = await a.onOpen(state.appStates[state.currentApp] || {}, PERSON_DIR);
      state.appStates[state.currentApp] = r.state;
      screen = `[\x1b[33m${a.name}\x1b[0m]\n${r.screen}`;
    } else {
      state.currentApp = null;
      screen = renderHome(apps);
    }
  } else {
    screen = renderHome(apps);
  }
} else if (/^(返回|back|home|主屏幕|exit)$/i.test(input)) {
  state.currentApp = null;
  screen = renderHome(apps);
} else {
  // 当前 app 内先检查是否切 app
  if (state.currentApp) {
    const sw = findApp(apps, input);
    if (sw && sw.name !== state.currentApp) {
      state.currentApp = sw.name;
      const r = await sw.onOpen(state.appStates[sw.name] || {}, PERSON_DIR);
      state.appStates[sw.name] = r.state;
      screen = `[\x1b[33m${sw.name}\x1b[0m]\n${r.screen}`;
    } else {
      const a = apps.get(state.currentApp);
      if (a) {
        const r = await a.onAction(input, state.appStates[state.currentApp] || {}, PERSON_DIR);
        state.appStates[state.currentApp] = r.state;
        screen = `[\x1b[33m${a.name}\x1b[0m]\n${r.screen}`;
      }
    }
  }
  if (!screen) {
    const a = findApp(apps, input);
    if (a) {
      state.currentApp = a.name;
      const r = await a.onOpen(state.appStates[a.name] || {}, PERSON_DIR);
      state.appStates[a.name] = r.state;
      screen = `[\x1b[33m${a.name}\x1b[0m]\n${r.screen}`;
    } else {
      screen = renderHome(apps) + `\n\n没有找到「${input}」`;
    }
  }
}

console.log((notif && state.currentApp !== "WeChat" ? notif : "") + screen);
save();
