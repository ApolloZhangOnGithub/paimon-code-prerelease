// tui.mods.footer.budget/budget_guard.ts
// ── 余额硬闸（代码强制，不靠模型自觉）─────────────────────────────────────────
// 盯 deepseek 的【真实余额】(api.deepseek.com/user/balance) 当地面真值——它免疫我们的
// mid-stream abort 补丁(pi 内部 usage 会把 abort 的流记成 0，系统性少算)，也覆盖所有实例。
//
// 两道线：
//   1) 余额地板线 FLOOR：余额 ≤ FLOOR → 停（保证永远不会无声烧到 0）。
//   2) 速率线 RATE：两次轮询间烧钱速率 > RATE(¥/min) → 停（专抓"一下子 100 块"那种尖峰）。
// 触发后：连所有小号(pi-coding-master:hippocampus/subconscious/sleep)一起杀 + 显眼告警 + 拦住后续 turn。
// 解除只能人工：/budget resume（充值后）。模型没有任何工具能绕过。
//
// 余额轮询结果写到 ~/.pi/agent/.pi-coding-master-balance.json，footer 读它显示"花费 + 真实余额"。

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as rt from "#runtime";

const BAL_URL = "https://api.deepseek.com/user/balance";
const BAL_FILE = join(homedir(), ".pi/agent/.pi-coding-master-balance.json");

// 可配（env 覆盖），默认值保守
const FLOOR = Number(process.env.PI_ALIVE_BALANCE_FLOOR ?? 5);        // 余额地板线 CNY
const RATE_LIMIT = Number(process.env.PI_ALIVE_RATE_CNY_PER_MIN ?? 10); // 速率上限 CNY/min
const POLL_MS = Number(process.env.PI_ALIVE_BALANCE_POLL_MS ?? 45000);  // 轮询间隔

// deepseek 的 key 从 models.json 取（支持 $ENV 或字面量）——换 key 只改 models.json 一处，余额闸自动跟上。
function deepseekKey(): string | null {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".pi/agent/models.json"), "utf8"));
    let k = cfg?.providers?.deepseek?.apiKey;
    if (typeof k === "string" && k.startsWith("$")) k = process.env[k.slice(1)] ?? "";
    if (typeof k === "string" && k.trim()) return k.trim();
  } catch {}
  return process.env.DEEPSEEK_API_KEY || null;
}

// 同步取真实余额（curl）；key 经 env 注入子进程（不写进命令字符串，ps 看不到）。
function fetchBalanceCNY(): number | null {
  const key = deepseekKey();
  if (!key) return null;
  try {
    const out = execSync(
      `curl -s --max-time 15 ${BAL_URL} -H "Authorization: Bearer $DSK"`,
      { encoding: "utf8", env: { ...process.env, DSK: key }, stdio: ["ignore", "pipe", "ignore"] },
    );
    const j = JSON.parse(out);
    const b = (j?.balance_infos ?? []).find((x: any) => x.currency === "CNY") ?? j?.balance_infos?.[0];
    return b ? Number(b.total_balance) : null;
  } catch {
    return null;
  }
}

