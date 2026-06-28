// spy-cmd.ts — minimal
export async function spyCmd(args: any, _ctx: any, _personDir: string): Promise<{ content: any[]; details: any }> {
  return { content: [{ type: "text", text: "谁是卧底" }], details: {} };
}
