// sync.ts — 自动同步入口，launcher 在启动前/退出后调用
// 用法: bun sync.ts pull|push [--quiet]

import { getBinding } from "../god.services/account/binding.ts";
import { pull, push, scanSyncFiles } from "../god.services/sync/client.ts";

const cmd = process.argv[2];
const quiet = process.argv.includes("--quiet");

function log(msg: string) { if (!quiet) console.error(`  [sync] ${msg}`); }

async function main() {
  const binding = getBinding();
  if (!binding?.token) { if (!quiet) log("未登录，跳过同步"); process.exit(0); }

  try {
    if (cmd === "pull") {
      const result = await pull(binding);
      if (result.pulled > 0) log(`拉取 ${result.pulled} 个文件`);
      if (result.tampered.length > 0) log(`本地修改: ${result.tampered.join(", ")}`);
    } else if (cmd === "push") {
      const pushed = await push(binding);
      if (pushed > 0) log(`推送 ${pushed} 个文件`);
    } else if (cmd === "status") {
      const files = scanSyncFiles();
      console.log(`  ${files.length} 个文件待同步`);
      for (const f of files.slice(0, 20)) console.log(`    ${f.path} (${f.size}B)`);
      if (files.length > 20) console.log(`    ... 共 ${files.length} 个`);
    } else {
      console.error("usage: bun sync.ts pull|push|status [--quiet]");
      process.exit(1);
    }
  } catch (e: any) {
    if (!quiet) log(`同步失败: ${e.message}`);
    process.exit(0);
  }
}

main();
