// techs/sh.ts — 统一的异步 shell 执行模块
// 所有扩展工具引用这个模块，永不使用 execSync/同步阻塞。
import { exec } from "node:child_process";

/** 异步执行 shell 命令，返回 stdout；失败抛错 */
export function asyncSh(cmd: string, timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: "utf8", timeout }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** 异步执行 shell 命令，失败返回空串（不抛错） */
export async function asyncShSafe(cmd: string, timeout = 5000): Promise<string> {
  try { return await asyncSh(cmd, timeout); } catch { return ""; }
}
