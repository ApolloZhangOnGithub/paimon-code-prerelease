source: process.ts @ 9b1311d4

# process.ts — Background process runner: run tool + /monitor + /restart

## 职责
Registers the `run` tool for shell command execution with automatic backgrounding: fast commands (<1s) return inline, slow commands auto-background and notify via steer message on completion. Also provides /monitor (view running commands) and /restart (deploy + kill + restart).

## 接口
- `registerProcess(pi: ExtensionAPI): void` — installs run tool, /monitor, /restart

## 依赖
- `#runtime` (getPrompt for "heart.commands")
- `typebox` (Type)
- `@mariozechner/pi-coding-agent` (ExtensionAPI)

## 行为要点
- **run tool**: executes via `pi.exec("bash", ["-c", cmd])` with AbortController
- **Auto-background**: races exec against 1s timeout; fast results return inline, slow ones get tracked in a Map and report completion via messageType "unstop-cmd-done" steer message
- **sleep blocking**: rejects bare `sleep N` commands (waiting is built-in, sleeping = idle)
- **Context capture**: stores last 5 messages as context when backgrounding (shown in /monitor)
- **Output cap**: stdout+stderr truncated to 50KB
- **/monitor command**: lists running commands with elapsed time, select to preview context
- **/restart command**: copies dist-override files to pi dist, clears jiti cache, kills all pi-coding-master processes for the person, then exits (hardcoded personId "8cbde57b")
- Injects "heart.commands" prompt via before_agent_start
