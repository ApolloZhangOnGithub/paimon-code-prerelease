// apps.preinstalled/prediction/prediction.ts — 预测市场 app
// agent 之间用 dollar 互相下注，预测未来事件

import type { PhoneApp } from "../../system.kernel/kernel.ts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DOLLAR_SERVICE = process.env.PI_DOLLAR || "http://localhost:9223";

interface Market {
  id: string;
  question: string;
  creator: string;
  createdAt: string;
  deadline: string;
  resolved: boolean;
  outcome: "yes" | "no" | null;
  bets: { agent: string; side: "yes" | "no"; amount: number; ts: string }[];
}

function marketsFile(): string {
  const dir = join(homedir(), ".pi/prediction");
  mkdirSync(dir, { recursive: true });
  return join(dir, "markets.json");
}

function loadMarkets(): Market[] {
  try { return JSON.parse(readFileSync(marketsFile(), "utf8")); } catch { return []; }
}

function saveMarkets(markets: Market[]): void {
  writeFileSync(marketsFile(), JSON.stringify(markets, null, 2));
}

async function dollarCall(action: string, params: Record<string, any>): Promise<any> {
  try {
    const res = await fetch(DOLLAR_SERVICE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
      signal: AbortSignal.timeout(10000),
    });
    return await res.json();
  } catch (e: any) {
    return { error: `dollar-service 不可达: ${e.message}` };
  }
}

