// paths.ts — 全局路径常量（唯一真相源）
// 目录结构变了只改这里，其他文件全部 import

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

const CORE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(CORE, "..");

// ── 构建模式（install.sh 部署时会把 "dev" 改写成 "release"）──
export const BUILD_MODE: "dev" | "release" = "dev";
export const IS_DEV = BUILD_MODE === "dev";

export const DIRS = {
  root: ROOT,
  core: CORE,

  organs: resolve(CORE, "individual.bio.organs"),
  gene: resolve(CORE, "individual.bio.gene"),
  genePromotor: resolve(CORE, "individual.bio.gene/promotor.dna"),
  geneCoded: resolve(CORE, "individual.bio.gene/coded.dna"),
  geneCore: resolve(CORE, "individual.bio.gene/core.dna"),
  geneTranspiler: resolve(CORE, "individual.bio.gene/transpiler.ts"),
  geneRna: resolve(CORE, "individual.bio.gene/rna.json"),

  tuiCommands: resolve(CORE, "god.tui/commands"),
  tuiUi: resolve(CORE, "god.tui/ui"),
  tuiOverrides: resolve(CORE, "god.tui/overrides"),
  cli: resolve(CORE, "god.cli"),

  // dev-only 路径（release 模式下不存在，用 IS_DEV 门控访问）
  ...(BUILD_MODE === "dev" ? {
    docs: resolve(ROOT, "Docs"),
    devCommon: resolve(ROOT, "Docs/Dev.Common"),
    devIssues: resolve(ROOT, "Docs/Dev.Common/Issues"),
    devLessons: resolve(ROOT, "Docs/Dev.Common/Lessons"),
    devNorms: resolve(ROOT, "Docs/Dev.Common/Norms"),
    cookAgent: resolve(ROOT, "Docs/Cook.Agent"),
    cookHuman: resolve(ROOT, "Docs/Cook.Human"),
    deploy: resolve(ROOT, "Codebase/deploy"),
  } : {}),

  mobile: resolve(CORE, "technology.local.mobile"),
  mobileApps: resolve(CORE, "technology.local.mobile/apps"),
  server: resolve(CORE, "technology.cloud.servers"),
  browserService: process.env.PI_BROWSER || "http://localhost:9222",
  accessibility: resolve(CORE, "world.accessibility"),
} as const;

// ── 目录结构 ──
export const PAIMON = join(homedir(), ".paimon");
export const PROGRAM_FILES_MOBILE = join(PAIMON, "ProgramFiles/Mobile");
const MEMORY_DATA = join(PAIMON, "MemoryData");
const SESSION_DATA = join(PAIMON, "SessionData");
const AGENT_FILE_DATA = join(PAIMON, "AgentFileData");
const RUNTIME_CACHE = join(PAIMON, "RuntimeCache");
const IDENTITY_DATA = join(PAIMON, "IdentityData");
const APP_DATA = join(PAIMON, "AppData");
const BLACKBOX_DATA = join(PAIMON, "BlackboxData");
const CONFIG_DIR = join(PAIMON, "config");
const ID_RE = /(?:\.paimon\/SessionData\/|\.paimon\/sessions\/|\.pi\/memory\/)([a-f0-9]+)\//;

export function configDir(): string { return CONFIG_DIR; }
export function memoryDataDir(): string { return MEMORY_DATA; }
export function runtimeCacheBaseDir(): string { return RUNTIME_CACHE; }
export function personDir(sessionFile: string | null | undefined): string | null {
  if (!sessionFile) return null;
  const m = sessionFile.match(ID_RE);
  return m ? join(MEMORY_DATA, m[1]) : null;
}

export function personDataDir(sessionFile: string | null | undefined): string | null {
  return personDir(sessionFile);
}

export function personId(sessionFile: string | null | undefined): string | null {
  if (!sessionFile) return null;
  const m = sessionFile.match(ID_RE);
  return m ? m[1] : null;
}

export function memoryDir(id: string): string { return join(MEMORY_DATA, id); }
export function channelDir(id: string): string { return join(RUNTIME_CACHE, id); }
export function sessionDirFor(id: string): string { return join(SESSION_DATA, id); }
export function agentFileDir(id: string): string { return join(AGENT_FILE_DATA, id); }
export function monitorDir(id: string): string { return join(RUNTIME_CACHE, id); }
export function runtimeCacheDir(id: string): string { return join(RUNTIME_CACHE, id); }
export function identityDir(id: string): string { return join(IDENTITY_DATA, id); }
export function blackboxDir(id: string): string { return join(BLACKBOX_DATA, id); }

