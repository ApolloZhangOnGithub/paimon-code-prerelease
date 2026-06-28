// brain.amygdala — 杏仁核 / 急停反射
// 不是 LLM、没有提示词，是【代码反射】：用户喊"停"，立刻 abort 当前生成/工具执行，不给模型投票权。
//
// 为什么必须在模型之外（代码层）：模型靠不住——它会无视"停"继续干工具、往沙箱外写
// （gut-research 实测：用户连喊 10+ 次"停"/"滚"全程被无视）。急停是【反射】，不是判断，
// 所以放在杏仁核这层代码里，绕过模型。和心脏的 Esc（按键硬停）互补：Esc 是按键，这个是说"停"。
//
// 只接管 abort（掐断当前动作）——这是安全核心。要不要顺带永久 halt continuous 是后续细化。

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function isStopIntent(text: string | undefined): boolean {
  const t = (text || "").trim();
  if (!t || t.length > 16) return false;        // 长句不算急停，避免误伤正常对话
  if (/别停|不停|继续/.test(t)) return false;     // 否定/反向（"别停"其实是"继续"），不刹
  return /^(停|住手|打住|别动|别写|闭嘴|stop|cancel)/i.test(t);
}

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event: any, ctx: any) => {
    if (!isStopIntent(event?.text)) return;
    try { ctx.abort?.(); } catch {}   // 立刻掐断当前生成/工具，不等模型反应
    try { ctx.ui?.notify?.("Emergency stop", "warning"); } catch {}
  });
}