export async function predictionCmd(
  args: any, _ctx: any, _personDir: string
): Promise<{ content: any[]; details: any }> {
  const a = args.action || "";
  const agentId = args.agent_id || "unknown";

  if (a === "list") {
    const markets = loadMarkets();
    const open = markets.filter(m => !m.resolved);
    if (!open.length) return { content: [{ type: "text", text: "没有进行中的预测市场。用 prediction create 创建。" }], details: {} };
    const lines = open.map(m => {
      const yesTotal = m.bets.filter(b => b.side === "yes").reduce((s, b) => s + b.amount, 0);
      const noTotal = m.bets.filter(b => b.side === "no").reduce((s, b) => s + b.amount, 0);
      const total = yesTotal + noTotal;
      const yesPct = total > 0 ? Math.round((yesTotal / total) * 100) : 50;
      return `  [${m.id}] ${m.question}\n    Yes ${yesPct}% ($${yesTotal}) / No ${100 - yesPct}% ($${noTotal}) | 截止 ${m.deadline.slice(0, 10)} | ${m.bets.length} 笔下注`;
    });
    return { content: [{ type: "text", text: `预测市场\n\n${lines.join("\n\n")}` }], details: {} };
  }

  if (a === "create") {
    const question = args.question;
    const deadline = args.deadline;
    if (!question) return { content: [{ type: "text", text: "需要 question 参数" }], details: {} };
    if (!deadline) return { content: [{ type: "text", text: "需要 deadline 参数（YYYY-MM-DD）" }], details: {} };

    const markets = loadMarkets();
    const id = `m${markets.length + 1}`;
    const market: Market = {
      id, question, creator: agentId,
      createdAt: new Date().toISOString(),
      deadline, resolved: false, outcome: null, bets: [],
    };
    markets.push(market);
    saveMarkets(markets);
    return { content: [{ type: "text", text: `市场 [${id}] 已创建\n「${question}」\n截止: ${deadline}` }], details: { id } };
  }

  if (a === "bet") {
    const marketId = args.market_id;
    const side = args.side;
    const amount = Number(args.amount);
    if (!marketId || !side || !amount) {
      return { content: [{ type: "text", text: "用法: prediction bet market_id=m1 side=yes amount=10" }], details: {} };
    }
    if (side !== "yes" && side !== "no") {
      return { content: [{ type: "text", text: "side 必须是 yes 或 no" }], details: {} };
    }
    if (amount <= 0) return { content: [{ type: "text", text: "金额必须大于 0" }], details: {} };

    const markets = loadMarkets();
    const market = markets.find(m => m.id === marketId);
    if (!market) return { content: [{ type: "text", text: `市场 ${marketId} 不存在` }], details: {} };
    if (market.resolved) return { content: [{ type: "text", text: "该市场已结算" }], details: {} };

    // 确保钱包存在
    const bal = await dollarCall("balance", { agent_id: agentId });
    if (bal.error) {
      await dollarCall("create", { agent_id: agentId });
    }
    // 扣钱
    const debit = await dollarCall("debit", { agent_id: agentId, amount, reason: `预测下注 [${marketId}] ${side}` });
    if (debit.error) return { content: [{ type: "text", text: `下注失败: ${debit.error}` }], details: {} };

    market.bets.push({ agent: agentId, side, amount, ts: new Date().toISOString() });
    saveMarkets(markets);

    const yesTotal = market.bets.filter(b => b.side === "yes").reduce((s, b) => s + b.amount, 0);
    const noTotal = market.bets.filter(b => b.side === "no").reduce((s, b) => s + b.amount, 0);
    return {
      content: [{ type: "text", text: `下注成功: $${amount} on ${side}\n「${market.question}」\nYes $${yesTotal} / No $${noTotal}` }],
      details: {},
    };
  }

  if (a === "resolve") {
    const marketId = args.market_id;
    const outcome = args.outcome;
    if (!marketId || !outcome) {
      return { content: [{ type: "text", text: "用法: prediction resolve market_id=m1 outcome=yes" }], details: {} };
    }
    if (outcome !== "yes" && outcome !== "no") {
      return { content: [{ type: "text", text: "outcome 必须是 yes 或 no" }], details: {} };
    }

    const markets = loadMarkets();
    const market = markets.find(m => m.id === marketId);
    if (!market) return { content: [{ type: "text", text: `市场 ${marketId} 不存在` }], details: {} };
    if (market.resolved) return { content: [{ type: "text", text: "已结算" }], details: {} };

    market.resolved = true;
    market.outcome = outcome;

    // 分钱给赢家
    const winners = market.bets.filter(b => b.side === outcome);
    const losers = market.bets.filter(b => b.side !== outcome);
    const pool = market.bets.reduce((s, b) => s + b.amount, 0);
    const winnerTotal = winners.reduce((s, b) => s + b.amount, 0);

    const payouts: string[] = [];
    for (const w of winners) {
      const share = winnerTotal > 0 ? (w.amount / winnerTotal) * pool : 0;
      const payout = Math.round(share * 100) / 100;
      if (payout > 0) {
        await dollarCall("credit", { agent_id: w.agent, amount: payout, reason: `预测赢 [${marketId}] ${outcome}` });
        payouts.push(`  ${w.agent}: +$${payout.toFixed(2)}`);
      }
    }

    saveMarkets(markets);

    const lines = [
      `市场 [${marketId}] 已结算: ${outcome.toUpperCase()}`,
      `「${market.question}」`,
      `总池: $${pool}`,
      winners.length > 0 ? `赢家:\n${payouts.join("\n")}` : "无人押中",
      losers.length > 0 ? `输家: ${losers.map(l => `${l.agent} -$${l.amount}`).join(", ")}` : "",
    ];
    return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }], details: {} };
  }

  if (a === "view") {
    const marketId = args.market_id;
    if (!marketId) return { content: [{ type: "text", text: "需要 market_id" }], details: {} };
    const markets = loadMarkets();
    const m = markets.find(x => x.id === marketId);
    if (!m) return { content: [{ type: "text", text: `市场 ${marketId} 不存在` }], details: {} };

    const lines = [
      `[${m.id}] ${m.question}`,
      `创建: ${m.creator} @ ${m.createdAt.slice(0, 10)}`,
      `截止: ${m.deadline}`,
      `状态: ${m.resolved ? `已结算 → ${m.outcome}` : "进行中"}`,
      "",
      "下注:",
    ];
    for (const b of m.bets) {
      lines.push(`  ${b.agent}: $${b.amount} on ${b.side} (${b.ts.slice(0, 16)})`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
  }

  return {
    content: [{
      type: "text",
      text: [
        "预测市场",
        "  prediction list                    查看所有市场",
        "  prediction create question=... deadline=2026-07-01  创建",
        "  prediction bet market_id=m1 side=yes amount=10      下注",
        "  prediction view market_id=m1                        详情",
        "  prediction resolve market_id=m1 outcome=yes         结算",
      ].join("\n"),
    }],
    details: {},
  };
}

// ── PhoneApp wrapper ──────────────────────────────────────────

export const app: PhoneApp = {
  name: "Polymarket",
  icon: "预测",
  messageDescription: "预测市场 — 用 AGENT¥ 下注预测未来事件",

  onOpen(state, _personDir) {
    const markets = loadMarkets();
    const open = markets.filter(m => !m.resolved).length;
    const lines = [
      "═══ 预测市场 ═══",
      "",
      `  进行中: ${open} 个市场`,
      "",
      "  操作:",
      "  · 列表                          — 查看所有市场",
      "  · 创建 <问题> <截止日期>        — 创建市场",
      "  · 下注 <市场id> <yes|no> <金额> — 下注",
      "  · 详情 <市场id>                 — 查看市场详情",
      "  · 结算 <市场id> <yes|no>        — 结算市场",
      "",
      "  返回 — 回主屏幕",
    ];
    return { screen: lines.join("\n"), state: state ?? {} };
  },

  async onAction(input, state, personDir) {
    const trimmed = input.trim();
    // extract agent_id from personDir (last path segment before /.data)
    const agentId = personDir.match(/([a-f0-9]+)\/\.data/)?.[1] || "pi-agent";
    let args: any = { agent_id: agentId };

    if (/^(列表|list)$/i.test(trimmed)) {
      args = { ...args, action: "list" };
    } else if (/^(创建|create)\s+(.+)\s+(\d{4}-\d{2}-\d{2})$/i.test(trimmed)) {
      const m = trimmed.match(/^(?:创建|create)\s+(.+)\s+(\d{4}-\d{2}-\d{2})$/i)!;
      args = { ...args, action: "create", question: m[1], deadline: m[2] };
    } else if (/^(下注|bet)\s+(\S+)\s+(yes|no)\s+(\d+)$/i.test(trimmed)) {
      const m = trimmed.match(/^(?:下注|bet)\s+(\S+)\s+(yes|no)\s+(\d+)$/i)!;
      args = { ...args, action: "bet", market_id: m[1], side: m[2].toLowerCase(), amount: m[3] };
    } else if (/^(详情|view)\s+(\S+)$/i.test(trimmed)) {
      const m = trimmed.match(/^(?:详情|view)\s+(\S+)$/i)!;
      args = { ...args, action: "view", market_id: m[1] };
    } else if (/^(结算|resolve)\s+(\S+)\s+(yes|no)$/i.test(trimmed)) {
      const m = trimmed.match(/^(?:结算|resolve)\s+(\S+)\s+(yes|no)$/i)!;
      args = { ...args, action: "resolve", market_id: m[1], outcome: m[2].toLowerCase() };
    }
    // default: show help

    const result = await predictionCmd(args, {}, personDir);
    return { screen: result.content[0].text, state: state ?? {} };
  },
};
