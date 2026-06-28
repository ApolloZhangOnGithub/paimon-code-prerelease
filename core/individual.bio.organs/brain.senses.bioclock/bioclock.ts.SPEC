source: bioclock.ts @ 959d9031

# bioclock.ts — Biological clock: timestamps on messages and tool results

## 职责
Gives the model awareness of wall-clock time. Injects current date at session_start, appends high-resolution timestamps to user messages (message_end), and stamps tool results with finish time + duration (tool_result). This lets the model know when events happened and how long tools took.

## 接口
- `default(pi: ExtensionAPI): void` — func entry called by kernel

## 依赖
- `@mariozechner/pi-coding-agent` (ExtensionAPI)

## 行为要点
- **session_start**: notifies UI with current date, sends date message (messageType "unstop-date") as nextTurn
- **message_end**: appends `[YYYY-MM-DD HH:MM:SS.mmm]` timestamp to the last text block of user messages only; skips assistant messages
- **tool_result**: appends `[HH:MM:SS +Ns]` (finish time + duration since tool_execution_start) to last text block of tool results
- Uses a Map keyed by toolCallId to track tool start times
- Only stamps user-role messages (model knows when it spoke)
- Returns `{ message }` for message_end rewrites (proper replacement, not mutation)
