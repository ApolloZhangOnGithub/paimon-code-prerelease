// god.pi.mod/tui.mods.blockrender/blockrender.js
// ── pi-coding-master 统一块渲染引擎 (the one engine) ───────────────────────────────
// 所有「● 块」—— assistant 文字 / 思考 / 工具命令 / 工具结果 —— 统一走这里，保证：
//   1) bullet（●/○）顶格在 col 0
//   2) 内容落在 col GUTTER(=2)，跨块对齐（说话、思考、命令同列）
//   3) 折行后续行也缩进到 col GUTTER（挂起缩进 / hanging indent）
//
// 谁用它（都是 import，绝不各自重写）：
//   - modes/interactive/components/assistant-message.js  → markdownBullet（文字/思考）
//   - modes/interactive/components/tool-execution.js      → dot（状态点）
//   - @earendil-works/pi-tui/dist/tui.js                  → wrapHanging（最终折行）
//
// 部署：install.sh 把本文件 cp 进 dist 两处（pi 组件目录 + pi-tui 根），
//      各处用相对 import `./blockrender.js`。源码只此一份，绝不手改 live。

export const GUTTER = 2; // 内容列：bullet "● " 占 2 列，内容从第 2 列起

// 状态点（工具用）：进行=○(accent) / 错=●(error) / 成功=●(success)。统一在这里，别各处各写。
export function dot(theme, opts) {
  const o = opts || {};
  if (o.partial) return theme.fg("accent", "○"); // ○
  if (o.error) return theme.fg("error", "●"); // ●
  return theme.fg("success", "●"); // ●
}

// 把一行开头的 GUTTER 个「前导可见空格」换成 "<dot> "（dot 落 col0，内容仍在 col GUTTER）。
// 行首可能带 ANSI（颜色/背景）；只动可见的前导空格，不碰样式。
export function swapLeadingPad(line, dotStr) {
  const s = String(line);
  const m = s.match(new RegExp("^((?:" + String.fromCharCode(27) + "\\[[0-9;]*m)*)( +)"));
  if (!m || m[2].length < GUTTER) return dotStr + " " + s; // 没有足够前导空格 → 直接前置
  const ansi = m[1];
  const rest = s.slice(ansi.length + GUTTER); // 砍掉 GUTTER 个空格
  return ansi + dotStr + " " + rest; // dot + 1 空格 = GUTTER 宽
}

// 渲染一个 markdown 块为「挂起 bullet」的行：
// md 必须是用 paddingX=GUTTER 构造好的 Markdown 实例（这样全部行——含折行——都在 col GUTTER），
// 再把首行前导空格换成 dot。→ 首行 "● 内容"、续行 "  内容"，天然挂起对齐。
export function markdownBullet(md, dotStr, width) {
  const lines = [...md.render(width)]; // copy: 不修改 Markdown 缓存（否则每帧重绘都会再叠加 dot）
  if (lines.length > 0) lines[0] = swapLeadingPad(lines[0], dotStr);
  return lines;
}

// 给【Text 组件】用的挂起折行：基于 wrapTextWithAnsi（Text 本来就用它）。
// 若行首有前缀（空白 + 可选 ●/○ bullet 及其后空格），把整行按 (width-前缀宽) 折，续行补前缀宽空格 →
// 续行和「● 后面的字」同列。无前缀则退回普通 wrapTextWithAnsi，行为不变（不影响别的 Text 用途）。
export function hangWrapText(text, width, h) {
  const { visibleWidth, wrapTextWithAnsi } = h;
  const stripped = String(text).replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");
  const pm = stripped.match(/^(\s*(?:[●○◌•▪]\s+)?)/);
  const indW = (pm && pm[1]) ? visibleWidth(pm[1]) : 0;
  if (indW <= 0 || indW >= width) return wrapTextWithAnsi(text, width);
  const wrapped = wrapTextWithAnsi(text, Math.max(1, width - indW));
  if (wrapped.length <= 1) return wrapped;
  const indent = " ".repeat(indW);
  return wrapped.map((ln, i) => (i === 0 ? ln : indent + ln));
}

// 挂起缩进折行：超宽行折行时，续行缩进到「行首前缀」之后。
// 前缀 = 行首空白 + 可选的 ●/○ bullet 及其后空格 → 续行和「● 后面的字」同列。
// pi-tui 的宽度/切片 helper 跨包不同，由调用方注入 h = {visibleWidth, sliceWithWidth, sliceByColumn, isImageLine}。
export function wrapHanging(lines, width, h) {
  if (!Array.isArray(lines) || width <= 0) return lines;
  const { visibleWidth, sliceWithWidth, sliceByColumn, isImageLine } = h;
  let need = false;
  for (const l of lines) {
    if (typeof l === "string" && !isImageLine(l) && visibleWidth(l) > width) { need = true; break; }
  }
  if (!need) return lines;
  const out = [];
  for (const line of lines) {
    if (typeof line !== "string" || isImageLine(line) || visibleWidth(line) <= width) { out.push(line); continue; }
    const stripped = line.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");
    const pm = stripped.match(/^(\s*(?:[●○◌•▪]\s+)?)/);
    const indW = pm && pm[1] ? visibleWidth(pm[1]) : 0;
    const indent = (indW > 0 && indW < width) ? " ".repeat(indW) : "";
    let col = 0; const total = visibleWidth(line); let first = true;
    while (col < total) {
      const avail = first ? width : Math.max(1, width - indent.length);
      const seg = sliceWithWidth(line, col, avail, true);
      if (!seg || seg.width <= 0) { out.push((first ? "" : indent) + sliceByColumn(line, col, avail, true)); break; }
      out.push((first ? "" : indent) + seg.text);
      col += seg.width;
      first = false;
    }
  }
  return out;
}
