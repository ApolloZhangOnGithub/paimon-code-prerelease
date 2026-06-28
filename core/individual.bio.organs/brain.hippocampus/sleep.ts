// sleep-session.ts — Independent sleep pi instance launcher
// v0.2 spec: 睡眠的 session 和潜意识一样都是一个 pi，激活 sleep.dlc
// Launches in tmux as sl-<personId>. Self-healing with backoff.
// Sleep pi only edits memory files; main consciousness continues working.

import { execSync } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { getPrompt } from "#runtime";

// prompt 来自 coded.dna（coded hippocampus.sleep），由 runtime 取，不再硬编码。
// 海马体深睡期（sleep.night）的编码 prompt：把 work_memory 整段消化、一次性巩固进 cortex（见 coded.dna hippocampus.sleep）。
let _sleepPrompt: string | null = null;
function getSleepPrompt(): string {
  if (!_sleepPrompt) _sleepPrompt = getPrompt("hippocampus.sleep");
  return _sleepPrompt;
}

export function launchSleepSession(
  personDir: string,
  onComplete: () => void,
): { stop: () => void; isRunning: () => boolean } {
  // personDir 以 /.data 结尾 → personId 是上一级目录名。之前用 /([a-f0-9]+)$/ 匹配会落到 ".data" 上(取到 "a" 之类),
  // tmux 名就乱了、也和显示对不上。统一取目录名。
  const personId = path.basename(personDir) === ".data" ? path.basename(path.dirname(personDir)) : path.basename(personDir);
  const tmuxName = `sl-${personId}`;
  const sessionDir = path.join(personDir, "..", "sleep-sessions");
  let running = false;

  function tmuxHas(): boolean {
    try {
      execSync(`tmux has-session -t ${tmuxName} 2>/dev/null`);
      return true;
    } catch { return false; }
  }

  // Launch async
  (async () => {
    if (tmuxHas()) {
      running = true;
      return;
    }

    running = true;
    await mkdir(sessionDir, { recursive: true });

    // Build sleep prompt
    let dnaIndex = "";
    try { dnaIndex = await readFile(`${personDir}/dna/index.md`, "utf8"); } catch {}
    let sleepDlc = "";
    try { sleepDlc = await readFile(`${personDir}/dna/sleep.dlc`, "utf8"); } catch {}

    const fullPrompt = `${dnaIndex}\n\n${sleepDlc}\n\n${getSleepPrompt()}\n\n文件目录: ${personDir}`;

    const promptFile = `${personDir}/sleep-prompt.md`;
    await writeFile(promptFile, fullPrompt);

    const launchScript = `${personDir}/sleep-launch.sh`;
    await writeFile(launchScript, `#!/bin/bash
export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }--experimental-transform-types"
SESSION_DIR=${JSON.stringify(sessionDir)}
PERSON_DIR=${JSON.stringify(personDir)}
PROMPT_FILE=${JSON.stringify(promptFile)}
INITIAL="开始深度睡眠。主意识困到撑不住了。【分段】消化 context.md：每次只读最旧的一截（300~500 行，别一口吞，否则你自己也撑爆），重组进 cortex.md，cortex 装不下的沉 deep_cortex.md，消化完就把那一截从 context.md 删掉；一截截来，直到 context 小下来。work_memory.md 同理。全部弄完 hibernate。"
export PI_PERSON_DIR="$PERSON_DIR"
MAIN_PID=${process.pid}
BACKOFF=15
while true; do
  # 级联：主意识进程没了就退出（睡眠是短任务，循环顶检查足够，不用常驻看门狗）。
  kill -0 "$MAIN_PID" 2>/dev/null || { echo "[sl] 主意识没了，退出。"; break; }
  START=$(date +%s)
  mkdir -p "$SESSION_DIR"
  # Write system prompt to conv.json (pi reads from session dir, --append-system-prompt doesn't exist)
  LOCKDIR="$PERSON_DIR/.memory-lock"
  LOCK_WAIT=0
  while [ "$LOCK_WAIT" -lt 300 ]; do
    if mkdir "$LOCKDIR" 2>/dev/null; then
      echo "{\"owner\":\"sl\",\"ts\":$(date +%s)000}" > "$LOCKDIR/stamp" 2>/dev/null
      break
    fi
    if [ -f "$LOCKDIR/stamp" ]; then
      LOCK_TS=$(cat "$LOCKDIR/stamp" 2>/dev/null | grep -o '"ts":[0-9]*' | grep -o '[0-9]*')
      NOW_MS=$(date +%s)000
      if [ -n "$LOCK_TS" ] && [ $(( NOW_MS - LOCK_TS )) -gt 60000 ]; then
        rm -f "$LOCKDIR/stamp" 2>/dev/null
        rmdir "$LOCKDIR" 2>/dev/null
        continue
      fi
    fi
    LOCK_WAIT=$(( LOCK_WAIT + 1 ))
    sleep 0.2
  done
  if [ "$LOCK_WAIT" -ge 300 ]; then
    echo "[sl] 无法获取文件锁（60s 超时），跳过本轮" >> /dev/stderr
    sleep 30
    continue
  fi
  python3 -c "import json,shlex; open('$SESSION_DIR/conv.json','w').write(json.dumps({'messages':[{'role':'system','content':open('$PROMPT_FILE').read()}]}))" 2>/dev/null
  echo "$INITIAL" | /opt/homebrew/bin/pi --session-dir "$SESSION_DIR"
  CODE=$?  # save pi exit code BEFORE releasing lock
  rm -f "$LOCKDIR/stamp" 2>/dev/null
  rmdir "$LOCKDIR" 2>/dev/null
  RAN=$(( $(date +%s) - START ))
  if [ "$CODE" -eq 0 ]; then
    echo "[$(date '+%F %T')] sleep pi OK — work_memory should be cleared."
    break
  fi
  if [ "$RAN" -ge 120 ]; then BACKOFF=15; else BACKOFF=$(( BACKOFF * 2 )); [ "$BACKOFF" -gt 300 ] && BACKOFF=300; fi
  echo "[$(date '+%F %T')] sleep pi exit=$CODE ran=$RAN s — restart in $BACKOFF s"
  sleep "$BACKOFF"
done
`);
    execSync(`chmod +x "${launchScript}"`, { stdio: "ignore" });
    try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {} // 先清掉同名僵尸 session（spawn failed 的根）
    execSync(
      `tmux new-session -d -s ${tmuxName} -c "${personDir}" 'bash "${launchScript}"'`,
      { stdio: "ignore" }
    );

    // Check periodically and call onComplete when work_memory is empty
    const checker = setInterval(() => {
      if (!tmuxHas()) {
        clearInterval(checker);
        running = false;
        onComplete();
      }
    }, 5000);
  })();

  return {
    stop() {
      running = false;
      try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null`); } catch {}
    },
    isRunning() {
      return running && tmuxHas();
    },
  };
}
