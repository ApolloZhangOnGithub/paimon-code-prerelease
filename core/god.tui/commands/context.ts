import { readFileSync } from "node:fs";
import { join } from "node:path";

function readFile(p: string): string {
  try { return readFileSync(p, "utf-8"); } catch { return ""; }
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0x3000 && c <= 0x30ff) || (c >= 0xff00 && c <= 0xffef)) cjk++;
  }
  return Math.ceil(cjk * 1.8 + (text.length - cjk) / 4);
}

export async function contextHandler(_args: any, ctx: any) {
  const personDir: string | undefined = (globalThis as any).__paimonPersonDir;
  if (!personDir) { ctx.ui.notify("No person directory.", "warning"); return; }

  const modelMax = parseInt(process.env.PI_MODEL_MAX_TOKENS || "") || 1000000;
  const model = process.env.PI_MODEL || "deepseek";
  const windowLabel = modelMax >= 1000000
    ? (modelMax / 1000000).toFixed(0) + "M context"
    : (modelMax / 1000).toFixed(0) + "k context";

  const dnaIndex = readFile(join(personDir, "dna/index.md"));
  const cortex = readFile(join(personDir, "neocortex.md"));
  const workMem = readFile(join(personDir, "work_memory.md"));
  const context = readFile(join(personDir, "context.md"));
  const deepCortex = readFile(join(personDir, "deep_cortex.md"));

  const cats = [
    { name: "DNA",          tokens: estimateTokens(dnaIndex),  color: "\x1b[90m" },
    { name: "Cortex",       tokens: estimateTokens(cortex),    color: "\x1b[33m" },
    { name: "Work Memory",  tokens: estimateTokens(workMem),   color: "\x1b[32m" },
    { name: "Context",      tokens: estimateTokens(context),   color: "\x1b[34m" },
  ];
  const used = cats.reduce((s, c) => s + c.tokens, 0);
  const free = Math.max(0, modelMax - used);
  const total = modelMax;
  const pct = (n: number) => total > 0 ? (n / total * 100).toFixed(1) : "0.0";
  const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  const R = "\x1b[0m";
  const D = "\x1b[90m";
  const B = "\x1b[1m";

  const cols = 20;
  const totalCells = 200;
  const cellSize = total / totalCells;
  const rows = Math.ceil(totalCells / cols);
  const grid: string[] = [];
  let cellIdx = 0;
  for (let r = 0; r < rows; r++) {
    let row = "    ";
    for (let c = 0; c < cols; c++) {
      if (cellIdx >= totalCells) { row += "  "; cellIdx++; continue; }
      const cellMid = (cellIdx + 0.5) * cellSize;
      let acc = 0; let ci = -1;
      for (let i = 0; i < cats.length; i++) { acc += cats[i].tokens; if (cellMid < acc) { ci = i; break; } }
      row += ci >= 0 ? cats[ci].color + "◉ " + R : D + "◦ " + R;
      cellIdx++;
    }
    grid.push(row);
  }

  const info = [
    `${B}${model} (${windowLabel})${R}`,
    `${fmt(used)}/${fmt(total)} tokens (${pct(used)}%)`,
    ``,
    `${D}Estimated usage by category${R}`,
  ];
  for (const c of cats) {
    if (c.tokens > 0) info.push(`${c.color}◉${R} ${c.name}: ${fmt(c.tokens)} tokens (${pct(c.tokens)}%)`);
  }
  info.push(`${D}◦${R} Free space: ${fmt(free)} (${pct(free)}%)`);
  if (deepCortex) info.push(`${D}◎${R} Deep Cortex (disk): ${fmt(estimateTokens(deepCortex))} tokens`);

  const gridW = 4 + cols * 2;
  const pad = " ".repeat(gridW);
  const lines = [`  ${B}Context Usage${R}  ${D}(q/esc 关闭)${R}`];
  const maxRows = Math.max(grid.length, info.length);
  for (let i = 0; i < maxRows; i++) {
    const left = i < grid.length ? grid[i] : pad;
    const right = i < info.length ? "  " + info[i] : "";
    lines.push(left + right);
  }

  const { Container, Text } = require("@earendil-works/pi-tui");
  await ctx.ui.custom((_tui: any, _theme: any, _kb: any, done: any) => {
    const box = new Container();
    for (const l of lines) box.addChild(new Text(l, 0, 0));
    setTimeout(() => done(undefined), 3000);
    return box;
  });
}
