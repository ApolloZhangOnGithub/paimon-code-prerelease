source: budget_guard.ts @ 910395fd

budget-guard.ts · SPEC（余额硬闸 / 代码强制的花钱护栏）

为什么存在：pi 内部的花费统计【系统性少算】——mid-stream abort（agent.js:170 的补丁）会把被
  abort 的流记成 usage=0（agent.js:338），而我们天天 abort；且 pi 只统计单 session。
  所以不能用 pi 的 $ 当钱闸。改用 deepseek 真实余额接口当地面真值（免疫补丁、覆盖所有实例）。

装在哪：engine/kernel.ts 在 default(pi) 最前面调 installBudgetGuard(pi)，每个 pi 实例都装。

机制：
- fetchBalanceCNY()：execSync curl api.deepseek.com/user/balance（key 由 shell 从 $DEEPSEEK_API_KEY
  展开，不写进命令串）。已验证可用。
- 轮询：每 POLL_MS(默认45s) 一次 + session_start + before_agent_start 太旧时补一次。
- 两道线：余额 ≤ FLOOR(默认¥5) → 停；两次轮询间速率 > RATE(默认¥10/min) → 停（抓"一下子100块"尖峰）。
- 触发 trip()：只让 role==main 去 killWorkers()（pkill -f "pi-coding-master:<role>:" + tmux 兜底，靠不可伪造的 title）；
  显眼 sendMessage 告警；before_agent_start 里 tripped 时 ctx.abort() + 拦住后续 turn。
- 解除只能人工 /budget resume（充值后）。模型无工具可绕过。
- 每次轮询把 {balance,ratePerMin,tripped,ts} 写 ~/.pi/agent/.pi-coding-master-balance.json，footer 读它显示真实余额。

可配 env：PI_ALIVE_BALANCE_FLOOR、PI_ALIVE_RATE_CNY_PER_MIN、PI_ALIVE_BALANCE_POLL_MS。
命令：/budget（看余额/速率/线）、/budget resume（解除）。

⚠️ 改动要【重启 pi 实例】才生效——正在跑的进程加载的是没有闸的旧 kernel。
局限：轮询有间隙（默认45s），间隙内的尖峰靠下一次轮询的速率线补抓；要更快可调小 POLL_MS 或后续加
  本地 stream-token 速率探测。killWorkers 依赖 process.title（kernel 设的 pi-coding-master:role:id）。
