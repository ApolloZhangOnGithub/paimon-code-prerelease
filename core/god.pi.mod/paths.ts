// paths.ts — 全局路径常量（唯一真相源）
// 目录结构变了只改这里，其他文件全部 import { DIRS } from "#paths"

import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";

const CORE = resolve(dirname(new URL(import.meta.url).pathname), "..");
const ROOT = resolve(CORE, "../..");

export const DIRS = {
  root: ROOT,
  core: CORE,

  organs: resolve(CORE, "individual.bio.organs"),
  gene: resolve(CORE, "individual.bio.gene"),

  docs: resolve(ROOT, "Docs"),
  devIssues: resolve(ROOT, "Docs/Dev/Issues"),
  devLessons: resolve(ROOT, "Docs/Dev/Lessons"),
  devNorms: resolve(ROOT, "Docs/Dev/Norms"),

  deploy: resolve(ROOT, "Codebase/deploy"),
  server: resolve(CORE, "technology.server"),
  browserService: process.env.PI_BROWSER || "http://localhost:9222",
} as const;

// ── person 目录解析（统一入口，不要各文件自己写）──
// personDir = ~/.pi/memory/<id>（不含 .data）
// personDataDir = ~/.pi/memory/<id>/.data
const PEOPLE_DIR = join(homedir(), ".pi/memory");

export function personDir(sessionFile: string | null | undefined): string | null {
  if (!sessionFile) return null;
  const m = sessionFile.match(/\.pi\/memory\/([a-f0-9]+)\//);
  return m ? join(PEOPLE_DIR, m[1]) : null;
}

export function personDataDir(sessionFile: string | null | undefined): string | null {
  const pd = personDir(sessionFile);
  return pd ? join(pd, ".data") : null;
}

export function personId(sessionFile: string | null | undefined): string | null {
  if (!sessionFile) return null;
  const m = sessionFile.match(/\.pi\/memory\/([a-f0-9]+)\//);
  return m ? m[1] : null;
}
