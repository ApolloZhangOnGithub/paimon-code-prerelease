source: fileactions.ts @ 5f6aaab2

# fileactions.ts — File operation interception: gates, changelogs, companions

## 职责
Intercepts all file write/edit/bash tool calls to enforce governance rules: SPEC-before-write, CHANGELOG auto-append, authorization checks (workDir/trusted dirs), dir.README gate (must read before operating), rename/move trace requirements, rm prohibition (mv to .REMOVED only), and companion file (.SPEC/.CHANGELOG/.NAMETRACE/.LOCATIONTRACE) auto-migration on mv.

## 接口
- `default(pi: ExtensionAPI): void` — func entry called by kernel

## 依赖
- `#runtime` (getPrompt for "fileactions.wise", "fileactions.rules")
- `./authorize.js` (loadTrust, checkAuth, getWorkDir, setWorkDir, addTrust, removeTrust)
- `./filewatch.js` (startWatcher)
- `./file_rules.json` (runtime-loaded rule patterns)
- `@mariozechner/pi-coding-agent` (ExtensionAPI, isToolCallEventType, isBashToolResult)
- `node:fs/promises`, `node:path`

## 行为要点
- **Write gate**: blocks write if .SPEC doesn't exist or is empty; blocks if target dir not yet ls'd
- **Edit gate**: CHANGELOG is append-only (cannot reduce line count)
- **Bash gate**: blocks rm (except in UNREGULATED); blocks mv/rename without NAMETRACE/LOCATIONTRACE
- **Authorization**: write/edit/bash targets must be in workDir or trusted; bash with unparseable rm/rmdir paths blocked (no fail-open)
- **dir.README gate**: must read dir.README before any operation in that directory
- **FILE_RULES**: loaded from file_rules.json, pattern-matched against bash commands
- **Auto-changelog**: appends timestamped entry on edit/write; auto-creates on first write
- **Companion migration**: on mv, moves .SPEC/.CHANGELOG/.NAMETRACE/.LOCATIONTRACE alongside
- **DNA auto-compile**: editing coded.dna or promotor.dna triggers transpiler and surfaces errors/warnings
- Exempt paths: .SPEC/.CHANGELOG/.NAMETRACE/.LOCATIONTRACE extensions + .git/
- Tracks seen directories and read dir.READMEs per session
