source: user_terminal.ts @ 88e43403

# user_terminal.ts — Tmux live terminal tool for users

## 职责
给 agent 提供一个"真终端"工具：在 tmux session 中运行长时间/交互式命令，
用户可以 attach 实时观看（tqdm 进度条、训练日志等正确渲染），弥补 agent run() 无 TTY 的不足。

## 接口
- `registerTerminal(pi: ExtensionAPI): void` — 注册 "terminal" 工具到 pi agent

### 工具参数 (action)
- `run` — 创建 tmux session 并执行命令（需 command，可选 name/cwd）
- `peek` — 捕获指定终端最近 200 行中的最后 60 行（需 name）
- `list` — 列出所有 dev-* 前缀的 tmux session
- `close` — 关闭指定终端（需 name）

## 依赖
- `@mariozechner/pi-coding-agent` (ExtensionAPI)
- `typebox` (Type — 参数 schema)
- `#sh` (asyncSh, asyncShSafe — shell 执行)
- `node:fs` (writeFileSync — 写临时脚本)
- `tmux` (运行时依赖)

## 行为要点
- 所有 session 名加 `dev-` 前缀，与 hc-/sc-/sl- 等其他 session 区分
- name 参数经 clean() 净化：只保留 `[a-zA-Z0-9_]`
- run 时若同名 session 已存在，先 kill 再重建
- 命令跑完后自动进入 `bash -i`（保留终端不消失，用户可继续操作）
- 临时脚本写入 `/tmp/pi-terminal-{name}.sh`
- peek 截取 capture-pane 最后 60 行，供 agent 查看进度
