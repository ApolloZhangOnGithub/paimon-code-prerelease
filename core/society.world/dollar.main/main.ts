// dollar.main/main.ts — 世界货币系统核心
// 钱包管理、余额查询、签名校验
// 模型不能直接改余额——所有修改走 dollar.transaction，签名防篡改

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const SECRET = process.env.PI_DOLLAR_SECRET || "";

export interface Wallet {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  createdAt: string;
  lastTx: string;
  hash: string;
}

function computeHash(w: Omit<Wallet, "hash">): string {
  const payload = `${w.balance}:${w.totalEarned}:${w.totalSpent}:${w.lastTx}:${SECRET}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function walletPath(personDir: string): string {
  return join(personDir, ".data", "wallet.json");
}

export function loadWallet(personDir: string): Wallet | null {
  try {
    const raw = JSON.parse(readFileSync(walletPath(personDir), "utf8"));
    const expected = computeHash(raw);
    if (raw.hash !== expected) return null;
    return raw;
  } catch { return null; }
}

export function createWallet(personDir: string, initialBalance: number = 0): Wallet {
  const now = new Date().toISOString();
  const w: Omit<Wallet, "hash"> = {
    balance: initialBalance,
    totalEarned: initialBalance,
    totalSpent: 0,
    createdAt: now,
    lastTx: now,
  };
  const wallet: Wallet = { ...w, hash: computeHash(w) };
  mkdirSync(join(personDir, ".data"), { recursive: true });
  writeFileSync(walletPath(personDir), JSON.stringify(wallet, null, 2));
  return wallet;
}

export function saveWallet(personDir: string, wallet: Wallet): void {
  const { hash: _, ...rest } = wallet;
  const signed: Wallet = { ...rest, hash: computeHash(rest) };
  writeFileSync(walletPath(personDir), JSON.stringify(signed, null, 2));
}

export function getBalance(personDir: string): number {
  const w = loadWallet(personDir);
  return w?.balance ?? 0;
}

export function addFunds(personDir: string, amount: number, reason: string): { ok: boolean; balance: number; error?: string } {
  if (amount <= 0) return { ok: false, balance: 0, error: "金额必须大于 0" };
  let w = loadWallet(personDir);
  if (!w) w = createWallet(personDir, 0);

  w.balance += amount;
  w.totalEarned += amount;
  w.lastTx = new Date().toISOString();
  saveWallet(personDir, w);
  logTx(personDir, { type: "credit", amount, reason, balance: w.balance });
  return { ok: true, balance: w.balance };
}

export function deductFunds(personDir: string, amount: number, reason: string): { ok: boolean; balance: number; error?: string } {
  if (amount <= 0) return { ok: false, balance: 0, error: "金额必须大于 0" };
  let w = loadWallet(personDir);
  if (!w) return { ok: false, balance: 0, error: "没有钱包" };
  if (w.balance < amount) return { ok: false, balance: w.balance, error: `余额不足: $${w.balance.toFixed(2)}, 需要 $${amount.toFixed(2)}` };

  w.balance -= amount;
  w.totalSpent += amount;
  w.lastTx = new Date().toISOString();
  saveWallet(personDir, w);
  logTx(personDir, { type: "debit", amount, reason, balance: w.balance });
  return { ok: true, balance: w.balance };
}

// ── 交易记录（追加式，不可改） ──

interface TxRecord {
  type: "credit" | "debit" | "transfer_in" | "transfer_out";
  amount: number;
  reason: string;
  balance: number;
  ts?: string;
}

function logTx(personDir: string, tx: TxRecord): void {
  const logFile = join(personDir, ".data", "wallet.log");
  const entry = JSON.stringify({ ...tx, ts: new Date().toISOString() }) + "\n";
  try {
    const { appendFileSync } = require("node:fs");
    appendFileSync(logFile, entry);
  } catch {}
}

export function getTxLog(personDir: string, limit: number = 20): TxRecord[] {
  try {
    const raw = readFileSync(join(personDir, ".data", "wallet.log"), "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l));
  } catch { return []; }
}
