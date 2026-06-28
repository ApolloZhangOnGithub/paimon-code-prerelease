#!/bin/bash
# 迁移 context.md 从旧格式 [ts] [role]\ncontent 到 JSONL 格式 {role, type, ts}
set -e

CTX="$HOME/.pi/memory/0f21812e/.data/context.md"
BAK="$HOME/.pi/memory/0f21812e/.data/context.md.bak.$(date +%s)"
OUT="$HOME/.pi/memory/0f21812e/.data/context.md.new"

cp "$CTX" "$BAK"
echo "备份: $BAK"

node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8");
const lines = raw.split("\n");
const out = [];

const roleMap = {
  "user":        { role: "user",     type: "user_msg" },
  "assistant":   { role: "assistant", type: "text" },
  "toolResult":  { role: "system",   type: "toolResult" },
  "tool":        { role: "system",   type: "toolResult" },
  "custom":      { role: "system",   type: "start_msg" },
  "system":      { role: "system",   type: "start_msg" },
  "?":           { role: "system",   type: "start_msg" },
};

let i = 0;
while (i < lines.length) {
  while (i < lines.length && !lines[i].trim()) { i++; }
  if (i >= lines.length) break;
  
  const header = lines[i];
  const m = header.match(/^\[([^\]]+)\] \[([^\]]+)\]$/);
  if (!m) { i++; continue; }
  
  const ts = m[1].trim();
  const roleTag = m[2].trim();
  const mapping = roleMap[roleTag] || { role: roleTag, type: "text" };
  
  i++;
  const contentLines = [];
  while (i < lines.length) {
    if (/^\[[^\]]+\] \[[^\]]+\]$/.test(lines[i])) break;
    contentLines.push(lines[i]);
    i++;
  }
  
  const content = contentLines.join("\n").trim();
  if (!content) continue;
  if (/^\[\d{2}:\d{2}:\d{2} [+-]/.test(content.trim())) continue;
  
  const entry = {
    role: mapping.role,
    type: mapping.type,
    ts: Date.parse(ts) || Date.now(),
  };
  if (["toolResult","user_msg","start_msg"].includes(mapping.type)) {
    entry.content = content.slice(0, 10000);
  } else {
    entry.text = content.slice(0, 10000);
  }
  out.push(JSON.stringify(entry));
}

fs.writeFileSync(process.argv[2], out.join("\n") + "\n");
' "$CTX" "$OUT"

echo "迁移完成: $(wc -l < "$OUT" | tr -d ' ') 条"
mv "$OUT" "$CTX"
echo "已替换 context.md ($(wc -l < "$CTX" | tr -d ' ') 行)"
echo "旧备份: $BAK"
