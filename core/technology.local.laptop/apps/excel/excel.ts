// apps/excel/excel.ts - Excel spreadsheet app for laptop
import path from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── column label utils ──
const COL_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function colLabel(n: number): string {
  if (n < 26) return COL_LABELS[n];
  return COL_LABELS[Math.floor(n / 26) - 1] + COL_LABELS[n % 26];
}

// ── CSV parse helper ──
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── display width (simple ASCII) ──
function dw(c: string): number {
  const cp = c.codePointAt(0) || 0;
  if (cp >= 0x1F300 && cp <= 0x1FAFF) return 2;
  if (cp >= 0x2600 && cp <= 0x27BF) return 2;
  if ((cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) ||
      (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0x20000 && cp <= 0x2FFFF)) return 2;
  if (cp >= 0xFF01 && cp <= 0xFF60) return 2;
  return 1;
}

function padR(s: string, w: number): string {
  const d = dw(s);
  return d >= w ? s : s + " ".repeat(w - d);
}

function clip(s: string, w: number): string {
  let r = "", wi = 0;
  for (const c of [...s]) {
    const c2 = dw(c);
    if (wi + c2 > w) return r + "\u2026";
    r += c; wi += c2;
  }
  return r;
}

// ── Excel state ──
export interface ExcelState {
  cwd: string;
  file: string | null;
  dirty: boolean;
  rows: number;
  cols: number;
  cells: Record<string, string>;  // "row,col" -> value
  selRow: number;
  selCol: number;
  output: string;
  promptSaveAs?: boolean;
  promptLoad?: boolean;
}

export function xInitState(cwd: string): ExcelState {
  return {
    cwd,
    file: null,
    dirty: false,
    rows: 20,
    cols: 6,
    cells: {},
    selRow: 0,
    selCol: 0,
    output: "Excel ready. arrows=move, type=enter, save[保存] load[加载]",
  };
}

// ── render ──
export function xRender(
  st: ExcelState,
  W: number,
  frow: (t: string, i?: number) => string,
  sep: () => string,
  bot: () => string,
): string {
  let { rows, cols, cells, selRow, selCol } = st;

  // calculate column widths (min 8, max 16)
  const cw: number[] = [];
  for (let c = 0; c < cols; c++) {
    let maxW = Math.max(8, dw(colLabel(c)) + 1);
    for (let r = 0; r < rows; r++) {
      const v = cells[`${r},${c}`] || "";
      maxW = Math.max(maxW, dw(v) + 1);
    }
    cw.push(Math.min(maxW + 1, 16));
  }

  // auto-fit visible columns to window (row#=3 + per-col cw+1 + final│=1)
  let visibleCols = cols, usedW = 3;
  for (let c = 0; c < cols; c++) { usedW += cw[c] + 1; if (usedW > W - 4) { visibleCols = c; break; } }
  if (selCol >= visibleCols) selCol = visibleCols - 1;

  let s = "";

  // Column headers (each cw[c] wide with │ separators)
  let rh = "  ";
  for (let c = 0; c < visibleCols; c++) {
    rh += "\u2502 " + padR(colLabel(c), cw[c] - 2);
  }
  rh += "\u2502";
  s += frow(rh, 1) + "\n";

  // Separator (dashes only, perfect alignment with data │ separators)
  let sepLine = "\u2500\u2500";
  for (let c = 0; c < visibleCols; c++) sepLine += "\u2500".repeat(cw[c]);
  sepLine += "\u2500";
  s += frow(sepLine, 1) + "\n";

  // Data rows
  for (let r = 0; r < rows; r++) {
    let line = (r + 1).toString().padStart(2);
    for (let c = 0; c < visibleCols; c++) {
      const v = cells[`${r},${c}`] || "";
      const display = clip(v, cw[c] - 2);
      if (r === selRow && c === selCol) {
        line += "\u2502[" + padR(display, cw[c] - 3) + "]";
      } else {
        line += "\u2502 " + padR(display, cw[c] - 2);
      }
    }
    line += "\u2502";
    s += frow(line, 1) + "\n";
  }

  // Status bar
  const cellRef = colLabel(selCol) + (selRow + 1);
  const cellVal = cells[`${selRow},${selCol}`] || "";
  s += sep() + "\n";
  s += frow("  " + cellRef + ": " + (cellVal || "(empty)"), 1) + "\n";

  if (st.file) {
    s += frow("  file: " + path.basename(st.file) + (st.dirty ? " *" : ""), 1) + "\n";
  }
  if (st.output) {
    s += frow("  " + clip(st.output, W - 8), 1) + "\n";
  }
  s += bot();
  return s;
}

// ── click handler ──
export function xClick(st: ExcelState, id: string): ExcelState {
  if (id === "save") {
    return xSave(st);
  }
  if (id === "saveas") {
    return { ...st, promptSaveAs: true, output: "Type filename to save as (.csv)..." };
  }
  if (id === "load") {
    return { ...st, promptLoad: true, output: "Type CSV filename to load..." };
  }
  if (id === "new") {
    return {
      ...st,
      file: null,
      dirty: false,
      cells: {},
      selRow: 0,
      selCol: 0,
      promptSaveAs: false,
      promptLoad: false,
      output: "New spreadsheet",
    };
  }
  if (id === "clear") {
    const key = `${st.selRow},${st.selCol}`;
    const newCells = { ...st.cells };
    delete newCells[key];
    return { ...st, cells: newCells, dirty: true, output: "Cell cleared" };
  }
  return st;
}

