import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import { getBinding, type Binding } from "../account/binding.ts";
import { syncEndpoint } from "../../paths.ts";

const PAIMON = join(homedir(), ".paimon");
const USER_ACCOUNT = join(PAIMON, "UserAccount");
const RUNTIME_CACHE = join(PAIMON, "RuntimeCache");
const SHADOW_FILE = join(RUNTIME_CACHE, ".sync-shadow.json");
const LOG_DIR = join(PAIMON, "LogData");
const SYNC_LOG = join(LOG_DIR, "sync.log");
const SYNC_STATUS = join(LOG_DIR, "sync-status.json");

function syncLog(action: string, detail: string) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    appendFileSync(SYNC_LOG, `[${ts}] ${action}: ${detail}\n`);
  } catch {}
}

function saveSyncStatus(action: "pull" | "push", count: number, files: string[]) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(SYNC_STATUS, JSON.stringify({
      lastAction: action,
      lastAt: new Date().toISOString(),
      count,
      files: files.slice(0, 20),
    }, null, 2));
  } catch {}
}

const SYNC_DIRS = ["MemoryData", "SessionData", "IdentityData", "AppData", "MemoirData"];
const EXCLUDED_PATTERNS = [
  /\.log$/, /\.err\.log$/, /\.stream$/, /\.zst$/,
  /hippocampus-launch\.sh$/, /^hc-offset$/, /\.pid$/,
];

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function isExcluded(filename: string): boolean {
  return EXCLUDED_PATTERNS.some((p) => p.test(filename));
}

function isArchived(personId: string): boolean {
  const plistPath = join(PAIMON, "MemoryData", "plist.json");
  try {
    const list = JSON.parse(readFileSync(plistPath, "utf8"));
    const entry = list.find((p: any) => p.id === personId);
    return entry?.archived === true;
  } catch { return false; }
}

export interface LocalFile {
  path: string;
  hash: string;
  size: number;
}

export function scanSyncFiles(): LocalFile[] {
  const files: LocalFile[] = [];

  // plist.json
  const plistPath = join(PAIMON, "MemoryData", "plist.json");
  if (existsSync(plistPath)) {
    const buf = readFileSync(plistPath);
    files.push({ path: "MemoryData/plist.json", hash: sha256(buf), size: buf.length });
  }

  // UserAccount (except binding.json)
  const uaDir = join(PAIMON, "UserAccount");
  if (existsSync(uaDir)) {
    for (const f of readdirSync(uaDir)) {
      if (f === "binding.json" || f === "api.log") continue;
      const fp = join(uaDir, f);
      if (!statSync(fp).isFile()) continue;
      const buf = readFileSync(fp);
      files.push({ path: `UserAccount/${f}`, hash: sha256(buf), size: buf.length });
    }
  }

  // Per-agent *Data dirs
  for (const dir of SYNC_DIRS) {
    const base = join(PAIMON, dir);
    if (!existsSync(base)) continue;

    if (dir === "MemoirData") {
      for (const f of readdirSync(base)) {
        const fp = join(base, f);
        if (!statSync(fp).isFile()) continue;
        const buf = readFileSync(fp);
        files.push({ path: `MemoirData/${f}`, hash: sha256(buf), size: buf.length });
      }
      continue;
    }

    for (const personId of readdirSync(base)) {
      if (personId === "plist.json") continue;
      const personDir = join(base, personId);
      if (!existsSync(personDir) || !statSync(personDir).isDirectory()) continue;
      if (isArchived(personId)) continue;

      const walk = (d: string) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const fp = join(d, entry.name);
          if (entry.isDirectory()) { walk(fp); continue; }
          if (isExcluded(entry.name)) continue;
          const buf = readFileSync(fp);
          const relPath = relative(PAIMON, fp);
          files.push({ path: relPath, hash: sha256(buf), size: buf.length });
        }
      };
      walk(personDir);
    }
  }

  return files;
}

// ── Shadow manifest ──

interface ShadowEntry { hash: string; size: number }

function loadShadow(): Record<string, ShadowEntry> {
  try { return JSON.parse(readFileSync(SHADOW_FILE, "utf8")); } catch { return {}; }
}

function saveShadow(manifest: Record<string, ShadowEntry>) {
  mkdirSync(RUNTIME_CACHE, { recursive: true });
  writeFileSync(SHADOW_FILE, JSON.stringify(manifest));
}

// ── Sync operations ──

