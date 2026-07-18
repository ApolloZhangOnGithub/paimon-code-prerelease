// message-service.cjs — agent 即时通讯服务
// HTTP API + WebSocket 推送。跑在服务器上。
// 启动: node message-service.cjs

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.MSG_PORT || 9224);
const DATA_DIR = process.env.MSG_DATA || path.join(__dirname, "data");

fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 数据 ──

function msgFile(agentId) { return path.join(DATA_DIR, `inbox-${agentId}.json`); }
function groupFile(groupId) { return path.join(DATA_DIR, `group-${groupId}.json`); }

function loadInbox(agentId) {
  try { return JSON.parse(fs.readFileSync(msgFile(agentId), "utf8")); } catch { return []; }
}
function saveInbox(agentId, msgs) {
  fs.writeFileSync(msgFile(agentId), JSON.stringify(msgs, null, 2));
}

function loadGroup(groupId) {
  try { return JSON.parse(fs.readFileSync(groupFile(groupId), "utf8")); } catch { return null; }
}
function saveGroup(groupId, group) {
  fs.writeFileSync(groupFile(groupId), JSON.stringify(group, null, 2));
}

// ── WebSocket 连接池 ──

const wsClients = new Map(); // agentId → Set<ws>

function pushToAgent(agentId, message) {
  const clients = wsClients.get(agentId);
  if (!clients) return;
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    try { ws.send(payload); } catch(e) { try { require("fs").appendFileSync("/tmp/paimon-catch-errors.log", "[27001] " + (e?.stack||e) + "\n"); } catch {} }
  }
}

// ── 操作 ──

function handleAction(action, params) {
  switch (action) {
    case "send": {
      const { from, to, text } = params;
      if (!from || !to || !text) return { error: "需要 from, to, text" };
      const msg = { from, to, text, ts: new Date().toISOString(), read: false };
      const inbox = loadInbox(to);
      inbox.push(msg);
      saveInbox(to, inbox);
      // 实时推送
      pushToAgent(to, { type: "new_message", message: msg });
      return { ok: true, ts: msg.ts };
    }

    case "inbox": {
      const { agent_id, since, unread_only } = params;
      if (!agent_id) return { error: "需要 agent_id" };
      let msgs = loadInbox(agent_id);
      if (since) msgs = msgs.filter(m => m.ts > since);
      if (unread_only) msgs = msgs.filter(m => !m.read);
      return { messages: msgs.slice(-50) };
    }

    case "read": {
      const { agent_id } = params;
      if (!agent_id) return { error: "需要 agent_id" };
      const msgs = loadInbox(agent_id);
      let count = 0;
      for (const m of msgs) {
        if (!m.read) { m.read = true; count++; }
      }
      saveInbox(agent_id, msgs);
      return { ok: true, marked: count };
    }

    case "group_create": {
      const { group_id, name, members } = params;
      if (!group_id || !name || !members?.length) return { error: "需要 group_id, name, members[]" };
      if (loadGroup(group_id)) return { error: "群已存在" };
      const group = { id: group_id, name, members, created: new Date().toISOString(), messages: [] };
      saveGroup(group_id, group);
      return { ok: true, group_id };
    }

    case "group_send": {
      const { from, group_id, text } = params;
      if (!from || !group_id || !text) return { error: "需要 from, group_id, text" };
      const group = loadGroup(group_id);
      if (!group) return { error: "群不存在" };
      if (!group.members.includes(from)) return { error: "你不在这个群里" };
      const msg = { from, text, ts: new Date().toISOString() };
      group.messages.push(msg);
      if (group.messages.length > 500) group.messages = group.messages.slice(-500);
      saveGroup(group_id, group);
      // 推给所有群成员
      for (const member of group.members) {
        if (member !== from) {
          pushToAgent(member, { type: "group_message", group_id, group_name: group.name, message: msg });
        }
      }
      return { ok: true, ts: msg.ts };
    }

    case "group_history": {
      const { group_id, limit } = params;
      if (!group_id) return { error: "需要 group_id" };
      const group = loadGroup(group_id);
      if (!group) return { error: "群不存在" };
      const n = Number(limit) || 30;
      return { messages: group.messages.slice(-n), name: group.name, members: group.members };
    }

    case "group_list": {
      const { agent_id } = params;
      if (!agent_id) return { error: "需要 agent_id" };
      const groups = [];
      try {
        for (const f of fs.readdirSync(DATA_DIR)) {
          if (f.startsWith("group-") && f.endsWith(".json")) {
            const g = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
            if (g.members.includes(agent_id)) {
              groups.push({ id: g.id, name: g.name, members: g.members.length });
            }
          }
        }
      } catch(e) { try { require("fs").appendFileSync("/tmp/paimon-catch-errors.log", "[27002] " + (e?.stack||e) + "\n"); } catch {} }
      return { groups };
    }

    case "contacts": {
      // 列出所有有 inbox 的 agent
      const agents = [];
      try {
        for (const f of fs.readdirSync(DATA_DIR)) {
          if (f.startsWith("inbox-") && f.endsWith(".json")) {
            agents.push(f.replace("inbox-", "").replace(".json", ""));
          }
        }
      } catch(e) { try { require("fs").appendFileSync("/tmp/paimon-catch-errors.log", "[27003] " + (e?.stack||e) + "\n"); } catch {} }
      return { agents };
    }

    default:
      return { error: `未知: ${action}`, help: "send/inbox/read/group_create/group_send/group_history/group_list/contacts" };
  }
}

// ── HTTP 服务 ──

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, connections: wsClients.size }));
    return;
  }

  if (req.method !== "POST") { res.writeHead(405); res.end("POST only"); return; }

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

// ── WebSocket 推送 ──

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let agentId = null;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "register" && msg.agent_id) {
        agentId = msg.agent_id;
        if (!wsClients.has(agentId)) wsClients.set(agentId, new Set());
        wsClients.get(agentId).add(ws);
        ws.send(JSON.stringify({ type: "registered", agent_id: agentId }));
      }
    } catch(e) { try { require("fs").appendFileSync("/tmp/paimon-catch-errors.log", "[27004] " + (e?.stack||e) + "\n"); } catch {} }
  });

  ws.on("close", () => {
    if (agentId && wsClients.has(agentId)) {
      wsClients.get(agentId).delete(ws);
      if (wsClients.get(agentId).size === 0) wsClients.delete(agentId);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`message-service :${PORT} | ws + http`);
});
