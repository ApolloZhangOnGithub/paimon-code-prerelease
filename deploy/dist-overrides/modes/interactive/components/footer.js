import { isAbsolute, relative, resolve, sep } from "node:path";
import { readFileSync } from "node:fs";          // pi-coding-master: 读余额硬闸写的文件
import { execSync } from "node:child_process";   // pi-coding-master: sc/hc 状态检测
import { homedir } from "node:os";               // pi-coding-master
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";
// pi-coding-master: footer.render() 流式时每帧都被调用；下面这些文件(work_memory/cortex/cost-*/balance)变化很慢，
// 不该每帧同步读盘(原来每帧 ~6 次 readFileSync = 渲染路径里的磁盘 I/O，拖慢每帧、加重弱终端的渲染压力)。
// 1 秒缓存：把每帧的多次读盘降到至多每秒一轮。读不到返回 ""(行为同原来的 try/catch 兜底)。
// pi-coding-master: sc/hc tmux session 状态（2秒缓存，不每帧 execSync）
let __scHcCache = { ts: 0, sc: false, hc: false, pid: "" };
function getScHcStatus(personId) {
    const now = Date.now();
    if (now - __scHcCache.ts < 2000 && __scHcCache.pid === personId) return __scHcCache;
    let sc = false, hc = false;
    if (personId) {
        try { execSync(`tmux has-session -t sc-${personId} 2>/dev/null`); sc = true; } catch {}
        try { execSync(`tmux has-session -t hc-${personId} 2>/dev/null`); hc = true; } catch {}
    }
    __scHcCache = { ts: now, sc, hc, pid: personId };
    return __scHcCache;
}
const __rcCache = new Map(); // path -> { ts, data }
function cachedReadFile(p) {
    const now = Date.now();
    const hit = __rcCache.get(p);
    if (hit && now - hit.ts < 1000)
        return hit.data;
    let data = "";
    try { data = readFileSync(p, "utf8"); } catch { data = ""; }
    __rcCache.set(p, { ts: now, data });
    return data;
}
/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text) {
    // Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
    return text
        .replace(/[\r\n\t]/g, " ")
        .replace(/ +/g, " ")
        .trim();
}
/**
 * Format token counts for compact footer display.
 */
