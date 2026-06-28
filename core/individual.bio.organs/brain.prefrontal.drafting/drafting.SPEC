always_think 模块 v0.2 · SPEC

设计来源: 2026-06-14 对话 + ideas.HUMAN/v0.2_spec.md 第 2 行(打断-续写引擎)
核心问题: 模型写代码/说话时"脑就是手"——生成即动作,中间没有审查闸,
          被参数里的思维定势(切片/复制/增量等惯例)直接冲成输出,自己感觉不到。

核心原则:
  - 不是"先想后做"(prefix 式,执行一旦开始仍是弹道式),
    而是"边写边想"——思考在动作进行中随时发生,且可回到断点续写。
  - 人写东西不是一次性不停预测 token:写的过程中会停下来想。模型也该能。
  - 该停就停,尤其在: 就要 commit 一个不可逆判断时 / "这样写很顺手"但没核对 spec 时 / 直觉与约束打架时。

机制(纯 mod,不新增 dist 补丁):
  1. 模型在输出任意位置写下标记: <need think>
  2. message_update 钩子读到半截 assistant 文本里出现该标记
  3. mod 投递一条 steer 消息: pi.sendMessage({...}, {deliverAs:"steer", isTriggerNewTurn:true})
  4. 经 unstop 的 steer→abort dist 补丁(agent.js: steer() 时 activeRun.abortController.abort()),
     当前生成被 abort = 写作暂停;半截输出(以 <need think> 结尾)由 pi 原生 partial 机制保留进 context
  5. steer 消息内容提示模型"现在想透,再从断点续写" → 模型转入思考 + 续写
  6. 一次输出里可触发任意多次(允许在中间想无数次)

依赖:
  - unstop 的 steer→abort 补丁(若该补丁不在,steer 不会暂停当前生成,本模块退化为"下一轮才生效")

钩子:
  before_agent_start → 注入约定 prompt(教模型 <need think> 的用法),仅 enabled 时
  agent_start        → 重置每轮暂停计数
  message_start      → 重置"本条消息已触发"标志(每条新 assistant 消息可重新触发)
  message_update     → 检测标记 → 触发暂停
  registerCommand("always_think") → on/off 开关

保护:
  - per-message guard: 一个标记只触发一次(abort 生效前的残余 delta 不重复触发)
  - per-turn 上限(MAX_PAUSES_PER_TURN, 暂定 50)防病态死循环;到顶不再触发

标记:
  默认 "<need think>"(常量,可改)。选用不与模型原生 reasoning 标签冲突的形式。

已知限制 / 待办(诚实记录,需 live 测试):
  - v1 只做"暂停-思考-续写";<need think> 标记会留在最终输出文本里(后续用 MessageRenderer 美化成"💭 暂停思考"指示)
  - 续写是"在半截后另起一条 assistant 消息,模型看着自己半截+提示接着写",非字面同一 token 流延续(对目的够用)
  - 更深形态(ideas 第 2 行的"或者"分支): 任何 command 是缓存里的可编辑文本文件,
    模型写时可 edit/删/调(像人打字回删)。这是"草稿缓冲",比暂停-续写更难,留作后续。
  - mid-stream 检测+abort 存在 race(abort 生效前的在途 delta),靠 guard 兜;真实表现需在 live pi 验证。
