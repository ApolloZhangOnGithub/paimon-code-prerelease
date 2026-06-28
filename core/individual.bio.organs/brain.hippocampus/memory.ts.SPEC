source: memory.ts @ b60acb20

memory.ts · SPEC（brain.hippocampus 的主意识记忆机能）

设计来源: ideas.HUMAN/v0.2_spec.md + 2026-06-15 缓存/估算大修
核心原则: context 就是记忆，模型自己编辑自己。let the model decide。
归属: 不是独立 func（memory 是 tag，不是 func）。这是 brain.hippocampus 的代码，
      由 hippocampus.ts 的 default(pi) 调 registerMemory(pi) 装上。

── 文件结构 per-person（数据=存，在 ~/.pi/memory/<id>/.data/，不在代码树）──
  context.md       ← 完整对话历史，message_end 增量写入，可被模型 editcontext
  work_memory.md   ← 海马体(hc-)再反思编码（nap 也往这写），不过度压缩
  cortex.md        ← 按叶分区长记忆（sleep 的 sl- 实例 1% 沉淀来的）
  deep_cortex.md   ← cortex 超 20% 窗口时沉降来的归档（不自动注入，按需回捞）
  events.jsonl / growth.jsonl / reminders.json ← 旁路数据

── 注入架构（⚠️ 缓存铁律，2026-06-15 大修的核心）──
  KV 缓存只在「提示词前缀逐轮一致」时命中。所以：
  1. session_start（醒来）：buildSnapshot() 把 DNA + cortex + work + context(尾部)
     按 token 预算(≤窗口35%)揉成「一份快照」，作为消息注入【一次】。这是稳定前缀。
  2. before_agent_start：【绝不】return systemPrompt。前缀不动 → 每轮命中缓存。
     只做三件事，全部往「后面」append 或只写文件：
       - work_memory 增量：比上次多出来的部分，作为新消息追加（不重发全部）；
       - 容量提醒：≥URGE(80%) 时 append 一条 [internal] 提醒（WARN 只记 growth.jsonl）；
       - 后台整理：cortex 超 20% → 沉降到 deep_cortex；events 修剪；到期 reminder append。
  3. 重建快照 = 下次醒来（session_start）。中途 sleep/nap 整理过的文件，下个会话才进新快照。
     —— 这就是「前缀=上次睡醒的快照，会话中只往后贴，睡觉时再揉成新快照」，一个会话最多一次未命中。

── token 估算（⚠️ 必须 CJK-aware）──
  estimateTokens：CJK 字 ×1.8 token，其余 ÷4。
  绝不能用 chars/4——中文少算约 7 倍，会让容量永不报警、注入撑爆窗口（历史事故：真 1.15M 只显示 38%）。

── 注入预算 ──
  MEMORY_BUDGET = 窗口 × 0.35（给对话+补全留 65%）。
  分配：cortex ≤35%·work ≤20%·context 填剩余，各自按尾部 sliceToTokens 切。
  → 配合 pi 自带 compaction：compacted 对话(~382K)+记忆(≤350K)+overhead < 1.048M，不爆。

── 工具 ──
  editcontext  双操作：edit context.md + append cortex.md（cortex_entry 必须非空）
  nap          context 段 → work_memory（再反思，不一句话总结）
  sleep        启动独立 sl- pi 实例做 1% 巩固（见 sleep.ts）。失败【显眼报错】，不再假装成功
  dream        把 cortex 片段丢给潜意识做创造性反思
  drinkcoffee  临时压制容量提醒 N 轮（不增容量）

── 失败要可见（2026-06-15 教训）──
  禁止空 catch 吞错 / 笑脸 fallback。坏了必须让主意识看见（否则像 sleep 那样静默死好几天）。