async function apiFetch(binding: Binding, path: string, init?: RequestInit) {
  const endpoint = syncEndpoint();
  return fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${binding.token}`,
      "X-Device-Id": binding.deviceId,
    },
  });
}

export async function pull(binding: Binding): Promise<{ pulled: number; tampered: string[] }> {
  const res = await apiFetch(binding, "/sync/manifest");
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);

  const { files: remote } = (await res.json()) as {
    files: Record<string, { hash: string; size: number; version: number }>;
  };

  const shadow = loadShadow();
  const local = scanSyncFiles();
  const localMap = new Map(local.map((f) => [f.path, f]));
  const tampered: string[] = [];

  for (const [path, entry] of Object.entries(shadow)) {
    const localFile = localMap.get(path);
    if (localFile && localFile.hash !== entry.hash) {
      tampered.push(path);
    }
  }

  const toPull: string[] = [];
  for (const [path, remoteEntry] of Object.entries(remote)) {
    const localFile = localMap.get(path);
    const shadowEntry = shadow[path];
    // 本地文件被修改过（hash ≠ shadow）→ 本地更新，不拉
    if (localFile && shadowEntry && localFile.hash !== shadowEntry.hash) continue;
    // 远程和本地一样 → 不需要拉
    if (localFile && localFile.hash === remoteEntry.hash) continue;
    // 本地没有 或 本地==shadow但远程不同 → 拉
    toPull.push(path);
  }

  if (toPull.length === 0) {
    saveShadow(Object.fromEntries(local.map((f) => [f.path, { hash: f.hash, size: f.size }])));
    return { pulled: 0, tampered };
  }

  const pullRes = await apiFetch(binding, "/sync/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: toPull }),
  });
  if (!pullRes.ok) throw new Error(`pull failed: ${pullRes.status}`);

  const { results } = (await pullRes.json()) as {
    results: Array<{ path: string; content?: string; hash?: string; error?: string }>;
  };

  let pulled = 0;
  const pulledFiles: string[] = [];
  const skippedLocal: string[] = [];
  const newShadow = { ...shadow };

  // 记录被跳过的本地修改文件
  for (const [path] of Object.entries(remote)) {
    const localFile = localMap.get(path);
    const shadowEntry = shadow[path];
    if (localFile && shadowEntry && localFile.hash !== shadowEntry.hash) {
      skippedLocal.push(path);
    }
  }
  if (skippedLocal.length > 0) syncLog("pull-skip", `${skippedLocal.length} locally modified: ${skippedLocal.join(", ")}`);

  for (const r of results) {
    if (r.error || !r.content) continue;
    const buf = Buffer.from(r.content, "base64");
    const hash = sha256(buf);
    if (r.hash && hash !== r.hash) {
      syncLog("pull-integrity-fail", r.path);
      continue;
    }
    const fp = join(PAIMON, r.path);
    mkdirSync(join(fp, ".."), { recursive: true });
    writeFileSync(fp, buf);
    newShadow[r.path] = { hash, size: buf.length };
    pulledFiles.push(r.path);
    pulled++;
  }

  if (pulled > 0) syncLog("pull", `${pulled} files: ${pulledFiles.join(", ")}`);
  saveSyncStatus("pull", pulled, pulledFiles);
  saveShadow(newShadow);
  return { pulled, tampered };
}

export async function push(binding: Binding): Promise<number> {
  const res = await apiFetch(binding, "/sync/manifest");
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);

  const { files: remote } = (await res.json()) as {
    files: Record<string, { hash: string }>;
  };

  const local = scanSyncFiles();
  const toPush = local.filter((f) => {
    const remoteEntry = remote[f.path];
    return !remoteEntry || remoteEntry.hash !== f.hash;
  });

  if (toPush.length === 0) {
    saveSyncStatus("push", 0, []);
    return 0;
  }

  const BATCH_SIZE = 20;
  let pushed = 0;
  const pushedFiles: string[] = [];

  for (let i = 0; i < toPush.length; i += BATCH_SIZE) {
    const batch = toPush.slice(i, i + BATCH_SIZE);
    const form = new FormData();
    for (const f of batch) {
      const buf = readFileSync(join(PAIMON, f.path));
      form.append(f.path, new Blob([buf]));
    }
    const pushRes = await apiFetch(binding, "/sync/push", { method: "POST", body: form });
    if (!pushRes.ok) throw new Error(`push failed: ${pushRes.status}`);
    pushed += batch.length;
    pushedFiles.push(...batch.map(f => f.path));
  }

  if (pushed > 0) syncLog("push", `${pushed} files: ${pushedFiles.join(", ")}`);
  saveSyncStatus("push", pushed, pushedFiles);

  const newShadow: Record<string, ShadowEntry> = {};
  for (const f of local) newShadow[f.path] = { hash: f.hash, size: f.size };
  saveShadow(newShadow);

  return pushed;
}

export async function acquireLock(binding: Binding, personId: string): Promise<boolean> {
  const res = await apiFetch(binding, `/sync/lock/${personId}`, { method: "POST" });
  if (res.ok) return true;
  if (res.status === 409) {
    const data = (await res.json()) as { holder?: { deviceId: string } };
    console.error(`  agent ${personId} is locked by device ${data.holder?.deviceId}`);
    return false;
  }
  throw new Error(`lock failed: ${res.status}`);
}

export async function releaseLock(binding: Binding, personId: string): Promise<void> {
  await apiFetch(binding, `/sync/lock/${personId}`, { method: "DELETE" });
}

export async function heartbeatLock(binding: Binding, personId: string): Promise<boolean> {
  const res = await apiFetch(binding, `/sync/lock/${personId}/heartbeat`, { method: "POST" });
  return res.ok;
}
