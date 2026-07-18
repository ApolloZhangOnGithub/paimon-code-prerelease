import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { agentId, agentWorkDir, loadTrust, saveTrust, agentEntry } from "#hands_fileactions";

export async function authdirCompletions(prefix: string) {
  const items: { value: string; label: string; description?: string }[] = [];
  const rm = prefix.match(/^remove\s+(.*)$/);
  if (rm) {
    await loadTrust();
    const e = agentEntry();
    for (const c of ["all", ...e.trusted.map(t => t.path)]) {
      if (c.startsWith(rm[1]!)) items.push({ value: `remove ${c}`, label: c });
    }
    return items.length ? items : null;
  }
  const subs: [string, string][] = [["all", "全量白名单（系统黑名单仍生效）"], ["remove ", "撤销授权"], ["list", "查看状态"]];
  for (const [s, desc] of subs) {
    if (s.startsWith(prefix)) items.push({ value: s, label: s.trim(), description: desc });
  }
  const raw = prefix.replace(/^~(?=\/|$)/, homedir());
  try {
    const slash = raw.lastIndexOf("/");
    const dir = slash >= 0 ? (raw.slice(0, slash) || "/") : ".";
    const base = slash >= 0 ? raw.slice(slash + 1) : raw;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (base ? !ent.name.startsWith(base) : ent.name.startsWith(".")) continue;
      const full = (dir === "/" ? "" : dir === "." ? "" : dir + "/") + ent.name;
      items.push({ value: (full || ent.name) + "/", label: ent.name + "/" });
      if (items.length >= 25) break;
    }
  } catch {}
  return items.length ? items : null;
}

export async function authdirHandler(args: string, ctx: any) {
  await loadTrust();
  const e = agentEntry();
  const a = (args ?? "").trim();
  if (!a || a === "list") {
    const now = Date.now();
    const rows = e.trusted.filter(t => !t.until || t.until > now)
      .map(t => ` - ${t.path}${t.until ? `（剩 ${Math.ceil((t.until - now) / 60000)} 分钟）` : ""}`);
    ctx.ui.notify(`agent: ${agentId()}\n工作目录(常开): ${agentWorkDir()}\n全量白名单: ${e.all ? "开" : "关"}\n信任目录:\n${rows.join("\n") || " (无)"}`, "info");
    return;
  }
  const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
  if (a === "all") {
    e.all = true; await saveTrust();
    ctx.ui.notify("已开启全量白名单（系统黑名单仍生效）", "info");
    return;
  }
  if (a === "remove" || a.startsWith("remove ")) {
    const rest = unquote(a.slice(6));
    if (rest === "all") { e.all = false; await saveTrust(); ctx.ui.notify("已关闭全量白名单", "info"); return; }
    if (!rest) { ctx.ui.notify("/authdir remove <目录|all>", "warning"); return; }
    const p = resolve(rest.replace(/^~(?=\/|$)/, homedir()));
    e.trusted = e.trusted.filter(t => t.path !== p);
    await saveTrust(); ctx.ui.notify(`已撤销: ${p}`, "info");
    return;
  }
  const mm = a.match(/^(.*?)(?:\s+(\d+))?$/s)!;
  const rawPath = unquote(mm[1] ?? "");
  const min = mm[2] ? parseInt(mm[2], 10) : NaN;
  if (!rawPath) { ctx.ui.notify("/authdir <目录> [分钟] | /authdir all | /authdir remove <目录|all>", "warning"); return; }
  const p = resolve(rawPath.replace(/^~(?=\/|$)/, homedir()));
  e.trusted = e.trusted.filter(t => t.path !== p);
  e.trusted.push({ path: p, until: Number.isFinite(min) && min > 0 ? Date.now() + min * 60000 : undefined });
  await saveTrust();
  ctx.ui.notify(`已信任: ${p}${Number.isFinite(min) && min > 0 ? `（${min} 分钟）` : "（永久）"}`, "info");
}
