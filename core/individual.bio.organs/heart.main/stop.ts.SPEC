source: stop.ts @ 9033e8a7

# stop.ts — Continuous/unstop mechanism: wait, hibernate, auto-continue

## 职责
Implements the "never truly stop" continuous execution loop. Registers wait/hibernate tools and /unstop command. On agent_end, auto-sends a follow-up message to keep the agent alive. Manages hibernate (deep rest, wakeable by user/voice), wait (timed pause with countdown), and Esc hard-stop.

## 接口
- `registerStop(pi: ExtensionAPI, state: UnstopState): void` — installs all hooks/tools/commands
- `UnstopState` interface: `{ enabled, maxCount, count, timeLimitMs, startTime }`

## 依赖
- `#runtime` (getPrompt, getSessionRole)
- `typebox` (Type), `node:fs`, `node:os`, `node:path`
- `@mariozechner/pi-coding-agent` (ExtensionAPI)

## 行为要点
- **wait tool**: pauses 1-30s with countdown UI, then auto-resumes via followUp message; blocks if /wait off
- **hibernate tool**: stops continuous loop (enabled=false), wakeable by real user/voice input; blocks if /hibernate off
- **agent_end hook**: auto-continues unless disabled, aborted (Esc), hibernate backoff (<5s), or wait/hibernate tool was last call; errors retry with exponential backoff up to 5min
- **Esc shortcut**: hard-stop (abort + enabled=false + disabledByUser=true); requires /unstop to resume
- **Wake detection**: real user message while hibernating re-enables continuous (unless user explicitly disabled)
- **sleep-done signal**: triggers restart via wake nonce file (if restart loop available) or in-place re-enable
- **session_start**: resets state, writes PID lock, kills stale main processes, kicks first turn
- **/unstop command**: on|off|toggle|N (count limit)|Nm (time limit)|Ns
- **/hibernate, /wait commands**: toggle disable flags via env vars
- Only main session gets the continuous prompt injection (workers skip)
- Debug logging to /tmp/unstop-debug.log with process.title for multi-instance disambiguation
