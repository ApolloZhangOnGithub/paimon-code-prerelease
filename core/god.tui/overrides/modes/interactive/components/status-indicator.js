import { Loader } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";
import { CountdownTimer } from "./countdown-timer.js";
import { keyText } from "./keybinding-hints.js";
import { formatTokens } from "./footer.js";

function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
}

export class StatusIndicator extends Loader {
    kind;
    constructor(kind, ui, spinnerColorFn, messageColorFn, message, indicator) {
        super(ui, spinnerColorFn, messageColorFn, message, indicator);
        this.kind = kind;
    }
    dispose() {
        this.stop();
    }
}
export class WorkingStatusIndicator extends StatusIndicator {
    _startTime;
    _tickTimer;
    _baseMessage;
    _getTokens;
    _thinkStartTime = 0;
    _isThinking = false;
    constructor(ui, message, indicator, getTokens) {
        const color = "border";
        super("working", ui, (s) => theme.fg(color, s), (t) => theme.fg(color, t), message, indicator);
        this._startTime = Date.now();
        this._baseMessage = message;
        this._getTokens = getTokens;
        this._tickTimer = setInterval(() => this._tick(), 1000);
    }
    setThinking(active) {
        if (active && !this._isThinking) {
            this._isThinking = true;
            this._thinkStartTime = Date.now();
        } else if (!active) {
            this._isThinking = false;
            this._thinkStartTime = 0;
        }
    }
    _tick() {
        const elapsed = fmtElapsed(Date.now() - this._startTime);
        const parts = [elapsed];
        if (this._getTokens) {
            const t = this._getTokens();
            if (t > 0) parts.push(`${formatTokens(t)} tokens`);
        }
        if (this._isThinking && this._thinkStartTime > 0) {
            const thinkElapsed = Date.now() - this._thinkStartTime;
            if (thinkElapsed >= 1000) parts.push(`thinking for ${fmtElapsed(thinkElapsed)}`);
        }
        this.setMessage(`${this._baseMessage} (${parts.join(" · ")})`);
    }
    setMessage(message) {
        if (!message.includes("(")) {
            this._baseMessage = message;
        }
        super.setMessage(message);
    }
    dispose() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = undefined;
        }
        super.dispose();
    }
}
export class RetryStatusIndicator extends StatusIndicator {
    countdown;
    constructor(ui, attempt, maxAttempts, delayMs) {
        const retryMessage = (seconds) => `Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
        super("retry", ui, (spinner) => theme.fg("warning", spinner), (text) => theme.fg("warning", text), retryMessage(Math.ceil(delayMs / 1000)));
        this.countdown = new CountdownTimer(delayMs, ui, (seconds) => {
            this.setMessage(retryMessage(seconds));
        }, () => {
            this.countdown = undefined;
        });
    }
    dispose() {
        this.countdown?.dispose();
        this.countdown = undefined;
        super.dispose();
    }
}
export class CompactionStatusIndicator extends StatusIndicator {
    constructor(ui, reason) {
        const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
        const label = reason === "manual"
            ? `Compacting context... ${cancelHint}`
            : `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
        super("compaction", ui, (spinner) => theme.fg("accent", spinner), (text) => theme.fg("accent", text), label);
    }
}
export class BranchSummaryStatusIndicator extends StatusIndicator {
    constructor(ui) {
        super("branchSummary", ui, (spinner) => theme.fg("accent", spinner), (text) => theme.fg("accent", text), `Summarizing branch... (${keyText("app.interrupt")} to cancel)`);
    }
}
export class IdleStatus {
    invalidate() {
    }
    render(_width) {
        return [];
    }
}
//# sourceMappingURL=status-indicator.js.map
