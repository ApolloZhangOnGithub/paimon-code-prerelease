import { Box, Container, getCapabilities, Image, Spacer, Text } from "@earendil-works/pi-tui";
import { createAllToolDefinitions } from "../../../core/tools/index.js";
import { getTextOutput as getRenderedTextOutput } from "../../../core/tools/render-utils.js";
import { convertToPng } from "../../../utils/image-convert.js";
import { theme } from "../theme/theme.js";
export class ToolExecutionComponent extends Container {
    contentBox;
    contentText;
    selfRenderContainer;
    callRendererComponent;
    resultRendererComponent;
    rendererState = {};
    imageComponents = [];
    imageSpacers = [];
    toolName;
    toolCallId;
    args;
    expanded = false;
    showImages;
    imageWidthCells;
    isPartial = true;
    toolDefinition;
    builtInToolDefinition;
    ui;
    cwd;
    executionStarted = false;
    argsComplete = false;
    result;
    convertedImages = new Map();
    hideComponent = false;
    constructor(toolName, toolCallId, args, options = {}, toolDefinition, ui, cwd) {
        super();
        this.toolName = toolName;
        this.toolCallId = toolCallId;
        this.args = args;
        this.toolDefinition = toolDefinition;
        this.builtInToolDefinition = createAllToolDefinitions(cwd)[toolName];
        this.showImages = options.showImages ?? true;
        this.imageWidthCells = options.imageWidthCells ?? 60;
        this.ui = ui;
        this.cwd = cwd;
        this.addChild(new Spacer(1));
        // Always create all shell variants. contentBox is used for default renderer-based composition.
        // selfRenderContainer is used when the tool renders its own framing.
        // contentText is reserved for generic fallback rendering when no tool definition exists.
        // pi-coding-master: paddingX/Y 都设 0 —— paddingX=1 会把 ● 推到第 1 列(和说话顶格 col0 不对齐);
        // paddingY=1 会在工具块上下各加一个空行(配合 Spacer(1) 就是 2 个,光污染)。归 0 后:
        // ● 顶格对齐说话,块间留白只靠那一个 Spacer(1)。
        this.contentBox = new Box(0, 0, (text) => theme.bg("toolPendingBg", text));
        this.contentText = new Text("", 1, 1, (text) => text); // 透明背景
        this.selfRenderContainer = new Container();
        if (this.hasRendererDefinition()) {
            this.addChild(this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox);
        }
        else {
            this.addChild(this.contentText);
        }
        this.updateDisplay();
    }
    getCallRenderer() {
        if (!this.builtInToolDefinition) {
            return this.toolDefinition?.renderCall;
        }
        if (!this.toolDefinition) {
            return this.builtInToolDefinition.renderCall;
        }
        return this.toolDefinition.renderCall ?? this.builtInToolDefinition.renderCall;
    }
    getResultRenderer() {
        if (!this.builtInToolDefinition) {
            return this.toolDefinition?.renderResult;
        }
        if (!this.toolDefinition) {
            return this.builtInToolDefinition.renderResult;
        }
        return this.toolDefinition.renderResult ?? this.builtInToolDefinition.renderResult;
    }
    hasRendererDefinition() {
        return this.builtInToolDefinition !== undefined || this.toolDefinition !== undefined;
    }
    getRenderShell() {
        if (!this.builtInToolDefinition) {
            return this.toolDefinition?.renderShell ?? "default";
        }
        if (!this.toolDefinition) {
            return this.builtInToolDefinition.renderShell ?? "default";
        }
        return this.toolDefinition.renderShell ?? this.builtInToolDefinition.renderShell ?? "default";
    }
    getRenderContext(lastComponent) {
        return {
            args: this.args,
            toolCallId: this.toolCallId,
            invalidate: () => {
                this.invalidate();
                this.ui.requestRender();
            },
            lastComponent,
            state: this.rendererState,
            cwd: this.cwd,
            executionStarted: this.executionStarted,
            argsComplete: this.argsComplete,
            isPartial: this.isPartial,
            expanded: this.expanded,
            showImages: this.showImages,
            isError: this.result?.isError ?? false,
        };
    }
    getToolSubtitle(args) {
        if (!args || typeof args !== 'object') return '';
        // Try title, query, name, url in order.
        // NOT 'summary' — that's for internal/logging, displaying it as subtitle
        // duplicates the tool result (e.g. wait/hibernate show the same text twice).
        for (const k of ['title', 'query', 'name', 'url']) {
            const v = args[k];
            if (typeof v === 'string' && v.length > 0 && v.length < 60) return ' ' + v;
        }
        return '';
    }
    createCallFallback() {
        let dot;
        if (this.isPartial) dot = theme.fg("accent", "\u25CB");
        else if (this.result?.isError) dot = theme.fg("error", "\u25CF");
        else dot = theme.fg("success", "\u25CF");
        const displayName = this.toolName.charAt(0).toUpperCase() + this.toolName.slice(1);
        let text = dot + " " + theme.fg("toolTitle", theme.bold(displayName));
        this._resultInlined = false;
        // 短 result 并到同一行（wait/hibernate/nap/sleep 一行就完的，当 subtitle）。
        // bioclock 在结果尾部追加 \n[时:分:秒 +Xs]，把它单独剥出来；正文若是单行短文本，就连同
        // 时间戳一起并到标题行（之前直接判 includes('\n') 会因为时间戳那一行而判定多行，把整条挤到第二行或被吃掉）。
        if (this.result && !this.isPartial) {
            const out = this.getTextOutput();
            if (out) {
                const tsMatch = out.match(/\n(\[\d{2}:\d{2}:\d{2}[^\]]*\])\s*$/);
                const ts = tsMatch ? tsMatch[1] : "";
                const body = (tsMatch ? out.slice(0, tsMatch.index) : out).trimEnd();
                if (body.length < 100 && !body.includes('\n')) {
                    text += "  " + theme.fg("toolOutput", body) + (ts ? " " + theme.fg("muted", ts) : "");
                    this._resultInlined = true;
                }
            }
        }
        return new Text(text, 0, 0);
    }
    createResultFallback() {
        const output = this.getTextOutput();
        if (!output) {
            return undefined;
        }
        // paddingX=2 让续行对齐 bullet "● " 的位置，而不是顶格（美观）
        return new Text(theme.fg("toolOutput", output), 2, 0);
    }
    updateArgs(args) {
        this.args = args;
        this.updateDisplay();
    }
    markExecutionStarted() {
        this.executionStarted = true;
        this.updateDisplay();
        this.ui.requestRender();
    }
    setArgsComplete() {
        this.argsComplete = true;
        this.updateDisplay();
        this.ui.requestRender();
    }
    updateResult(result, isPartial = false) {
        this.result = result;
        this.isPartial = isPartial;
        this.updateDisplay();
        this.maybeConvertImagesForKitty();
    }
    maybeConvertImagesForKitty() {
        const caps = getCapabilities();
        if (caps.images !== "kitty")
            return;
        if (!this.result)
            return;
        const imageBlocks = this.result.content.filter((c) => c.type === "image");
        for (let i = 0; i < imageBlocks.length; i++) {
            const img = imageBlocks[i];
            if (!img.data || !img.mimeType)
                continue;
            if (img.mimeType === "image/png")
                continue;
            if (this.convertedImages.has(i))
                continue;
            const index = i;
            convertToPng(img.data, img.mimeType).then((converted) => {
                if (converted) {
                    this.convertedImages.set(index, converted);
                    this.updateDisplay();
                    this.ui.requestRender();
                }
            });
        }
    }
    setExpanded(expanded) {
        this.expanded = expanded;
        this.updateDisplay();
    }
    setShowImages(show) {
        this.showImages = show;
        this.updateDisplay();
    }
    setImageWidthCells(width) {
        this.imageWidthCells = Math.max(1, Math.floor(width));
        this.updateDisplay();
    }
    invalidate() {
        super.invalidate();
        this.updateDisplay();
    }
    render(width) {
        const viewMode = globalThis.__piViewMode || "full";
        if (viewMode === "clean") return [];
        if (viewMode === "fold" && !this.expanded) {
            const args = this.args || {};
            let dot;
            if (this.isPartial) dot = theme.fg("accent", "\u25CB");
            else if (this.result?.isError) dot = theme.fg("error", "\u25CF");
            else dot = theme.fg("success", "\u25CF");
            const capName = this.toolName.charAt(0).toUpperCase() + this.toolName.slice(1);
            let summary = dot + " " + capName;
            if (args.command) summary += ' ' + String(args.command).split("\n")[0].slice(0, 80);
            else if (args.path) summary += ' ' + args.path;
            else if (args.query) summary += ' ' + args.query;
            else if (args.url) summary += ' ' + args.url;
            if (this.result && !this.isPartial) summary += this.result.isError ? " ✗" : " ✓";
            else if (this.isPartial) summary += " …";
            return [summary];
        }
        if (this.hideComponent) {
            return [];
        }
        if (this.hasRendererDefinition() && this.getRenderShell() === "self") {
            const contentLines = this.selfRenderContainer.render(width);
            if (contentLines.length === 0 && this.imageComponents.length === 0) {
                return [];
            }
            const lines = [];
            if (contentLines.length > 0) {
                lines.push("");
                lines.push(...contentLines);
            }
            for (let i = 0; i < this.imageComponents.length; i++) {
                const spacer = this.imageSpacers[i];
                if (spacer) {
                    lines.push(...spacer.render(width));
                }
                const imageComponent = this.imageComponents[i];
                if (imageComponent) {
                    lines.push(...imageComponent.render(width));
                }
            }
            return lines;
        }
        return super.render(width);
    }
    updateDisplay() {
        const bgFn = (text) => text; // 透明背景（身份函数：原样返回文本，不加底色）。WARN: 不能写成 () => (text) => text，那会把函数本身当文本渲染出来（满屏 "(text) => text" + 渲染崩溃）。
        let hasContent = false;
        this.hideComponent = false;
        if (this.hasRendererDefinition()) {
            const renderContainer = this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox;
            if (renderContainer instanceof Box) {
                renderContainer.setBgFn(bgFn);
            }
            renderContainer.clear();
            const callRenderer = this.getCallRenderer();
            if (!callRenderer) {
                renderContainer.addChild(this.createCallFallback());
                hasContent = true;
            }
            else {
                try {
                    const component = callRenderer(this.args, theme, this.getRenderContext(this.callRendererComponent));
                    this.callRendererComponent = component;
                    // 展开视图：把 ● 替换成带状态颜色的版本（递归处理 Text 和 Box 子节点）
                    let dot;
                    if (this.isPartial) dot = theme.fg('accent', '○');
                    else if (this.result?.isError) dot = theme.fg('error', '●');
                    else dot = theme.fg('success', '●');
                    (function replaceDot(node) {
                        if (node && typeof node.text === 'string' && (node.text.includes('●') || node.text.includes('○'))) {
                            node.text = node.text.replace(/[●○]/, dot);
                        }
                        if (node && typeof node.children !== 'undefined') {
                            for (const child of node.children) replaceDot(child);
                        }
                    })(component);
                    renderContainer.addChild(component);
                    hasContent = true;
                }
                catch {
                    this.callRendererComponent = undefined;
                    renderContainer.addChild(this.createCallFallback());
                    hasContent = true;
                }
            }
            if (this.result) {
                const resultRenderer = this.getResultRenderer();
                if (!resultRenderer) {
                    if (!this._resultInlined) {
                        const component = this.createResultFallback();
                        if (component) {
                            renderContainer.addChild(component);
                            hasContent = true;
                        }
                    }
                }
                else {
                    try {
                        const component = resultRenderer({ content: this.result.content, details: this.result.details }, { expanded: this.expanded, isPartial: this.isPartial }, theme, this.getRenderContext(this.resultRendererComponent));
                        this.resultRendererComponent = component;
                        renderContainer.addChild(component);
                        hasContent = true;
                    }
                    catch {
                        this.resultRendererComponent = undefined;
                        if (!this._resultInlined) {
                            const component = this.createResultFallback();
                            if (component) {
                                renderContainer.addChild(component);
                                hasContent = true;
                            }
                        } else { hasContent = true; }
                    }
                }
            }
        }
        else {
            this.contentText.setCustomBgFn(bgFn);
        }
        for (const img of this.imageComponents) {
            this.removeChild(img);
        }
        this.imageComponents = [];
        for (const spacer of this.imageSpacers) {
            this.removeChild(spacer);
        }
        this.imageSpacers = [];
        if (this.result) {
            const imageBlocks = this.result.content.filter((c) => c.type === "image");
            const caps = getCapabilities();
            for (let i = 0; i < imageBlocks.length; i++) {
                const img = imageBlocks[i];
                if (caps.images && this.showImages && img.data && img.mimeType) {
                    const converted = this.convertedImages.get(i);
                    const imageData = converted?.data ?? img.data;
                    const imageMimeType = converted?.mimeType ?? img.mimeType;
                    if (caps.images === "kitty" && imageMimeType !== "image/png")
                        continue;
                    const spacer = new Spacer(1);
                    this.addChild(spacer);
                    this.imageSpacers.push(spacer);
                    const imageComponent = new Image(imageData, imageMimeType, { fallbackColor: (s) => theme.fg("toolOutput", s) }, { maxWidthCells: this.imageWidthCells });
                    this.imageComponents.push(imageComponent);
                    this.addChild(imageComponent);
                }
            }
        }
        if (this.hasRendererDefinition() && !hasContent && this.imageComponents.length === 0) {
            this.hideComponent = true;
        }
    }
    getTextOutput() {
        return getRenderedTextOutput(this.result, this.showImages);
    }
    formatToolExecution() {
        let text = theme.fg("toolTitle", theme.bold(this.toolName.charAt(0).toUpperCase() + this.toolName.slice(1)));
        const content = JSON.stringify(this.args, null, 2);
        if (content) {
            text += `\n\n${content}`;
        }
        const output = this.getTextOutput();
        if (output) {
            text += `\n${output}`;
        }
        return text;
    }
}
//# sourceMappingURL=tool-execution.js.map