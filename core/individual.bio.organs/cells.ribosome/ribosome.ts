// cells.ribosome/blood.ts
// ── 核糖体侧 ─────────────────────────────────────────────────────────────────
// 读取 RNA 转录本（individual.bio.gene/rna.json），把 prompt 交给各个 func（蛋白质）。
// 这是机器，不是基因。func 不再硬编码 prompt 文本，而是向这里取：
//   getPrompt("heart.continuous")              —— func 级 prompt（按 coded:name）
//   getDuty("brain.hippocampus", "sleep.night") —— 某 mode 下的职责 prompt（按 in/duty 的 coded:）
//
// rna.json 由 individual.bio.gene/transpiler.ts 生成。改了 .dna 要重新转录。
// 路径解析：默认相对本文件 ../../individual.bio.gene/rna.json；可用环境变量 PI_ALIVE_RNA 覆盖（部署用）。

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = resolve(RUNTIME_DIR, "../..");
const RNA_PATH = process.env.PI_ALIVE_RNA || resolve(CORE_ROOT, "individual.bio.gene/rna.json");
const PROMPTS_PATH = resolve(CORE_ROOT, "individual.bio.organs/kernel.prompt/prompts.md");

// ── RNA 类型（与 transpiler 输出对应，宽松定义）──
interface Duty { name: string; desc: string | null; coded: string | null; prompt: string | null }
interface RnaFunc {
  name: string;
  path: string | null;
  future: boolean;
  session: string[];
  modes: Record<string, "abled" | "disabled">;
  alias: string[];
  modules: string[];
  belong: string[];
  tags: string[];
  promptRefs: string[];
  prompts: Record<string, string>;
  duties: Record<string, Duty[]>;
}
interface Rna {
  sessions: string[];
  modes: Record<string, { name: string; alias: string[] }>;
  tags: Record<string, any>;
  funcs: Record<string, RnaFunc>;
  coded: Record<string, string>;
  aliasToReal: Record<string, string>;
  errors: string[];
  warnings: string[];
}

// ── 懒加载 + 校验 ──
let _rna: Rna | null = null;
export function reloadRNA(): void { _rna = null; _promptSections = null; }
export function rna(): Rna {
  if (_rna) return _rna;
  // 1. 加载 RNA（从 coded.dna 编译的转录本）
  let raw: Rna;
  try {
    raw = JSON.parse(readFileSync(RNA_PATH, "utf8"));
  } catch (e: any) {
    throw new Error(`[paimon-code] 读不到 RNA: ${RNA_PATH}\n先转录：bun individual.bio.gene/transpiler.ts\n${e?.message ?? e}`);
  }
  if (raw.errors?.length) {
    throw new Error(`[paimon-code] RNA 含 ${raw.errors.length} 个错误，拒绝运行：\n  ` + raw.errors.join("\n  "));
  }
  // 2. 缓存
  _rna = raw;
  return raw;
}

// ── 运行期状态：当前 mode / session 角色 ──
let _mode: string = process.env.PI_ALIVE_MODE || "DWN";
let _sessionRole: string = "main";

// ── prompt 取用（从 kernel.prompt/prompts.md 读取）──────────────────────────

let _promptSections: Map<string, string> | null = null;

function loadPrompts(): Map<string, string> {
  if (_promptSections) return _promptSections;
  const raw = readFileSync(PROMPTS_PATH, "utf8");
  const sections = new Map<string, string>();
  const lines = raw.split("\n");
  let currentName: string | null = null;
  let currentLines: string[] = [];
  for (const line of lines) {
    const match = line.match(/^# (\S+)\s*$/);
    if (match) {
      if (currentName !== null) {
        sections.set(currentName, currentLines.join("\n").trim());
      }
      currentName = match[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentName !== null) {
    sections.set(currentName, currentLines.join("\n").trim());
  }
  _promptSections = sections;
  return sections;
}

export function reloadPrompts(): void { _promptSections = null; }

export function getPrompt(name: string): string {
  const sections = loadPrompts();
  const p = sections.get(name);
  if (p === undefined) {
    // 兼容旧名：coded.dna 用 "mouth.speak" → prompts.md 用 "mouth"
    const short = name.replace(/\.[^.]+$/, "");
    const fallback = sections.get(short);
    if (fallback !== undefined) return fallback;
    // 再试 rna.json coded 段（过渡期兼容）
    try {
      const coded = rna().coded[name];
      if (coded !== undefined) return coded;
    } catch {}
    throw new Error(`[paimon-code] prompt 不存在: "${name}"（检查 kernel.prompt/prompts.md 是否有 # ${name} 段）`);
  }
  return p;
}

/** 取某 func 在某 mode 下的职责列表（含已解析的 prompt）。无则空数组。 */
export function getDuty(funcName: string, mode: string = _mode): Duty[] {
  return rna().funcs[funcName]?.duties[mode] ?? [];
}

/** 取某 func 在某 mode 下「第一个」职责的 prompt（最常见用法）。无则 null。 */
export function getDutyPrompt(funcName: string, mode: string = _mode): string | null {
  const d = getDuty(funcName, mode);
  return d.length ? d[0].prompt : null;
}

/** 取某 func 声明的所有 func 级 coded prompt（已解析）。 */
export function getFuncPrompts(funcName: string): string[] {
  const f = rna().funcs[funcName];
  if (!f) return [];
  return f.promptRefs.map((r) => f.prompts[r]).filter((x): x is string => !!x);
}

// ── func / mode / session 查询 ───────────────────────────────────────────────

export function getFunc(funcName: string): RnaFunc | undefined {
  // 支持 alias
  const real = rna().funcs[funcName] ? funcName : rna().aliasToReal[funcName];
  return real ? rna().funcs[real] : undefined;
}

export function listFuncs(opts?: { includeFuture?: boolean }): RnaFunc[] {
  const all = Object.values(rna().funcs);
  return opts?.includeFuture ? all : all.filter((f) => !f.future);
}

/** func 是否在某 mode 下启用。 */
export function isAbled(funcName: string, mode: string = _mode): boolean {
  return getFunc(funcName)?.modes[mode] === "abled";
}

/** func 是否该在某 session 角色里加载（session 含 "all" 或包含该角色即是）。 */
export function runsInSession(funcName: string, role: string = _sessionRole): boolean {
  const s = getFunc(funcName)?.session ?? [];
  return s.includes("all") || s.includes(role);
}

// ── mode 状态 ────────────────────────────────────────────────────────────────

export function getMode(): string { return _mode; }
export function listModes(): string[] { return Object.keys(rna().modes); }
export function setMode(mode: string): void {
  // 支持 alias（wake→DWN, sleep→sleep.night）
  const real = rna().modes[mode]
    ? mode
    : Object.values(rna().modes).find((m) => m.alias.includes(mode))?.name;
  if (!real) throw new Error(`[paimon-code] 未知 mode: "${mode}"，可用: ${listModes().join(", ")}`);
  _mode = real;
}

// ── session 角色（由 kernel 在 session_start 时设置）──
export function getSessionRole(): string { return _sessionRole; }
export function setSessionRole(role: string): void { _sessionRole = role; }

// ── 调试：原始 RNA ──
export function rnaRaw(): Rna { return rna(); }
