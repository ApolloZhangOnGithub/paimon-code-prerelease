// watcher.ts — 文件变动监控 + 自动部署 + 推送给 agent
// 启动时对源码目录 recursive watch，有 .ts 文件变动 → auto build → deploy → 推消息
import { watch } from "node:fs";
import { exec } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function installWatcher(pi: ExtensionAPI, devRoot: string) {
  const { existsSync } = require("node:fs");
  if (!existsSync(devRoot)) return;

  // 自动发现 device-manifest.ts 所在目录
  const { execSync: es } = require("node:child_process");
  let srcDir = "";
  try {
    srcDir = es(`find "${devRoot}" -name 'technology-manifest.ts' -not -path '*/node_modules/*' -not -path '*/individual.bio.*/*' 2>/dev/null | head -1`, { encoding: "utf8" }).trim();
  } catch { return; }
  if (!srcDir) return;
  srcDir = require("node:path").dirname(srcDir);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const deploy = () => {
    const cmd = `find "${devRoot}" -name 'technology-manifest.ts' -not -path '*/node_modules/*' -not -path '*/individual.bio.*/*' | head -1 | xargs dirname | xargs -I{} rsync -a {}/ ~/.pi/agent/extensions/device/`;
    exec(cmd, (err, stdout, stderr) => {
      const out = stdout + stderr;
      if (!err) return; // silent on success
      try {
        pi.sendMessage({
          messageType: "watcher-deploy",
          content: `WARN: auto-deploy failed:\n${stderr}`,
          isDisplayedInTUI: true,
        }, { deliverAs: "nextTurn" });
      } catch {}
    });
  };

  try {
    const w = watch(srcDir, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.endsWith(".ts")) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(deploy, 2000);
    });
    (globalThis as any).__piWatcher = w;
  } catch {}
}
