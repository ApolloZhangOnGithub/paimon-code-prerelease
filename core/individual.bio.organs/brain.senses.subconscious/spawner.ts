import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { getPrompt } from "#runtime";

export interface SubconsciousHandle {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  getMessages(): any[];
  getSessionId(): string;
  getSessionDir(): string;
}

export function createSubconscious(
  pi: ExtensionAPI,
  getTranscriptPath: () => string | undefined,
  onError: (msg: string) => void,
  onMessage: (msg: any) => void,
  personDir: string,
): SubconsciousHandle {
  const personId = personDir.match(/([a-f0-9]+)$/)?.[1] ?? "x";
  const tmuxName = `sc-${personId}`;
  const sessionDir = `${personDir}/.data/conscious-sessions`;
  let running = false;

  function tmuxHas(): boolean {
    try {
      execSync(`tmux has-session -t ${tmuxName} 2>/dev/null`);
      return true;
    } catch { return false; }
  }

  const self: SubconsciousHandle = {
    async start() {
      running = true;
      try { appendFileSync("/tmp/sc-spawn.log", `[${new Date().toISOString()}] start() called, tmuxHas=${tmuxHas()}\n`); } catch {}
      if (tmuxHas()) {
        // tmux session 在但进程可能死了（空壳）——检查 pane 是否有活进程
        try {
          const pid = execSync(`tmux list-panes -t ${tmuxName} -F '#{pane_pid}' 2>/dev/null`).toString().trim();
          if (pid) {
            const children = execSync(`pgrep -P ${pid} 2>/dev/null`).toString().trim();
            if (children) return; // 有子进程在跑，真的活着
          }
        } catch {}
        // 空壳，杀掉重建
        try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {}
      }

      await mkdir(sessionDir, { recursive: true });

      const feedPath = getTranscriptPath() ?? `${personDir}/.data/conscious-feed.jsonl`;
      const promptFile = `${personDir}/.data/conscious-prompt.md`;
      await writeFile(promptFile, `${getPrompt("subconscious.observe")}

Main session history (read it regularly for new content): ${feedPath}
Send thoughts to the main session with the aware tool.`);

      // Subconscious = a real pi running inside tmux (real TTY, native rendering).
      // continuous extension inside keeps it alive during a run; this launcher keeps it
      // alive ACROSS runs — if pi crashes/exits (e.g. insufficient balance exits the
      // process outright), wait with backoff and restart. When the condition clears
      // (balance topped up), it auto-recovers. Killed when the conscious session ends.
      // User watches it with: tmux attach -t sc-<id> -r  (read-only)
      try {
        const initialPrompt = "开始你的工作：持续阅读主意识的历史记录，反思，发现问题就用 aware 告诉主意识。";
        const launchScript = `${personDir}/.data/conscious-launch.sh`;
        await writeFile(launchScript, `#!/bin/bash
# Self-healing subconscious launcher (auto-generated). Restarts pi with backoff on exit.
export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }--experimental-transform-types"
SESSION_DIR=${JSON.stringify(sessionDir)}
PROMPT_FILE=${JSON.stringify(promptFile)}
INITIAL=${JSON.stringify(initialPrompt)}
MAIN_PID=${process.pid}
FEED_FILE=${JSON.stringify(feedPath)}
# 级联看门狗：主意识进程一退出，就连本 tmux 一起关掉（防孤儿常驻烧钱）。
( while kill -0 "$MAIN_PID" 2>/dev/null; do sleep 5; done; echo "[sc] 主意识已退出，自动关闭本实例。"; tmux kill-session -t ${tmuxName} 2>/dev/null ) &
BACKOFF=15
PREV_SIZE=0
while true; do
  kill -0 "$MAIN_PID" 2>/dev/null || { echo "[sc] 主意识没了，退出。"; break; }
  # 只有 feed 有新内容（主意识有活动）才启动
  CURR_SIZE=$(stat -f%z "$FEED_FILE" 2>/dev/null || echo 0)
  if [ "$CURR_SIZE" -le "$PREV_SIZE" ]; then sleep 30; continue; fi
  PREV_SIZE=$CURR_SIZE
  START=$(date +%s)
  mkdir -p "$SESSION_DIR"
  python3 -c "import json; open('$SESSION_DIR/conv.json','w').write(json.dumps({'messages':[{'role':'system','content':open('$PROMPT_FILE').read()}]}))" 2>/dev/null
  # 初始消息作为位置参数传入，stdin 保持 tmux TTY（让 TUI 正常渲染）
  BLACKBOX="$HOME/smart-pi/pi-coding-master.DEV/Codebase/debug/god.pi.blackbox/blackbox.sh"
  if [ -x "$BLACKBOX" ]; then
    "$BLACKBOX" "${personId}" "sc-${personId}" "subconscious" -- /opt/homebrew/bin/pi --session-dir "$SESSION_DIR" "$INITIAL"
  else
    /opt/homebrew/bin/pi --session-dir "$SESSION_DIR" "$INITIAL"
  fi
  CODE=$?
  RAN=$(( $(date +%s) - START ))
  if [ "$RAN" -ge 120 ]; then BACKOFF=15; else BACKOFF=$(( BACKOFF * 2 )); [ "$BACKOFF" -gt 300 ] && BACKOFF=300; fi
  echo "[$(date '+%F %T')] subconscious pi exited (code=$CODE, ran $RAN s) — restart in $BACKOFF s"
  sleep "$BACKOFF"
done
`);
        execSync(`chmod +x "${launchScript}"`, { stdio: "ignore" });
        try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {} // 先清掉同名僵尸 session（spawn failed 的根）
        execSync(
          `tmux new-session -d -s ${tmuxName} -c "${personDir}" 'bash "${launchScript}"'`,
          { stdio: "ignore" }
        );
      } catch (err: any) {
        try { appendFileSync("/tmp/sc-spawn.log", `[${new Date().toISOString()}] SPAWN FAILED: ${err?.stack ?? err}\n`); } catch {}
        onError(`Subconscious tmux spawn failed: ${err?.message ?? err}`);
        running = false;
      }
    },

    stop() {
      running = false;
      try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {}
    },

    isRunning() { return tmuxHas(); },
    getMessages() { return []; },
    getSessionId() { return tmuxName; },
    getSessionDir() { return sessionDir; },
  };

  return self;
}
