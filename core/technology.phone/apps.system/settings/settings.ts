import { asyncShSafe } from "#sh";
import * as fs from "fs";
import * as path from "path";
import type { PhoneApp } from "../../system.kernel/kernel.ts";
import { getRegion, setRegion } from "../../apps.preinstalled/calendar/holiday-calendar.ts";

// apps.system/settings/settings.ts — 系统设置
async function getPiVersion(): Promise<string> {
  const raw = await asyncShSafe("node -e 'console.log(require(\"@earendil-works/pi-coding-agent/package.json\").version)'", 3000);
  return raw.trim() || "?";
}

function loadCostTotal(personDir: string): { main: number; hippocampus: number; subconscious: number; total: number; sessions: number } {
  const f = path.join(personDir, "cost_total.json");
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return { main: 0, hippocampus: 0, subconscious: 0, total: 0, sessions: 0 }; }
}

function loadCostCurrent(personDir: string, role: string): number {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(personDir, `cost-${role}.json`), "utf8"));
    return d.cost || 0;
  } catch { return 0; }
}

export async function settingsCmd(args: any, _ctx: any, personDir: string): Promise<{ content: any[]; details: any }> {
  const a = args.action || "";
  if (a === "status") {
    const piVer = await getPiVersion();
    const costTotal = loadCostTotal(personDir);
    const costCurr = {
      main: loadCostCurrent(personDir, "main"),
      hippocampus: loadCostCurrent(personDir, "hippocampus"),
      subconscious: loadCostCurrent(personDir, "subconscious"),
    };
    costCurr.total = costCurr.main + costCurr.hippocampus + costCurr.subconscious;

    const info = {
      platform: process.platform,
      arch: process.arch,
      pi: piVer,
      node: process.version,
      cwd: process.cwd(),
      uptime: Math.floor(process.uptime()),
      costCurrent: costCurr,
      costTotal,
    };

    const lines = [
      `平台: ${info.platform}/${info.arch}`,
      `pi: v${info.pi}`,
      `Node: ${info.node}`,
      `运行时间: ${info.uptime}s`,
      ``,
      `--- 费用 ---`,
      `当前会话: $${costCurr.total.toFixed(4)}`,
      `  主意识: $${costCurr.main.toFixed(4)}`,
      `  海马体: $${costCurr.hippocampus.toFixed(4)}`,
      `  潜意识: $${costCurr.subconscious.toFixed(4)}`,
      `累计(全部会话): $${costTotal.total.toFixed(4)} (${costTotal.sessions}次会话)`,
    ];

    return { content: [{ type: "text", text: lines.join("\n") }], details: info };
  }
  if (a === "region" || a === "地区") {
    const current = getRegion(personDir);
    const lines = [
      `**地区设置**`,
      "",
      `当前: ${current === "CN" ? "中国" : "美国"}`,
      "",
      "切换: 地区 中国 | 地区 美国",
      "",
      "地区决定日历中显示的节假日。",
      "中国: 春节、清明、端午、中秋、国庆等",
      "美国: New Year, Independence Day, Thanksgiving, Christmas 等",
    ];
    return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
  }

  if (a === "地区 中国" || a === "region CN" || a === "region cn") {
    setRegion(personDir, "CN");
    return { content: [{ type: "text", text: "地区已切换为 **中国**。日历将显示中国节假日。" }], details: {} };
  }
  if (a === "地区 美国" || a === "region US" || a === "region us") {
    setRegion(personDir, "US");
    return { content: [{ type: "text", text: "地区已切换为 **美国**。日历将显示美国节假日。" }], details: {} };
  }

  return { content: [{ type: "text", text: `未知操作: ${a}。可用: status | 地区 | 地区 中国 | 地区 美国` }], details: {} };
}

// ── PhoneApp ──────────────────────────────────────────────────
export const app: PhoneApp = {
  name: "设置",
  icon: "设置",
  messageDescription: "系统设置与状态",
  onOpen(_state, personDir) {
    const region = getRegion(personDir);
    const regionLabel = region === "US" ? "美国" : "中国";
    return {
      screen: [
        "设置",
        "",
        `地区: ${regionLabel}`,
        "",
        "命令:",
        "  状态         — 查看系统状态与费用",
        "  地区         — 查看地区设置",
        "  地区 中国    — 切换到中国节假日",
        "  地区 美国    — 切换到美国节假日",
      ].join("\n"),
      state: _state ?? {},
    };
  },
  async onAction(input, state, personDir) {
    const trimmed = input.trim();
    let action = trimmed;
    if (trimmed === "状态") action = "status";
    else if (trimmed === "地区") action = "region";
    else if (trimmed === "地区 中国" || trimmed === "地区中国") action = "地区 中国";
    else if (trimmed === "地区 美国" || trimmed === "地区美国") action = "地区 美国";

    const result = await settingsCmd({ action }, {}, personDir);
    return { screen: result.content[0].text, state };
  },
};
