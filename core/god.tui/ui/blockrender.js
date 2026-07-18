// god.tui/ui/blockrender.js
// ── paimon-code 统一块渲染引擎 (the one engine) ───────────────────────────────
// 所有「• 块」—— assistant 文字 / 思考 / 工具命令 / 工具结果 —— 统一走这里，保证：
//   1) bullet（•/◦）顶格在 col 0
//   2) 内容落在 col GUTTER(=2)，跨块对齐（说话、思考、命令同列）
//   3) 折行后续行也缩进到 col GUTTER（挂起缩进 / hanging indent）
//
// 谁用它（都是 import，绝不各自重写）：
//   - modes/interactive/components/assistant-message.js  → markdownBullet（文字/思考）
//   - modes/interactive/components/tools-execution.js      → dot（状态点）
//   - @earendil-works/pi-tui/dist/tui.js                  → wrapHanging（最终折行）
//   - 所有工具的 renderCall / renderResult                  → toolCall / toolResult
//
// 部署：install.sh 把本文件 cp 进 dist 两处（pi 组件目录 + pi-tui 根），
//      各处用相对 import `./blockrender.js`。源码只此一份，绝不手改 live。

export const GUTTER = 2; // 内容列：bullet "• " 占 2 列，内容从第 2 列起

// 状态点（工具用）：进行=◦(accent) / 错=•(error) / 成功=•(success)。统一在这里，别各处各写。
export function dot(theme, opts) {
  const o = opts || {};
  if (o.partial) return theme.fg("accent", "◦"); // ◦
  if (o.error) return theme.fg("error", "•"); // •
  return theme.fg("success", "•"); // •
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
// 再把首行前导空格换成 dot。→ 首行 "• 内容"、续行 "  内容"，天然挂起对齐。
export function markdownBullet(md, dotStr, width) {
  const lines = [...md.render(width)]; // copy: 不修改 Markdown 缓存（否则每帧重绘都会再叠加 dot）
  if (lines.length > 0) lines[0] = swapLeadingPad(lines[0], dotStr);
  return lines;
}

// 给【Text 组件】用的挂起折行：基于 wrapTextWithAnsi（Text 本来就用它）。
// 若行首有前缀（空白 + 可选 bullet/$ 及其后空格），首行按 width 折，续行按 width-前缀宽 折并补缩进 →
// 续行和「前缀后面的字」同列。无前缀则退回普通 wrapTextWithAnsi，行为不变（不影响别的 Text 用途）。
export function hangWrapText(text, width, h) {
  const { visibleWidth, wrapTextWithAnsi } = h;
  const stripped = String(text).replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");
  const pm = stripped.match(/^(\s*(?:(?:[•◦●○$⎿]|\d+\s*│)\s+)?)/);
  const indW = (pm && pm[1]) ? visibleWidth(pm[1]) : 0;
  if (indW <= 0 || indW >= width) return wrapTextWithAnsi(text, width);
  // 预处理：长 token 含 / 时插入断点（空格后复原），避免 breakLongWord 逐字硬切路径
  let src = text;
  if (visibleWidth(stripped) > width && /\S{30,}/.test(stripped) && stripped.includes("/")) {
    src = text.replace(/\//g, "/ ");
  }
  const wrapped = wrapTextWithAnsi(src, width);
  // 复原断点空格
  if (src !== text) {
    for (let i = 0; i < wrapped.length; i++) wrapped[i] = wrapped[i].replace(/\/ /g, "/");
  }
  if (wrapped.length <= 1) return wrapped;
  const indent = " ".repeat(indW);
  const result = [wrapped[0]];
  for (let i = 1; i < wrapped.length; i++) {
    // 续行加缩进后不超宽 → 直接 push，避免不必要的二次折行
    if (visibleWidth(wrapped[i]) + indW <= width) {
      result.push(indent + wrapped[i]);
    } else {
      const sub = wrapTextWithAnsi(wrapped[i], Math.max(1, width - indW));
      for (const s of sub) result.push(indent + s);
    }
  }
  return result;
}

// 挂起缩进折行：超宽行折行时，续行缩进到「行首前缀」之后。
// 前缀 = 行首空白 + 可选的 •/◦ bullet 及其后空格 → 续行和「• 后面的字」同列。
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
    const pm = stripped.match(/^(\s*(?:(?:[•◦●○$⎿]|\d+\s*│)\s+)?)/);
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

// ══════════════════════════════════════════════════════════════════════════════
// 渲染模版
// ══════════════════════════════════════════════════════════════════════════════
//
// renderToolCall — 工具调用行渲染
// renderMessage  — 所有消息渲染（tool result + notification/alert/resume 等）
//
// 用法：
//   import { renderToolCall, renderMessage } from "#tui_blockrender";
//   renderCall(args, theme) { return renderToolCall.label(theme, "Hibernate", args?.summary); },
//   renderResult() { return renderMessage.silent(); },

// 组件注入：调用方通过 initBlockrender() 注入 Text/Container/helpers，避免循环依赖
let _Text = null, _Container = null, _visibleWidth = null, _wrapTextWithAnsi = null;
export function initBlockrender(Text, Container, visibleWidth, wrapTextWithAnsi) {
  _Text = Text; _Container = Container;
  if (visibleWidth) _visibleWidth = visibleWidth;
  if (wrapTextWithAnsi) _wrapTextWithAnsi = wrapTextWithAnsi;
}

// 自举：从 pi-tui 动态加载 helpers（install.sh 部署后可直接 import）
(async () => {
  if (_visibleWidth && _wrapTextWithAnsi) return;
  try {
    const m = await import("@earendil-works/pi-tui");
    if (!_visibleWidth) _visibleWidth = m.visibleWidth;
    if (!_wrapTextWithAnsi) _wrapTextWithAnsi = m.wrapTextWithAnsi;
  } catch { /* not available in all deployment contexts */ }
})();
function T(text) { return new _Text(text, 0, 0); }
function C() { return new _Container(); }

// 挂起 bullet 输出：返回带 render(width) 的对象，调用 hangWrapText 实现折行缩进
function bulletText(dotStr, text) {
  if (!_visibleWidth || !_wrapTextWithAnsi) {
    // fallback: 用 Text 组件但限制长度防止超宽崩溃
    const safe = (dotStr + " " + (text || "")).slice(0, 120);
    return T(safe);
  }
  return {
    text: dotStr + " " + (text || ""),
    render(width) {
      const h = { visibleWidth: _visibleWidth, wrapTextWithAnsi: _wrapTextWithAnsi };
      // 先按 \n 拆行，每行独立折行
      const rawLines = this.text.split('\n');
      const firstPrefix = rawLines[0].replace(/\x1b\[[0-9;]*m/g, '').match(/^(\s*(?:(?:[•◦●○$⎿]|\d+\s*│)\s+)?)/)?.[0] || '';
      const indentW = firstPrefix ? _visibleWidth(firstPrefix) : 0;
      // 提取第一行的 ANSI SGR 码注入后续行，避免 \n 后丢失颜色
      const ansiCodes = rawLines[0].match(/\x1b\[[0-9;]*m/g) || [];
      const ansiPrefix = ansiCodes.filter(c => c !== '\x1b[0m').join('');
      const wrapped = rawLines.length <= 1
        ? hangWrapText(this.text, width, h)
        : rawLines.flatMap((l, i) => {
            if (i === 0) return hangWrapText(l, width, h);
            if (indentW <= 0 || indentW >= width) return _wrapTextWithAnsi(l, width);
            return _wrapTextWithAnsi(l, width - indentW).map(line => ' '.repeat(indentW) + ansiPrefix + line);
          });
      // 安全网：硬截断任何超宽行（防止 wrapTextWithAnsi 偶发不折行）
      const safe = [];
      for (const w of wrapped) {
        if (_visibleWidth(w) > width) {
          let cur = ''; let remain = w;
          while (_visibleWidth(remain) > width) {
            let cut = width;
            while (_visibleWidth(remain.slice(0, cut)) > width) cut--;
            safe.push(remain.slice(0, cut));
            remain = remain.slice(cut);
          }
          if (remain) safe.push(remain);
        } else { safe.push(w); }
      }
      return safe;
    },
    invalidate() {},
  };
}

// ── renderToolCall: 工具调用行 ────────────────────────────────────────────

export const renderToolCall = {
  // ◦ Label  detail
  label(theme, name, detail) {
    const d = dot(theme, { partial: true });
    const text = detail ? theme.bold(name) + " " + theme.fg("dim", String(detail)) : theme.bold(name);
    return bulletText(d, text);
  },

  // ◦ Label command text
  command(theme, name, cmd) {
    const d = dot(theme, { partial: true });
    const text = String(cmd || "");
    return bulletText(d, theme.bold(name) + " " + theme.fg("toolOutput", text.length > 200 ? text.slice(0, 197) + "..." : text));
  },
};

// ── renderMessage: 所有消息（tool result / notification / alert / ...）────

export const renderMessage = {
  // spinner 接管：不渲染任何 result 内容（hibernate/wait — 状态由 spinner 系统显示）
  spinner() { return C(); },

  // 静默：不渲染 result（mouth/aware 等无内容输出的工具，状态点已在 call 行）
  silent() { return C(); },

  // 输出：显示文本内容（execute/terminal/mobile/laptop 的 tool result）
  // 工具结果：⎿ 缩进到 GUTTER，续行对齐，挂在 call 行下
  // 错误时用 • 顶格
  output(theme, ctx, content) {
    const text = content?.[0]?.text ?? "";
    if (!text) return C();
    if (ctx?.isError) {
      const d = dot(theme, { error: true });
      return bulletText(d, theme.fg("toolOutput", text));
    }
    const indent = " ".repeat(GUTTER);
    return bulletText(indent + "⎿ ", theme.fg("toolOutput", text));
  },

  // 简短摘要（同上逻辑）
  summary(theme, ctx, text) {
    if (!text) return C();
    if (ctx?.isError) {
      const d = dot(theme, { error: true });
      return bulletText(d, theme.fg("dim", String(text).slice(0, 200)));
    }
    const indent = " ".repeat(GUTTER);
    return bulletText(indent + "⎿ ", theme.fg("dim", String(text).slice(0, 200)));
  },

  // 通知/警告：• Label \n  content
  notice(theme, label, content) {
    const d = dot(theme);
    const c = C();
    c.addChild(new _Text(d + " " + theme.bold(label), 0, 0));
    if (content) c.addChild(new _Text(theme.fg("dim", String(content)), GUTTER, 0));
    return c;
  },

  // 外部消息：• From \n  content
  external(theme, from, content) {
    const d = dot(theme);
    const c = C();
    c.addChild(new _Text(d + " " + theme.bold(from), 0, 0));
    if (content) c.addChild(new _Text(String(content), GUTTER, 0));
    return c;
  },

  // 通知/Alert：◦ Label \n  body
  alert(theme, ctx, label, body) {
    const d = dot(theme, { partial: true });
    const c = C();
    c.addChild(new _Text(d + " " + theme.bold(label), 0, 0));
    if (body) c.addChild(new _Text(body, GUTTER, 0));
    return c;
  },
};

