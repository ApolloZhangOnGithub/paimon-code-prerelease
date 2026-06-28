source: hippocampus.ts @ 3b0c0219

hippocampus.ts · SPEC（brain.hippocampus 的 func 入口）

身份: brain.hippocampus 这个 func 的入口文件（default(pi) 在这里）。
      memory 是 tag（标签），不是 func；海马体才是「记忆」这个 tag 下的 func。

default(pi) 装两部分:
1. registerMemory(pi)  —— 主意识身上的记忆机能（注入快照、editcontext、nap/sleep/dream、容量监控）。
   代码在同目录 memory.ts。
2. 后台 hc- 编码小号 —— agent_start 后 spawn tmux hc-<personId>，持续读 context.md、
   再反思写 work_memory.md（gen_work_mem）。createHippocampus 工厂也在本文件。

prompt: createHippocampus 给 hc- 子实例的系统 prompt = getPrompt("hippocampus.gen_work_mem")（coded.dna）。
模式（promotor.dna）: DWN→gen_work_mem / sleep.night→deep_encode(sleep.ts) / sleep.nap→gen_work_mem。
模块（promotor.dna 声明，尚未拆分实现）: workmem / cortexmem / deepcortexmem。