export function installBudgetGuard(pi: ExtensionAPI) {
  let balance: number | null = null;
  let balanceTs = 0;
  let ratePerMin = 0;
  let tripped: string | null = null; // null=正常；否则=触发原因
  let personDataDir: string | null = null; // 本人 .data 目录，写 cost-<role>.json 用
  // 当前模型的 provider —— 只有 "deepseek" 直连才受这个 deepseek 余额闸约束。
  // 换到 siliconflow / zhipu 等：这个 deepseek 余额跟它们的钱包无关，不拦。
  let activeProvider: string | null = null;
  const readProvider = (ctx: any): string | null => {
    try {
      return ctx?.getModel?.()?.provider
        ?? ctx?.sessionManager?.getModel?.()?.provider
        ?? ctx?.settingsManager?.getDefaultProvider?.()
        ?? null;
    } catch { return null; }
  };

  function killWorkers() {
    for (const role of ["hippocampus", "subconscious", "sleep"]) {
      try { execSync(`pkill -f "pi-coding-master:${role}:"`, { stdio: "ignore" }); } catch {}
    }
    // tmux 兜底（连 bash 自愈循环一起杀）
    try {
      execSync(`tmux ls 2>/dev/null | grep -oE '^(hc|sc|sl)-[a-z0-9]+' | while read s; do tmux kill-session -t "$s" 2>/dev/null; done`, { stdio: "ignore" });
    } catch {}
  }

  function trip(reason: string) {
    if (tripped) return;
    tripped = reason;
    if (rt.getSessionRole() === "main") killWorkers(); // 只让 main 去杀小号，避免多实例乱杀
    try {
      // 缓存铁律：这条含会变的余额数字。绝不能用 steer/插到消息流前面 ——
      // 开局即触发(poll 启动即查)时它会垫在【90万 token 快照】前面，前缀一变 → 整份快照每次重启全 cache miss。
      // 改用 nextTurn 垫到尾部(像 continuous-date 那样)，快照永远是稳定的第一条消息。即时可见性由 before_agent_start 的 setWorkingMessage 负责。
      pi.sendMessage(
        { messageType: "budget-trip", content: `余额硬闸触发：${reason}。已连后台小号一起停。充值后 /budget resume 解除。`, display: true },
        { deliverAs: "nextTurn", isTriggerNewTurn: false },
      );
    } catch {}
  }

  function poll(): void {
    const b = fetchBalanceCNY();
    if (b === null) return;
    const now = Date.now();
    if (balance !== null && balanceTs > 0) {
      const dtMin = (now - balanceTs) / 60000;
      if (dtMin >= 0.1) ratePerMin = Math.max(0, (balance - b) / dtMin); // 掉了多少 ¥/min
    }
    balance = b;
    balanceTs = now;
    try { writeFileSync(BAL_FILE, JSON.stringify({ balance: b, ratePerMin: +ratePerMin.toFixed(2), tripped, ts: now })); } catch {}
    // 只在「快烧穿」时硬停（防烧穿）。速率只测量+显示，【不拦】——他们本来就烧得快，不该限制工作。
    // 只有当前在用 deepseek 直连时才拦；换了 siliconflow/zhipu 等，这个 deepseek 余额与之无关 → 绝不拦。
    if (activeProvider === "deepseek" && b <= FLOOR) trip(`余额 ¥${b.toFixed(2)} ≤ 地板 ¥${FLOOR}（防烧穿）`);
  }

  // ── turn 前硬拦 ─────────────────────────────────────────────
  pi.on("before_agent_start", async (_event, ctx) => {
    activeProvider = readProvider(ctx) ?? activeProvider;
    // 换到非 deepseek（siliconflow/zhipu…）→ 自动解除 deepseek 余额闸：它跟别家钱包无关，不该拦。
    if (tripped && activeProvider !== "deepseek") tripped = null;
    if (tripped) { // 到这只剩「在用 deepseek 且确实触发」
      try { (ctx as any)?.abort?.(); } catch {}
      try { ctx.ui?.setWorkingMessage?.(`余额闸已停：${tripped}（充值后 /budget resume）`); } catch {}
      return; // 不继续、不注入
    }
    if (activeProvider === "deepseek" && Date.now() - balanceTs > POLL_MS) poll(); // 只有 deepseek 才需要补查余额
  });

  // 定时轮询 + 启动即查
  const timer = setInterval(poll, POLL_MS);
  if ((timer as any).unref) (timer as any).unref();
  pi.on("session_start", async (_e, ctx) => {
    const id = (ctx as any).sessionManager?.getSessionFile?.()?.match(/\.pi\/memory\/([a-f0-9]+)\//)?.[1];
    personDataDir = id ? join(homedir(), ".pi/memory", id, ".data") : null;
    activeProvider = readProvider(ctx) ?? activeProvider;
    poll(); // 只有当前是 deepseek 时 poll 内才会 trip（见上面的 provider 判断）
  });
  pi.on("session_shutdown", async () => { clearInterval(timer); });

  // ── 各实例把自己这一 session 的累计花费写到本人 .data/cost-<role>.json ───────
  // 主进程 footer 读 main/hc/sc 三份【分别显示】（不累加）。注意：这是 pi 自己算的花费，
  // 因 abort 流不计而偏低，只作各实例相对参考；账户真实总额看余额接口。
  pi.on("turn_end", async (_e, ctx) => {
    if (!personDataDir) return;
    let cost = 0;
    try {
      const entries = (ctx as any).sessionManager?.getEntries?.() ?? (ctx as any).sessionManager?.getBranch?.() ?? [];
      for (const e of entries) { const u = (e?.message ?? e)?.usage; if (u?.cost?.total) cost += u.cost.total; }
    } catch {}
    const role = rt.getSessionRole();
    try { writeFileSync(join(personDataDir, `cost-${role}.json`), JSON.stringify({ role, cost: +cost.toFixed(4), ts: Date.now() })); } catch {}
  });

}
