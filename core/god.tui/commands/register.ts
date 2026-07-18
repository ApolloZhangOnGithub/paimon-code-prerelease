// god.tui/commands/register.ts
// god 层自己注册所有用户命令。agent 内核不 import 这个文件。
// headless 模式下不加载此文件，agent 照常运行，只是没有 /xxx 命令。

import { configHandler } from "./config.ts";
import { toolsHandler } from "./tools.ts";
import { authdirHandler, authdirCompletions } from "./authdir.ts";
import { quitHandler } from "./quit.ts";
import { contextHandler } from "./context.ts";
import { pauseHandler } from "./pause.ts";
import { compactHandler } from "./compact.ts";
import { renameHandler } from "./rename.ts";
import { identityHandler } from "./identity.ts";

export function registerGodCommands(pi: any) {
  pi.registerCommand("config", {
    description: "配置第三方服务 API Key",
    handler: configHandler,
  });
  pi.registerCommand("tools", {
    description: "列出当前可用工具",
    handler: toolsHandler(() => pi.getActiveTools() ?? []),
  });
  pi.registerCommand("authdir", {
    description: "白名单授权目录",
    messageDescription: "白名单授权: /authdir <目录> [分钟] | /authdir all | /authdir remove <目录|all>",
    getArgumentCompletions: authdirCompletions,
    handler: authdirHandler,
  });
  pi.registerCommand("quit", {
    description: "退出 Paimon",
    handler: quitHandler,
  });
  pi.registerCommand("context", {
    description: "上下文用量",
    handler: contextHandler,
  });
  pi.registerCommand("pause", {
    description: "暂停/恢复 agent",
    handler: pauseHandler,
  });
  pi.registerCommand("compact", {
    description: "压缩上下文记忆",
    handler: compactHandler,
  });
  pi.registerCommand("rename", {
    description: "改名 /rename <new-name>",
    handler: renameHandler,
  });
  pi.registerCommand("identity", {
    description: "查询身份信息 /identity [id|name]",
    handler: identityHandler,
  });
}
