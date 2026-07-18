import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const UA_DIR = join(homedir(), ".paimon/UserAccount");
const UA_FILE = join(UA_DIR, "services.json");
const LEGACY_FILE = join(homedir(), ".paimon/config/services.json");

const DEFAULTS: Record<string, Record<string, string>> = {
  brave: { apiKey: "" },
  weread: { apiKey: "" },
  deepseek: { apiKey: "" },
  "doubao-voicengine": { appId: "", token: "" },
  "doubao-seed": { url: "", apiKey: "", model: "" },
};

export async function configHandler(_args: any, ctx: any) {
  const sf = existsSync(UA_FILE) ? UA_FILE : existsSync(LEGACY_FILE) ? LEGACY_FILE : UA_FILE;
  let services: Record<string, any> = {};
  try { services = JSON.parse(readFileSync(sf, "utf8")); } catch {}
  const names = Object.keys(services);
  if (!names.length) {
    mkdirSync(UA_DIR, { recursive: true });
    services = { ...DEFAULTS };
    writeFileSync(UA_FILE, JSON.stringify(services, null, 2));
  }

  while (true) {
    const maxNameW = Math.max(...names.map(n => n.length), 10);
    const options = names.length ? names.map(name => {
      const svc = services[name] || {};
      const fields = Object.keys(svc);
      const allSet = fields.every(f => typeof svc[f] === "string" && svc[f].trim());
      const noneSet = fields.every(f => !svc[f] || !(svc[f] as string).trim());
      const status = allSet ? "● 已配置" : noneSet ? "○ 未配置" : "◐ 部分配置";
      return `${name.padEnd(maxNameW + 2)}${status}`;
    }) : ["(空)"];
    const choice = await ctx.ui.select("服务配置 (services.json)", options);
    if (!choice) break;
    const idx = options.indexOf(choice);
    if (idx < 0 || idx >= names.length) break;
    const name = names[idx];
    const svc = services[name] || {};
    const fields = Object.keys(svc);

    while (true) {
      const fieldOpts = fields.map(f => {
        const v = svc[f];
        const display = (typeof v === "string" && v.trim()) ? v.slice(0, 8) + "..." : "(未设置)";
        return `${f.padEnd(16)}  ${display}`;
      });
      const fieldChoice = await ctx.ui.select(`${name} 配置`, fieldOpts);
      if (!fieldChoice) break;
      const fi = fieldOpts.indexOf(fieldChoice);
      if (fi < 0) break;
      const field = fields[fi];
      const newVal = await ctx.ui.input(`${name}.${field}`);
      if (newVal !== undefined && newVal !== null) {
        svc[field] = newVal.trim();
        services[name] = svc;
        mkdirSync(UA_DIR, { recursive: true });
        writeFileSync(UA_FILE, JSON.stringify(services, null, 2));
      }
    }
  }
}
