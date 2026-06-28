source: kernel.ts @ 6c51190a

# kernel.ts — Kernel: loads all funcs into a pi instance

## 职责
Extension entry point. Reads RNA, iterates all non-future funcs, and calls each registered func's init function on the pi ExtensionAPI. Also installs crash logging, budget guard, doc tracker, file watcher, session role detection, and provides /bios and /mode commands.

## 接口
- `default(pi: ExtensionAPI): void` — single export; called by pi to bootstrap everything

## 依赖
- `#runtime` (rt), `#budget` (installBudgetGuard), `#devdoc` (installDocTracker), `#watcher` (installWatcher)
- Func imports: `#heart`, `#fileactions`, `#sensitiveactions`, `#hippocampus`, `#amygdala`, `#drafting`, `#bioclock`, `#subconscious`, `#ear`, `#mouth`
- `@mariozechner/pi-coding-agent` (ExtensionAPI type)

## 行为要点
- REGISTRY maps func names to init functions; missing entries produce warnings, not crashes
- Crash logger prepends listeners for uncaughtException/unhandledRejection to /tmp/pi-coding-master-crash.log
- `session_start`: detects role from session file path (main/subconscious/hippocampus/sleep), sets process.title to `pi-coding-master:<role>:<id>` (unforgeable)
- Warns if running in macOS Terminal.app (known crash bug with heavy TUI)
- Auto-detects dev root (PI_DEV_ROOT or ~/smart-pi/pi-coding-master.DEV) and runs deploy staleness check + file watcher
- `/bios` command: shows mode, role, loaded funcs, prompt refs
- `/mode` command: switches mode via rt.setMode (takes effect next agent turn)
