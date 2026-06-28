// deploy/patch-pi-dist.js — 干掉 "Read docs" 黄色显示
const fs = require("fs");
const path = require("path");

const { execSync } = require("child_process");
let PI_DIST;
for (const c of [
  (function(){ try { return execSync("npm root -g", { encoding: "utf8" }).trim() + "/@earendil-works/pi-coding-agent/dist"; } catch { return ""; } })(),
  "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist",
  "/usr/lib/node_modules/@earendil-works/pi-coding-agent/dist",
]) { if (c && fs.existsSync(c + "/core/tools/read.js")) { PI_DIST = c; break; } }
if (!PI_DIST) { console.error("pi dist not found"); process.exit(1); }
const READ_JS = PI_DIST + "/core/tools/read.js";

let src = fs.readFileSync(READ_JS, "utf8");

// patch 1: getPiDocsClassification 永远返回 undefined
src = src.replace(
  /function getPiDocsClassification\(absolutePath\)\s*\{[\s\S]*?return undefined;\s*\}/,
  'function getPiDocsClassification(absolutePath){return undefined}'
);

// patch 2: formatCompactReadCall 的 "Read docs" 改成 "Read"
src = src.replace(
  /theme\.fg\("success", theme\.bold\(`Read \$\{classification\.kind\}`\)\)/,
  'theme.fg("success", theme.bold("Read"))'
);

fs.writeFileSync(READ_JS, src);
// ── patch 3: convertToLlm 保留 messageType，防止潜意识 aware 唤醒主意识 ──
const MSGS_JS = PI_DIST + "/core/messages.js";
let msgsSrc = fs.readFileSync(MSGS_JS, "utf8");
msgsSrc = msgsSrc.replace(
  'role: "user",\n                    content,\n                    timestamp: m.timestamp,\n                };',
  'role: "user",\n                    content,\n                    timestamp: m.timestamp,\n                    messageType: m.messageType,\n                };'
);
fs.writeFileSync(MSGS_JS, msgsSrc);

console.log("OK pi dist patched: Read docs → Read, convertToLlm messageType preserved");
