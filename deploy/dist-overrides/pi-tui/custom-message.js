import { Box, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";
/**
 * Component that renders a custom message entry from extensions.
 * Uses distinct styling to differentiate from user messages.
 */
export class CustomMessageComponent extends Container {
    message;
    customRenderer;
    box;
    customComponent;
    markdownTheme;
    _expanded = false;
    constructor(message, customRenderer, markdownTheme = getMarkdownTheme()) {
        super();
        this.message = message;
        this.customRenderer = customRenderer;
        this.markdownTheme = markdownTheme;
        this.addChild(new Spacer(1));
        // pi-coding-master: 无背景色（原版蓝底太刺眼）
        this.box = new Box(0, 0, (t) => t);
        this.rebuild();
    }
    setExpanded(expanded) {
        if (this._expanded !== expanded) {
            this._expanded = expanded;
            this.rebuild();
        }
    }
    invalidate() {
        super.invalidate();
        this.rebuild();
    }
    rebuild() {
        // Remove previous content component
        if (this.customComponent) {
            this.removeChild(this.customComponent);
            this.customComponent = undefined;
        }
        this.removeChild(this.box);
        // Try custom renderer first - it handles its own styling
        if (this.customRenderer) {
            try {
                const component = this.customRenderer(this.message, { expanded: this._expanded }, theme);
                if (component) {
                    // Custom renderer provides its own styled component
                    this.customComponent = component;
                    this.addChild(component);
                    return;
                }
            }
            catch {
                // Fall through to default rendering
            }
        }
        // Default rendering uses our box
        this.addChild(this.box);
        this.box.clear();
        // pi-coding-master: dim 文本，无背景，无 label 标签
        let text;
        if (typeof this.message.content === "string") {
            text = this.message.content;
        }
        else {
            text = this.message.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");
        }
        if (text.trim()) {
            this.box.addChild(new Text(theme.fg("dim", text.trim()), 2, 0));
        }
    }
}
//# sourceMappingURL=custom-message.js.map