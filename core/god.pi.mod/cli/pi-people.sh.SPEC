source: pi-people.sh @ 212c23d1

# pi-people.sh — Shell script for pi people management

## 职责
pi-coding-master 的 person-based launcher：管理"人"列表（创建/列表/进入/归档/恢复），
解析序号或名字定位人，然后以对应人的 session 目录启动真正的 pi agent 进程。

## 接口 (CLI)
- `pi` — 列出所有人（按 active 优先 + 最近优先排序）
- `pi <名字|序号>` — 进入/创建人
- `pi --archive <名字|序号> [更多...]` — 批量归档（隐藏不删）
- `pi --unarchive <名字|序号> [更多...]` — 批量恢复
- `pi --archived` — 查看已归档列表
- `pi --sc <名字|序号>` — 只读 attach 潜意识 tmux (sc-{id})
- `pi --dev` — 设置 PI_DEV=1 开发模式
- 未知 `--flag` → 透传给 `/opt/homebrew/bin/pi`

## 依赖
- `~/.pi/memory/plist.json` — 人列表的单一真相源
- `/opt/homebrew/bin/pi` — 底层 pi agent 二进制
- `node` (JSON 操作、crypto 生成 ID)
- `tmux` (潜意识 attach、终端会话)

## 行为要点
- 启动前从 `models.json` 提取 DEEPSEEK_API_KEY 覆盖环境变量，防 shell 残留旧 key → 402
- 模式 flag 可在任意位置（`pi --archive 18` 和 `pi 18 --archive` 等价）
- 排序: active(ps aux 检测) 优先 → lastSeen 近的优先；序号与显示顺序一致
- 归档批量操作先在同一快照上解析所有目标再改，避免边改边重排序号错位
- 主进程有 wake-restart 循环：pi 退出后若 `.wake-restart` nonce 变化则自动重启
- PI_ALIVE_RESTART_LOOP=1 + PI_ALIVE_WOKE 环境变量控制重启闸和"睡醒"状态
