source: runtime.ts @ 6a7a0fc7

# runtime.ts — RNA reader: provides getPrompt/getDuty/getMode etc.

## 职责
Lazy-loads the transpiled RNA (rna.json) and exposes accessor functions for prompts, duties, modes, sessions, and func metadata. All other organs fetch their prompt text and mode/session state through this module instead of hardcoding. Refuses to run if RNA contains errors (fail loud).

## 接口
- `rna(): Rna` — lazy-load + validate RNA, cache singleton
- `getPrompt(name: string): string` — coded prompt by name (throws if missing)
- `getDuty(funcName, mode?): Duty[]` — duties for a func in a mode
- `getDutyPrompt(funcName, mode?): string | null` — first duty's prompt
- `getFuncPrompts(funcName): string[]` — all func-level coded prompts
- `getFunc(funcName): RnaFunc | undefined` — lookup by name or alias
- `listFuncs(opts?): RnaFunc[]` — all funcs (optionally include future)
- `isAbled(funcName, mode?): boolean` — enabled in current mode?
- `runsInSession(funcName, role?): boolean` — should load in this session role?
- `getMode() / setMode(mode) / listModes()` — mode state (supports alias)
- `getSessionRole() / setSessionRole(role)` — session role state
- `rnaRaw(): Rna` — raw RNA for kernel introspection

## 依赖
- `node:fs` (readFileSync), `node:path`
- RNA path: `../../individual.bio.gene/rna/rna.json` or env `PI_ALIVE_RNA`

## 行为要点
- Singleton lazy load: reads JSON once, caches in `_rna`
- Throws on read failure with actionable message ("先转录")
- Throws if `rna.errors` is non-empty (refuses to run with broken RNA)
- `setMode` resolves aliases (e.g. "wake" -> "DWN", "sleep" -> "sleep.night")
- Default mode from `PI_ALIVE_MODE` env or "DWN"; default session role "main"
- `getPrompt` throws on missing name (fail loud, not silent null)
