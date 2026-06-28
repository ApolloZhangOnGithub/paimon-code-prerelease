source: reminder.ts @ fd1f7242

# Reminders -- 提醒事项

## 功能
待办管理，支持截止日期、优先级、follow-up 自动催促、完成/重开、标签筛选。

## 操作
- `--add <title>` -- 新建提醒（可选 `--due`, `--priority low|normal|high|critical`, `--follow-up`, `--notes`）
- `--complete <id>` -- 标记完成
- `--uncomplete <id>` -- 重新打开
- `--due <id> <ISO>` -- 设置/修改截止日期
- `--nudge <id>` -- 手动催促（重置 follow-up 计时）
- `--tag <id> <tag>` -- 添加标签
- `--show <id>` -- 详情
- `--overdue` -- 列出所有逾期项
- `--search <q>` -- 搜索
- `--filter active|completed|followup` -- 按状态筛选
- 无参数 -- 显示逾期 + 活跃 + 完成统计

## 数据
`{personDir}/reminders.json` -- Reminder[] JSON 数组。

## 备注
导出 `isOverdue`/`needsNudge` 供调度器检测催促时机。follow-up 默认间隔 60 分钟。
