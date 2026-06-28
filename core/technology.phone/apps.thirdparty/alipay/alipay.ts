// apps.thirdparty/alipay/alipay.ts — 支付宝 AI付
// 对接官方 @alipay/agent-payment MCP (alipay-bot CLI)
import type { PhoneApp } from "../../system.kernel/kernel.ts";
import { execSync } from "child_process";
import { existsSync } from "fs";

import { homedir } from "node:os";
import { join } from "node:path";
const BOT = join(homedir(), ".local/bin/alipay-bot");

function bot(args: string): { ok: boolean; output: string } {
  try {
    const out = execSync(`${BOT} ${args}`, { timeout: 15000, encoding: "utf8" });
    return { ok: true, output: out.trim() };
  } catch (e: any) {
    return { ok: false, output: e.stderr || e.message || String(e) };
  }
}

function isInstalled(): boolean {
  return existsSync(BOT);
}

function genQR(url: string): string {
  try {
    return execSync(`python3 -c "
import qrcode
qr = qrcode.QRCode(border=2, box_size=1)
qr.add_data('${url}')
qr.make(fit=True)
qr.print_ascii(invert=True)
"`, { timeout: 5000, encoding: "utf8" });
  } catch {
    return "[QR码生成失败]";
  }
}

// ── PhoneApp ──────────────────────────────────────────────────
export const app: PhoneApp = {
  name: "支付宝",
  icon: "支付宝",
  messageDescription: "支付宝AI付 — 智能体支付",

  onOpen(_state) {
    if (!isInstalled()) {
      return {
        screen: [
          "═══ 支付宝 ═══",
          "",
          "  WARN: 未安装支付宝 AI付",
          "  请先运行: npx -y @alipay/agent-payment@latest install",
          "",
          "  返回 — 回主屏幕",
        ].join("\n"),
        state: _state ?? {},
      };
    }

    const wallet = bot("check-wallet");
    const lines = [
      "═══ 支付宝 AI付 ═══",
      "",
      wallet.ok ? `  ${wallet.output}` : "  WARN: 钱包未开通 — 输入「开通钱包」",
      "",
      "  操作:",
      "  · 开通钱包          — 申请开通支付宝钱包",
      "  · 钱包状态          — 查看钱包详情",
      "  · 付款 <金额> <说明> — 发起支付",
      "  · 查单 <订单号>     — 查询支付状态",
      "  · 开启支付          — 开启支付宝支付功能",
      "",
      "  返回 — 回主屏幕",
    ];
    return { screen: lines.join("\n"), state: _state ?? {} };
  },

  onAction(input, state) {
    const cmd = input.trim();

    // 开通钱包
    if (/^(开通钱包|apply)/i.test(cmd)) {
      const r = bot("apply-wallet");
      if (!r.ok) return { screen: `Error: ${r.output}`, state };
      // extract URL from output and show QR
      const urlMatch = r.output.match(/https:\/\/u\.alipay\.cn\/[^\s)]+/);
      const url = urlMatch ? urlMatch[0] : "";
      const qr = url ? genQR(url) : "";
      return {
        screen: [
          `请用支付宝扫码授权`,
          "",
          qr,
          "",
          url ? `${url}` : "",
          "",
          "扫码后输入「bind <授权码>」完成绑定",
        ].filter(Boolean).join("\n"),
        state,
      };
    }

    // 钱包状态
    if (/^(钱包|状态|check|钱包状态)/i.test(cmd)) {
      const r = bot("check-wallet");
      return { screen: r.ok ? r.output : `Error: ${r.output}`, state };
    }

    // 开启支付
    if (/^(开启支付|开启支付宝)/i.test(cmd)) {
      const lines = [
        "开启支付宝支付功能",
        "",
        "请按以下步骤操作:",
        "1. 打开支付宝 App 扫码授权",
        "2. 获取授权指令后发给我",
        "3. 我将调用 bind-wallet 完成绑定",
        "",
        "或输入「bind <授权码>」完成绑定",
      ];
      return { screen: lines.join("\n"), state };
    }

    // 绑定钱包
    if (/^bind\s+(\S+)/i.test(cmd)) {
      const code = cmd.match(/^bind\s+(\S+)/i)![1];
      const r = bot(`bind-wallet ${code}`);
      return { screen: r.ok ? `${r.output}` : `Error: ${r.output}`, state };
    }

    // 付款
    const payMatch = cmd.match(/^(?:付款|pay)\s+(\d+(?:\.\d+)?)\s*(.+)?$/i);
    if (payMatch) {
      const amount = payMatch[1];
      const desc = (payMatch[2] || "AI服务").replace(/["`$\\]/g, "");
      const r = bot(`submit-payment --amount ${amount} --desc "${desc}"`);
      return { screen: r.ok ? `${r.output}` : `Error: ${r.output}`, state };
    }

    // 查单
    const queryMatch = cmd.match(/^(?:查单|query)\s+(\S+)$/i);
    if (queryMatch) {
      const r = bot(`query-payment-status ${queryMatch[1]}`);
      return { screen: r.ok ? `${r.output}` : `Error: ${r.output}`, state };
    }

    return this.onOpen(state);
  },
};
