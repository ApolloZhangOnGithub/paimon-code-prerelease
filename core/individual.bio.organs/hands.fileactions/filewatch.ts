import { watch } from "node:fs";
import { readdir, stat, appendFile, access } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";

const LOG_DIRS = [
  resolve("gut-lm"),
  resolve(dirname(new URL(import.meta.url).pathname), ".."),
];
const DEBOUNCE_MS = 500;

const pending = new Map<string, NodeJS.Timeout>();

function fmt(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

async function logChange(filePath: string, action: string) {
  try {
    const clPath = `${filePath}.CHANGELOG`;
    await appendFile(clPath, `[${fmt()}] ${action}\n`, "utf8");
  } catch {}
}

async function scanDir(dir: string) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = resolve(dir, e.name);
      if (e.isDirectory()) await scanDir(full);
    }
  } catch {}
}

export function startWatcher() {
  for (const dir of LOG_DIRS) {
    // 递归 watch
    watch(dir, { recursive: true, persistent: false }, async (event, filename) => {
      if (!filename || filename.startsWith(".")) return;
      const fullPath = resolve(dir, filename);
      
      // debounce
      const existing = pending.get(fullPath);
      if (existing) clearTimeout(existing);
      
      pending.set(fullPath, setTimeout(async () => {
        pending.delete(fullPath);
        try {
          await stat(fullPath);
          // File exists now - created or modified
          if (event === "rename") {
            await logChange(fullPath, "created/modified");
          } else {
            await logChange(fullPath, "modified");
          }
        } catch {
          // File gone - deleted
          await logChange(fullPath, "deleted");
        }
      }, DEBOUNCE_MS));
    }).unref(); // don't keep process alive
  }
  
  console.log("[filewatch] watching", LOG_DIRS.map(d => relative(process.cwd(), d)));
}
