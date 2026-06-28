// apps.thirdparty/wechatread/wechatread.ts — 微信读书
import type { PhoneApp } from "../../system.kernel/kernel.ts";

// ── Core ──────────────────────────────────────────────────────
export async function wechatreadCmd(args: any, _ctx: any, _personDir: string): Promise<{ content: any[]; details: any }> {
  const a = args.action || "";
  const kw = args.keyword || args.query || "";

  if (a === "search") {
    if (!kw) return { content: [{ type: "text", text: "需要 keyword 参数" }], details: {} };
    try {
      const url = `https://weread.qq.com/web/search/global?q=${encodeURIComponent(kw)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as any;
      const books = data?.books || [];
      if (!books.length) return { content: [{ type: "text", text: `"${kw}" 无结果。` }], details: {} };
      const text = books.slice(0, 10).map((b: any, i: number) => {
        const info = b.bookInfo || b;
        return `${i+1}. ${info.title} — ${info.author}\n   ${info.intro?.slice(0, 80) || ""}`;
      }).join("\n\n");
      return { content: [{ type: "text", text: `搜索: "${kw}"\n\n${text}` }], details: {} };
    } catch (e: any) {
      return { content: [{ type: "text", text: `搜索失败: ${e.message}` }], details: {} };
    }
  }

  if (a === "hot") {
    try {
      const res = await fetch("https://weread.qq.com/web/bookListInCategory/rising?maxIndex=0", {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as any;
      const books = data?.books || [];
      if (!books.length) return { content: [{ type: "text", text: "获取飙升榜失败。" }], details: {} };
      const text = books.slice(0, 10).map((b: any, i: number) => {
        const info = b.bookInfo || b;
        return `${i+1}. ${info.title} — ${info.author}`;
      }).join("\n");
      return { content: [{ type: "text", text: `微信读书 · 飙升榜\n\n${text}` }], details: {} };
    } catch (e: any) {
      return { content: [{ type: "text", text: `获取失败: ${e.message}` }], details: {} };
    }
  }

  return {
    content: [{ type: "text", text: "微信读书\n  search <keyword>  搜索书籍\n  hot             飙升榜" }],
    details: {},
  };
}

// ── PhoneApp ──────────────────────────────────────────────────
export const app: PhoneApp = {
  name: "微信读书",
  icon: "读书",
  messageDescription: "微信读书 — 搜书/榜单",
  onOpen(_state) {
    return {
      screen: "微信读书\n\n输入「搜索 关键词」搜书\n输入「飙升」看飙升榜\n输入「返回」回主屏幕",
      state: _state ?? {},
    };
  },
  async onAction(input, state) {
    const cmd = input.trim();
    if (cmd === "飙升" || cmd === "hot") {
      const r = await wechatreadCmd({ action: "hot" }, {}, "");
      return { screen: r.content[0].text, state };
    }
    if (cmd.startsWith("搜索 ") || cmd.startsWith("search ")) {
      const kw = cmd.replace(/^(搜索 |search )/, "");
      const r = await wechatreadCmd({ action: "search", keyword: kw }, {}, "");
      return { screen: r.content[0].text, state };
    }
    const r = await wechatreadCmd({}, {}, "");
    return { screen: r.content[0].text, state };
  },
};
