import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";
// paimon-code 统一块渲染引擎(源:god.mods.tui/main.blockrender/blockrender.js,install.sh 部署到此目录)
import { markdownBullet, GUTTER } from "./blockrender.js";
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
    contentContainer;
    hideThinkingBlock;
    markdownTheme;
    hiddenThinkingLabel;
    lastMessage;
    hasToolCalls = false;
    errorShown = false;
    constructor(message, hideThinkingBlock = false, markdownTheme = getMarkdownTheme(), hiddenThinkingLabel = "Thinking...") {
        super();
        this.hideThinkingBlock = hideThinkingBlock;
        this.markdownTheme = markdownTheme;
        this.hiddenThinkingLabel = hiddenThinkingLabel;
        // Container for text/thinking content
        this.contentContainer = new Container();
        this.addChild(this.contentContainer);
        if (message) {
            this.updateContent(message);
        }
    }
    invalidate() {
        super.invalidate();
        if (this.lastMessage) {
            this.updateContent(this.lastMessage);
        }
    }
    setHideThinkingBlock(hide) {
        this.hideThinkingBlock = hide;
        if (this.lastMessage) {
            this.updateContent(this.lastMessage);
        }
    }
    setHiddenThinkingLabel(label) {
        this.hiddenThinkingLabel = label;
        if (this.lastMessage) {
            this.updateContent(this.lastMessage);
        }
    }
    render(width) {
        const lines = super.render(width);
        if (this.hasToolCalls || lines.length === 0) {
            return lines;
        }
        lines[0] = OSC133_ZONE_START + lines[0];
        lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
        return lines;
    }
    updateContent(message) {
        this.lastMessage = message;
        // Clear content container
        this.contentContainer.clear();
        this.errorShown = false;
        const hasVisibleContent = message.content.some((c) => (c.type === "text" && c.text?.trim()) || (c.type === "thinking" && (c.thinking || "").trim()));
        if (hasVisibleContent) {
            this.contentContainer.addChild(new Spacer(1));
        }
        // Render content in order
        for (let i = 0; i < message.content.length; i++) {
            const content = message.content[i];
            if (content.type === "text" && content.text.trim()) {
                // Strip leaked XML tags (model hallucination)
                const cleaned = content.text.trim().replace(/<\/?(?:parameter|function_calls|antml:[a-z_]+)[^>]*>/g, "").trim();
                if (!cleaned) continue;
                const md = new Markdown(cleaned, GUTTER, 0, this.markdownTheme);
                this.contentContainer.addChild({
                    render: (w) => markdownBullet(md, theme.fg("text", "•"), w),
                    invalidate: () => { if (md.invalidate) md.invalidate(); },
                });
            }
            else if (content.type === "thinking" && (content.thinking || "").trim()) {
                const viewMode = globalThis.__piViewMode || "full";
                if (viewMode === "clean") continue;
                // Add spacing only when another visible assistant content block follows.
                // This avoids a superfluous blank line before separately-rendered tool execution blocks.
                const hasVisibleContentAfter = message.content
                    .slice(i + 1)
                    .some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));
                if (viewMode === "fold" || this.hideThinkingBlock) {
                    // Fold mode: skip thinking — no "Thinking..." label either
                    // Only add spacing if there's visible content after
                    if (hasVisibleContentAfter) {
                        this.contentContainer.addChild(new Spacer(1));
                    }
                }
                else {
                    // Thinking traces — 灰点 + 思考内容，同样走 blockrender 统一对齐。
                    const md = new Markdown((content.thinking || "").trim(), GUTTER, 0, this.markdownTheme, {
                        color: (text) => theme.fg("thinkingText", text),
                    });
                    this.contentContainer.addChild({
                        render: (w) => markdownBullet(md, theme.fg("thinkingText", "•"), w),
                        invalidate: () => { if (md.invalidate) md.invalidate(); },
                    });
                    if (hasVisibleContentAfter) {
                        this.contentContainer.addChild(new Spacer(1));
                    }
                }
            }
        }
        // Check if aborted - show after partial content
        // But only if there are no tool calls (tool execution components will show the error)
        const hasToolCalls = message.content.some((c) => c.type === "toolCall");
        this.hasToolCalls = hasToolCalls;
        if (!hasToolCalls) {
            // paimon-code: suppress "Operation aborted" display. Steer/voice-driven aborts are normal in continuous agent mode.
            if (false && message.stopReason === "aborted") {
                const abortMessage = message.errorMessage && message.errorMessage !== "Request was aborted"
                    ? message.errorMessage
                    : "Operation aborted";
                if (hasVisibleContent) {
                    this.contentContainer.addChild(new Spacer(1));
                }
                else {
                    this.contentContainer.addChild(new Spacer(1));
                }
                this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), 1, 0));
            }
            else if (message.stopReason === "error") {
                if (!this.errorShown) {
                    this.errorShown = true;
                    const errorMsg = message.errorMessage || "Unknown error";
                    this.contentContainer.addChild(new Spacer(1));
                    this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
                }
            }
        }
    }
}
//# sourceMappingURL=assistant-message.js.map