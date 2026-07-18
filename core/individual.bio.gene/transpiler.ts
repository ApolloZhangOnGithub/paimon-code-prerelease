// individual.bio.gene/transpiler.ts
// ── RNA polymerase ──────────────────────────────────────────────────────────
// 把基因组（individual.bio.gene/dna.*/promotor.dna + coded.dna）转录成 RNA（individual.bio.gene/rna.json）。
// 这是机器，不是基因：它用代码实现 rules.dna 里写的规则，本身不写进 DNA。
//
// 两套解析器（coded 和 promotor 互不相同）：
//   parsePromotor() —— 缩进式声明语言：vir / func / session / mode / tag / in / duty / coded:
//   parseCoded()    —— 只认 `coded <name> """ ... """` 三引号块，正文整段当字符串
//
// 然后 compile()：补全双向 belong/contain、解析 mode:abled、把 coded:name 解析成实际 prompt、
// 校验（未声明的 vir 前缀=error，缺 session/mode=warning，coded 引用不到=error）。
//
// 运行：  bun individual.bio.gene/transpiler.ts        （从 Codebase/core 根目录）
// 产物：  individual.bio.gene/rna.json

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logerr } from "#paths";

const GENE_ROOT = dirname(fileURLToPath(import.meta.url));
const ORGANS_DIR = resolve(GENE_ROOT, "../individual.bio.organs");

// ── 类型 ─────────────────────────────────────────────────────────────────────
type Duty = { name: string; desc: string; coded: string | null };
type FuncDecl = {
  name: string;
  future: boolean;
  session: string[]; // ["all"] / ["none"] / ["main", ...]
  abled: { mode: "any" | "none" | "list"; list: string[] };
  alias: string[];
  modules: string[];
  belong: string[];
  contain: string[];
  codedRefs: string[]; // func 级 coded:（不分 mode）
  duties: Record<string, Duty[]>; // mode -> duties（来自 `in <mode>`）
};
type ModeDecl = { name: string; alias: string[]; abled: string[] };
type TagDecl = { name: string; belong: string[]; contain: string[] };

// ── 工具 ─────────────────────────────────────────────────────────────────────
const stripComment = (l: string) => {
  const i = l.indexOf("//");
  return i >= 0 ? l.slice(0, i) : l;
};
const indentOf = (l: string) => l.length - l.replace(/^ +/, "").length;
const splitList = (s: string) =>
  s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

