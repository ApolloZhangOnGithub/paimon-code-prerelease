source: transpiler.ts @ 3a9eb161

# transpiler.ts — DNA to RNA compiler: parses .dna files, emits rna.json

## 职责
Reads promotor.dna (indentation-based declarations of funcs, modes, sessions, tags, virs) and coded.dna (triple-quoted prompt blocks), compiles them into a unified RNA JSON that runtime.ts consumes. Validates structural integrity: vir prefix chains, unused coded blocks, undeclared sessions/modes, missing organ directories.

## 接口
- CLI entry: `bun individual.bio.gene/dna.transpiler/transpiler.ts` (runs main())
- Internal: `parsePromotor(text) -> { virs, funcs, modes, sessions, tags }`
- Internal: `parseCoded(text) -> Record<string, string>`
- Internal: `compile(parsed, coded) -> RNA object`

## 依赖
- `node:fs` (readFileSync, writeFileSync, readdirSync)
- `node:path`
- Input: `dna.promotor/promotor.dna`, `dna.coded/coded.dna`
- Output: `rna/rna.json`

## 行为要点
- **promotor parser**: indent-based; top-level: vir, func, future func, session, mode, tag; nested: session, mode:abled, alias, module, belong, contain, in <mode>, duty, coded:
- **coded parser**: regex `coded <name> """..."""` triple-quote blocks
- **compile phase**: resolves coded: refs to actual prompt text, builds mode abled/disabled map per func, computes bidirectional tag membership (belong/contain) with transitive closure, validates vir prefix chains
- **Validation errors** (block runtime): unreferenced coded blocks, unresolved coded: refs, undeclared vir prefixes
- **Validation warnings** (non-fatal): missing session/mode:abled declarations, organs dirs with .ts but no promotor declaration, tag references to unknown targets
- **alias resolution**: func aliases + tag aliases, stored in aliasToReal map
- Exits with code 1 if errors found; RNA is still written but runtime will refuse to load it
- Scans individual.bio.organs/ directory to detect undeclared organ folders
