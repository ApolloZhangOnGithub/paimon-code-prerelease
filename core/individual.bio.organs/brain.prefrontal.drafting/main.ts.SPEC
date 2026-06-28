source: main.ts @ 7b20157d

# index.ts — Drafting entry: wires always-think

## 职责
Entry point for the brain.prefrontal.drafting func. Delegates entirely to registerAlwaysThink from drafting.ts. Serves as the thin func entry that kernel imports via #drafting.

## 接口
- `default(pi: ExtensionAPI): void` — func entry called by kernel

## 依赖
- `./drafting.js` (registerAlwaysThink)
- `@mariozechner/pi-coding-agent` (ExtensionAPI)

## 行为要点
- Pure delegation: no additional logic
- Depends on unstop's steer->abort dist patch for mid-stream pause to work
