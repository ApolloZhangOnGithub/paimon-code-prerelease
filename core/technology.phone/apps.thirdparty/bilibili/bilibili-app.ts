// apps.thirdparty/bilibili/bilibili-app.ts — B站 Video App（PhoneApp 包装）
import type { PhoneApp } from "../../system.kernel/kernel.ts";
import { bilibiliCmd } from "./bilibili.ts";

export const app: PhoneApp = {
  name: "B站",
  icon: "B站",
  messageDescription: "视频字幕/搜索/热门",
  onOpen(state: any) {
    return { screen: "B站\n\n输入 BV号 看字幕\n输入「搜索 关键词」搜视频\n输入「热门」看排行榜", state };
  },
  async onAction(input: string, state: any) {
    const cmd = input.trim();
    try {
      if (cmd === "热门" || cmd === "popular") {
        const r = await bilibiliCmd({ action: "popular" }, {}, "");
        return { screen: r.content[0].text, state };
      }
      if (cmd.startsWith("搜索 ") || cmd.startsWith("search ")) {
        const kw = cmd.replace(/^(搜索 |search )/, "");
        const r = await bilibiliCmd({ action: "search", keyword: kw }, {}, "");
        return { screen: r.content[0].text, state };
      }
      if (cmd.match(/^BV/i)) {
        const r = await bilibiliCmd({ action: "subs", bvid: cmd }, {}, "");
        return { screen: r.content[0].text.slice(0, 6000), state };
      }
      return { screen: "B站\n\n" + cmd.split("\n").slice(0, 10).join("\n") + "\n\n用法: BV号 | 搜索 xxx | 热门 | 返回", state };
    } catch (e: any) {
      return { screen: `Error: ${e.message}`, state };
    }
  },
};