function formatTokens(count) {
    if (count < 1000)
        return count.toString();
    if (count < 10000)
        return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000)
        return `${Math.round(count / 1000)}k`;
    if (count < 10000000)
        return `${(count / 1000000).toFixed(1)}M`;
    return `${Math.round(count / 1000000)}M`;
}
export function formatCwdForFooter(cwd, home) {
    if (!home)
        return cwd;
    const resolvedCwd = resolve(cwd);
    const resolvedHome = resolve(home);
    const relativeToHome = relative(resolvedHome, resolvedCwd);
    const isInsideHome = relativeToHome === "" ||
        (relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
    if (!isInsideHome)
        return cwd;
    return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}
/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent {
    autoCompactEnabled = true;
    session;
    footerData;
    constructor(session, footerData) {
        this.session = session;
        this.footerData = footerData;
    }
    setSession(session) {
        this.session = session;
    }
    setAutoCompactEnabled(enabled) {
        this.autoCompactEnabled = enabled;
    }
    /**
     * No-op: git branch caching now handled by provider.
     * Kept for compatibility with existing call sites in interactive-mode.
     */
    invalidate() {
        // No-op: git branch is cached/invalidated by provider
    }
    /**
     * Clean up resources.
     * Git watcher cleanup now handled by provider.
     */
    dispose() {
        // Git watcher cleanup handled by provider
    }
    render(width) {
        const state = this.session.state;
        // Calculate cumulative usage from ALL session entries (not just post-compaction messages)
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCacheWrite = 0;
        let totalCost = 0;
        let latestCacheHitRate;
        for (const entry of this.session.sessionManager.getEntries()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
                totalInput += entry.message.usage.input;
                totalOutput += entry.message.usage.output;
                totalCacheRead += entry.message.usage.cacheRead;
                totalCacheWrite += entry.message.usage.cacheWrite;
                totalCost += entry.message.usage.cost.total;
                const latestPromptTokens = entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
                latestCacheHitRate =
                    latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
            }
        }
        // Calculate context usage from session (handles compaction correctly).
        // After compaction, tokens are unknown until the next LLM response.
        // 从磁盘读 context/work_memory/cortex，统一 CJK 估算法（同 memory.ts 容量警告一致）
        let diskTokens = { ctx: 0, work: 0, cx: 0 };
        try {
          const sf = this.session.sessionManager.getSessionFile?.();
          const pid = sf && sf.match(/\.pi\/memory\/([a-f0-9]+)\//);
          if (pid) {
            const base = `${homedir()}/.pi/memory/${pid[1]}/.data`;
            const ctxTxt = cachedReadFile(`${base}/context.md`);
            const wmTxt = cachedReadFile(`${base}/work_memory.md`);
            const cxTxt = cachedReadFile(`${base}/cortex.md`);
            const est = (t) => { let cjk=0; for(let i=0;i<t.length;i++){const c=t.charCodeAt(i);if((c>=0x3400&&c<=0x9fff)||(c>=0xf900&&c<=0xfaff)||(c>=0x3000&&c<=0x30ff)||(c>=0xff00&&c<=0xffef))cjk++} return Math.round(cjk*1.8+(t.length-cjk)*0.25); };
            diskTokens = { ctx: est(ctxTxt), work: est(wmTxt), cx: est(cxTxt) };
          }
        } catch {}
        const contextWindow = state.model?.contextWindow ?? 200000;
        const totalTokens = diskTokens.ctx + diskTokens.work + diskTokens.cx;
        const totalPercent = contextWindow > 0 ? Math.min(100, (totalTokens / contextWindow) * 100) : 0;
        const ctxPct = contextWindow > 0 ? ((diskTokens.ctx / contextWindow) * 100).toFixed(1) : "0";
        const workPct = contextWindow > 0 && diskTokens.work > 0 ? ((diskTokens.work / contextWindow) * 100).toFixed(1) : "0";
        const cxPct = contextWindow > 0 && diskTokens.cx > 0 ? ((diskTokens.cx / contextWindow) * 100).toFixed(1) : "0";
        // Replace home directory with ~
        let pwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
        // Add git branch if available
        const branch = this.footerData.getGitBranch();
        if (branch) {
            pwd = `${pwd} (${branch})`;
        }
        // Add session name if set
        const sessionName = this.session.sessionManager.getSessionName();
        if (sessionName) {
            pwd = `${pwd} • ${sessionName}`;
        }
        // ── pi-coding-master footer: 身份 │ 钱 │ 记忆 ──
        // 从 plist.json 读 person name
        let personName = "";
        let personShortId = "";
        try {
            const sf = this.session.sessionManager.getSessionFile?.();
            const pid = sf && sf.match(/\.pi\/memory\/([a-f0-9]+)\//);
            if (pid) {
                personShortId = pid[1].slice(0, 4);
                try {
                    const plist = JSON.parse(cachedReadFile(`${homedir()}/.pi/memory/plist.json`) || "[]");
                    const person = plist.find(p => p.id === pid[1]);
                    if (person?.name) personName = person.name;
                } catch {}
            }
        } catch {}

        const statsParts = [];

        // 区域1: 身份
        if (personName) {
            statsParts.push(`${personName} #${personShortId}`);
        } else if (personShortId) {
            statsParts.push(`#${personShortId}`);
        }

        // 区域2: 钱（PI_SHOW_WALLET=1 启用，默认关）
        if (process.env.PI_SHOW_WALLET === "1") {
            try {
                const sf = this.session.sessionManager.getSessionFile?.();
                const pid = sf && sf.match(/\.pi\/memory\/([a-f0-9]+)\//);
                let agentDollar = "";
                if (pid) {
                    const walletData = cachedReadFile(`${homedir()}/.pi/memory/${pid[1]}/.data/wallet.json`);
                    if (walletData) {
                        const w = JSON.parse(walletData);
                        if (typeof w.balance === "number") agentDollar = `AGENT¥${Math.round(w.balance)}`;
                    }
                }
                const rc = (role) => { try { return JSON.parse(cachedReadFile(`${homedir()}/.pi/memory/${pid[1]}/.data/cost-${role}.json`) || "{}").cost || 0; } catch { return 0; } };
                const bal = JSON.parse(cachedReadFile(`${homedir()}/.pi/agent/.pi-coding-master-balance.json`) || "{}");
                const balStr = typeof bal.balance === "number" ? `¥${bal.balance.toFixed(2)}` : "";
                let sessionCost = "";
                if (pid) {
                    const main = totalCost || 0, hc = rc("hippocampus"), sc = rc("subconscious"), sl = rc("sleep");
                    const total = main + hc + sc + sl;
                    if (total > 0) sessionCost = ` (-¥${total.toFixed(2)})`;
                }
                const walletParts = [agentDollar, balStr + sessionCost].filter(Boolean).join(" ");
                if (walletParts) statsParts.push(walletParts);
            } catch {}
        }

        // 区域3: 记忆占比
        const ctxWindowStr = `${formatTokens(contextWindow)}`;
        let memStr;
        if (diskTokens.work > 0 || diskTokens.cx > 0) {
          const tp = totalPercent.toFixed(1);
          memStr = `记忆${tp}% [对话${ctxPct} 工作${workPct} 皮层${cxPct}]/${ctxWindowStr}`;
        } else if (ctxPct !== "?") {
          memStr = `记忆${ctxPct}%/${ctxWindowStr}`;
        } else {
          memStr = `记忆?/${ctxWindowStr}`;
        }
        if (totalPercent > 90) {
          memStr = theme.fg("error", memStr);
        } else if (totalPercent > 70) {
          memStr = theme.fg("warning", memStr);
        }
        statsParts.push(memStr);
        let statsLeft = statsParts.join(" ");
        // Add model name on the right side, plus thinking level if model supports it
        const modelName = state.model?.id || "no-model";
        let statsLeftWidth = visibleWidth(statsLeft);
        // If statsLeft is too wide, truncate it
        if (statsLeftWidth > width) {
            statsLeft = truncateToWidth(statsLeft, width, "...");
            statsLeftWidth = visibleWidth(statsLeft);
        }
        // Calculate available space for padding (minimum 2 spaces between stats and model)
        const minPadding = 2;
        // Add thinking level indicator if model supports reasoning
        let rightSideWithoutProvider = modelName;
        if (state.model?.reasoning) {
            const thinkingLevel = state.thinkingLevel || "off";
            rightSideWithoutProvider =
                thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
        }
        // Prepend the provider in parentheses if there are multiple providers and there's enough room
        let rightSide = rightSideWithoutProvider;
        if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
            rightSide = `(${state.model.provider}) ${rightSideWithoutProvider}`;
            if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
                // Too wide, fall back
                rightSide = rightSideWithoutProvider;
            }
        }
        const rightSideWidth = visibleWidth(rightSide);
        const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;
        let statsLine;
        if (totalNeeded <= width) {
            // Both fit - add padding to right-align model
            const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
            statsLine = statsLeft + padding + rightSide;
        }
        else {
            // Need to truncate right side
            const availableForRight = width - statsLeftWidth - minPadding;
            if (availableForRight > 0) {
                const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
                const truncatedRightWidth = visibleWidth(truncatedRight);
                const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
                statsLine = statsLeft + padding + truncatedRight;
            }
            else {
                // Not enough space for right side at all
                statsLine = statsLeft;
            }
        }
        let fullPid = "";
        try {
            const sf = this.session.sessionManager.getSessionFile?.();
            const m = sf && sf.match(/\.pi\/memory\/([a-f0-9]+)\//);
            if (m) fullPid = m[1];
        } catch {}
        const scHc = getScHcStatus(fullPid);
        const scDot = scHc.sc ? theme.fg("success", "●") : theme.fg("error", "●");
        const hcDot = scHc.hc ? theme.fg("success", "●") : theme.fg("error", "●");
        const scLabel = scHc.sc ? theme.fg("success", "●") + "潜意识" : theme.fg("error", "●") + "潜意识";
        const hcLabel = scHc.hc ? theme.fg("success", "●") + "海马体" : theme.fg("error", "●") + "海马体";
        const dimMem = theme.fg("dim", memStr);
        const leftPart = theme.fg("dim", `${scLabel} ${hcLabel}`) + "  " + dimMem;
        const leftW = visibleWidth(leftPart);
        // line1: 状态灯
        const statusPart = theme.fg("dim", `${scLabel} ${hcLabel}`);
        const statusW = visibleWidth(statusPart);
        let line1 = statusPart + " ".repeat(Math.max(0, width - statusW));

        // line2: 名字+模型名(左) + 记忆(右)
        const statsNoMem = statsParts.filter(s => s !== memStr).join(" ");
        const statsNoMemW = visibleWidth(statsNoMem);
        const memW = visibleWidth(memStr);
        const midPadding = 4;
        const line2Needed = statsNoMemW + midPadding + memW;
        let line2;
        if (line2Needed <= width) {
            line2 = theme.fg("dim", statsNoMem) + " ".repeat(width - statsNoMemW - memW) + theme.fg("dim", memStr);
        } else if (width > memW + 10) {
            // 截断名字部分，保留记忆完整
            const maxNameWidth = width - memW - midPadding;
            const truncatedName = truncateToWidth(statsNoMem, maxNameWidth, "...");
            line2 = theme.fg("dim", truncatedName) + " ".repeat(width - visibleWidth(truncatedName) - memW) + theme.fg("dim", memStr);
        } else {
            // 空间太小，只显示记忆
            line2 = " ".repeat(Math.max(0, width - memW)) + theme.fg("dim", memStr);
        }
        const lines = [line1, line2];
        const extensionStatuses = this.footerData.getExtensionStatuses();
        if (extensionStatuses.size > 0) {
            const sortedStatuses = Array.from(extensionStatuses.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([, text]) => sanitizeStatusText(text));
            const statusLine = sortedStatuses.join(" ");
            lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
        }
        return lines;
    }
}
//# sourceMappingURL=footer.js.map