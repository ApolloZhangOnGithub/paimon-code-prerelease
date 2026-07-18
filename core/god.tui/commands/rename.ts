import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

const PAIMON = path.join(homedir(), ".paimon");
const PLIST = path.join(PAIMON, "MemoryData", "plist.json");
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

function loadPlist(): any[] {
  try { return JSON.parse(fs.readFileSync(PLIST, "utf8")); } catch { return []; }
}

export async function renameHandler(args: any, ctx: any) {
  const newName = typeof args === "string" ? args.trim() : args?.args?.trim?.() || "";
  if (!newName) { ctx.ui.notify("/rename <new-name>", "warning"); return; }

  const agentId = process.env.PAIMON_AGENT_ID;
  if (!agentId) { ctx.ui.notify("无法确定当前 agent", "warning"); return; }

  if (!NAME_RE.test(newName)) {
    ctx.ui.notify(`invalid name: must start with a letter, only a-z A-Z 0-9 _ allowed`, "warning");
    return;
  }

  const list = loadPlist();
  const entry = list.find((p: any) => p.id === agentId);
  if (!entry) { ctx.ui.notify("当前 agent 不在 plist 中", "warning"); return; }
  if (list.find((p: any) => p.name === newName && p.id !== agentId)) {
    ctx.ui.notify(`name "${newName}" already taken`, "warning");
    return;
  }

  const prev = entry.name;
  entry.name = newName;
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, JSON.stringify(list, null, 2));

  const idDir = path.join(PAIMON, "IdentityData", agentId);
  const idFile = path.join(idDir, "identity.json");
  let idData: any = {};
  try { idData = JSON.parse(fs.readFileSync(idFile, "utf8")); } catch {}
  if (!Array.isArray(idData.renameHistory)) idData.renameHistory = [];
  idData.renameHistory.unshift({ from: prev, to: newName, at: new Date().toISOString() });
  fs.mkdirSync(idDir, { recursive: true });
  fs.writeFileSync(idFile, JSON.stringify(idData, null, 2));

  process.env.PAIMON_AGENT_NAME = newName;
  try { process.title = `paimon: ${newName}`; } catch {}

  ctx.ui.notify(`${prev} → ${newName}`, "info");
}
