source: space.ts @ e07ed9f8

# space.ts — Space switching tool (agent inhabitable environments)

## 职责
实现 agent 的"空间"概念：定义 agent 所处的环境（谁在身边、能与什么交互），
支持在不同空间之间移动，维护每个 person 的空间状态和历史。

## 接口
- `spaceCmd(args, ctx, personDir): Promise<any>` — 主命令处理器
  - `--list` / `list` — 列出所有空间
  - `--move <id>` / `move <id>` — 移动到目标空间（检查 joinPolicy）
  - `--detail [id]` — 查看空间详情（无 id 则看当前）
  - `--back` — 返回上一个空间（栈式导航）
  - 无参数 — 显示当前空间环境概览
- `getCurrentSpace(personDir): SpaceDef | undefined` — 获取当前空间定义
- `setSpace(personDir, spaceId): boolean` — 程序式切换空间
- `BUILTIN_SPACES` / `getSpace(id)` — 内置空间列表与查询
- `type SpaceDef` / `type SpaceState` — 导出类型

## 依赖
- `node:fs`, `node:path`（已 import 但当前未实际使用，预留持久化）

## 行为要点
- 三个内置空间: solo（私人沉思）、terminal（用户对话，默认）、lobby（公共大厅）
- 状态存在内存 Map 中（`spaceStates`），按 personDir 隔离，进程重启丢失
- 默认空间是 "terminal"
- move 时检查 joinPolicy：invite_only 且非 user/system 拥有的空间会被拒绝
- spaceHistory 是栈，支持 --back 回退；move 和 setSpace 都会 push 历史
- discoverable=false 的空间在环境概览中仅当它是当前空间时才显示
