import { execFileSync } from "child_process";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises";
import { Type } from "typebox";
import { renderDiff } from "../../modes/interactive/components/diff.js";
import { getToolPrompt } from "./prompts-reader.js";
import { GUTTER } from "../../modes/interactive/components/blockrender.js"; // 统一块渲染引擎:内容列(col2)
import { applyEditsToNormalizedContent, computeEditsDiff, detectLineEnding, generateDiffString, generateUnifiedPatch, normalizeToLF, restoreLineEndings, stripBom, } from "./edit-diff.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToCwd } from "./path-utils.js";
import { renderToolPath, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

// ── git add gate: 成功写文件后自动 git add ──
function tryGitAdd(filePath) {
    try {
        execFileSync("git", ["add", filePath], { timeout: 3000, stdio: "ignore" });
    } catch {
        // 不在 git 仓库 / git 未安装 —— 静默忽略
    }
}
const replaceEDITSchema = Type.Object({
    oldText: Type.String({
        messageDescription: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    }),
    newText: Type.String({ messageDescription: "Replacement text for this targeted edit." }),
}, { additionalProperties: false });
const editSchema = Type.Object({
    path: Type.String({ messageDescription: "Path to the file to edit (relative or absolute)" }),
    edits: Type.Array(replaceEDITSchema, {
        messageDescription: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
    }),
}, { additionalProperties: false });
const defaultEDITOperations = {
    readFile: (path) => fsReadFile(path),
    writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
    access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
};
function prepareEDITArguments(input) {
    if (!input || typeof input !== "object") {
        return input;
    }
    const args = input;
    // Some models (Opus 4.6, GLM-5.1) send edits as a JSON string instead of an array
    if (typeof args.edits === "string") {
        try {
            const parsed = JSON.parse(args.edits);
            if (Array.isArray(parsed))
                args.edits = parsed;
        }
        catch { }
    }
    // path inside edits[0] instead of top-level — hoist it
    if (!args.path && Array.isArray(args.edits) && args.edits.length > 0 && args.edits[0].path) {
        args.path = args.edits[0].path;
        for (const e of args.edits) delete e.path;
    }
    const legacy = args;
    if (typeof legacy.oldText !== "string" || typeof legacy.newText !== "string") {
        return args;
    }
    const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
    edits.push({ oldText: legacy.oldText, newText: legacy.newText });
    const { oldText: _oldText, newText: _newText, ...rest } = legacy;
    return { ...rest, edits };
}
function validateEDITInput(input) {
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
        throw new Error("EDIT tool input is invalid. edits must contain at least one replacement.");
    }
    return { path: input.path, edits: input.edits };
}
function createEDITCallRenderComponent() {
    // pi-coding-master: Box(0,0) —— paddingX=1 会把 ● Edit 顶到 col1（和别的块对不齐）、paddingY=1 加空行。归 0。
    return Object.assign(new Box(0, 0, (text) => text), {
        preview: undefined,
        previewArgsKey: undefined,
        previewPending: false,
        settledError: false,
    });
}
function getEDITCallRenderComponent(state, lastComponent) {
    if (lastComponent instanceof Box) {
        const component = lastComponent;
        state.callComponent = component;
        return component;
    }
    if (state.callComponent) {
        return state.callComponent;
    }
    const component = createEDITCallRenderComponent();
    state.callComponent = component;
    return component;
}
function getRenderablePreviewInput(args) {
    if (!args) {
        return null;
    }
    const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : null;
    if (!path) {
        return null;
    }
    if (Array.isArray(args.edits) &&
        args.edits.length > 0 &&
        args.edits.every((edit) => typeof edit?.oldText === "string" && typeof edit?.newText === "string")) {
        return { path, edits: args.edits };
    }
    if (typeof args.oldText === "string" && typeof args.newText === "string") {
        return { path, edits: [{ oldText: args.oldText, newText: args.newText }] };
    }
    return null;
}
function formatEDITCall(args, theme, cwd) {
    const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
    return theme.fg("toolTitle", "● " + theme.bold("Edit")) + " " + pathDisplay;
}
function formatEDITResult(args, preview, result, theme, isError) {
    const rawPath = str(args?.file_path ?? args?.path);
    const previewDiff = preview && !("error" in preview) ? preview.diff : undefined;
    const previewError = preview && "error" in preview ? preview.error : undefined;
    if (isError) {
        const errorText = result.content
            .filter((c) => c.type === "text")
            .map((c) => c.text || "")
            .join("\n");
        // pi-coding-master: 去重要容忍尾部追加 —— bioclock 给工具结果加了 "\n[time +dur]" 时间戳后缀，
        // 会让 errorText !== previewError 而漏过去重，导致「No changes」在预览块和结果块各显示一遍。
        // 用 startsWith 判前缀相同即视为重复，抑制结果块那一遍。
        if (!errorText || errorText === previewError ||
            (previewError && errorText.startsWith(previewError))) {
            return undefined;
        }
        return theme.fg("error", errorText);
    }
    const resultDiff = result.details?.diff;
    if (resultDiff && resultDiff !== previewDiff) {
        return renderDiff(resultDiff, { filePath: rawPath ?? undefined });
    }
    return undefined;
}
function getEDITHeaderBg(preview, settledError, theme) {
    if (preview) {
        if ("error" in preview) {
            return (text) => theme.bg("toolErrorBg", text);
        }
        return (text) => theme.bg("toolSuccessBg", text);
    }
    if (settledError) {
        return (text) => theme.bg("toolErrorBg", text);
    }
    return (text) => theme.bg("toolPendingBg", text);
}
function buildEDITCallComponent(component, args, theme, cwd) {
    // 透明背景，不再用底色
    component.setBgFn((text) => text);
    component.clear();
    component.addChild(new Text(formatEDITCall(args, theme, cwd), 0, 0));
    if (!component.preview) {
        return component;
    }
    const body = "error" in component.preview ? theme.fg("error", component.preview.error) : renderDiff(component.preview.diff);
    component.addChild(new Spacer(1));
    component.addChild(new Text(body, GUTTER, 0)); // diff 落 col GUTTER，对齐 ● 后面的内容
    return component;
}
function setEDITPreview(component, preview, argsKey) {
    const current = component.preview;
    const changed = current === undefined ||
        ("error" in current && "error" in preview
            ? current.error !== preview.error
            : "error" in current !== "error" in preview) ||
        (!("error" in current) &&
            !("error" in preview) &&
            (current.diff !== preview.diff || current.firstChangedLine !== preview.firstChangedLine));
    component.preview = preview;
    component.previewArgsKey = argsKey;
    component.previewPending = false;
    return changed;
}
export function createEditToolDefinition(cwd, options) {
    const ops = options?.operations ?? defaultEDITOperations;
    return {
        name: "edit",
        label: "edit",
        messageDescription: getToolPrompt('edit', 'messageDescription'),
        promptSnippet: getToolPrompt('edit', 'snippet'),
        promptGuidelines: [
            "Use edit for precise changes (edits[].oldText must match exactly)",
            "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
            "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
            "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
        ],
        parameters: editSchema,
        renderShell: "self",
        prepareArguments: prepareEDITArguments,
        async execute(_toolCallId, input, signal, onUpdate, _ctx) {
            const { path, edits } = validateEDITInput(input);
            const absolutePath = resolveToCwd(path, cwd);
            // NORM: 禁止直接编辑 node_modules → 只能用 dist-override
            if (/node_modules[\/]@earendil-works/.test(absolutePath)) throw new Error("Error: 禁止直接编辑 node_modules/@earendil-works！改动会被 npm 重装冲掉。正确做法：修改源码 → 放到 dist-overrides/ → install.sh 部署。");
            try { if (onUpdate) onUpdate({ content: [{ type: "text", text: `编辑 ${edits.length} 处: ${path}` }] }); } catch {}
            return withFileMutationQueue(absolutePath, async () => {
                // Do not reject from an abort event listener here: that would release the
                // mutation queue while an in-flight filesystem operation may still finish.
                // Checking signal.aborted after each await observes the same aborts while
                // keeping the queue locked until the current operation has settled.
                const throwIfAborted = () => {
                    if (signal?.aborted)
                        throw new Error("Operation aborted");
                };
                throwIfAborted();
                // Check if file exists.
                try {
                    await ops.access(absolutePath);
                }
                catch (error) {
                    throwIfAborted();
                    const errorMessage = error instanceof Error && "code" in error ? `Error code: ${error.code}` : String(error);
                    throw new Error(`Could not edit file: ${path}. ${errorMessage}.`);
                }
                throwIfAborted();
                try { if (onUpdate) onUpdate({ content: [{ type: "text", text: `读取: ${path}` }] }); } catch {}
                // Read the file.
                const buffer = await ops.readFile(absolutePath);
                const rawContent = buffer.toString("utf-8");
                throwIfAborted();
                try { if (onUpdate) onUpdate({ content: [{ type: "text", text: `应用 ${edits.length} 处编辑...` }] }); } catch {}
                // Strip BOM before matching. The model will not include an invisible BOM in oldText.
                const { bom, text: content } = stripBom(rawContent);
                const originalEnding = detectLineEnding(content);
                const normalizedContent = normalizeToLF(content);
                const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path);
                throwIfAborted();
                const finalContent = bom + restoreLineEndings(newContent, originalEnding);
                try { if (onUpdate) onUpdate({ content: [{ type: "text", text: `写入: ${path}` }] }); } catch {}
                await ops.writeFile(absolutePath, finalContent);
                tryGitAdd(absolutePath);
                throwIfAborted();
                try { if (onUpdate) onUpdate({ content: [{ type: "text", text: `生成 diff...` }] }); } catch {}
                const diffResult = generateDiffString(baseContent, newContent);
                const patch = generateUnifiedPatch(path, baseContent, newContent);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Successfully replaced ${edits.length} block(s) in ${path}.`,
                        },
                    ],
                    details: { diff: diffResult.diff, patch, firstChangedLine: diffResult.firstChangedLine },
                };
            });
        },
        renderCall(args, theme, context) {
            const component = getEDITCallRenderComponent(context.state, context.lastComponent);
            const previewInput = getRenderablePreviewInput(args);
            const argsKey = previewInput
                ? JSON.stringify({ path: previewInput.path, edits: previewInput.edits })
                : undefined;
            if (component.previewArgsKey !== argsKey) {
                component.preview = undefined;
                component.previewArgsKey = argsKey;
                component.previewPending = false;
                component.settledError = false;
            }
            if (context.argsComplete && previewInput && !component.preview && !component.previewPending) {
                component.previewPending = true;
                const requestKey = argsKey;
                void computeEditsDiff(previewInput.path, previewInput.edits, context.cwd).then((preview) => {
                    if (component.previewArgsKey === requestKey) {
                        setEDITPreview(component, preview, requestKey);
                        context.invalidate();
                    }
                });
            }
            return buildEDITCallComponent(component, args, theme, context.cwd);
        },
        renderResult(result, _options, theme, context) {
            const callComponent = context.state.callComponent;
            const previewInput = getRenderablePreviewInput(context.args);
            const argsKey = previewInput
                ? JSON.stringify({ path: previewInput.path, edits: previewInput.edits })
                : undefined;
            const typedResult = result;
            const resultDiff = !context.isError ? typedResult.details?.diff : undefined;
            let changed = false;
            if (callComponent) {
                if (typeof resultDiff === "string") {
                    changed =
                        setEDITPreview(callComponent, { diff: resultDiff, firstChangedLine: typedResult.details?.firstChangedLine }, argsKey) || changed;
                }
                if (callComponent.settledError !== context.isError) {
                    callComponent.settledError = context.isError;
                    changed = true;
                }
                if (changed) {
                    buildEDITCallComponent(callComponent, context.args, theme, context.cwd);
                }
            }
            const output = formatEDITResult(context.args, callComponent?.preview, typedResult, theme, context.isError);
            const component = context.lastComponent ?? new Container();
            component.clear();
            if (!output) {
                return component;
            }
            component.addChild(new Spacer(1));
            component.addChild(new Text(output, GUTTER, 0)); // 结果落 col GUTTER，统一对齐
            return component;
        },
    };
}
export function createEditTool(cwd, options) {
    return wrapToolDefinition(createEditToolDefinition(cwd, options));
}
//# sourceMappingURL=edit.js.map