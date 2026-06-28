source: main.ts @ ebfe516f

# index.ts — Heart entry: wires stop + process

## 职责
Entry point for the heart.main func. Creates default UnstopState and delegates to registerStop (continuous loop) and registerProcess (shell execution). Acts as the thin composition root for the heart organ.

## 接口
- `default(pi: ExtensionAPI): void` — func entry called by kernel

## 依赖
- `./stop.js` (registerStop, UnstopState)
- `./process.js` (registerProcess)
- `@mariozechner/pi-coding-agent` (ExtensionAPI)

## 行为要点
- Initializes UnstopState with enabled=true, no count/time limits
- Each sub-module (stop, process) injects its own prompt via before_agent_start
- No prompt.ts — removed; prompt injection is per-module
