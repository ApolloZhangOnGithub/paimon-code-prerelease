// send.ts — 发消息的命令行工具
// 用法: bun send.ts <to> <message>
// 例: bun send.ts a4a1e232 "把 phone app 都改成 PhoneApp 接口"

const MSG_SERVICE = process.env.PI_MSG || "http://localhost:9224";
const FROM = process.env.PI_SENDER || "claude-code";

const [, , to, ...rest] = process.argv;
const text = rest.join(" ");

if (!to || !text) {
  console.log("用法: bun send.ts <to_agent_id> <message>");
  console.log("  环境变量: PI_MSG=http://server:9224 PI_SENDER=claude-code");
  process.exit(1);
}

const res = await fetch(MSG_SERVICE, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "send", from: FROM, to, text }),
});
let result: any;
try {
  result = await res.json();
} catch {
  console.error(`ERR: message-service returned non-JSON (HTTP ${res.status})`);
  process.exit(1);
}

if (result.ok) {
  console.log(`sent → ${to}: "${text}"`);
} else {
  console.error(`ERR: ${result.error}`);
}
