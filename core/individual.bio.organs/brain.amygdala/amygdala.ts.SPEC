source: amygdala.ts @ 8384c4dd

brain.amygdala — 杏仁核 / 急停反射。纯代码、无 LLM、无提示词。

机制：pi.on("input") 监听用户输入；isStopIntent 判定是"停"意图（短句 ≤16 字，以 停/住手/打住/别动/别写/闭嘴/stop/cancel 开头，排除"别停/不停/继续"反向词）→ 立刻 ctx.abort() 掐断当前生成/工具执行。不调模型、不靠模型自觉。

为什么要它（用户原话场景）：模型会无视"停"继续干——gut-research 实测用户连喊 10+ 次"停""滚"全被无视，agent 还在调工具、往沙箱外写文件。急停是【反射】不是判断，所以必须在模型之外的代码层。

边界：v1 只做 abort（掐断当前动作，安全核心）。是否顺带永久 halt continuous（让它停下不自动续）是后续细化。与心脏 body.heart 的 Esc 互补：Esc=按键硬停，杏仁核=听到"停"。session main（只有主意识收用户输入），belong infra，永远 abled。
