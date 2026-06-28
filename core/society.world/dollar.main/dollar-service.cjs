// dollar-service.cjs — 钱包 HTTP 服务（跑在服务器上）
// agent 通过 HTTP API 查余额/支付，不能直接改数据
// 启动: DOLLAR_SECRET=xxx node dollar-service.cjs

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.DOLLAR_PORT || 9223);
const SECRET = process.env.DOLLAR_SECRET || "";
const DATA_DIR = process.env.DOLLAR_DATA || path.join(__dirname, "wallets");
const API_TOKEN = process.env.DOLLAR_API_TOKEN || "";

fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 钱包操作 ──

function walletFile(agentId) { return path.join(DATA_DIR, `${agentId}.json`); }
function txLogFile(agentId) { return path.join(DATA_DIR, `${agentId}.log`); }

function computeHash(w) {
  return crypto.createHash("sha256")
    .update(`${w.balance}:${w.totalEarned}:${w.totalSpent}:${w.lastTx}:${SECRET}`)
    .digest("hex").slice(0, 16);
}

function loadWallet(agentId) {
  try {
    const w = JSON.parse(fs.readFileSync(walletFile(agentId), "utf8"));
    if (w.hash !== computeHash(w)) return null;
    return w;
  } catch { return null; }
}

function saveWallet(agentId, w) {
  const { hash: _, ...rest } = w;
  const signed = { ...rest, hash: computeHash(rest) };
  fs.writeFileSync(walletFile(agentId), JSON.stringify(signed, null, 2));
}

function logTx(agentId, tx) {
  const entry = JSON.stringify({ ...tx, ts: new Date().toISOString() }) + "\n";
  fs.appendFileSync(txLogFile(agentId), entry);
}

// ── API 处理 ──

function handleAction(action, params) {
  const agentId = params.agent_id;
  if (!agentId) return { error: "需要 agent_id" };

  switch (action) {
    case "balance": {
      const w = loadWallet(agentId);
      if (!w) return { balance: 0, exists: false };
      return { balance: w.balance, totalEarned: w.totalEarned, totalSpent: w.totalSpent };
    }

    case "create": {
      if (loadWallet(agentId)) return { error: "钱包已存在" };
      const initial = Number(params.amount) || 100;
      const now = new Date().toISOString();
      const w = { balance: initial, totalEarned: initial, totalSpent: 0, createdAt: now, lastTx: now };
      w.hash = computeHash(w);
      fs.writeFileSync(walletFile(agentId), JSON.stringify(w, null, 2));
      logTx(agentId, { type: "credit", amount: initial, reason: "初始余额", balance: initial });
      return { ok: true, balance: initial };
    }

    case "credit": {
      const amount = Number(params.amount);
      if (!amount || amount <= 0) return { error: "金额必须大于0" };
      let w = loadWallet(agentId);
      if (!w) return { error: "钱包不存在" };
      w.balance += amount;
      w.totalEarned += amount;
      w.lastTx = new Date().toISOString();
      saveWallet(agentId, w);
      logTx(agentId, { type: "credit", amount, reason: params.reason || "", balance: w.balance });
      return { ok: true, balance: w.balance };
    }

    case "debit": {
      const amount = Number(params.amount);
      if (!amount || amount <= 0) return { error: "金额必须大于0" };
      let w = loadWallet(agentId);
      if (!w) return { error: "钱包不存在" };
      if (w.balance < amount) return { error: `余额不足: $${w.balance.toFixed(2)}`, balance: w.balance };
      w.balance -= amount;
      w.totalSpent += amount;
      w.lastTx = new Date().toISOString();
      saveWallet(agentId, w);
      logTx(agentId, { type: "debit", amount, reason: params.reason || "", balance: w.balance });
      return { ok: true, balance: w.balance };
    }

    case "transfer": {
      const from = agentId;
      const to = params.to_agent_id;
      const amount = Number(params.amount);
      if (!to) return { error: "需要 to_agent_id" };
      if (!amount || amount <= 0) return { error: "金额必须大于0" };
      let wFrom = loadWallet(from);
      let wTo = loadWallet(to);
      if (!wFrom) return { error: "转出钱包不存在" };
      if (!wTo) return { error: "转入钱包不存在" };
      if (wFrom.balance < amount) return { error: `余额不足: $${wFrom.balance.toFixed(2)}`, balance: wFrom.balance };

      wFrom.balance -= amount;
      wFrom.totalSpent += amount;
      wFrom.lastTx = new Date().toISOString();
      saveWallet(from, wFrom);

      wTo.balance += amount;
      wTo.totalEarned += amount;
      wTo.lastTx = new Date().toISOString();
      saveWallet(to, wTo);

      const reason = params.reason || `transfer to ${to}`;
      logTx(from, { type: "transfer_out", amount, reason, balance: wFrom.balance, to });
      logTx(to, { type: "transfer_in", amount, reason: `from ${from}: ${reason}`, balance: wTo.balance, from });
      return { ok: true, from_balance: wFrom.balance, to_balance: wTo.balance };
    }

    case "history": {
      try {
        const raw = fs.readFileSync(txLogFile(agentId), "utf8");
        const limit = Number(params.limit) || 20;
        const lines = raw.trim().split("\n").filter(Boolean).slice(-limit);
        return { transactions: lines.map(l => JSON.parse(l)) };
      } catch { return { transactions: [] }; }
    }

    default:
      return { error: `未知操作: ${action}`, help: "balance/create/credit/debit/transfer/history" };
  }
}

// ── HTTP 服务 ──

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/health") {
    const wallets = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json")).length;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, wallets }));
    return;
  }

  if (req.method !== "POST") { res.writeHead(405); res.end("POST only"); return; }

  // API token 校验（可选）
  if (API_TOKEN) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${API_TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
  }

  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    try {
      const { action, ...params } = JSON.parse(body);
      const result = handleAction(action, params);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`dollar-service :${PORT} | wallets: ${DATA_DIR}`);
});
