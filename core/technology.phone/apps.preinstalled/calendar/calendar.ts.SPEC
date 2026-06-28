source: calendar.ts @ 1c043154

# Calendar -- 日历日程管理

## 功能
创建、查询、搜索、删除日程事件。支持全天事件、地点、简单循环规则、提醒分钟数、标签。

## 操作
- `--add <title>` -- 创建事件（可选 `--start`/`--end` ISO, `--all-day`, `--desc`, `--location`, `--remind <min>`）
- `--today` -- 今日日程
- `--upcoming [N]` -- 未来 N 天（默认 7）
- `--date <YYYY-MM-DD>` -- 指定日期日程
- `--show <id>` -- 事件详情
- `--delete <id>` -- 删除事件
- `--search <q>` -- 按标题/描述/地点/标签搜索
- 无参数 -- 显示今日 + 未来 7 天概览

## 数据
`{personDir}/calendar.json` -- CalendarEvent[] JSON 数组。

## 备注
导出 `CalendarEvent` 类型及 `loadEvents`/`eventsOnDay`/`upcomingEvents` 供其他模块使用（如提醒检查）。