// ── 解析 promotor.dna ────────────────────────────────────────────────────────
function parsePromotor(text: string) {
  const virs = new Set<string>(); // 去掉前导 . 的 vir 地址，如 "body" / "body.hands"
  const funcs: Record<string, FuncDecl> = {};
  const modes: Record<string, ModeDecl> = {};
  const sessions: string[] = [];
  const tags: Record<string, TagDecl> = {};

  let cur: { kind: "func" | "mode" | "tag" | "vir"; name: string } | null = null;
  let curIn: string | null = null; // func 内当前 `in <mode>`
  let curDuty: Duty | null = null;

  const lines = text.split("\n");
  for (const raw of lines) {
    const line = stripComment(raw).replace(/\s+$/, "");
    if (!line.trim()) continue;
    const indent = indentOf(line);
    const t = line.trim();

    // ── 顶层声明（indent 0）──
    if (indent === 0) {
      curIn = null;
      curDuty = null;
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^vir\s+\.(\S+)/))) {
        virs.add(m[1]);
        cur = { kind: "vir", name: m[1] };
      } else if ((m = t.match(/^(future\s+)?func\s+(\S+)/))) {
        const name = m[2];
        funcs[name] = {
          name,
          future: !!m[1],
          session: [],
          abled: { mode: "list", list: [] },
          alias: [],
          modules: [],
          belong: [],
          contain: [],
          codedRefs: [],
          duties: {},
        };
        cur = { kind: "func", name };
      } else if ((m = t.match(/^session\s+(\S+)/))) {
        if (!sessions.includes(m[1])) sessions.push(m[1]);
        cur = null;
      } else if ((m = t.match(/^mode\s+(\S+)/))) {
        modes[m[1]] = { name: m[1], alias: [], abled: [] };
        cur = { kind: "mode", name: m[1] };
      } else if ((m = t.match(/^tag\s+(\S+)/))) {
        tags[m[1]] = { name: m[1], belong: [], contain: [] };
        cur = { kind: "tag", name: m[1] };
      } else {
        cur = null;
      }
      continue;
    }

    // ── 缩进行：归属当前顶层块 ──
    if (!cur) continue;

    if (cur.kind === "func") {
      const f = funcs[cur.name];
      let m: RegExpMatchArray | null;
      // func 级属性 → 重置 in/duty 上下文
      if ((m = t.match(/^session\s+(.+)/))) {
        f.session = splitList(m[1]);
        curIn = null; curDuty = null;
      } else if ((m = t.match(/^mode:abled\s+(.+)/))) {
        const list = splitList(m[1]);
        if (list.includes("any")) f.abled = { mode: "any", list: [] };
        else if (list.includes("none")) f.abled = { mode: "none", list: [] };
        else f.abled = { mode: "list", list };
        curIn = null; curDuty = null;
      } else if (t.match(/^mode:disabled\s+/)) {
        curIn = null; curDuty = null; // 暂不支持减法，忽略
      } else if ((m = t.match(/^alias\s+(.+)/))) {
        f.alias.push(...splitList(m[1])); curIn = null; curDuty = null;
      } else if ((m = t.match(/^module\s+(.+)/))) {
        f.modules.push(...splitList(m[1])); curIn = null; curDuty = null;
      } else if ((m = t.match(/^belong\s+(.+)/))) {
        f.belong.push(...splitList(m[1])); curIn = null; curDuty = null;
      } else if ((m = t.match(/^contain\s+(.+)/))) {
        f.contain.push(...splitList(m[1])); curIn = null; curDuty = null;
      } else if ((m = t.match(/^in\s+(\S+)/))) {
        curIn = m[1];
        if (!f.duties[curIn]) f.duties[curIn] = [];
        curDuty = null;
      } else if ((m = t.match(/^duty\s+(\S+)/))) {
        curDuty = { name: m[1], desc: "", coded: null };
        if (curIn) f.duties[curIn].push(curDuty);
      } else if ((m = t.match(/^coded:(\S+)/))) {
        if (curDuty) curDuty.coded = m[1];
        else f.codedRefs.push(m[1]); // func 级
      } else if (curDuty) {
        // duty 描述续行
        curDuty.desc = (curDuty.desc ? curDuty.desc + " " : "") + t;
      }
    } else if (cur.kind === "mode") {
      const md = modes[cur.name];
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^alias\s+(.+)/))) md.alias.push(...splitList(m[1]));
      else if ((m = t.match(/^abled\s*(.*)/))) md.abled.push(...splitList(m[1]));
    } else if (cur.kind === "tag") {
      const tg = tags[cur.name];
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^belong\s+(.+)/))) tg.belong.push(...splitList(m[1]));
      else if ((m = t.match(/^contain\s+(.+)/))) tg.contain.push(...splitList(m[1]));
    }
  }

  return { virs, funcs, modes, sessions, tags };
}

// ── 解析 coded.dna ───────────────────────────────────────────────────────────
function parseCoded(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  // `coded <name> """\n ...body... \n"""`，正文不解析；正文里没有三连引号。
  const re = /^coded[ \t]+(\S+)[ \t]+"""\n([\s\S]*?)\n"""/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}

