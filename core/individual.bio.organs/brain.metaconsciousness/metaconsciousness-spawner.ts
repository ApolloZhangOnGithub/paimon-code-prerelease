import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
let _errorLogPath = "/tmp/pi-silent-err.log";
const _log = (code: string, e: unknown) => { try { const d = _errorLogPath.replace(/\/[^/]+$/, ""); if (!existsSync(d)) mkdirSync(d, { recursive: true }); appendFileSync(_errorLogPath, `[${new Date().toISOString()}] [spawner][${code}] ${e}\n`); } catch {} };
function setErrorLog(personDir: string) { _errorLogPath = personDir.replace("/MemoryData/", "/ErrorData/") + "/error.log"; }
import { getPrompt } from "#ribosome";

export interface metaconsciousnessHandle {
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  getMessages(): any[];
  getSessionId(): string;
  getSessionDir(): string;
}

export function createmetaconsciousness(
  pi: ExtensionAPI,
  getTranscriptPath: () => string | undefined,
  onError: (msg: string) => void,
  onMessage: (msg: any) => void,
  personDir: string,
): metaconsciousnessHandle {
  setErrorLog(personDir);
  const personId = global.__paimonPersonId;
  const tmuxName = `mc-${personId}`;
  const sessionDir = global.__paimonSessionDir + "/metaconsciousnessSessions";
  let running = false;

  function tmuxHas(): boolean {
    try {
      execSync(`tmux has-session -t ${tmuxName} 2>/dev/null`);
      return true;
    } catch {} return false;
  }

  const self: metaconsciousnessHandle = {
    async start() {
      if (process.env.PAIMON_NO_MC) { running = false; return; }
      setErrorLog(personDir);
      running = true;
      try { appendFileSync("/tmp/mc-spawn.log", `[${new Date().toISOString()}] start() called, tmuxHas=${tmuxHas()}\n`); } catch {}
      // 不检查 isRunning——总是先杀旧再建新（重启后 PID 变了旧 session 变孤儿，直接收割）
      try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {}

      await mkdir(sessionDir, { recursive: true });

      const feedPath = getTranscriptPath() ?? global.__paimonChannelDir + "/conscious-feed.jsonl";
      const promptFile = join(tmpdir(), `mc-prompt-${personId}.md`);
      await writeFile(promptFile, `${getPrompt("metaconsciousness.observe")}

Main session history (read it regularly for new content): ${feedPath}
Send thoughts to the main session with the aware tool.`);

      // metaconsciousness = a real pi running inside tmux (real TTY, native rendering).
      // continuous extension inside keeps it alive during a run; this launcher keeps it
      // alive ACROSS runs — if pi crashes/exits (e.g. insufficient balance exits the
      // process outright), wait with backoff and restart. When the condition clears
      // (balance topped up), it auto-recovers. Killed when the conscious session ends.
      // User watches it with: tmux attach -t mc-<id> -r  (read-only)
      try {
        const initialPrompt = "开始你的工作：持续阅读主意识的历史记录，反思，发现问题就用 aware 告诉主意识。";
        const launchScript = join(tmpdir(), `mc-launch-${personId}.sh`);
        const channelDir = global.__paimonChannelDir ?? "";
        await writeFile(launchScript, `#!/bin/bash
# Self-healing metaconsciousness launcher (auto-generated). Restarts pi with backoff on exit.
# Cross-platform stat helpers (macOS uses -f, Linux uses -c)
if [ "$(uname)" = "Darwin" ]; then
  stat_mtime() { stat -f%m "$1" 2>/dev/null || echo 0; }
  stat_size()  { stat -f%z "$1" 2>/dev/null || echo 0; }
else
  stat_mtime() { stat -c %Y "$1" 2>/dev/null || echo 0; }
  stat_size()  { stat -c %s "$1" 2>/dev/null || echo 0; }
fi
export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }--experimental-transform-types"
export NODE_PATH="$HOME/.local/lib/paimon/runtime/node_modules"
export PAIMON_CODING_AGENT_DIR="$HOME/.paimon/agent"
export PAIMON_HEADLESS=1
export PAIMON_CHANNEL_DIR=${JSON.stringify(channelDir)}
export PAIMON_PERSON_ID=${JSON.stringify(personId)}
export PAIMON_PERSON_DIR=${JSON.stringify(personDir)}
export PAIMON_SESSION_DIR=${JSON.stringify(sessionDir)}
SESSION_DIR=${JSON.stringify(sessionDir)}
PROMPT_FILE=${JSON.stringify(promptFile)}
INITIAL=${JSON.stringify(initialPrompt)}
MAIN_PID=${process.pid}
MAIN_PID_FILE="${personDir}/main.pid"
FEED_FILE=${JSON.stringify(feedPath)}
SC_BACKOFF=15
CONTEXT_SIZE=0
CONTEXT_FILE="${personDir}/context.md"
PAUSE_FILE="${personDir}/paused"
RC_PAUSE_FILE="$HOME/.paimon/RuntimeCache/${personId}/paused"
while true; do
  if [ -f "$MAIN_PID_FILE" ]; then
    PID_AGE=$(($(date +%s) - $(stat_mtime "$MAIN_PID_FILE")))
    [ "$PID_AGE" -gt 120 ] && { echo "[mc] 主进程 heartbeat 超时 (\${PID_AGE}s)，自杀。"; break; }
  fi
  if [ -f "$PAUSE_FILE" ] || [ -f "$RC_PAUSE_FILE" ]; then sleep 5; continue; fi
  # context 每涨 10% 重启 mc，其他时间单 session 连续跑
  NEW_SIZE=$(stat_size "$CONTEXT_FILE")
  THRESHOLD=$(( CONTEXT_SIZE + CONTEXT_SIZE / 10 ))
  if [ "$CONTEXT_SIZE" -gt 0 ] && [ "$NEW_SIZE" -lt "$THRESHOLD" ]; then sleep 5; continue; fi
  CONTEXT_SIZE=$NEW_SIZE
  mkdir -p "$SESSION_DIR"
  python3 -c "import json; open('$SESSION_DIR/conv.json','w').write(json.dumps({'messages':[{'role':'system','content':open('$PROMPT_FILE').read()}]}))" 2>/dev/null
  START=$(date +%s)
  BLACKBOX="$HOME/.local/lib/paimon/extensions/paimon-code/god.cli/blackbox.sh"
  if [ -x "$BLACKBOX" ]; then
    "$BLACKBOX" "${personId}" "mc-${personId}" "metaconsciousness" -- $HOME/.local/lib/paimon/runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js --session-dir "$SESSION_DIR" "$INITIAL"
  else
    $HOME/.local/lib/paimon/runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js --session-dir "$SESSION_DIR" "$INITIAL"
  fi
  SC_CODE=$?
  if [ "$SC_CODE" -eq 0 ]; then break; fi
  SC_RAN=$(( $(date +%s) - START ))
  if [ "$SC_RAN" -ge 120 ]; then SC_BACKOFF=15; else SC_BACKOFF=$(( SC_BACKOFF * 2 )); [ "$SC_BACKOFF" -gt 300 ] \&\& SC_BACKOFF=300; fi
  sleep "$SC_BACKOFF"
done
`);
        execSync(`chmod +x "${launchScript}"`, { stdio: "ignore" });
        try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {} // 先清掉同名僵尸 session（spawn failed 的根）
        execSync(
          `tmux new-session -d -s ${tmuxName} -c "${personDir}" 'bash "${launchScript}" '`,
          { stdio: "ignore" }
        );
        (globalThis as any).__paimonMetaconsciousnessHandle = self;
      } catch (err: any) {
        try { appendFileSync("/tmp/mc-spawn.log", `[${new Date().toISOString()}] SPAWN FAILED: ${err?.stack ?? err}\n`); } catch {}
        onError(`metaconsciousness tmux spawn failed: ${err?.message ?? err}`);
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
