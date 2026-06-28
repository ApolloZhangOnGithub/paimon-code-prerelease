// apps.thirdparty/bilibili/bilibili.ts — B站视频能力（纯 TypeScript，零外部依赖）
// AI字幕提取 / 视频信息 / 搜索 — 全部通过 B站公开 API

const BILI_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": "https://www.bilibili.com/",
};

async function biliGet(url: string): Promise<any> {
  const res = await fetch(url, { headers: BILI_HEADERS, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`B站 API 返回非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function getVideoInfo(bvid: string) {
  const viewRes = await biliGet(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  if (viewRes.code !== 0) throw new Error(`B站 view API 错误: ${viewRes.message}`);
  const data = viewRes.data;
  if (!data?.cid) throw new Error(`视频数据异常: 缺少 cid (bvid=${bvid})`);
  // Check for AI subtitles
  const subRes = await biliGet(`https://api.bilibili.com/x/v2/dm/view?type=1&oid=${data.cid}&pid=${data.aid}`);
  const subtitles = subRes?.data?.subtitle?.subtitles || [];
  return { ...data, subtitles, cid: data.cid, aid: data.aid };
}

async function fetchSubtitles(bvid: string): Promise<string> {
  const info = await getVideoInfo(bvid);
  if (!info.subtitles.length) return `视频 "${info.title}" 无 AI 字幕。可尝试 whisper 语音转录。`;

  const results: string[] = [`## ${info.title}\n时长: ${Math.floor(info.duration/60)}:${String(info.duration%60).padStart(2,'0')} | 播放: ${info.stat.view} | 弹幕: ${info.stat.danmaku}\n`];

  for (const sub of info.subtitles) {
    let url: string = sub.subtitle_url;
    if (url.startsWith("//")) url = "https:" + url;
    const body = (await biliGet(url)).body || [];
    results.push(`### ${sub.lan_doc} (${body.length} 条)`);
    for (const t of body) {
      const ts = `${Math.floor(t.from/60)}:${String(Math.floor(t.from%60)).padStart(2,'0')}`;
      results.push(`[${ts}] ${t.content}`);
    }
    results.push("");
  }
  return results.join("\n");
}

export async function bilibiliCmd(args: any, _ctx: any, _personDir: string): Promise<{ content: any[]; details: any }> {
  const a = args.action || "";

  if (a === "subs" || a === "fetch_subs") {
    const bvid = args.bvid;
    if (!bvid) return { content: [{ type: "text", text: "需要 bvid 参数（如 BV1Wzjg65EM6）" }], details: {} };
    try {
      const text = await fetchSubtitles(bvid);
      return { content: [{ type: "text", text: text.slice(0, 15000) }], details: { bvid } };
    } catch (e: any) {
      return { content: [{ type: "text", text: `字幕提取失败: ${e.message}` }], details: {} };
    }
  }

  if (a === "info") {
    const bvid = args.bvid;
    if (!bvid) return { content: [{ type: "text", text: "需要 bvid 参数" }], details: {} };
    try {
      const info = await getVideoInfo(bvid);
      const subs = info.subtitles.map((s: any) => s.lan_doc).join(", ") || "无";
      const text = [
        `标题: ${info.title}`,
        `BV: ${bvid} | 时长: ${Math.floor(info.duration/60)}:${String(info.duration%60).padStart(2,'0')}`,
        `播放: ${info.stat.view} | 弹幕: ${info.stat.danmaku} | 评论: ${info.stat.reply}`,
        `UP: ${info.owner.name} | 粉丝: ${info.owner.follower || "?"}`,
        `AI字幕: ${subs}`,
        `简介: ${info.desc.slice(0, 300)}`,
      ].join("\n");
      return { content: [{ type: "text", text }], details: { bvid, cid: info.cid } };
    } catch (e: any) {
      return { content: [{ type: "text", text: `获取失败: ${e.message}` }], details: {} };
    }
  }

  if (a === "search") {
    const kw = args.keyword || args.query;
    if (!kw) return { content: [{ type: "text", text: "需要 keyword 参数" }], details: {} };
    try {
      // B站搜索需要 cookie 反爬; 用带 cookie 的请求
      const searchRes = await biliGet(
        `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(kw)}`
      );
      if (searchRes.code !== 0) throw new Error(`搜索API错误 (code=${searchRes.code}): ${searchRes.message}`);
      const videos = (searchRes?.data?.result || []).slice(0, 10);
      if (!videos.length) return { content: [{ type: "text", text: `"${kw}" 无结果。` }], details: {} };
      const text = videos.map((v: any, i: number) => {
        const title = (v.title || "").replace(/<em class="keyword">|<\/em>/g, "");
        const dur = typeof v.duration === "number" ? `${Math.floor(v.duration/60)}:${String(v.duration%60).padStart(2,'0')}` : String(v.duration || "?");
        return `${i+1}. ${title}\n   BV${v.bvid} | ${v.play} | ${dur}`;
      }).join("\n");
      return { content: [{ type: "text", text }], details: {} };
    } catch (e: any) {
      return { content: [{ type: "text", text: `搜索失败: ${e.message}` }], details: {} };
    }
  }

  if (a === "popular") {
    try {
      const data = (await biliGet("https://api.bilibili.com/x/web-interface/popular?ps=10")).data;
      const text = (data?.list || []).map((v: any, i: number) => {
        const dur = typeof v.duration === "number" ? `${Math.floor(v.duration/60)}:${String(v.duration%60).padStart(2,'0')}` : String(v.duration || "?");
        return `${i+1}. ${v.title}\n   BV${v.bvid} | ${v.stat.view} | ${v.stat.danmaku} | ${dur}`;
      }).join("\n");
      return { content: [{ type: "text", text }], details: {} };
    } catch (e: any) {
      return { content: [{ type: "text", text: `获取失败: ${e.message}` }], details: {} };
    }
  }

  if (a === "whisper") {
    return { content: [{ type: "text", text: "Whisper 语音转录暂不可用——需安装 faster-whisper 模型。\n\n用 `subs` 先拿 AI 字幕，大部分 B站视频都有。" }], details: {} };
  }

  if (a === "hardsub") {
    return { content: [{ type: "text", text: "OCR 硬字幕提取暂不可用——需安装 pyobjc-framework-Vision + PaddleOCR。\n\n用 `subs` 先拿 AI 字幕。" }], details: {} };
  }

  return {
    content: [{
      type: "text",
      text: [
        "Bilibili — 视频能力",
        "  subs <bvid>         AI 字幕（弹幕 API，免登录）",
        "  info <bvid>         视频信息 + 字幕列表",
        "  search <keyword>    搜索视频",
        "  popular             热门榜 TOP10",
        "  whisper <bvid>      语音转文字（待装模型）",
        "  hardsub <bvid>      OCR 硬字幕（待装模型）",
      ].join("\n"),
    }],
    details: {},
  };
}