// ── 编译：promotor + coded → RNA ─────────────────────────────────────────────
function compile(
  p: ReturnType<typeof parsePromotor>,
  coded: Record<string, string>,
  opts: { strict?: boolean } = {},
) {
  const strict = opts.strict !== false;
  const errors: string[] = [];
  const warnings: string[] = [];
  const modeNames = Object.keys(p.modes);

  // alias → 实名 解析表（func/tag 都能起别名）
  const aliasToReal: Record<string, string> = {};
  for (const f of Object.values(p.funcs))
    for (const a of f.alias) aliasToReal[a] = f.name;

  // ── 双向 belong/contain 补全（func ↔ tag）──
  const tagContains: Record<string, Set<string>> = {};
  const funcTags: Record<string, Set<string>> = {};
  for (const name of Object.keys(p.tags)) tagContains[name] = new Set();
  for (const name of Object.keys(p.funcs)) funcTags[name] = new Set();

  const resolveTag = (x: string) => p.tags[x] ? x : (aliasToReal[x] ?? x);

  // func.belong T  →  func∈T
  for (const f of Object.values(p.funcs)) {
    for (const b of f.belong) {
      const tg = resolveTag(b);
      if (!p.tags[tg]) { warnings.push(`func ${f.name} belong 未声明的 tag: ${b}`); continue; }
      funcTags[f.name].add(tg);
      tagContains[tg].add(f.name);
    }
  }
  // tag.contain X  →  X∈tag （X 可为 func 名 / alias / tag 命名空间内的相对 alias / 子 tag）
  for (const tg of Object.values(p.tags)) {
    for (const c of tg.contain) {
      // 解析顺序：实名 func → 全局 alias → tag 命名空间下的相对 alias（如 memory 下的 hippocampus = memory.hippocampus）
      let real = p.funcs[c] ? c : aliasToReal[c];
      if (!real && aliasToReal[`${tg.name}.${c}`]) real = aliasToReal[`${tg.name}.${c}`];
      real = real ?? c;
      if (p.funcs[real]) { funcTags[real].add(tg.name); tagContains[tg.name].add(real); }
      else if (p.tags[real]) { tagContains[tg.name].add(real); } // 子 tag 关系
      else warnings.push(`tag ${tg.name} contain 未知目标: ${c}`);
    }
  }

  // ── tag 传递闭包：dotted 父子（lobes.temporal ⊂ lobes）+ tag.belong 上级 ──
  const tagParents: Record<string, Set<string>> = {};
  for (const name of Object.keys(p.tags)) {
    tagParents[name] = new Set();
    // dotted 层级父：lobes.temporal → lobes
    const segs = name.split(".");
    for (let i = 1; i < segs.length; i++) {
      const anc = segs.slice(0, i).join(".");
      if (p.tags[anc]) tagParents[name].add(anc);
    }
    // 显式 tag.belong（如 lobes belong brain —— brain 是 vir，不是 tag，跳过非 tag）
    for (const b of p.tags[name].belong) {
      const r = resolveTag(b);
      if (p.tags[r]) tagParents[name].add(r);
    }
  }
  const allAncestors = (tag: string, seen = new Set<string>()): Set<string> => {
    for (const par of tagParents[tag] ?? []) {
      if (!seen.has(par)) { seen.add(par); allAncestors(par, seen); }
    }
    return seen;
  };

  // ── vir 前缀校验：func 名除最后一段外，每级前缀必须是已声明 vir（或本身是 func）──
  const checkVirPrefix = (name: string) => {
    const segs = name.split(".");
    for (let i = 1; i < segs.length; i++) {
      const pre = segs.slice(0, i).join(".");
      if (!p.virs.has(pre) && !p.funcs[pre]) {
        errors.push(`func ${name} 的前缀 .${pre} 未用 vir 声明`);
      }
    }
  };

  // ── coded 解析 ──
  const resolveCoded = (ref: string, where: string): string | null => {
    if (coded[ref] !== undefined) return coded[ref];
    errors.push(`${where} 引用的 coded:${ref} 在 coded.dna 中找不到`);
    return null;
  };

  // ── 反向校验: coded.dna 里每个块都必须被至少一个 func 引用（变体模式跳过）──
  if (strict) {
    const allRefs = new Set<string>();
    for (const f of Object.values(p.funcs)) {
      for (const r of f.codedRefs) allRefs.add(r);
      for (const ds of Object.values(f.duties)) for (const d of ds) if (d.coded) allRefs.add(d.coded);
    }
    for (const k of Object.keys(coded)) {
      if (!allRefs.has(k)) {
        errors.push(`coded:${k} 在 coded.dna 中定义但没有任何 func 引用它。请在 promotor.dna 中对应的 func 下加 coded:${k}`);
      }
    }
  }

  // ── 检测 organs/ 下有 .ts 文件但未在 promotor.dna 声明的目录（变体跳过）──
  if (strict) try {
    const INFRA_DIRS = new Set(["cells.ribosome", "hands.execute", "kernel.core", "kernel.backbone", "hands.terminal"]); // backbone=消息总线库(#kernel_backbone)；terminal 由 mobile kernel 注册，均不走 promotor 激活
    const entries = readdirSync(ORGANS_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || INFRA_DIRS.has(e.name)) continue;
      const dirPath = `${ORGANS_DIR}/${e.name}`;
      const hasTS = readdirSync(dirPath).some((f: string) => f.endsWith(".ts") && !f.includes(".CHANGELOG") && !f.endsWith(".SPEC"));
      if (hasTS && !p.funcs[e.name]) {
        warnings.push(`individual.bio.organs/${e.name}/ 有 .ts 但未在 promotor.dna 声明 func。`);
      }
    }
  } catch {}

  // ── 逐 func 生成 ──
  const rnaFuncs: Record<string, any> = {};
  for (const f of Object.values(p.funcs)) {
    checkVirPrefix(f.name);

    // session 默认
    let session = f.session;
    if (session.length === 0) {
      session = ["all"];
      if (!f.future) warnings.push(`func ${f.name} 未声明 session，默认 all`);
    }

    // 每个 mode 的启用状态
    const modesResolved: Record<string, "abled" | "disabled"> = {};
    if (f.abled.mode === "any") for (const m of modeNames) modesResolved[m] = "abled";
    else if (f.abled.mode === "none") for (const m of modeNames) modesResolved[m] = "disabled";
    else {
      if (f.abled.list.length === 0 && !f.future)
        warnings.push(`func ${f.name} 未声明 mode:abled，默认全部 disabled`);
      for (const m of modeNames)
        modesResolved[m] = f.abled.list.includes(m) ? "abled" : "disabled";
    }

    // func 级 coded（不分 mode）
    const prompts: Record<string, string> = {};
    for (const ref of f.codedRefs) {
      const txt = resolveCoded(ref, `func ${f.name}`);
      if (txt !== null) prompts[ref] = txt;
    }

    // 各 mode 的 duties（带解析后的 prompt）
    const duties: Record<string, any[]> = {};
    for (const [mode, list] of Object.entries(f.duties)) {
      duties[mode] = list.map((d) => {
        let prompt: string | null = null;
        if (d.coded) prompt = resolveCoded(d.coded, `func ${f.name} in ${mode} duty ${d.name}`);
        return { name: d.name, desc: d.desc || null, coded: d.coded, prompt };
      });
    }

    // tag 传递闭包
    const directTags = new Set(funcTags[f.name]);
    const transTags = new Set(directTags);
    for (const tg of directTags) for (const anc of allAncestors(tg)) transTags.add(anc);

    rnaFuncs[f.name] = {
      name: f.name,
      path: f.future ? null : `individual.bio.organs/${f.name}`,
      future: f.future,
      session,
      modes: modesResolved,
      alias: f.alias,
      modules: f.modules,
      belong: f.belong,
      tags: [...transTags].sort(),
      tagsDirect: [...directTags].sort(),
      promptRefs: f.codedRefs,
      prompts,
      duties,
    };
  }

  // ── tag 表 ──
  const rnaTags: Record<string, any> = {};
  for (const [name, tg] of Object.entries(p.tags)) {
    rnaTags[name] = {
      name,
      belong: tg.belong,
      parents: [...(tagParents[name] ?? [])].sort(),
      members: [...tagContains[name]].sort(),
    };
  }

  // ── mode 表 ──
  const rnaModes: Record<string, any> = {};
  for (const [name, md] of Object.entries(p.modes))
    rnaModes[name] = { name, alias: md.alias };

  return {
    generatedFrom: ["individual.bio.gene/promotor.dna", "individual.bio.gene/coded.dna"],
    note: "GENERATED by individual.bio.gene/transpiler.ts — 不要手改，改 .dna 后重新转录。",
    sessions: p.sessions,
    modes: rnaModes,
    tags: rnaTags,
    funcs: rnaFuncs,
    coded,
    aliasToReal,
    errors,
    warnings,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
function transcribe(promotorPath: string, codedPaths: string[], outPath: string, label: string, strict = true) {
  const promotorText = readFileSync(promotorPath, "utf8");
  let codedText = "";
  for (const cp of codedPaths) {
    codedText += readFileSync(cp, "utf8") + "\n";
  }

  const parsed = parsePromotor(promotorText);
  const coded = parseCoded(codedText);
  const rna = compile(parsed, coded, { strict });

  writeFileSync(outPath, JSON.stringify(rna, null, 2) + "\n");

  const F = Object.keys(rna.funcs).length;
  const C = Object.keys(coded).length;
  console.log(`transcribed → ${label}  (${F} funcs, ${C} coded prompts)`);
  for (const w of rna.warnings) console.log(`  WARN: ${w}`);
  for (const e of rna.errors) console.log(`  ✗ error:   ${e}`);
  if (rna.errors.length) {
    console.log(`\n${rna.errors.length} error(s) — RNA 已写出但不应用于运行。`);
    process.exit(1);
  }
}

function main() {
  const CORE_ROOT = resolve(GENE_ROOT, "..");

  // 默认转录（coding-agent）
  transcribe(
    `${GENE_ROOT}/promotor.dna`,
    [`${GENE_ROOT}/coded.dna`],
    `${GENE_ROOT}/rna.json`,
    "individual.bio.gene/rna.json"
  );

  // 变体转录：扫描 variants.kinds.*/promotor.*.dna
  const variantsBase = resolve(CORE_ROOT, ".");
  try {
    for (const entry of readdirSync(variantsBase, { withFileTypes: true })) {
      if (!entry.name.startsWith("variants.kinds.") || !entry.isDirectory()) continue;
      const kind = entry.name.replace("variants.kinds.", "");
      const varDir = resolve(variantsBase, entry.name);
      const varPromotor = resolve(varDir, `promotor.${kind}.dna`);
      const varCoded = resolve(varDir, `coded.${kind}.dna`);
      try { readFileSync(varPromotor); } catch { continue; }
      const codedPaths = [`${GENE_ROOT}/coded.dna`];
      try { readFileSync(varCoded); codedPaths.push(varCoded); } catch {}
      const outPath = resolve(varDir, "rna.json");
      transcribe(varPromotor, codedPaths, outPath, `variants.kinds.${kind}/rna.json`, false);
    }
  } catch {}
}

main();
