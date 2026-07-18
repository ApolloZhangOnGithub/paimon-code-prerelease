export async function pauseHandler(args: any, ctx: any) {
  const handler = (globalThis as any).__paimonPauseHandler;
  if (!handler) { ctx.ui.notify("心跳未就绪", "warning"); return; }
  await handler(args, ctx);
}
