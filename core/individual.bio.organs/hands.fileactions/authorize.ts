import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const TRUST_FILE = resolve(dirname(new URL(import.meta.url).pathname), "authorize.TRUST");

interface TrustEntry { path: string; until?: number }
let trusted: TrustEntry[] = [];
let workDir = "";

export async function loadTrust() {
  try {
    const raw = await readFile(TRUST_FILE, "utf8");
    const data = JSON.parse(raw);
    trusted = data.trusted ?? [];
    workDir = data.workDir ?? "";
    // 清理过期
    const now = Date.now();
    trusted = trusted.filter(e => !e.until || e.until > now);
  } catch {
    trusted = [];
    workDir = "";
  }
}

async function saveTrust() {
  await mkdir(dirname(new URL(import.meta.url).pathname), { recursive: true }).catch(() => {});
  await writeFile(TRUST_FILE, JSON.stringify({ workDir, trusted }, null, 2), "utf8");
}

export function getWorkDir() { return workDir; }
export function getTrusted() { return [...trusted]; }

export async function setWorkDir(dir: string) {
  workDir = resolve(dir);
  await saveTrust();
}

export async function addTrust(dir: string, minutes?: number) {
  const path = resolve(dir);
  // 去重
  trusted = trusted.filter(e => e.path !== path);
  trusted.push({ path, until: minutes ? Date.now() + minutes * 60000 : undefined });
  await saveTrust();
}

export async function removeTrust(dir: string) {
  const path = resolve(dir);
  trusted = trusted.filter(e => e.path !== path);
  await saveTrust();
}

// 检查操作是否需要授权。返回 null=允许，返回 string=需要授权的理由
export function checkAuth(targetPath: string): string | null {
  if (!targetPath) return null;
  const abs = resolve(targetPath);
  
  // 未设置 workDir：拒绝一切写入（安全默认）
  if (!workDir) {
    return `[SAFE DEFAULT] 工作目录未设置。拒绝写入 ${targetPath}。请先用 pi workdir set <目录> 设置工作区。`;
  }
  
  // workDir 及其子目录，允许
  if (abs === workDir || abs.startsWith(workDir + "/")) return null;

  for (const t of trusted) {
    if (abs === t.path || abs.startsWith(t.path + "/")) return null;
  }
  
  return `目录 ${targetPath} 不在工作目录(${workDir})或信任目录中。用户需授权。`;
}
