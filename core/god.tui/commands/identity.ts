import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

const PAIMON = path.join(homedir(), ".paimon");
const PLIST = path.join(PAIMON, "MemoryData", "plist.json");

function loadPlist(): any[] {
  try { return JSON.parse(fs.readFileSync(PLIST, "utf8")); } catch { return []; }
}

export async function identityHandler(args: any, ctx: any) {
  const query = typeof args === "string" ? args.trim() : args?.args?.trim?.() || "";
  const ref = query || process.env.PAIMON_AGENT_ID || process.env.PAIMON_AGENT_NAME || "";
  if (!ref) { ctx.ui.notify("usage: /identity [id|name]", "warning"); return; }

  const list = loadPlist();
  const record = list.find((p: any) => p.id === ref) || list.find((p: any) => p.name === ref);
  if (!record) { ctx.ui.notify(`agent "${ref}" not found`, "warning"); return; }

  const D = "\x1b[90m", R = "\x1b[0m", B = "\x1b[1m", G = "\x1b[32m";
  const lines = [`  ${B}Identity${R}`, ""];
  lines.push(`  ID:       ${record.id}`);
  lines.push(`  Name:     ${record.name}`);
  if (record.kind) lines.push(`  Kind:     ${record.kind}`);
  if (record.model) lines.push(`  Model:    ${record.model}`);
  if (record.created) lines.push(`  Created:  ${record.created.slice(0, 19).replace("T", " ")}`);
  if (record.lastSeen) lines.push(`  LastSeen: ${record.lastSeen.slice(0, 19).replace("T", " ")}`);
  if (record.org) lines.push(`  Org:      ${record.org}`);
  if (record.archived) lines.push(`  Status:   ${D}archived${R}`);
  if (record.note) lines.push(`  Note:     ${record.note}`);

  const idFile = path.join(PAIMON, "IdentityData", record.id, "identity.json");
  try {
    const idData = JSON.parse(fs.readFileSync(idFile, "utf8"));
    if (Array.isArray(idData.renameHistory) && idData.renameHistory.length) {
      lines.push("");
      lines.push(`  ${D}Rename History${R}`);
      for (const r of idData.renameHistory.slice(0, 10)) {
        lines.push(`  ${D}${r.at?.slice(0, 10) || "?"}${R}  ${r.from} → ${r.to}`);
      }
    }
  } catch {}

  const memDir = path.join(PAIMON, "MemoryData", record.id);
  if (fs.existsSync(memDir)) {
    let size = 0;
    const walk = (d: string) => {
      try {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const fp = path.join(d, e.name);
          if (e.isDirectory()) walk(fp);
          else try { size += fs.statSync(fp).size; } catch {}
        }
      } catch {}
    };
    walk(memDir);
    const kb = (size / 1024).toFixed(0);
    lines.push("");
    lines.push(`  Memory:   ${kb} KB`);
  }

  lines.push("");
  ctx.ui.notify(lines.join("\n"), "info");
}