// ── 回忆录 ──
export function memoirDir(id: string): string {
  const dir = join(PAIMON, "MemoirData");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return join(dir, id + ".MEMOIR");
}

export function logerr(code: string, e: unknown, ctx?: string) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] [${code}]${ctx ? ' ' + ctx : ''} ${(e as any)?.stack || e}\n`;
  try {
    const dir = join(PAIMON, 'ErrorData');
    const file = join(dir, 'catch-errors.log');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, msg);
  } catch {
    try { appendFileSync('/tmp/paimon-catch-errors.log', msg); } catch {}
  }
}
export function appSharedDir(appName: string): string {
  const dir = join(APP_DATA, "shared", appName);
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

export function appPersonDir(personId: string, appName: string): string {
  const dir = join(APP_DATA, personId, appName);
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

// ── UserAccount（用户账户统一目录）──
const USER_ACCOUNT = join(PAIMON, "UserAccount");

export function userAccountDir(): string { return USER_ACCOUNT; }

export function userFile(name: string): string {
  const ua = join(USER_ACCOUNT, name);
  if (existsSync(ua)) return ua;
  const legacy = join(CONFIG_DIR, name);
  return existsSync(legacy) ? legacy : ua;
}

// ── 域名 ──
export const PAIMON_DOMAIN = "paimon.beer";
export const WIKI_ENDPOINT_DEFAULT = `https://wiki.${PAIMON_DOMAIN}`;
export const SYNC_ENDPOINT_DEFAULT = `${WIKI_ENDPOINT_DEFAULT}/api`;

const SYNC_TUNNEL = "http://localhost:13456";
let _syncEndpointCache: string | null = null;
export function syncEndpoint(): string {
  if (_syncEndpointCache) return _syncEndpointCache;
  const svc = loadServices();
  if (svc["paimon-sync"]?.endpoint) { _syncEndpointCache = svc["paimon-sync"].endpoint as string; return _syncEndpointCache; }
  try { execSync("curl -sf --connect-timeout 1 " + SYNC_TUNNEL + "/health", { stdio: "ignore" }); _syncEndpointCache = SYNC_TUNNEL; return SYNC_TUNNEL; } catch {}
  _syncEndpointCache = SYNC_ENDPOINT_DEFAULT;
  return SYNC_ENDPOINT_DEFAULT;
}

// ── 第三方服务配置（~/.paimon/UserAccount/services.json，兼容旧 config/）──
let _servicesCache: Record<string, any> | null = null;
function loadServices(): Record<string, any> {
  if (_servicesCache) return _servicesCache;
  const ua = join(USER_ACCOUNT, "services.json");
  const legacy = join(CONFIG_DIR, "services.json");
  try {
    _servicesCache = JSON.parse(readFileSync(existsSync(ua) ? ua : legacy, "utf8"));
  } catch { _servicesCache = {}; }
  return _servicesCache!;
}

export function serviceKey(service: string, field = "apiKey"): string | null {
  const svc = loadServices()[service];
  if (!svc) return null;
  const v = svc[field];
  return (typeof v === "string" && v.trim()) ? v.trim() : null;
}

// ── 统一 API 管线 ──
function maskKey(key: string): string {
  if (key.length <= 8) return key.slice(0, 2) + "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

let _apiAgent = "system";
export function setApiAgent(agentId: string) { _apiAgent = agentId; }

function writeApiLog(entry: Record<string, any>) {
  try {
    const dir = USER_ACCOUNT;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "api.log"), JSON.stringify(entry) + "\n");
  } catch {}
}

export async function apiFetch(
  url: string,
  init: RequestInit,
  ctx: { service: string; api: string; agent?: string; key?: string },
): Promise<Response> {
  const start = Date.now();
  let status = 0;
  let error: string | undefined;
  try {
    const res = await fetch(url, init);
    status = res.status;
    return res;
  } catch (e: any) {
    error = e.message;
    throw e;
  } finally {
    writeApiLog({
      ts: new Date().toISOString(),
      agent: ctx.agent || _apiAgent,
      service: ctx.service,
      api: ctx.api,
      key: ctx.key ? maskKey(ctx.key) : undefined,
      method: (init?.method || "GET").toUpperCase(),
      url,
      status,
      ms: Date.now() - start,
      ...(error ? { error } : {}),
    });
  }
}
