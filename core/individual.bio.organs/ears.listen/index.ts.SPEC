source: index.ts @ 5716a393

# index.ts — Ear entry: re-exports ears.ts

## 职责
Entry point for the ears.listen func. Pure re-export of the default export from ./ears.ts. Serves as the module boundary that kernel imports via #ear.

## 接口
- `default` — re-exported from `./ears.js`

## 依赖
- `./ears.js`

## 行为要点
- Single-line re-export, no additional logic
- Actual ear implementation lives in ears.ts (not read in this batch)
