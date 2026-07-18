// apps/terminal/terminal.ts - Terminal shell for laptop
import { execSync } from "node:child_process";

type FrowFn = (t: string, i?: number) => string;
type FrowsFn = (t: string, i: number, ci?: number) => string[];
type VoidFn = () => string;

export function tInitState(cwd: string) {
  return { cwd, input: "", output: "", running: false };
}

export function tRender(st: any, frow: FrowFn, sep: VoidFn, bot: VoidFn, frows: FrowsFn, blank: () => string): string {
  const ol = (st.output || "").split("\n"); const recent = ol.slice(-18);
  let s = ""; let n = 0;
  for (let i = 0; i < recent.length && n < 18; i++) { const wls = frows(recent[i], 1, 3); for (const wl of wls) { if (n >= 18) break; s += wl + "\n"; n++; } }
  for (let i = n; i < 18; i++) s += blank() + "\n";
  if (!st.running && st.input) { s += sep() + "\n"; for (const wl of frows("$ " + st.input + "\u2588", 1, 2)) s += wl + "\n"; s += bot(); }
  else if (st.running) s += sep() + "\n" + frow("running...") + "\n" + bot();
  else s += bot();
  return s;
}

// Terminal input handling stays in kernel.ts (execSync and state mutation are wired there)
export function tHandleEnter(st: any, ws: string): any {
  if (!st.input) return st;
  st.output = (st.output || "") + "$ " + st.input + "\n";
  try {
    const r = execSync(st.input, { cwd: st.cwd || ws, timeout: 15000, encoding: "utf8", maxBuffer: 10000 });
    st.output += r;
  } catch (e: any) {
    st.output += (e.stdout || "") + (e.stderr || "") || "Error";
  }
  st.input = "";
  return st;
}
