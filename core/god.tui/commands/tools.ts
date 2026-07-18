export function toolsHandler(getActiveTools: () => string[]) {
  return async (_args: any, ctx: any) => {
    const tools: string[] = getActiveTools() ?? [];
    if (!tools.length) { ctx.ui.notify("(无可用工具)", "warning"); return; }
    const sorted = [...tools].sort();
    const out = `当前可用工具 (${tools.length}): ${sorted.join(", ")}`;
    ctx.ui.notify(out, "info");
  };
}
