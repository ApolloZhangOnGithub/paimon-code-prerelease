source: issue.ts @ c6ec459d

# issue.ts — Generalized dev document writer (ISSUE/LESSON/NORM)

## 职责
管理 pi-coding-master 项目的开发文档：ISSUE（有状态，可 open/fixed）、LESSON、NORM（无状态）。
自动编号（三位 NNN）、自动生成索引文件，提供 CLI 命令和 agent 工具两种入口。

## 接口
- `addDoc(type: DocType, title: string, detail: string): number` — 创建文档，返回编号
- `setStatus(type: DocType, num: number, status: string): boolean` — 仅 ISSUE 可设状态
- `listOpen(type: DocType): DocMeta[]` — 列出打开的（LESSON/NORM 返回全部）
- `readDoc(type: DocType, num: number): string | null` — 读取文档内容
- `installDocTracker(pi: ExtensionAPI): void` — 注册 /issue /lesson /norm 命令 + devdoc 工具

## 依赖
- `@mariozechner/pi-coding-agent` (ExtensionAPI)
- `node:fs`, `node:path`
- 写入目录: `PROJECT_ROOT/Docs.Dev.{Issues|Lessons|Norms}/`

## 行为要点
- 文件命名: `NNN-slug.{TYPE}.md`，slug 由 `slugify()` 生成（40 字符上限）
- 每次 addDoc / setStatus 后自动 `regenIndex()` 重建 `{Plural}.INDEX` 索引
- ISSUE 索引按 open/已解决 两栏分列；LESSON/NORM 索引只有一栏
- devdoc 工具仅在 `PI_DEV=1` 时注册（开发模式）
- DocType 是字面联合类型 `"ISSUE" | "LESSON" | "NORM"`
