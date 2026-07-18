#!/usr/bin/env node
// wechat-cli — Claude Code 用的微信客户端
// 用法:
//   wechat send <to> <text>     发私信
//   wechat broadcast <text>     广播
//   wechat inbox                查看收件箱
//   wechat read                 标记已读
//   wechat group create <id> <name> <成员1,成员2,...>
//   wechat group send <id> <text>
//   wechat group history <id>

const SERVER = process.env.MSG_SERVER || "http://127.0.0.1:9224";
const ME = process.env.PAIMON_AGENT_NAME || process.env.USER || "claude-" + process.pid;

async function api(action, params = {}) {
  const r = await fetch(SERVER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  return r.json();
}

function fmtTs(ts) {
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

async function main() {
  const [,, cmd, ...args] = process.argv;

  if (!cmd || cmd === "help") {
    console.log(`wechat — 跨 agent 即时通讯 (身份: ${ME})\n`);
    console.log("  send <to> <text>              发私信");
    console.log("  broadcast <text>              广播给所有人");
    console.log("  inbox                         查看收件箱");
    console.log("  read                          标记全部已读");
    console.log("  group create <id> <name> <a,b,c>  创建群");
    console.log("  group send <id> <text>        群发消息");
    console.log("  group history <id>            群聊记录");
    console.log("  group list                    我的群");
    return;
  }

  if (cmd === "send") {
    const [to, ...rest] = args;
    const text = rest.join(" ");
    if (!to || !text) { console.log("用法: wechat send <to> <text>"); return; }
    const r = await api("send", { from: ME, to, text });
    console.log(r.ok ? `已发送给 ${to}` : `失败: ${r.error}`);
    return;
  }

  if (cmd === "broadcast") {
    const text = args.join(" ");
    if (!text) { console.log("用法: wechat broadcast <text>"); return; }
    const r = await api("send", { from: ME, to: "all", text });
    console.log(r.ok ? "已广播" : `失败: ${r.error}`);
    return;
  }

  if (cmd === "inbox") {
    const r = await api("inbox", { agent_id: ME });
    const msgs = r.messages || [];
    if (!msgs.length) { console.log("(没有消息)"); return; }
    for (const m of msgs) {
      const mark = m.read ? " " : "●";
      console.log(`${mark} [${fmtTs(m.ts)}] ${m.from}: ${m.text}`);
    }
    return;
  }

  if (cmd === "read") {
    const r = await api("read", { agent_id: ME });
    console.log(r.ok ? `已读 ${r.marked} 条` : `失败: ${r.error}`);
    return;
  }

  if (cmd === "group") {
    const [sub, ...rest] = args;
    if (sub === "create") {
      const [id, name, members] = rest;
      if (!id || !name || !members) { console.log("用法: wechat group create <id> <name> <a,b,c>"); return; }
      const r = await api("group_create", { group_id: id, name, members: members.split(",") });
      console.log(r.ok ? `群 ${id} 已创建` : `失败: ${r.error}`);
    } else if (sub === "send") {
      const [id, ...t] = rest;
      const text = t.join(" ");
      if (!id || !text) { console.log("用法: wechat group send <id> <text>"); return; }
      const r = await api("group_send", { from: ME, group_id: id, text });
      console.log(r.ok ? "已发送" : `失败: ${r.error}`);
    } else if (sub === "history") {
      const [id] = rest;
      if (!id) { console.log("用法: wechat group history <id>"); return; }
      const r = await api("group_history", { group_id: id });
      if (r.error) { console.log(`失败: ${r.error}`); return; }
      console.log(`群: ${r.name} | 成员: ${r.members.join(", ")}\n`);
      for (const m of r.messages || []) {
        console.log(`[${fmtTs(m.ts)}] ${m.from}: ${m.text}`);
      }
    } else if (sub === "list") {
      const r = await api("group_list", { agent_id: ME });
      if (!r.groups?.length) { console.log("(没有群)"); return; }
      for (const g of r.groups) {
        console.log(`${g.id}  ${g.name}  成员: ${g.members.join(", ")}`);
      }
    } else {
      console.log("用法: wechat group [create|send|history|list]");
    }
    return;
  }

  console.log(`未知命令: ${cmd}。输入 wechat help 查看用法。`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
