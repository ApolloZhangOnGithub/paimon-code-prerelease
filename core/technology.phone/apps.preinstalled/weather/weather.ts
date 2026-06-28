// apps.preinstalled/weather/weather.ts — Weather PhoneApp
import type { PhoneApp } from "../../system.kernel/kernel.ts";

async function fetchWeather(city: string): Promise<string> {
  const c = encodeURIComponent(city || "Beijing");
  try {
    const res = await fetch(`https://wttr.in/${c}?format=%C+%t+%h+%w&lang=zh`, {
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "curl/7.79" },
    });
    if (res.ok) return `${city}: ${(await res.text()).trim()}`;
  } catch {}
  // fallback: multi-line forecast
  try {
    const res = await fetch(`https://wttr.in/${c}?T&lang=zh`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "curl/7.79" },
    });
    if (res.ok) {
      const text = await res.text();
      return text.split("\n").filter((l: string) => l.trim()).slice(0, 8).join("\n");
    }
  } catch {}
  return "天气查询失败，检查城市名";
}

export const app: PhoneApp = {
  name: "天气",
  icon: "天气",
  messageDescription: "查询城市天气",

  onOpen(state: any) {
    return {
      screen: [
        "═══ 天气 ═══",
        "",
        "输入城市名查询天气",
        "如：深圳、Tokyo、London",
        "",
        "「返回」退出",
      ].join("\n"),
      state,
    };
  },

  async onAction(input: string, state: any) {
    const weather = await fetchWeather(input.trim());
    return { screen: weather + "\n\n输入其他城市继续查，或「返回」退出", state };
  },
};
