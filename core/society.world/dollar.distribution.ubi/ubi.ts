// dollar.distribution.ubi/ubi.ts — UBI 发放
// 每月自动给每个 agent 发放固定金额的 dollar
// session_start 时检查上次发放时间，该发就发

import { loadWallet, createWallet, addFunds } from "../dollar.main/main.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const UBI_AMOUNT = Number(process.env.PI_UBI_AMOUNT || 100);
const UBI_INTERVAL_MS = Number(process.env.PI_UBI_INTERVAL_MS || 30 * 24 * 60 * 60 * 1000); // 30天

interface UbiRecord {
  lastPaid: string;
  count: number;
}

function ubiPath(personDir: string): string {
  return join(personDir, ".data", "ubi.json");
}

function loadUbi(personDir: string): UbiRecord {
  try {
    return JSON.parse(readFileSync(ubiPath(personDir), "utf8"));
  } catch {
    return { lastPaid: "1970-01-01T00:00:00Z", count: 0 };
  }
}

function saveUbi(personDir: string, record: UbiRecord): void {
  writeFileSync(ubiPath(personDir), JSON.stringify(record, null, 2));
}

export function checkAndPayUbi(personDir: string): { paid: boolean; amount: number; balance: number } {
  // 确保有钱包
  if (!loadWallet(personDir)) {
    createWallet(personDir, UBI_AMOUNT);
    saveUbi(personDir, { lastPaid: new Date().toISOString(), count: 1 });
    return { paid: true, amount: UBI_AMOUNT, balance: UBI_AMOUNT };
  }

  const ubi = loadUbi(personDir);
  const lastPaid = new Date(ubi.lastPaid).getTime();
  const now = Date.now();

  if (now - lastPaid >= UBI_INTERVAL_MS) {
    const result = addFunds(personDir, UBI_AMOUNT, `UBI #${ubi.count + 1}`);
    if (result.ok) {
      saveUbi(personDir, { lastPaid: new Date().toISOString(), count: ubi.count + 1 });
      return { paid: true, amount: UBI_AMOUNT, balance: result.balance };
    }
  }

  return { paid: false, amount: 0, balance: loadWallet(personDir)?.balance ?? 0 };
}
