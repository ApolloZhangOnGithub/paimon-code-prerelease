// dollar.transaction/transaction.ts — 转账、支付、余额查询
// 注册为 tool 让 agent 可以查余额和看交易记录，但不能直接改余额

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getBalance, getTxLog, loadWallet } from "../dollar.main/main.ts";
import { homedir } from "node:os";
import { join } from "node:path";

function getPersonDir(ctx: any): string | null {
  const sf = ctx?.sessionManager?.getSessionFile?.();
  const match = sf?.match(/\.pi\/memory\/([a-f0-9]+)\//);
  return match ? join(homedir(), ".pi/memory", match[1]) : null;
}

export function installDollarTools(pi: ExtensionAPI): void {
  // 查余额（agent 可用）
  pi.registerTool({
    name: "wallet",
    label: "Wallet",
    messageDescription: "查看钱包余额和交易记录",
    promptSnippet: "Check your wallet balance and transaction history",
    parameters: {
      type: "object" as any,
      properties: {
        action: { type: "string", messageDescription: "balance(余额) | history(交易记录) | info(钱包详情)" },
      },
    },
    async execute(_id: string, args: any) {
      // personDir 从工具上下文拿不到，用模块级变量
      if (!_personDir) return { content: [{ type: "text", text: "无法确定身份" }], details: {} };
      const action = args?.action || "balance";

      if (action === "balance") {
        const b = getBalance(_personDir);
        return { content: [{ type: "text", text: `余额: $${b.toFixed(2)}` }], details: { balance: b } };
      }

      if (action === "history") {
        const txs = getTxLog(_personDir, 15);
        if (!txs.length) return { content: [{ type: "text", text: "暂无交易记录" }], details: {} };
        const lines = txs.map(tx => {
          const sign = tx.type === "credit" || tx.type === "transfer_in" ? "+" : "-";
          return `  ${tx.ts?.slice(0, 16)} ${sign}$${tx.amount.toFixed(2)} → $${tx.balance.toFixed(2)}  ${tx.reason}`;
        });
        return { content: [{ type: "text", text: `交易记录:\n${lines.join("\n")}` }], details: {} };
      }

      if (action === "info") {
        const w = loadWallet(_personDir);
        if (!w) return { content: [{ type: "text", text: "没有钱包" }], details: {} };
        return {
          content: [{
            type: "text",
            text: `钱包详情\n  余额: $${w.balance.toFixed(2)}\n  累计收入: $${w.totalEarned.toFixed(2)}\n  累计支出: $${w.totalSpent.toFixed(2)}\n  创建: ${w.createdAt.slice(0, 10)}\n  最后交易: ${w.lastTx.slice(0, 16)}`,
          }],
          details: {},
        };
      }

      return { content: [{ type: "text", text: "用法: wallet balance | history | info" }], details: {} };
    },
  });

  // wallet 命令已移除(v0.2 命令精简)

  // 记录 personDir
  let _personDir: string | null = null;
  pi.on("session_start", async (_event: any, ctx: any) => {
    _personDir = getPersonDir(ctx);
  });
}
