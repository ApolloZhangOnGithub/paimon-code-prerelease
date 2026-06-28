source: runner_esc.patch

# heart.interrupt — 打断/补丁集

## 职责
存放 pi dist 的 git patch 文件，在 install.sh 中通过 git apply 应用。
- runner_esc.patch: ESC 打断 runner
- interactive-mode-loader.patch: loader 交互模式修复
- agent_start-loader-flicker.patch: 启动时 loader 闪烁修复
