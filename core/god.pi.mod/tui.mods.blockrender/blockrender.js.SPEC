source: blockrender.js

# blockrender.js — pi-coding-master 统一块渲染引擎

## 职责
所有「● 块」—— assistant 文字/思考/工具命令/工具结果 —— 的统一渲染引擎。
保证 bullet 顶格 col 0、内容落 col GUTTER(=2)、折行挂起缩进到内容列。

## 导出
- `GUTTER = 2` — 内容列偏移量
- `dot(theme, opts)` — 状态点：进行=○(accent) / 错=●(error) / 成功=●(success)
- `swapLeadingPad(line, dotStr)` — 把行首 GUTTER 个空格换成 "dot "
- `markdownBullet(md, dotStr, width)` — Markdown 块渲染为挂起 bullet
- `hangWrapText(text, width, h)` — Text 组件挂起折行
- `wrapHanging(lines, width, h)` — 超宽行挂起缩进折行

## 依赖
- 调用方注入 `h = {visibleWidth, sliceWithWidth, sliceByColumn, isImageLine}`（跨包共享，不硬依赖）

## 部署
源码只此一份（god 域），install.sh cp 到两处：
1. `pi-dist/modes/interactive/components/blockrender.js`（组件目录）
2. `pi-tui-dist/blockrender.js`（pi-tui 根）
各处用相对 import `./blockrender.js`。绝不手改 live。

## 行为要点
- ANSI 剥离统一用 `String.fromCharCode(27)`，不用字面 ESC 字节
- `wrapHanging` 只有 `visibleWidth(line) > width` 时才折行，否则原样返回
- 行首前缀检测：空白 + 可选 ●/○ 及其后空格，折行续行缩进到前缀宽
