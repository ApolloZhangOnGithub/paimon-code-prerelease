source: main.ts @ 99a05361

# hands.commandcall.ts — Shell command utility (#sh): async exec helpers

## 职责
Provides two async shell execution helpers used by other organs. Wraps node:child_process.exec with timeout support. Ensures no organ ever uses synchronous execSync (which blocks the event loop).

## 接口
- `asyncSh(cmd: string, timeout?: number): Promise<string>` — execute shell command, return stdout, throw on error
- `asyncShSafe(cmd: string, timeout?: number): Promise<string>` — same but returns "" on error (never throws)

## 依赖
- `node:child_process` (exec)

## 行为要点
- Default timeout: 5000ms
- asyncSh rejects with the exec error object on non-zero exit or timeout
- asyncShSafe swallows all errors and returns empty string
- Returns stdout only (stderr is discarded on success)
- Imported across organs via #sh path alias
