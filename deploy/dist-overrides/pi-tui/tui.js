/**
 * Minimal TUI implementation with differential rendering
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { isKeyRelease, matchesKey } from "./keys.js";
import { deleteKittyImage, getCapabilities, isImageLine, setCellDimensions } from "./terminal-image.js";
import { extractSegments, normalizeTerminalOutput, sliceByColumn, sliceWithWidth, visibleWidth } from "./utils.js";
// pi-coding-master 统一块渲染引擎(源:god.pi.mod/tui.mods.blockrender/blockrender.js,install.sh 部署到 pi-tui/dist/)
import { wrapHanging } from "./blockrender.js";
const KITTY_SEQUENCE_PREFIX = "\x1b_G";
function extractKittyImageIds(line) {
    const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX);
    if (sequenceStart === -1)
        return [];
    const paramsStart = sequenceStart + KITTY_SEQUENCE_PREFIX.length;
    const paramsEnd = line.indexOf(";", paramsStart);
    if (paramsEnd === -1)
        return [];
    const params = line.slice(paramsStart, paramsEnd);
    for (const param of params.split(",")) {
        const [key, value] = param.split("=", 2);
        if (key !== "i" || value === undefined)
            continue;
        const id = Number(value);
        if (Number.isInteger(id) && id > 0 && id <= 0xffffffff) {
            return [id];
        }
    }
    return [];
}
/** Type guard to check if a component implements Focusable */
export function isFocusable(component) {
    return component !== null && "focused" in component;
}
/**
 * Cursor position marker - APC (Application Program Command) sequence.
 * This is a zero-width escape sequence that terminals ignore.
 * Components emit this at the cursor position when focused.
 * TUI finds and strips this marker, then positions the hardware cursor there.
 */
export const CURSOR_MARKER = "\x1b_pi:c\x07";
export { visibleWidth };
/** Parse a SizeValue into absolute value given a reference size */
function parseSizeValue(value, referenceSize) {
    if (value === undefined)
        return undefined;
    if (typeof value === "number")
        return value;
    // Parse percentage string like "50%"
    const match = value.match(/^(\d+(?:\.\d+)?)%$/);
    if (match) {
        return Math.floor((referenceSize * parseFloat(match[1])) / 100);
    }
    return undefined;
}
function isTermuxSession() {
    return Boolean(process.env.TERMUX_VERSION);
}
/**
 * Container - a component that contains other components
 */
export class Container {
    children = [];
    addChild(component) {
        this.children.push(component);
    }
    removeChild(component) {
        const index = this.children.indexOf(component);
        if (index !== -1) {
            this.children.splice(index, 1);
        }
    }
    clear() {
        this.children = [];
    }
    invalidate() {
        for (const child of this.children) {
            child.invalidate?.();
        }
    }
    render(width) {
        const lines = [];
        this._firstChildLines = 0;
        this._lastChildLines = 0;
        for (let ci = 0; ci < this.children.length; ci++) {
            const childLines = this.children[ci].render(width);
            if (ci === 0) this._firstChildLines = childLines.length;
            if (ci === this.children.length - 1) this._lastChildLines = childLines.length;
            for (const line of childLines) {
                lines.push(line);
            }
        }
        return lines;
    }
}
/**
 * TUI - Main class for managing terminal UI with differential rendering
 */
