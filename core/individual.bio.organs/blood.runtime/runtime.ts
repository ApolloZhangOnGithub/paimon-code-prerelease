// blood.runtime/runtime.ts
// ── 核糖体侧 ─────────────────────────────────────────────────────────────────
// 读取 RNA 转录本（individual.bio.gene/rna/rna.json），把 prompt 交给各个 func（蛋白质）。
// 这是机器，不是基因。func 不再硬编码 prompt 文本，而是向这里取：
//   getPrompt("heart.continuous")              —— func 级 prompt（按 coded:name）
//   getDuty("brain.hippocampus", "sleep.night") —— 某 mode 下的职责 prompt（按 in/duty 的 coded:）
//
// rna.json 由 dna.transpiler/transpiler.ts 生成。改了 .dna 要重新转录。
// 路径解析：默认相对本文件 ../../individual.bio.gene/rna/rna.json；可用环境变量 PI_ALIVE_RNA 覆盖（部署用）。

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const RUNTIME_DIR = dirname(new URL(import.meta.url).pathname);
const RNA_PATH = process.env.PI_ALIVE_RNA || resolve(RUNTIME_DIR, "../../individual.bio.gene/rna/rna.json");
const PROMPTS_PATH = process.env.PI_ALIVE_PROMPTS || resolve(RUNTIME_DIR, "../../prompts/prompts.json");

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
export function rna(): Rna {
  if (_rna) return _rna;
  // 1. 加载 RNA（从 coded.dna 编译的转录本）
  let raw: Rna;
  try {
    raw = JSON.parse(readFileSync(RNA_PATH, "utf8"));
  } catch (e: any) {
    throw new Error(`[pi-coding-master] 读不到 RNA: ${RNA_PATH}\n先转录：bun individual.bio.gene/dna.transpiler/transpiler.ts\n${e?.message ?? e}`);
  }
  if (raw.errors?.length) {
    throw new Error(`[pi-coding-master] RNA 含 ${raw.errors.length} 个错误，拒绝运行：\n  ` + raw.errors.join("\n  "));
  }
  // 2. 覆盖 prompts.json 中的统一提示词（优先级高于 coded.dna）
  //    prompots.json 是唯一真相源，coded.dna 中的对应块已弃用。
  try {
    const promptsRaw = JSON.parse(readFileSync(PROMPTS_PATH, "utf8"));
    const dna = promptsRaw?.dna;
    if (dna && typeof dna === "object") {
      for (const [name, text] of Object.entries(dna)) {
        if (typeof text === "string" && text.length > 0) {
          raw.coded[name] = text;
          // 更新 func 级 prompts 映射（让 getFuncPrompts 也能取到）
          for (const f of Object.values(raw.funcs)) {
            for (const ref of f.promptRefs) {
              if (ref === name) {
                f.prompts[ref] = text;
              }
            }
          }
        }
      }
    }
  } catch {
    // prompts.json 不存在或格式不对时不阻塞，继续用 RNA 的数据
  }
  _rna = raw;
  return raw;
}

// ── 运行期状态：当前 mode / session 角色 ──
let _mode: string = process.env.PI_ALIVE_MODE || "DWN";
let _sessionRole: string = "main";

// ── prompt 取用 ──────────────────────────────────────────────────────────────

/** 按名取 coded prompt 正文；取不到直接抛错（fail loud）。
 *  支持 import：prompt 里写 `import xxx` 会被递归替换成对应 coded 块的内容。 */
export function getPrompt(name: string): string {
  const p = rna().coded[name];
  if (p === undefined) {
    throw new Error(`[pi-coding-master] coded prompt 不存在: "${name}"（检查 coded.dna 是否有 \`coded ${name}\`，promotor.dna 是否 coded:${name}）`);
  }
  return resolveImports(p);
}

/** 递归解析 prompt 中的 `import xxx` 行 */
function resolveImports(text: string, seen: Set<string> = new Set()): string {
  return text.replace(/^import\s+(\S+)\s*$/gm, (_, name) => {
    if (seen.has(name)) return `[circular import: ${name}]`;
    seen.add(name);
    const imported = rna().coded[name];
    if (imported === undefined) return `[import not found: ${name}]`;
    return resolveImports(imported, seen);
  });
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
  if (!real) throw new Error(`[pi-coding-master] 未知 mode: "${mode}"，可用: ${listModes().join(", ")}`);
  _mode = real;
}

// ── session 角色（由 kernel 在 session_start 时设置）──
export function getSessionRole(): string { return _sessionRole; }
export function setSessionRole(role: string): void { _sessionRole = role; }

// ── 调试：原始 RNA ──
export function rnaRaw(): Rna { return rna(); }
