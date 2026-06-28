import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { constants } from "fs";
import { access as fsAccess, readFile as fsreadFile } from "fs/promises";
import { Type } from "typebox";
import { getReadmePath } from "../../config.js";
import { keyHint, keyText } from "../../modes/interactive/components/keybinding-hints.js";
import { getLanguageFromPath, highlightCode } from "../../modes/interactive/theme/theme.js";
import { formatDimensionNote, resizeImage } from "../../utils/image-resize.js";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.js";
import { formatPathRelativeToCwdOrAbsolute } from "../../utils/paths.js";
import { resolveReadPathAsync, resolveToCwd } from "./path-utils.js";
import { getTextOutput, renderToolPath, replaceTabs, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "./truncate.js";
import { getToolPrompt, getVisionBridgePrompt } from "./prompts-reader.js";
const ReadSchema = Type.Object({
    path: Type.String({ messageDescription: "Path to the file to READ (relative or absolute)" }),
    offset: Type.Optional(Type.Number({ messageDescription: "Line number to start READing from (1-indexed)" })),
    limit: Type.Optional(Type.Number({ messageDescription: "Maximum number of lines to READ" })),
});
const COMPACT_RESOURCE_FILE_NAMES = new Set(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);
const defaultReadOperations = {
    readFile: (path) => fsreadFile(path),
    access: (path) => fsAccess(path, constants.R_OK),
    detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};
function formatReadLineRange(args, theme) {
    if (args?.offset === undefined && args?.limit === undefined)
        return "";
    const startLine = args.offset ?? 1;
    const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
    return theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
}
function formatReadCall(args, theme, cwd) {
    const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
    return theme.fg("success", "● " + theme.bold("Read")) + " " + pathDisplay + formatReadLineRange(args, theme);
}
function trimTrailingEmptyLines(lines) {
    let end = lines.length;
    while (end > 0 && lines[end - 1] === "") {
        end--;
    }
    return lines.slice(0, end);
}
// pi-coding-master: 主模型不支持图片时，用 glm-5v-turbo 把图片转成文字描述，让纯文本主意识也能"看图"。
// 主意识固定 GLM-5.2（纯文本），图片由 GLM-5V-Turbo 转文字后代看。
const VISION_DESCRIBE_TIMEOUT_MS = 45000;
let _visionConfigCache = null;
async function getVisionConfig() {
    if (_visionConfigCache)
        return _visionConfigCache;
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const modelsPath = path.join(os.homedir(), ".pi", "agent", "models.json");
    let raw;
    try {
        raw = fs.readFileSync(modelsPath, "utf-8");
    }
    catch {
        return null;
    }
    let cfg;
    try {
        cfg = JSON.parse(raw);
    }
    catch {
        return null;
    }
    const zhipu = cfg?.providers?.zhipu;
    if (!zhipu?.apiKey || !zhipu?.baseUrl)
        return null;
    const visionModel = (zhipu.models || []).find((m) => Array.isArray(m.input) && m.input.includes("image"));
    if (!visionModel)
        return null;
    _visionConfigCache = {
        baseUrl: zhipu.baseUrl.replace(/\/$/, ""),
        apiKey: zhipu.apiKey,
        modelId: visionModel.id,
    };
    return _visionConfigCache;
}
// 用 vision 模型把图片(base64)转成文字描述。失败时返回 null，调用方回退到提示文本。
async function describeImageWithVision(dataBase64, mimeType) {
    const cfg = await getVisionConfig();
    if (!cfg)
        return null;
    const url = `${cfg.baseUrl}/chat/completions`;
    const body = {
        model: cfg.modelId,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: getVisionBridgePrompt() },
                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${dataBase64}` } },
                ],
            },
        ],
        max_tokens: 2000,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_DESCRIBE_TIMEOUT_MS);
    try {
        const resp = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!resp.ok)
            return null;
        const json = await resp.json();
        const text = json?.choices?.[0]?.message?.content;
        return typeof text === "string" && text.trim().length > 0 ? text.trim() : null;
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
function needsVisionBridge(model) {
    return !!model && !model.input.includes("image");
}
function toPosixPath(filePath) {
    return filePath.split(sep).join("/");
}
function getPiDocsClassification(absolutePath) {
    // pi-coding-master: 禁用 docs 特殊分类，统一用 Read。
    // 原逻辑：检测 docs/ README.md examples/ 返回 {kind:"docs",label}
    // 现在：所有文件一视同仁，不做 docs 分类。
    return undefined;
}
function getCompactReadClassification(args, cwd) {
    const rawPath = str(args?.file_path ?? args?.path);
    if (!rawPath)
        return undefined;
    const absolutePath = resolveToCwd(rawPath, cwd);
    const fileName = basename(absolutePath);
    if (fileName === "SKILL.md") {
        return { kind: "skill", label: basename(dirname(absolutePath)) || fileName };
    }
    const docsClassification = getPiDocsClassification(absolutePath);
    if (docsClassification)
        return docsClassification;
    if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
        return { kind: "resource", label: formatPathRelativeToCwdOrAbsolute(absolutePath, cwd) };
    }
    return undefined;
}
function formatCompactReadCall(classification, args, theme) {
    const expandHint = theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
    if (classification.kind === "skill") {
        return (theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
            theme.fg("customMessageText", classification.label) +
            formatReadLineRange(args, theme) +
            expandHint);
    }
    return (theme.fg("success", theme.bold(`Read ${classification.kind}`)) +
        " " +
        theme.fg("accent", classification.label) +
        formatReadLineRange(args, theme) +
        expandHint);
}
function formatReadResult(args, result, options, theme, showImages, _cwd, isError) {
    if (!options.expanded && !isError) {
        return "";
    }
    const rawPath = str(args?.file_path ?? args?.path);
    const output = getTextOutput(result, showImages);
    const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
    const renderedLines = lang ? highlightCode(replaceTabs(output), lang) : output.split("\n");
    const lines = trimTrailingEmptyLines(renderedLines);
    const maxLines = options.expanded ? lines.length : 10;
    const displayLines = lines.slice(0, maxLines);
    const remaining = lines.length - maxLines;
    const indent = "  ";
    let text = `\n${displayLines.map((line) => indent + (lang ? replaceTabs(line) : theme.fg("toolOutput", replaceTabs(line)))).join("\n")}`;
    if (remaining > 0) {
        text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
    }
    const truncation = result.details?.truncation;
    if (truncation?.truncated) {
        if (truncation.firstLineExceedsLimit) {
            text += `\n${theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`)}`;
        }
        else if (truncation.truncatedBy === "lines") {
            text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`)}`;
        }
        else {
            text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;
        }
    }
    return text;
}
export function createReadToolDefinition(cwd, options) {
    const autoResizeImages = options?.autoResizeImages ?? true;
    const ops = options?.operations ?? defaultReadOperations;
    return {
        name: "read",
        label: "Read",
        messageDescription: (getToolPrompt('read', 'messageDescription') || '').replace('{{DEFAULT_MAX_LINES}}', String(DEFAULT_MAX_LINES)).replace('{{DEFAULT_MAX_BYTES_KB}}', String(DEFAULT_MAX_BYTES / 1024)),
        promptSnippet: getToolPrompt('read', 'snippet'),
        promptGuidelines: getToolPrompt('read', 'guidelines'),
        parameters: ReadSchema,
        async execute(_toolCallId, { path, offset, limit }, signal, _onUpdate, ctx) {
            return new Promise((resolve, reject) => {
                if (signal?.aborted) {
                    reject(new Error("Operation aborted"));
                    return;
                }
                let aborted = false;
                const onAbort = () => {
                    aborted = true;
                    reject(new Error("Operation aborted"));
                };
                signal?.addEventListener("abort", onAbort, { once: true });
                (async () => {
                    try {
                        const absolutePath = await resolveReadPathAsync(path, cwd);
                        if (aborted)
                            return;
                        // Check if file exists and is READable.
                        await ops.access(absolutePath);
                        if (aborted)
                            return;
                        const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;
                        let content;
                        let details;
                        const visionBridge = needsVisionBridge(ctx?.model);
                        if (mimeType) {
                            // READ image as binary.
                            const buffer = await ops.readFile(absolutePath);
                            // pi-coding-master: 主模型不支持图片时，用 vision 模型把图片转成文字描述。
                            // 主意识（如 GLM-5.2 纯文本）始终只收到文字，不切换模型。
                            if (visionBridge) {
                                // 先 resize 拿到适合发送的 base64，再调 vision 模型转文字。
                                let imgData = buffer.toString("base64");
                                let imgMime = mimeType;
                                let dimensionNote = "";
                                if (autoResizeImages) {
                                    const resized = await resizeImage(buffer, mimeType);
                                    if (resized) {
                                        imgData = resized.data;
                                        imgMime = resized.mimeType;
                                        dimensionNote = formatDimensionNote(resized) || "";
                                    }
                                }
                                if (aborted)
                                    return;
                                let desc = null;
                                try {
                                    desc = await describeImageWithVision(imgData, imgMime);
                                }
                                catch {
                                    desc = null;
                                }
                                if (aborted)
                                    return;
                                let textNote = `READ image file [${mimeType}]`;
                                if (dimensionNote)
                                    textNote += `\n${dimensionNote}`;
                                if (desc) {
                                    textNote += `\n[Image converted to text by glm-5v-turbo]:\n${desc}`;
                                }
                                else {
                                    textNote += `\n[Image conversion failed. Current model does not support images. Try different methods.]`;
                                }
                                content = [{ type: "text", text: textNote }];
                            }
                            else if (autoResizeImages) {
                                // Resize image if needed before sending it back to the model.
                                const resized = await resizeImage(buffer, mimeType);
                                if (!resized) {
                                    const textNote = `READ image file [${mimeType}]\n[Image omitted: could not be resized below the inline image size limit.]`;
                                    content = [{ type: "text", text: textNote }];
                                }
                                else {
                                    const dimensionNote = formatDimensionNote(resized);
                                    let textNote = `READ image file [${resized.mimeType}]`;
                                    if (dimensionNote)
                                        textNote += `\n${dimensionNote}`;
                                    content = [
                                        { type: "text", text: textNote },
                                        { type: "image", data: resized.data, mimeType: resized.mimeType },
                                    ];
                                }
                            }
                            else {
                                const textNote = `READ image file [${mimeType}]`;
                                content = [
                                    { type: "text", text: textNote },
                                    { type: "image", data: buffer.toString("base64"), mimeType },
                                ];
                            }
                        }
                        else {
                            // READ text content.
                            const buffer = await ops.readFile(absolutePath);
                            const textContent = buffer.toString("utf-8");
                            const allLines = textContent.split("\n");
                            const totalFileLines = allLines.length;
                            // Apply offset if specified. Convert from 1-indexed input to 0-indexed array access.
                            const startLine = offset ? Math.max(0, offset - 1) : 0;
                            const startLineDisplay = startLine + 1;
                            // Check if offset is out of bounds.
                            if (startLine >= allLines.length) {
                                throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
                            }
                            let selectedContent;
                            let userLimitedLines;
                            // If limit is specified by the user, honor it first. Otherwise truncateHead decides.
                            if (limit !== undefined) {
                                const endLine = Math.min(startLine + limit, allLines.length);
                                selectedContent = allLines.slice(startLine, endLine).join("\n");
                                userLimitedLines = endLine - startLine;
                            }
                            else {
                                selectedContent = allLines.slice(startLine).join("\n");
                            }
                            // Apply truncation, respecting both line and byte limits.
                            const truncation = truncateHead(selectedContent);
                            let outputText;
                            if (truncation.firstLineExceedsLimit) {
                                // First line alone exceeds the byte limit. Point the model at a bash fallback.
                                const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
                                outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
                                details = { truncation };
                            }
                            else if (truncation.truncated) {
                                // Truncation occurred. Build an actionable continuation notice.
                                const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
                                const nextOffset = endLineDisplay + 1;
                                outputText = truncation.content;
                                if (truncation.truncatedBy === "lines") {
                                    outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
                                }
                                else {
                                    outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
                                }
                                details = { truncation };
                            }
                            else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
                                // User-specified limit stopped early, but the file still has more content.
                                const remaining = allLines.length - (startLine + userLimitedLines);
                                const nextOffset = startLine + userLimitedLines + 1;
                                outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
                            }
                            else {
                                // No truncation and no remaining user-limited content.
                                outputText = truncation.content;
                            }
                            content = [{ type: "text", text: outputText }];
                        }
                        if (aborted)
                            return;
                        signal?.removeEventListener("abort", onAbort);
                        resolve({ content, details });
                    }
                    catch (error) {
                        signal?.removeEventListener("abort", onAbort);
                        if (!aborted)
                            reject(error);
                    }
                })();
            });
        },
        renderCall(args, theme, context) {
            const text = context.lastComponent ?? new Text("", 0, 0);
            const classification = !context.expanded ? getCompactReadClassification(args, context.cwd) : undefined;
            text.setText(classification
                ? formatCompactReadCall(classification, args, theme)
                : formatReadCall(args, theme, context.cwd));
            return text;
        },
        renderResult(result, options, theme, context) {
            const text = context.lastComponent ?? new Text("", 0, 0);
            text.setText(formatReadResult(context.args, result, options, theme, context.showImages, context.cwd, context.isError));
            return text;
        },
    };
}
export function createReadTool(cwd, options) {
    return wrapToolDefinition(createReadToolDefinition(cwd, options));
}
//# sourceMappingURL=READ.js.map