export class TUI extends Container {
    terminal;
    previousLines = [];
    previousKittyImageIds = new Set();
    previousWidth = 0;
    previousHeight = 0;
    focusedComponent = null;
    inputListeners = new Set();
    /** Global callback for debug key (Shift+Ctrl+D). Called before input is forwarded to focused component. */
    onDebug;
    renderRequested = false;
    renderTimer;
    lastRenderAt = 0;
    static MIN_RENDER_INTERVAL_MS = 16;
    cursorRow = 0; // Logical cursor row (end of rendered content)
    hardwareCursorRow = 0; // Actual terminal cursor row (may differ due to IME positioning)
    showHardwareCursor = process.env.PI_HARDWARE_CURSOR === "1";
    clearOnShrink = process.env.PI_CLEAR_ON_SHRINK === "1"; // Clear empty rows when content shrinks (default: off)
    maxLinesRendered = 0; // Track terminal's working area (max lines ever rendered)
    previousViewportTop = 0; // Track previous viewport top for resize-aware cursor moves
    fullRedrawCount = 0;
    stopped = false;
    _scrollRegionActive = false;
    _pinnedBottom = 0;
    // Overlay stack for modal components rendered on top of base content
    focusOrderCounter = 0;
    overlayStack = [];
    overlayFocusRestore = { status: "inactive" };
    constructor(terminal, showHardwareCursor) {
        super();
        this.terminal = terminal;
        if (showHardwareCursor !== undefined) {
            this.showHardwareCursor = showHardwareCursor;
        }
    }
    get fullRedraws() {
        return this.fullRedrawCount;
    }
    getShowHardwareCursor() {
        return this.showHardwareCursor;
    }
    setShowHardwareCursor(enabled) {
        if (this.showHardwareCursor === enabled)
            return;
        this.showHardwareCursor = enabled;
        if (!enabled) {
            this.terminal.hideCursor();
        }
        this.requestRender();
    }
    getClearOnShrink() {
        return this.clearOnShrink;
    }
    /**
     * Set whether to trigger full re-render when content shrinks.
     * When true (default), empty rows are cleared when content shrinks.
     * When false, empty rows remain (reduces redraws on slower terminals).
     */
    setClearOnShrink(enabled) {
        this.clearOnShrink = enabled;
    }
    setFocus(component) {
        this.setFocusInternal({ component, overlayFocusRestore: "clear" });
    }
    setFocusInternal({ component, overlayFocusRestore, }) {
        const previousFocus = this.focusedComponent;
        let nextFocus = component;
        const previousFocusedOverlay = previousFocus
            ? this.overlayStack.find((entry) => entry.component === previousFocus && this.isOverlayVisible(entry))
            : undefined;
        const nextFocusIsOverlay = nextFocus ? this.overlayStack.some((entry) => entry.component === nextFocus) : false;
        const restoreState = this.getVisibleOverlayFocusRestore();
        if (nextFocus && !nextFocusIsOverlay) {
            if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
                if (restoreState.resume.status === "focus-target" || !this.isComponentMounted(restoreState.blockedBy)) {
                    nextFocus = this.resolveBlockedOverlayFocusResume(restoreState);
                }
                else {
                    this.overlayFocusRestore = {
                        status: "blocked",
                        overlay: restoreState.overlay,
                        blockedBy: nextFocus,
                        resume: restoreState.resume,
                    };
                }
            }
            else if (previousFocusedOverlay &&
                restoreState.status !== "inactive" &&
                restoreState.overlay === previousFocusedOverlay &&
                !this.isOverlayFocusAncestor(previousFocusedOverlay, nextFocus)) {
                this.overlayFocusRestore = {
                    status: "blocked",
                    overlay: previousFocusedOverlay,
                    blockedBy: nextFocus,
                    resume: { status: "restore-overlay" },
                };
            }
        }
        else if (nextFocus === null) {
            if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
                nextFocus = this.resolveBlockedOverlayFocusResume(restoreState);
            }
            else if (overlayFocusRestore === "clear") {
                this.clearOverlayFocusRestore();
            }
        }
        if (isFocusable(this.focusedComponent)) {
            this.focusedComponent.focused = false;
        }
        this.focusedComponent = nextFocus;
        if (isFocusable(nextFocus)) {
            nextFocus.focused = true;
        }
        const focusedOverlay = nextFocus
            ? this.overlayStack.find((entry) => entry.component === nextFocus && this.isOverlayVisible(entry))
            : undefined;
        if (focusedOverlay) {
            this.overlayFocusRestore = { status: "eligible", overlay: focusedOverlay };
        }
    }
    clearOverlayFocusRestore() {
        this.overlayFocusRestore = { status: "inactive" };
    }
    clearOverlayFocusRestoreFor(overlay) {
        if (this.overlayFocusRestore.status !== "inactive" && this.overlayFocusRestore.overlay === overlay) {
            this.clearOverlayFocusRestore();
        }
    }
    resolveBlockedOverlayFocusResume(restoreState) {
        if (restoreState.resume.status === "restore-overlay")
            return restoreState.overlay.component;
        this.clearOverlayFocusRestore();
        return restoreState.resume.target;
    }
    getVisibleOverlayFocusRestore() {
        const restoreState = this.overlayFocusRestore;
        if (restoreState.status === "inactive")
            return restoreState;
        if (!this.overlayStack.includes(restoreState.overlay) || !this.isOverlayVisible(restoreState.overlay)) {
            return { status: "inactive" };
        }
        return restoreState;
    }
    isOverlayFocusAncestor(entry, component) {
        const visited = new Set();
        let current = entry.preFocus;
        while (current && !visited.has(current)) {
            visited.add(current);
            if (current === component)
                return true;
            current = this.overlayStack.find((overlay) => overlay.component === current)?.preFocus ?? null;
        }
        return false;
    }
    retargetOverlayPreFocus(removed) {
        for (const overlay of this.overlayStack) {
            if (overlay !== removed && overlay.preFocus === removed.component) {
                overlay.preFocus = removed.preFocus;
            }
        }
    }
    isComponentMounted(component) {
        return this.children.some((child) => this.containsComponent(child, component));
    }
    containsComponent(root, target) {
        if (root === target)
            return true;
        if (!(root instanceof Container))
            return false;
        return root.children.some((child) => this.containsComponent(child, target));
    }
    /**
     * Show an overlay component with configurable positioning and sizing.
     * Returns a handle to control the overlay's visibility.
     */
    showOverlay(component, options) {
        const entry = {
            component,
            ...(options === undefined ? {} : { options }),
            preFocus: this.focusedComponent,
            hidden: false,
            focusOrder: ++this.focusOrderCounter,
        };
        this.overlayStack.push(entry);
        // Only focus if overlay is actually visible
        if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
            this.setFocus(component);
        }
        this.terminal.hideCursor();
        this.requestRender();
        // Return handle for controlling this overlay
        return {
            hide: () => {
                const index = this.overlayStack.indexOf(entry);
                if (index !== -1) {
                    this.clearOverlayFocusRestoreFor(entry);
                    this.retargetOverlayPreFocus(entry);
                    this.overlayStack.splice(index, 1);
                    // Restore focus if this overlay had focus
                    if (this.focusedComponent === component) {
                        const topVisible = this.getTopmostVisibleOverlay();
                        this.setFocus(topVisible?.component ?? entry.preFocus);
                    }
                    if (this.overlayStack.length === 0)
                        this.terminal.hideCursor();
                    this.requestRender();
                }
            },
            setHidden: (hidden) => {
                if (entry.hidden === hidden)
                    return;
                entry.hidden = hidden;
                // Update focus when hiding/showing
                if (hidden) {
                    this.clearOverlayFocusRestoreFor(entry);
                    // If this overlay had focus, move focus to next visible or preFocus
                    if (this.focusedComponent === component) {
                        const topVisible = this.getTopmostVisibleOverlay();
                        this.setFocus(topVisible?.component ?? entry.preFocus);
                    }
                }
                else {
                    // Restore focus to this overlay when showing (if it's actually visible)
                    if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
                        entry.focusOrder = ++this.focusOrderCounter;
                        this.setFocus(component);
                    }
                }
                this.requestRender();
            },
            isHidden: () => entry.hidden,
            focus: () => {
                if (!this.overlayStack.includes(entry) || !this.isOverlayVisible(entry))
                    return;
                entry.focusOrder = ++this.focusOrderCounter;
                this.setFocus(component);
                this.requestRender();
            },
            unfocus: (unfocusOptions) => {
                const isFocused = this.focusedComponent === component;
                const restoreState = this.overlayFocusRestore;
                const hasPendingRestore = restoreState.status !== "inactive" && restoreState.overlay === entry;
                if (!isFocused && !hasPendingRestore)
                    return;
                if (restoreState.status === "blocked" &&
                    restoreState.overlay === entry &&
                    this.focusedComponent === restoreState.blockedBy) {
                    if (unfocusOptions) {
                        this.overlayFocusRestore = {
                            status: "blocked",
                            overlay: entry,
                            blockedBy: restoreState.blockedBy,
                            resume: { status: "focus-target", target: unfocusOptions.target },
                        };
                    }
                    else {
                        this.clearOverlayFocusRestore();
                    }
                    this.requestRender();
                    return;
                }
                this.clearOverlayFocusRestoreFor(entry);
                if (isFocused || unfocusOptions) {
                    const topVisible = this.getTopmostVisibleOverlay();
                    const fallbackTarget = topVisible && topVisible !== entry ? topVisible.component : entry.preFocus;
                    this.setFocus(unfocusOptions ? unfocusOptions.target : fallbackTarget);
                }
                this.requestRender();
            },
            isFocused: () => this.focusedComponent === component,
        };
    }
    /** Hide the topmost overlay and restore previous focus. */
    hideOverlay() {
        const overlay = this.overlayStack[this.overlayStack.length - 1];
        if (!overlay)
            return;
        this.clearOverlayFocusRestoreFor(overlay);
        this.retargetOverlayPreFocus(overlay);
        this.overlayStack.pop();
        if (this.focusedComponent === overlay.component) {
            // Find topmost visible overlay, or fall back to preFocus
            const topVisible = this.getTopmostVisibleOverlay();
            this.setFocus(topVisible?.component ?? overlay.preFocus);
        }
        if (this.overlayStack.length === 0)
            this.terminal.hideCursor();
        this.requestRender();
    }
    /** Check if there are any visible overlays */
    hasOverlay() {
        return this.overlayStack.some((o) => this.isOverlayVisible(o));
    }
    /** Check if an overlay entry is currently visible */
    isOverlayVisible(entry) {
        if (entry.hidden)
            return false;
        if (entry.options?.visible) {
            return entry.options.visible(this.terminal.columns, this.terminal.rows);
        }
        return true;
    }
    /** Find the visual-frontmost visible capturing overlay, if any */
    getTopmostVisibleOverlay() {
        let topmost;
        for (const overlay of this.overlayStack) {
            if (overlay.options?.nonCapturing || !this.isOverlayVisible(overlay))
                continue;
            if (!topmost || overlay.focusOrder > topmost.focusOrder) {
                topmost = overlay;
            }
        }
        return topmost;
    }
    invalidate() {
        super.invalidate();
        for (const overlay of this.overlayStack)
            overlay.component.invalidate?.();
    }
    start() {
        this.stopped = false;
        this.terminal.start((data) => this.handleInput(data), () => this.requestRender());
        this.terminal.hideCursor();
        this.queryCellSize();
        this.requestRender();
    }
    addInputListener(listener) {
        this.inputListeners.add(listener);
        return () => {
            this.inputListeners.delete(listener);
        };
    }
    removeInputListener(listener) {
        this.inputListeners.delete(listener);
    }
    queryCellSize() {
        // Only query if terminal supports images (cell size is only used for image rendering)
        if (!getCapabilities().images) {
            return;
        }
        // Query terminal for cell size in pixels: CSI 16 t
        // Response format: CSI 6 ; height ; width t
        this.terminal.write("\x1b[16t");
    }
    stop() {
        this.stopped = true;
        if (this.renderTimer) {
            clearTimeout(this.renderTimer);
            this.renderTimer = undefined;
        }
        if (this._scrollRegionActive) {
            this.terminal.write("\x1b[r"); // reset scroll region
            this._scrollRegionActive = false;
        }
        this.terminal.showCursor();
        this.terminal.stop();
    }
    requestRender(force = false) {
        if (force) {
            this.previousLines = [];
            this.previousWidth = -1; // -1 triggers widthChanged, forcing a full clear
            this.previousHeight = -1; // -1 triggers heightChanged, forcing a full clear
            this.cursorRow = 0;
            this.hardwareCursorRow = 0;
            this.maxLinesRendered = 0;
            this.previousViewportTop = 0;
            if (this.renderTimer) {
                clearTimeout(this.renderTimer);
                this.renderTimer = undefined;
            }
            this.renderRequested = true;
            process.nextTick(() => {
                if (this.stopped || !this.renderRequested) {
                    return;
                }
                this.renderRequested = false;
                this.lastRenderAt = performance.now();
                this.doRender();
            });
            return;
        }
        if (this.renderRequested)
            return;
        this.renderRequested = true;
        process.nextTick(() => this.scheduleRender());
    }
    scheduleRender() {
        if (this.stopped || this.renderTimer || !this.renderRequested) {
            return;
        }
        const elapsed = performance.now() - this.lastRenderAt;
        const delay = Math.max(0, TUI.MIN_RENDER_INTERVAL_MS - elapsed);
        this.renderTimer = setTimeout(() => {
            this.renderTimer = undefined;
            if (this.stopped || !this.renderRequested) {
                return;
            }
            this.renderRequested = false;
            this.lastRenderAt = performance.now();
            this.doRender();
            if (this.renderRequested) {
                this.scheduleRender();
            }
        }, delay);
    }
    handleInput(data) {
        if (this.inputListeners.size > 0) {
            let current = data;
            for (const listener of this.inputListeners) {
                const result = listener(current);
                if (result?.consume) {
                    return;
                }
                if (result?.data !== undefined) {
                    current = result.data;
                }
            }
            if (current.length === 0) {
                return;
            }
            data = current;
        }
        // Consume terminal cell size responses without blocking unrelated input.
        if (this.consumeCellSizeResponse(data)) {
            return;
        }
        // Global debug key handler (Shift+Ctrl+D)
        if (matchesKey(data, "shift+ctrl+d") && this.onDebug) {
            this.onDebug();
            return;
        }
        // If focused component is an overlay, verify it's still visible
        // (visibility can change due to terminal resize or visible() callback)
        const focusedOverlay = this.overlayStack.find((o) => o.component === this.focusedComponent);
        if (focusedOverlay && !this.isOverlayVisible(focusedOverlay)) {
            // Focused overlay is no longer visible, redirect to topmost visible overlay
            const topVisible = this.getTopmostVisibleOverlay();
            if (topVisible) {
                this.setFocus(topVisible.component);
            }
            else {
                this.setFocusInternal({ component: focusedOverlay.preFocus, overlayFocusRestore: "preserve" });
            }
        }
        const focusIsOverlay = this.overlayStack.some((o) => o.component === this.focusedComponent);
        if (!focusIsOverlay) {
            const restoreState = this.getVisibleOverlayFocusRestore();
            if (restoreState.status === "eligible") {
                this.setFocus(restoreState.overlay.component);
            }
            else if (restoreState.status === "blocked" && restoreState.blockedBy !== this.focusedComponent) {
                if (restoreState.resume.status === "restore-overlay") {
                    this.setFocus(restoreState.overlay.component);
                }
                else {
                    this.clearOverlayFocusRestore();
                    this.setFocus(restoreState.resume.target);
                }
            }
        }
        // Pass input to focused component (including Ctrl+C)
        // The focused component can decide how to handle Ctrl+C
        if (this.focusedComponent?.handleInput) {
            // Filter out key release events unless component opts in
            if (isKeyRelease(data) && !this.focusedComponent.wantsKeyRelease) {
                return;
            }
            this.focusedComponent.handleInput(data);
            this.requestRender();
        }
    }
    consumeCellSizeResponse(data) {
        // Response format: ESC [ 6 ; height ; width t
        const match = data.match(/^\x1b\[6;(\d+);(\d+)t$/);
        if (!match) {
            return false;
        }
        const heightPx = parseInt(match[1], 10);
        const widthPx = parseInt(match[2], 10);
        if (heightPx <= 0 || widthPx <= 0) {
            return true;
        }
        setCellDimensions({ widthPx, heightPx });
        // Invalidate all components so images re-render with correct dimensions.
        this.invalidate();
        this.requestRender();
        return true;
    }
    /**
     * Resolve overlay layout from options.
     * Returns { width, row, col, maxHeight } for rendering.
     */
    resolveOverlayLayout(options, overlayHeight, termWidth, termHeight) {
        const opt = options ?? {};
        // Parse margin (clamp to non-negative)
        const margin = typeof opt.margin === "number"
            ? { top: opt.margin, right: opt.margin, bottom: opt.margin, left: opt.margin }
            : (opt.margin ?? {});
        const marginTop = Math.max(0, margin.top ?? 0);
        const marginRight = Math.max(0, margin.right ?? 0);
        const marginBottom = Math.max(0, margin.bottom ?? 0);
        const marginLeft = Math.max(0, margin.left ?? 0);
        // Available space after margins
        const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
        const availHeight = Math.max(1, termHeight - marginTop - marginBottom);
        // === Resolve width ===
        let width = parseSizeValue(opt.width, termWidth) ?? availWidth;
        // Apply minWidth
        if (opt.minWidth !== undefined) {
            width = Math.max(width, opt.minWidth);
        }
        // Clamp to available space
        width = Math.max(1, Math.min(width, availWidth));
        // === Resolve maxHeight ===
        let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
        // Clamp to available space
        if (maxHeight !== undefined) {
            maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
        }
        // Effective overlay height (may be clamped by maxHeight)
        const effectiveHeight = maxHeight !== undefined ? Math.min(overlayHeight, maxHeight) : overlayHeight;
        // === Resolve position ===
        let row;
        let col;
        if (opt.row !== undefined) {
            if (typeof opt.row === "string") {
                // Percentage: 0% = top, 100% = bottom (overlay stays within bounds)
                const match = opt.row.match(/^(\d+(?:\.\d+)?)%$/);
                if (match) {
                    const maxRow = Math.max(0, availHeight - effectiveHeight);
                    const percent = parseFloat(match[1]) / 100;
                    row = marginTop + Math.floor(maxRow * percent);
                }
                else {
                    // Invalid format, fall back to center
                    row = this.resolveAnchorRow("center", effectiveHeight, availHeight, marginTop);
                }
            }
            else {
                // Absolute row position
                row = opt.row;
            }
        }
        else {
            // Anchor-based (default: center)
            const anchor = opt.anchor ?? "center";
            row = this.resolveAnchorRow(anchor, effectiveHeight, availHeight, marginTop);
        }
        if (opt.col !== undefined) {
            if (typeof opt.col === "string") {
                // Percentage: 0% = left, 100% = right (overlay stays within bounds)
                const match = opt.col.match(/^(\d+(?:\.\d+)?)%$/);
                if (match) {
                    const maxCol = Math.max(0, availWidth - width);
                    const percent = parseFloat(match[1]) / 100;
                    col = marginLeft + Math.floor(maxCol * percent);
                }
                else {
                    // Invalid format, fall back to center
                    col = this.resolveAnchorCol("center", width, availWidth, marginLeft);
                }
            }
            else {
                // Absolute column position
                col = opt.col;
            }
        }
        else {
            // Anchor-based (default: center)
            const anchor = opt.anchor ?? "center";
            col = this.resolveAnchorCol(anchor, width, availWidth, marginLeft);
        }
        // Apply offsets
        if (opt.offsetY !== undefined)
            row += opt.offsetY;
        if (opt.offsetX !== undefined)
            col += opt.offsetX;
        // Clamp to terminal bounds (respecting margins)
        row = Math.max(marginTop, Math.min(row, termHeight - marginBottom - effectiveHeight));
        col = Math.max(marginLeft, Math.min(col, termWidth - marginRight - width));
        return { width, row, col, maxHeight };
    }
    resolveAnchorRow(anchor, height, availHeight, marginTop) {
        switch (anchor) {
            case "top-left":
            case "top-center":
            case "top-right":
                return marginTop;
            case "bottom-left":
            case "bottom-center":
            case "bottom-right":
                return marginTop + availHeight - height;
            case "left-center":
            case "center":
            case "right-center":
                return marginTop + Math.floor((availHeight - height) / 2);
        }
    }
    resolveAnchorCol(anchor, width, availWidth, marginLeft) {
        switch (anchor) {
            case "top-left":
            case "left-center":
            case "bottom-left":
                return marginLeft;
            case "top-right":
            case "right-center":
            case "bottom-right":
                return marginLeft + availWidth - width;
            case "top-center":
            case "center":
            case "bottom-center":
                return marginLeft + Math.floor((availWidth - width) / 2);
        }
    }
    /** Composite all overlays into content lines (sorted by focusOrder, higher = on top). */
    compositeOverlays(lines, termWidth, termHeight) {
        if (this.overlayStack.length === 0)
            return lines;
        const result = [...lines];
        // Pre-render all visible overlays and calculate positions
        const rendered = [];
        let minLinesNeeded = result.length;
        const visibleEntries = this.overlayStack.filter((e) => this.isOverlayVisible(e));
        visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);
        for (const entry of visibleEntries) {
            const { component, options } = entry;
            // Get layout with height=0 first to determine width and maxHeight
            // (width and maxHeight don't depend on overlay height)
            const { width, maxHeight } = this.resolveOverlayLayout(options, 0, termWidth, termHeight);
            // Render component at calculated width
            let overlayLines = component.render(width);
            // Apply maxHeight if specified
            if (maxHeight !== undefined && overlayLines.length > maxHeight) {
                overlayLines = overlayLines.slice(0, maxHeight);
            }
            // Get final row/col with actual overlay height
            const { row, col } = this.resolveOverlayLayout(options, overlayLines.length, termWidth, termHeight);
            rendered.push({ overlayLines, row, col, w: width });
            minLinesNeeded = Math.max(minLinesNeeded, row + overlayLines.length);
        }
        // Pad to at least terminal height so overlays have screen-relative positions.
        // Excludes maxLinesRendered: the historical high-water mark caused self-reinforcing
        // inflation that pushed content into scrollback on terminal widen.
        const workingHeight = Math.max(result.length, termHeight, minLinesNeeded);
        // Extend result with empty lines if content is too short for overlay placement or working area
        while (result.length < workingHeight) {
            result.push("");
        }
        const viewportStart = Math.max(0, workingHeight - termHeight);
        // Composite each overlay
        for (const { overlayLines, row, col, w } of rendered) {
            for (let i = 0; i < overlayLines.length; i++) {
                const idx = viewportStart + row + i;
                if (idx >= 0 && idx < result.length) {
                    // Defensive: truncate overlay line to declared width before compositing
                    // (components should already respect width, but this ensures it)
                    const truncatedOverlayLine = visibleWidth(overlayLines[i]) > w ? sliceByColumn(overlayLines[i], 0, w, true) : overlayLines[i];
                    result[idx] = this.compositeLineAt(result[idx], truncatedOverlayLine, col, w, termWidth);
                }
            }
        }
        return result;
    }
    // pi-coding-master: OSC 8 close (\x1b]8;;\x07) 在某些终端会渲染成空行，只保留 SGR reset
    static SEGMENT_RESET = "\x1b[0m";
    // pi-coding-master: 折行缓存——内容+宽度没变就跳过 wrapHanging（修复 CPU 100% 空转）
    _wrapCache = { width: 0, result: null, ref: null };
    wrapLinesToWidth(lines, width) {
        if (this._wrapCache.width === width && this._wrapCache.ref === lines) {
            return this._wrapCache.result;
        }
        const result = wrapHanging(lines, width, { visibleWidth, sliceWithWidth, sliceByColumn, isImageLine });
        this._wrapCache = { width, result, ref: lines };
        return result;
    }
    applyLineResets(lines) {
        const reset = TUI.SEGMENT_RESET;
        for (let i = 0; i < lines.length; i++) {
            // pi-coding-master 防御:某组件偶发吐出非字符串行(漏括号的方法引用 / undefined / 嵌套数组)时强制转成字符串。
            // 绝不让一行坏数据崩掉整个渲染循环 —— 那等于崩掉一个一直活着的 agent。
            const line = typeof lines[i] === "string" ? lines[i] : (lines[i] = String(lines[i] ?? ""));
            if (!isImageLine(line)) {
                lines[i] = normalizeTerminalOutput(line) + reset;
            }
        }
        return lines;
    }
    collectKittyImageIds(lines) {
        const ids = new Set();
        for (const line of lines) {
            for (const id of extractKittyImageIds(line)) {
                ids.add(id);
            }
        }
        return ids;
    }
    deleteKittyImages(ids) {
        let buffer = "";
        for (const id of ids) {
            buffer += deleteKittyImage(id);
        }
        return buffer;
    }
    expandLastChangedForKittyImages(firstChanged, lastChanged) {
        let expandedLastChanged = lastChanged;
        for (let i = firstChanged; i < this.previousLines.length; i++) {
            if (extractKittyImageIds(this.previousLines[i]).length > 0) {
                expandedLastChanged = Math.max(expandedLastChanged, i);
            }
        }
        return expandedLastChanged;
    }
    deleteChangedKittyImages(firstChanged, lastChanged) {
        if (firstChanged < 0 || lastChanged < firstChanged)
            return "";
        const ids = new Set();
        const maxLine = Math.min(lastChanged, this.previousLines.length - 1);
        for (let i = firstChanged; i <= maxLine; i++) {
            for (const id of extractKittyImageIds(this.previousLines[i] ?? "")) {
                ids.add(id);
            }
        }
        return this.deleteKittyImages(ids);
    }
    /** Splice overlay content into a base line at a specific column. Single-pass optimized. */
    compositeLineAt(baseLine, overlayLine, startCol, overlayWidth, totalWidth) {
        if (isImageLine(baseLine))
            return baseLine;
        // Single pass through baseLine extracts both before and after segments
        const afterStart = startCol + overlayWidth;
        const base = extractSegments(baseLine, startCol, afterStart, totalWidth - afterStart, true);
        // Extract overlay with width tracking (strict=true to exclude wide chars at boundary)
        const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);
        // Pad segments to target widths
        const beforePad = Math.max(0, startCol - base.beforeWidth);
        const overlayPad = Math.max(0, overlayWidth - overlay.width);
        const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
        const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
        const afterTarget = Math.max(0, totalWidth - actualBeforeWidth - actualOverlayWidth);
        const afterPad = Math.max(0, afterTarget - base.afterWidth);
        // Compose result
        const r = TUI.SEGMENT_RESET;
        const result = base.before +
            " ".repeat(beforePad) +
            r +
            overlay.text +
            " ".repeat(overlayPad) +
            r +
            base.after +
            " ".repeat(afterPad);
        // CRITICAL: Always verify and truncate to terminal width.
        // This is the final safeguard against width overflow which would crash the TUI.
        // Width tracking can drift from actual visible width due to:
        // - Complex ANSI/OSC sequences (hyperlinks, colors)
        // - Wide characters at segment boundaries
        // - Edge cases in segment extraction
        const resultWidth = visibleWidth(result);
        if (resultWidth <= totalWidth) {
            return result;
        }
        // Truncate with strict=true to ensure we don't exceed totalWidth
        return sliceByColumn(result, 0, totalWidth, true);
    }
    /**
     * Find and extract cursor position from rendered lines.
     * Searches for CURSOR_MARKER, calculates its position, and strips it from the output.
     * Only scans the bottom terminal height lines (visible viewport).
     * @param lines - Rendered lines to search
     * @param height - Terminal height (visible viewport size)
     * @returns Cursor position { row, col } or null if no marker found
     */
    extractCursorPosition(lines, height) {
        // Only scan the bottom `height` lines (visible viewport)
        const viewportTop = Math.max(0, lines.length - height);
        for (let row = lines.length - 1; row >= viewportTop; row--) {
            const line = lines[row];
            const markerIndex = line.indexOf(CURSOR_MARKER);
            if (markerIndex !== -1) {
                // Calculate visual column (width of text before marker)
                const beforeMarker = line.slice(0, markerIndex);
                const col = visibleWidth(beforeMarker);
                // Strip marker from the line
                lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
                return { row, col };
            }
        }
        return null;
    }
    doRender() {
        // ── pi-coding-master 自修复引擎 · 渲染边界 ──────────────────────────────────────
        // 渲染层【任何】throw 都不许崩掉 pi(一个一直活着的 agent)。今天的"超宽行 throw"只是其一;
        // 任意自定义组件 render() 抛错也走这里。策略:记日志(响,不静默)→ 跳过本帧 → 重置 previousLines
        // 让下一帧整屏重画、从坏状态重新同步。绝不 rethrow。
        try {
            this._doRenderUnsafe();
        } catch (e) {
            try {
                fs.appendFileSync(path.join(os.homedir(), ".pi", "agent", "pi-render-errors.log"), `[${new Date().toISOString()}] [render] ${(e && e.stack) ? e.stack : e}\n`);
            } catch { }
            this.previousLines = []; // 下帧全重画,重新同步,别卡死在坏状态
        }
    }
    _doRenderUnsafe() {
        if (this.stopped)
            return;
        const width = this.terminal.columns;
        const height = this.terminal.rows;
        const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
        const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;
        const previousBufferLength = this.previousHeight > 0 ? this.previousViewportTop + this.previousHeight : height;
        let prevViewportTop = heightChanged ? Math.max(0, previousBufferLength - height) : this.previousViewportTop;
        let viewportTop = prevViewportTop;
        let hardwareCursorRow = this.hardwareCursorRow;
        const computeLineDiff = (targetRow) => {
            const currentScreenRow = hardwareCursorRow - prevViewportTop;
            const targetScreenRow = targetRow - viewportTop;
            return targetScreenRow - currentScreenRow;
        };
        // Render all components to get new lines
        let newLines = this.render(width);
        // Composite overlays into the rendered lines (before differential compare)
        if (this.overlayStack.length > 0) {
            newLines = this.compositeOverlays(newLines, width, height);
        }
        // pi-coding-master: 超宽的行在这里【折行】成多行(替代下面"超宽即抛错崩进程")。
        // 必须在 cursor/diff/清屏 用到行数之前做 —— 之后所有逻辑都基于折行后的行数,一致、不错位。
        newLines = this.wrapLinesToWidth(newLines, width);
        // Compute pinned footer height for scroll region (last child = footer)
        const pb = this._lastChildLines || 0;
        this._pinnedBottom = pb;
        // Extract cursor position before applying line resets (marker must be found first)
        const cursorPos = this.extractCursorPosition(newLines, height);
        newLines = this.applyLineResets(newLines);
        // Helper to render all new lines (overwrite-in-place, no blank-screen flash)
        const fullRender = (clear) => {
            this.fullRedrawCount += 1;
            let buffer = "\x1b[?2026h"; // Begin synchronized output
            if (clear) {
                buffer += this.deleteKittyImages(this.previousKittyImageIds);
                if (widthChanged || heightChanged) {
                    buffer += "\x1b[2J\x1b[H\x1b[3J"; // Resize: full clear needed
                } else {
                    buffer += "\x1b[H"; // Non-resize: overwrite in place
                }
            }
            for (let i = 0; i < newLines.length; i++) {
                if (i > 0)
                    buffer += "\r\n";
                buffer += "\x1b[2K"; // Clear this line then write — never blank the whole screen
                buffer += newLines[i];
            }
            // Clear leftover lines from previous render (content shrunk)
            const prevLen = this.previousLines.length;
            if (clear && prevLen > newLines.length) {
                for (let i = newLines.length; i < prevLen && i < newLines.length + height; i++) {
                    buffer += "\r\n\x1b[2K";
                }
            }
            buffer += "\x1b[?2026l"; // End synchronized output
            this.terminal.write(buffer);
            this.cursorRow = Math.max(0, newLines.length - 1);
            this.hardwareCursorRow = this.cursorRow;
            // Reset max lines when clearing, otherwise track growth
            if (clear) {
                this.maxLinesRendered = newLines.length;
            }
            else {
                this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
            }
            const bufferLength = Math.max(height, newLines.length);
            this.previousViewportTop = Math.max(0, bufferLength - height);
            this.positionHardwareCursor(cursorPos, newLines.length);
            this.previousLines = newLines;
            this.previousKittyImageIds = this.collectKittyImageIds(newLines);
            this.previousWidth = width;
            this.previousHeight = height;
        };
        const debugRedraw = process.env.PI_DEBUG_REDRAW === "1" || fs.existsSync("/tmp/pi-tui-debug");
        const logRedraw = (reason) => {
            if (!debugRedraw)
                return;
            const logPath = path.join(os.homedir(), ".pi", "agent", "pi-debug.log");
            const msg = `[${new Date().toISOString()}] fullRender: ${reason} (prev=${this.previousLines.length}, new=${newLines.length}, height=${height})\n`;
            fs.appendFileSync(logPath, msg);
        };
        // First render - just output everything without clearing (assumes clean screen)
        if (this.previousLines.length === 0 && !widthChanged && !heightChanged) {
            logRedraw("first render");
            fullRender(false);
            return;
        }
        // Width changes always need a full re-render because wrapping changes.
        if (widthChanged) {
            logRedraw(`terminal width changed (${this.previousWidth} -> ${width})`);
            fullRender(true);
            return;
        }
        // Height changes normally need a full re-render to keep the visible viewport aligned,
        // but Termux changes height when the software keyboard shows or hides.
        // In that environment, a full redraw causes the entire history to replay on every toggle.
        if (heightChanged && !isTermuxSession()) {
            logRedraw(`terminal height changed (${this.previousHeight} -> ${height})`);
            fullRender(true);
            return;
        }
        // Content shrunk below the working area and no overlays - re-render to clear empty rows
        // (overlays need the padding, so only do this when no overlays are active)
        // Configurable via setClearOnShrink() or PI_CLEAR_ON_SHRINK=0 env var
        if (this.clearOnShrink && newLines.length < this.maxLinesRendered && this.overlayStack.length === 0) {
            logRedraw(`clearOnShrink (maxLinesRendered=${this.maxLinesRendered})`);
            fullRender(true);
            return;
        }
        // Find first and last changed lines
        let firstChanged = -1;
        let lastChanged = -1;
        const maxLines = Math.max(newLines.length, this.previousLines.length);
        for (let i = 0; i < maxLines; i++) {
            const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
            const newLine = i < newLines.length ? newLines[i] : "";
            if (oldLine !== newLine) {
                if (firstChanged === -1) {
                    firstChanged = i;
                }
                lastChanged = i;
            }
        }
        const appendedLines = newLines.length > this.previousLines.length;
        if (appendedLines) {
            if (firstChanged === -1) {
                firstChanged = this.previousLines.length;
            }
            lastChanged = newLines.length - 1;
        }
        if (firstChanged !== -1) {
            lastChanged = this.expandLastChangedForKittyImages(firstChanged, lastChanged);
        }
        const appendStart = appendedLines && firstChanged === this.previousLines.length && firstChanged > 0;
        // No changes - but still need to update hardware cursor position if it moved
        if (firstChanged === -1) {
            this.positionHardwareCursor(cursorPos, newLines.length);
            this.previousViewportTop = prevViewportTop;
            this.previousHeight = height;
            return;
        }
        // All changes are in deleted lines (nothing to render, just clear)
        if (firstChanged >= newLines.length) {
            if (this.previousLines.length > newLines.length) {
                let buffer = "\x1b[?2026h";
                buffer += this.deleteChangedKittyImages(firstChanged, lastChanged);
                // Move to end of new content (clamp to 0 for empty content)
                const targetRow = Math.max(0, newLines.length - 1);
                if (targetRow < prevViewportTop) {
                    logRedraw(`deleted lines moved viewport up (${targetRow} < ${prevViewportTop})`);
                    fullRender(true);
                    return;
                }
                const lineDiff = computeLineDiff(targetRow);
                if (lineDiff > 0)
                    buffer += `\x1b[${lineDiff}B`;
                else if (lineDiff < 0)
                    buffer += `\x1b[${-lineDiff}A`;
                buffer += "\r";
                // Clear extra lines without scrolling
                const extraLines = this.previousLines.length - newLines.length;
                if (extraLines > height) {
                    logRedraw(`extraLines > height (${extraLines} > ${height})`);
                    fullRender(true);
                    return;
                }
                const clearStartOffset = newLines.length === 0 ? 0 : 1;
                if (extraLines > 0 && clearStartOffset > 0) {
                    buffer += `\x1b[${clearStartOffset}B`;
                }
                for (let i = 0; i < extraLines; i++) {
                    buffer += "\r\x1b[2K";
                    if (i < extraLines - 1)
                        buffer += "\x1b[1B";
                }
                const moveBack = Math.max(0, extraLines - 1 + clearStartOffset);
                if (moveBack > 0) {
                    buffer += `\x1b[${moveBack}A`;
                }
                buffer += "\x1b[?2026l";
                this.terminal.write(buffer);
                this.cursorRow = targetRow;
                this.hardwareCursorRow = targetRow;
            }
            this.positionHardwareCursor(cursorPos, newLines.length);
            this.previousLines = newLines;
            this.previousKittyImageIds = this.collectKittyImageIds(newLines);
            this.previousWidth = width;
            this.previousHeight = height;
            this.previousViewportTop = prevViewportTop;
            return;
        }
        // Differential rendering can only touch what was actually visible.
        // If the first changed line is above the previous viewport, those changed
        // lines have scrolled off-screen (into scrollback) — the user cannot see them.
        // A full redraw here just to repaint invisible lines clears+homes the whole
        // screen = a jarring "jump to top" on every retroactive history change
        // (tool cards finalizing, markdown reflow, injected/subconscious messages).
        // Instead: if nothing visible changed, only update bookkeeping; otherwise
        // clamp the repaint to the top of the visible viewport and redraw in place.
        // Scrollback may drift slightly above the fold — far preferable to a constant jump.
        // (Set PI_FULL_REDRAW_ABOVE_FOLD=1 to restore the old full-redraw behavior.)
        if (firstChanged < prevViewportTop) {
            if (process.env.PI_FULL_REDRAW_ABOVE_FOLD === "1") {
                logRedraw(`firstChanged < viewportTop (${firstChanged} < ${prevViewportTop})`);
                fullRender(true);
                return;
            }
            if (!appendedLines && lastChanged < prevViewportTop) {
                // Entire change is above the fold — nothing on screen to repaint.
                this.positionHardwareCursor(cursorPos, newLines.length);
                this.previousLines = newLines;
                this.previousKittyImageIds = this.collectKittyImageIds(newLines);
                this.previousWidth = width;
                this.previousHeight = height;
                this.previousViewportTop = prevViewportTop;
                return;
            }
            firstChanged = prevViewportTop;
        }
        // Render from first changed line to end
        // Build buffer with all updates wrapped in synchronized output
        let buffer = "\x1b[?2026h"; // Begin synchronized output
        buffer += this.deleteChangedKittyImages(firstChanged, lastChanged);
        const prevViewportBottom = prevViewportTop + height - 1;
        const moveTargetRow = appendStart ? firstChanged - 1 : firstChanged;
        if (moveTargetRow > prevViewportBottom) {
            const currentScreenRow = Math.max(0, Math.min(height - 1, hardwareCursorRow - prevViewportTop));
            const moveToBottom = height - 1 - currentScreenRow;
            if (moveToBottom > 0) {
                buffer += `\x1b[${moveToBottom}B`;
            }
            const scroll = moveTargetRow - prevViewportBottom;
            buffer += "\r\n".repeat(scroll);
            prevViewportTop += scroll;
            viewportTop += scroll;
            hardwareCursorRow = moveTargetRow;
        }
        // Move cursor to first changed line (use hardwareCursorRow for actual position)
        const lineDiff = computeLineDiff(moveTargetRow);
        if (lineDiff > 0) {
            buffer += `\x1b[${lineDiff}B`; // Move down
        }
        else if (lineDiff < 0) {
            buffer += `\x1b[${-lineDiff}A`; // Move up
        }
        buffer += appendStart ? "\r\n" : "\r"; // Move to column 0
        // Only render changed lines (firstChanged to lastChanged), not all lines to end
        // This reduces flicker when only a single line changes (e.g., spinner animation)
        const renderEnd = Math.min(lastChanged, newLines.length - 1);
        for (let i = firstChanged; i <= renderEnd; i++) {
            if (i > firstChanged)
                buffer += "\r\n";
            buffer += "\x1b[2K"; // Clear current line
            let line = newLines[i];
            const isImage = isImageLine(line);
            if (!isImage && visibleWidth(line) > width) {
                line = sliceByColumn(line, 0, width, true);
            }
            buffer += line;
        }
        // Track where cursor ended up after rendering
        let finalCursorRow = renderEnd;
        // If we had more lines before, clear them and move cursor back
        if (this.previousLines.length > newLines.length) {
            // Move to end of new content first if we stopped before it
            if (renderEnd < newLines.length - 1) {
                const moveDown = newLines.length - 1 - renderEnd;
                buffer += `\x1b[${moveDown}B`;
                finalCursorRow = newLines.length - 1;
            }
            const extraLines = this.previousLines.length - newLines.length;
            for (let i = newLines.length; i < this.previousLines.length; i++) {
                buffer += "\r\n\x1b[2K";
            }
            // Move cursor back to end of new content
            buffer += `\x1b[${extraLines}A`;
        }
        buffer += "\x1b[?2026l"; // End synchronized output
        if (process.env.PI_TUI_DEBUG === "1" || fs.existsSync("/tmp/pi-tui-debug")) {
            const debugDir = "/tmp/tui";
            fs.mkdirSync(debugDir, { recursive: true });
            const debugPath = path.join(debugDir, `render-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
            const debugData = [
                `firstChanged: ${firstChanged}`,
                `viewportTop: ${viewportTop}`,
                `cursorRow: ${this.cursorRow}`,
                `height: ${height}`,
                `lineDiff: ${lineDiff}`,
                `hardwareCursorRow: ${hardwareCursorRow}`,
                `renderEnd: ${renderEnd}`,
                `finalCursorRow: ${finalCursorRow}`,
                `cursorPos: ${JSON.stringify(cursorPos)}`,
                `newLines.length: ${newLines.length}`,
                `previousLines.length: ${this.previousLines.length}`,
                "",
                "=== newLines ===",
                JSON.stringify(newLines, null, 2),
                "",
                "=== previousLines ===",
                JSON.stringify(this.previousLines, null, 2),
                "",
                "=== buffer ===",
                JSON.stringify(buffer),
            ].join("\n");
            fs.writeFileSync(debugPath, debugData);
        }
        // Write entire buffer at once
        this.terminal.write(buffer);
        // Track cursor position for next render
        // cursorRow tracks end of content (for viewport calculation)
        // hardwareCursorRow tracks actual terminal cursor position (for movement)
        this.cursorRow = Math.max(0, newLines.length - 1);
        this.hardwareCursorRow = finalCursorRow;
        // Track terminal's working area (grows but doesn't shrink unless cleared)
        this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
        this.previousViewportTop = Math.max(prevViewportTop, finalCursorRow - height + 1);
        // Position hardware cursor for IME
        this.positionHardwareCursor(cursorPos, newLines.length);
        this.previousLines = newLines;
        this.previousKittyImageIds = this.collectKittyImageIds(newLines);
        this.previousWidth = width;
        this.previousHeight = height;
    }
    /**
     * Position the hardware cursor for IME candidate window.
     * @param cursorPos The cursor position extracted from rendered output, or null
     * @param totalLines Total number of rendered lines
     */
    positionHardwareCursor(cursorPos, totalLines) {
        if (!cursorPos || totalLines <= 0) {
            this.terminal.hideCursor();
            return;
        }
        // Clamp cursor position to valid range
        const targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
        const targetCol = Math.max(0, cursorPos.col);
        // Move cursor from current position to target
        const rowDelta = targetRow - this.hardwareCursorRow;
        let buffer = "";
        if (rowDelta > 0) {
            buffer += `\x1b[${rowDelta}B`; // Move down
        }
        else if (rowDelta < 0) {
            buffer += `\x1b[${-rowDelta}A`; // Move up
        }
        // Move to absolute column (1-indexed)
        buffer += `\x1b[${targetCol + 1}G`;
        if (buffer) {
            this.terminal.write(buffer);
        }
        this.hardwareCursorRow = targetRow;
        if (this.showHardwareCursor) {
            this.terminal.showCursor();
        }
        else {
            this.terminal.hideCursor();
        }
    }
}
//# sourceMappingURL=tui.js.map