// apps.preinstalled/search/search.ts — 本地 SearXNG 搜索
// 零依赖，直接 HTTP 调 SearXNG

const SEARX = process.env.SEARXNG_URL || "http://127.0.0.1:8888";

export async function searchCmd(args: any, _ctx: any, _personDir: string): Promise<{ content: any[]; details: any }> {
  const q = args.query || args.q || "";
  if (!q) return { content: [{ type: "text", text: "search <query> — 搜索全网" }], details: {} };

  try {
    const url = `${SEARX}/search?q=${encodeURIComponent(q)}&format=json&categories=general&language=zh-CN`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const j = await r.json() as any;
    const items = j.results || [];
    if (!items.length) return { content: [{ type: "text", text: `"${q}" 无结果。` }], details: {} };

    const engines = [...new Set(items.map((i: any) => i.engine).filter(Boolean))];
    const text = [`${q}`, `引擎: ${engines.join(", ")}`, ""];
    for (const [i, item] of items.slice(0, 8).entries()) {
      text.push(`[${i+1}] ${item.title}`);
      text.push(`    ${(item.content || item.snippet || "").slice(0, 120)}`);
      text.push(`    → ${item.url}`);
      text.push("");
    }
    return { content: [{ type: "text", text: text.join("\n") }], details: { count: items.length } };
  } catch (e: any) {
    return { content: [{ type: "text", text: `搜索失败: ${e.message}` }], details: {} };
  }
}
