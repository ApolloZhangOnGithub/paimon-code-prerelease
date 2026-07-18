// brain.intentions — 前瞻性记忆（意图栈）
// agent 用 edit 接口自由编辑纯文本计划。agent_end 时检查：非空→续命，空→提示停下。
// 持久化到 MemoryData/{id}/intentions.txt，重启不丢失。
// 渲染规范：Docs/Dev.Common/Norms/Top-Level/008-intentions-tool-render.NORM
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { registerPaimonTool } from "#kernel_backbone";
import { renderToolCall, renderMessage } from "#tui_blockrender";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const MAX_INTENTIONS_LEN = 3000;
let _buffer = "";
let _filePath: string | null = null;

function saveIntentions(): void {
  if (!_filePath) return;
  try {
    mkdirSync(dirname(_filePath), { recursive: true });
    writeFileSync(_filePath, _buffer, "utf-8");
  } catch {}
}

function loadIntentions(): void {
  if (!_filePath) return;
  try {
    if (existsSync(_filePath)) {
      _buffer = readFileSync(_filePath, "utf-8").trim().slice(0, MAX_INTENTIONS_LEN);
    }
  } catch {}
}

export function getIntentions(): string { return _buffer; }
export function clearIntentions(): void { _buffer = ""; saveIntentions(); }

export interface IntentionItem { num: number; text: string; status: "pending" | "done" | ""; }
export function getIntentionItems(): IntentionItem[] {
  const lines = _buffer.split("\n").filter(l => l.trim());
  return lines.map((line, i) => {
    const trimmed = line.trim();
    const done = /^[✓✅☑]\s/.test(trimmed);
    const pending = /^\d+[.)]\s/.test(trimmed);
    return {
      num: i + 1,
      text: trimmed,
      status: done ? "done" : (pending ? "pending" : ""),
    };
  });
}

function lineCount(): number {
  return _buffer.split("\n").filter(l => l.trim()).length;
}

function lineWord(n: number): string {
  return n === 1 ? "1 Line" : `${n} Lines`;
}

export default function (_pi: ExtensionAPI) {
  // 持久化路径：从 agent 的 MemoryData 目录读写 intentions
  _pi.on("session_start", async (_event, ctx) => {
    try {
      const sf = (ctx as any).sessionManager?.getSessionFile?.();
      if (sf) {
        const m = sf.match(/([a-f0-9]{8})\//);
        if (m) {
          _filePath = join(homedir(), ".paimon", "MemoryData", m[1], "intentions.txt");
          loadIntentions();
        }
      }
    } catch {}
  });

  registerPaimonTool({
    name: "intentions",
    label: "Intentions",
    messageDescription:
      "Read or edit your intentions — what you plan to do next.\n" +
      "- No params → read current intentions\n" +
      "- new_string only → write (only when empty, otherwise use edit)\n" +
      "- old_string + new_string → edit (find and replace)\n" +
      "Use this to plan ahead. Non-empty intentions = you keep working. Empty = system asks you to plan or stop.",
    promptSnippet: "intentions() to read, intentions({new_string:'plan'}) to write when empty, intentions({old_string:'...', new_string:'...'}) to edit",
    parameters: Type.Object({
      old_string: Type.Optional(Type.String({ messageDescription: "Text to find (omit to replace all or read)" })),
      new_string: Type.Optional(Type.String({ messageDescription: "Replacement text (omit old_string to replace entire content)" })),
      force: Type.Optional(Type.Boolean({ messageDescription: "Force overwrite non-empty stack (skip error)" })),
    }),
    renderCall(args: any, theme: any) {
      const hasOld = args?.old_string !== undefined;
      const hasNew = args?.new_string !== undefined;
      if (!hasOld && !hasNew) {
        return renderToolCall.label(theme, `Checked ${lineWord(lineCount())} of Intentions`);
      }
      if (!hasOld && hasNew) {
        const newLines = (args.new_string || "").split("\n").filter((l: string) => l.trim()).length;
        return renderToolCall.label(theme, `Write ${lineWord(newLines)} of Intentions`);
      }
      return renderToolCall.label(theme, "Edit Intentions");
    },
    renderResult(result: any, _options: any, theme: any, ctx: any) {
      const content = result?.details?._content || result?.content || [];
      const text = content?.[0]?.text || "";

      if (result?.details?.action === "read") {
        return renderMessage.silent();
      }
      if (ctx?.isError && text) {
        return renderMessage.summary(theme, { isError: true }, text);
      }
      if (text) {
        return renderMessage.output(theme, ctx, [{ type: "text", text }]);
      }
      return renderMessage.silent();
    },
    async execute(_id, rawParams, _signal, _onUpdate, _ctx) {
      const params = rawParams as { old_string?: string; new_string?: string };

      // read
      if (params.old_string === undefined && params.new_string === undefined) {
        const items = getIntentionItems();
        const pending = items.filter(i => i.status === "pending").length;
        const done = items.filter(i => i.status === "done").length;
        const summary = items.length > 0
          ? `[${pending} pending, ${done} done]\n${_buffer}`
          : "(empty)";
        return { content: [{ type: "text", text: summary }], details: { action: "read", pending, done } };
      }

      // write (replace all) — force 模式下跳过空栈检查
      if (params.old_string === undefined && params.new_string !== undefined) {
        if (_buffer.trim() && !params.force) {
          return { content: [{ type: "text", text: `ERR: 意图栈非空（${lineWord(lineCount())}）。用 intentions({force:true, new_string:'...'}) 强制覆盖。\n\n当前内容:\n${_buffer}` }], isError: true };
        }
        _buffer = params.new_string.slice(0, MAX_INTENTIONS_LEN);
        saveIntentions();
        const truncated = params.new_string.length > MAX_INTENTIONS_LEN ? ` (截断, 原${params.new_string.length}字符)` : "";
        return { content: [{ type: "text", text: (_buffer || "(cleared)") + truncated }], details: { action: "write" } };
      }

      // edit (find & replace)
      if (params.old_string !== undefined && params.new_string !== undefined) {
        if (params.old_string && !_buffer.includes(params.old_string)) {
          return { content: [{ type: "text", text: `old_string not found in intentions.\nCurrent:\n${_buffer || "(empty)"}` }], isError: true };
        }
        if (params.old_string === "") {
          _buffer = _buffer + ((_buffer && params.new_string) ? "\n" : "") + params.new_string;
        } else {
          _buffer = _buffer.replace(params.old_string, params.new_string);
        }
        if (_buffer.length > MAX_INTENTIONS_LEN) _buffer = _buffer.slice(0, MAX_INTENTIONS_LEN);
        _buffer = _buffer.trim();
        saveIntentions();
        return { content: [{ type: "text", text: _buffer || "(cleared)" }], details: { action: "edit" } };
      }

      return { content: [{ type: "text", text: _buffer || "(empty)" }], details: {} };
    },
  });
}
