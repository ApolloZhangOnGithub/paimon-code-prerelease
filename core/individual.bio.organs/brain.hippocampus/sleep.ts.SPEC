source: sleep.ts @ 4a509a76

sleep.ts · SPEC（深睡：独立 sl- pi 实例启动器）

归属: brain.hippocampus 的代码（sleep.night 模式的巩固实现）。
被谁调: memory.ts 的 sleep 工具 → import("./sleep.js") → launchSleepSession(personDir, onComplete)。

做什么:
- 在 tmux 起一个【独立 pi 实例】sl-<personId>（对标 hc-/sc-，是第三个对等独立意识，DNA 铁律）。
- 加载 dna/index.md + dna/sleep.dlc + SLEEP_PROMPT(coded hippocampus.sleep)。
- 按 1% partial edit 把 work_memory.md 逐块编码进 cortex.md（不一次全搬）。
- 自愈：崩了带指数退避重启；work_memory 清空后 onComplete() → 主意识切回 wake。
- 主意识调 sleep 后可 hibernate，整理由这个独立实例完成。

prompt: 来自 coded.dna 的 `coded hippocampus.sleep`，经 ../../../engine/runtime.js 的 getPrompt 取。
注意: 文件名是 sleep.ts（不是 sleep-session.ts）。memory.ts 必须 import("./sleep.js")。
