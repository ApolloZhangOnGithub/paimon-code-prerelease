import { setStatus } from "#status";

// paimon: 压缩权重引导，让摘要 LLM 区分信息重要性
const DEFAULT_COMPACT_GUIDANCE = [
  "报错信息、异常栈、bug 定位 → 原文保留，含完整文件路径+行号",
  "架构决策、方向变更、用户说'不对/重来' → 详细记录原因和转折点",
  "多步调试链 → 保留步骤顺序和每步结论，省略中间工具输出的冗余部分",
  "代码生成/修改 → 保留文件路径+改了什么，不保留完整代码",
  "用户纯确认('好的''继续''嗯') → 一句带过或省略",
  "工具调用(读文件/执行命令) → 只保留对理解结果必要的摘要，命令本身不保留",
  "反复讨论同一话题但无结论 → 合并为一条，标注'未解决'",
].join("\n");

export async function compactHandler(args: string, ctx: any) {
  const userInstructions = (args ?? "").trim();
  const customInstructions = [
    `Compaction priorities:\n${DEFAULT_COMPACT_GUIDANCE}`,
    userInstructions || undefined,
  ].filter(Boolean).join("\n\n") || undefined;

  setStatus("sleeping(compacting)");
  ctx.compact({
    customInstructions,
    onComplete: () => {
      setStatus("working");
      try { ctx.ui.notify("compact 完成", "info"); } catch {}
    },
    onError: () => {
      setStatus("working");
    },
  });
}