// ── press handler ──
export function xPress(st: ExcelState, k: string): ExcelState {
  if (k === "Up" && st.selRow > 0) {
    return { ...st, selRow: st.selRow - 1 };
  }
  if (k === "Down" && st.selRow < st.rows - 1) {
    return { ...st, selRow: st.selRow + 1 };
  }
  if (k === "Left" && st.selCol > 0) {
    return { ...st, selCol: st.selCol - 1 };
  }
  if (k === "Right" && st.selCol < st.cols - 1) {
    return { ...st, selCol: st.selCol + 1 };
  }
  if (k === "Backspace") {
    const key = `${st.selRow},${st.selCol}`;
    const newCells = { ...st.cells };
    if (newCells[key] !== undefined && newCells[key] !== "") {
      if (newCells[key].length <= 1) {
        delete newCells[key];
      } else {
        newCells[key] = newCells[key].slice(0, -1);
      }
      return { ...st, cells: newCells, dirty: true };
    }
  }
  if (k === "Enter") {
    if (st.selRow < st.rows - 1) {
      return { ...st, selRow: st.selRow + 1 };
    }
  }
  if (k === "Tab") {
    if (st.selCol < st.cols - 1) {
      return { ...st, selCol: st.selCol + 1 };
    } else if (st.selRow < st.rows - 1) {
      return { ...st, selCol: 0, selRow: st.selRow + 1 };
    }
  }
  return st;
}

// ── type handler ──
export function xType(st: ExcelState, t: string): ExcelState {
  // strip quotes if wrapped
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1);
  }

  // handle save-as prompt
  if (st.promptSaveAs) {
    let fp = t.startsWith("/") ? t : path.join(st.cwd, t);
    if (!fp.endsWith(".csv")) fp += ".csv";
    return xSaveTo({ ...st, file: fp, promptSaveAs: false });
  }

  // handle load prompt
  if (st.promptLoad) {
    const fp = t.startsWith("/") ? t : path.join(st.cwd, t);
    if (!existsSync(fp)) {
      return { ...st, promptLoad: false, output: "File not found: " + t };
    }
    try {
      const content = readFileSync(fp, "utf8");
      const lines = content.split(/\r?\n/).filter(l => l.trim() !== "");
      const newCells: Record<string, string> = {};
      for (let r = 0; r < lines.length; r++) {
        const cols = parseCSVLine(lines[r]);
        for (let c = 0; c < cols.length; c++) {
          const v = cols[c].trim();
          if (v) newCells[`${r},${c}`] = v;
        }
      }
      // auto-expand rows/cols to fit CSV
      const maxC = Math.max(st.cols, lines.reduce((mx: number, l: string) => Math.max(mx, parseCSVLine(l).length), 0));
      const maxR = Math.max(st.rows, lines.length);
      return {
        ...st,
        cells: newCells,
        file: fp,
        dirty: false,
        promptLoad: false,
        selRow: 0,
        selCol: 0,
        rows: maxR > st.rows ? maxR + 2 : st.rows,
        cols: maxC > st.cols ? maxC + 1 : st.cols,
        output: "Loaded: " + path.basename(fp) + " (" + Object.keys(newCells).length + " cells, " + maxC + " col × " + maxR + " row)",
      };
    } catch (e: any) {
      return { ...st, promptLoad: false, output: "Load error: " + e.message };
    }
  }

  // enter value into cell
  const key = `${st.selRow},${st.selCol}`;
  const newCells = { ...st.cells };
  newCells[key] = t;
  let next = { ...st, cells: newCells, dirty: true, output: "Cell " + colLabel(st.selCol) + (st.selRow + 1) + " set" };

  // auto-move down
  if (st.selRow < st.rows - 1) {
    next = { ...next, selRow: st.selRow + 1 };
  }

  return next;
}

// ── save helpers (used by click "save" and save-as prompt) ──
function xSave(st: ExcelState): ExcelState {
  if (!st.file) {
    return { ...st, promptSaveAs: true, output: "No file. Type filename:" };
  }
  return xSaveTo(st);
}

function xSaveTo(st: ExcelState): ExcelState {
  if (!st.file) return st;
  try {
    const lines: string[] = [];
    for (let r = 0; r < st.rows; r++) {
      const cols: string[] = [];
      for (let c = 0; c < st.cols; c++) {
        let v = st.cells[`${r},${c}`] || "";
        if (v.includes(",") || v.includes('"') || v.includes("\n")) {
          v = '"' + v.replace(/"/g, '""') + '"';
        }
        cols.push(v);
      }
      // trim trailing empty columns
      while (cols.length > 0 && cols[cols.length - 1] === "") cols.pop();
      if (cols.length > 0) lines.push(cols.join(","));
    }
    writeFileSync(st.file, lines.join("\n"), "utf8");
    return { ...st, dirty: false, output: "Saved: " + path.basename(st.file) };
  } catch (e: any) {
    return { ...st, output: "Save error: " + e.message };
  }
}

// ── open-create hook (called by kernel when opening from Finder) ──
export function xOpenCreate(fp: string, ws: string): { type: string; state: any; min: boolean; full: boolean } | null {
  try {
    const csv = readFileSync(fp, "utf8");
    const lines = csv.split(/\r?\n/).filter((l: string) => l.trim());
    const cells: Record<string, string> = {};
    let maxC = 0;
    for (let r = 0; r < lines.length; r++) {
      const parts = lines[r].split(",");
      maxC = Math.max(maxC, parts.length);
      for (let c = 0; c < parts.length; c++) if (parts[c]) cells[`${r},${c}`] = parts[c];
    }
    return {
      type: "Excel",
      state: { ...xInitState(ws), file: fp, cells, rows: Math.max(20, lines.length + 2), cols: Math.max(6, maxC + 1), output: "Opened from Finder: " + path.basename(fp) },
      min: false, full: false,
    };
  } catch { return null; }
}
