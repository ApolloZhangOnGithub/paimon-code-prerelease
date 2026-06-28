source: watcher.ts @ d2f81091

# watcher.ts — File change auto-deploy

## 职责
对开发源码目录做 recursive watch，检测 `.ts` 文件变动后自动 rsync 部署到
`~/.pi/agent/extensions/device/`，实现"改源码即生效"的开发体验。

## 接口
- `installWatcher(pi: ExtensionAPI, devRoot: string): void` — 启动监控

## 依赖
- `node:fs` (watch, existsSync)
- `node:child_process` (exec, execSync)
- `node:path`
- `@mariozechner/pi-coding-agent` (ExtensionAPI — 用 sendMessage 报错)

## 行为要点
- 通过 `find` 定位 `technology-manifest.ts` 所在目录作为监控根
- 排除 `node_modules/` 和 `individual.bio.*/` 路径
- 2 秒防抖: 连续变动只触发一次部署（clearTimeout + setTimeout 2000ms）
- 部署方式: rsync -a 到 `~/.pi/agent/extensions/device/`
- 成功时静默，失败时通过 `pi.sendMessage` 推送 watcher-deploy 告警
- watcher 实例存在 `globalThis.__piWatcher` 上（便于外部引用/清理）
- devRoot 不存在或找不到 manifest 时直接 return，不报错
