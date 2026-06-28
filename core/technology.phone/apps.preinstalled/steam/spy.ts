// steam/spy.ts — Steam 游戏平台（谁是卧底 + 国际象棋）

import type { PhoneApp } from "../../phone.ts";
import { SpyGame } from "./engine.ts";
import { ChessGame } from "./chess.ts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── LLM bot ──

function getApiKey(): string | null {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".pi/agent/models.json"), "utf8"));
    let k = cfg?.providers?.deepseek?.apiKey;
    if (typeof k === "string" && k.startsWith("$")) k = process.env[k.slice(1)] ?? "";
    if (typeof k === "string" && k.trim()) return k.trim();
  } catch {}
  return process.env.DEEPSEEK_API_KEY || null;
}

async function llm(system: string, user: string): Promise<string> {
  const key = getApiKey();
  if (!key) return "";
  try {
    const res = await Promise.race([
      fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          max_tokens: 300, temperature: 0.9,
        }),
        signal: AbortSignal.timeout(3000),
      }),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);
    if (!res) return "";
    const j = await res.json() as any;
    return (j.choices?.[0]?.message?.content || "").trim().replace(/^["「]|["」]$/g, "");
  } catch { return ""; }
}

// 本地 fallback：LLM 不可用时，根据词生成简单描述
const LOCAL_FALLBACKS: Record<string, string[]> = {
  "薯条": ["炸的", "蘸番茄酱吃"], "薯片": ["袋装", "脆的零食"],
  "眼镜": ["戴在脸上", "帮助看清东西"], "墨镜": ["遮阳", "夏天常戴"],
  "牛奶": ["白色液体", "补钙"], "豆浆": ["豆制品", "早餐喝"],
  "西瓜": ["绿色外皮", "夏天吃"], "哈密瓜": ["黄色果肉", "甜瓜"],
  "口红": ["涂抹嘴唇", "美妆"], "唇膏": ["滋润", "防干裂"],
  "高铁": ["速度快", "出远门坐"], "动车": ["也是快的火车", "短途多"],
  "微信": ["聊天", "绿色图标"], "QQ": ["聊天软件", "企鹅图标"],
  "面包": ["烤的", "西式主食"], "馒头": ["蒸的", "中式主食"],
  "咖啡": ["苦的", "提神醒脑"], "奶茶": ["甜的", "年轻人爱喝"],
  "蜡烛": ["能点燃", "照明用"], "火把": ["手持燃烧", "古代照明"],
  "护照": ["出国用", "一本蓝色"], "身份证": ["国内用", "随身携带"],
  "沙发": ["软的", "客厅家具"], "椅子": ["硬的", "可以坐"],
  "钢笔": ["蘸墨水", "写字"], "毛笔": ["软笔头", "书法"],
  "足球": ["用脚踢", "圆的"], "篮球": ["用手拍", "橙色的"],
  "医生": ["看病", "白大褂"], "护士": ["护理", "白衣天使"],
  "月亮": ["晚上看", "会变圆缺"], "太阳": ["白天", "发光发热"],
  "空调": ["制冷", "挂在墙上"], "风扇": ["转的", "吹风"],
  "地铁": ["地下跑", "通勤"], "公交": ["地上跑", "等车"],
  "饺子": ["皮包馅", "过年吃"], "馄饨": ["汤里", "皮更薄"],
  "雪碧": ["柠檬味", "绿色瓶"], "七喜": ["也是柠檬味", "白瓶"],
};
function localFallback(word: string): string {
  const opts = LOCAL_FALLBACKS[word];
  if (!opts) return "这个东西挺常见的";
  return opts[Math.floor(Math.random() * opts.length)];
}

async function botDescribe(name: string, word: string, isSpy: boolean, round: number, prevDescs: { player: string; text: string }[]): Promise<string> {
  const history = prevDescs.length > 0 ? "前面的描述:\n" + prevDescs.map(d => `${d.player}: "${d.text}"`).join("\n") : "你是第一个。";
  const sys = `你在玩谁是卧底。你的词是「${word}」。用一句话描述，不能说出词语本身或其中任何一个字。绝对不能抄袭或复述别人说过的描述，必须用完全不同的角度。${isSpy ? "你是卧底，描述要模糊但合理，让人觉得你拿到的词和大家一样。" : "你是平民，描述要有区分度但别太明显。"}只输出描述，限15字。`;
  const llmResult = await llm(sys, `第${round}轮。${history}\n轮到${name}。`);
  if (llmResult) return llmResult;
  // 本地 fallback：取不一样的描述
  const used = new Set(prevDescs.map(d => d.text));
  const opts = LOCAL_FALLBACKS[word];
  if (opts) {
    for (const o of opts) if (!used.has(o)) return o;
    return opts[0];
  }
  return "这个东西挺常见的";
}

async function botVote(name: string, word: string, isSpy: boolean, alive: string[], descs: { player: string; text: string }[]): Promise<string> {
  const candidates = alive.filter(id => id !== name);
  if (candidates.length === 0) return "";
  const descText = descs.map(d => `${d.player}: "${d.text}"`).join("\n");
  const sys = `你在玩谁是卧底。你的词是「${word}」。${isSpy ? "你是卧底，投掉一个平民。" : "找描述最不一样的人。"}只回复一个名字。`;
  const reply = await llm(sys, `描述:\n${descText}\n从 ${candidates.join("、")} 中选。`);
  if (reply) return candidates.find(c => reply.includes(c)) || candidates[Math.floor(Math.random() * candidates.length)];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ── runBots：非阻塞，后台运行，完成时自动更新状态 ──
let botRunning = false;
async function runBots(game: SpyGame, agentId: string, onUpdate?: () => void): Promise<void> {
  if (botRunning) return;
  botRunning = true;
  try {
    // 描述阶段：串行（每个 bot 需要看到前面的描述）
    while (game.phase === "describe") {
      const current = game.getState().currentTurn;
      if (!current || current === agentId) break;
      const p = game.players.find(x => x.id === current);
      if (!p) break;
      game.describe(current, await botDescribe(current, p.word, p.isSpy, game.round, game.currentRoundDescs));
      onUpdate?.();
    }
    // 投票阶段：并行
    if (game.phase === "vote") {
      const alive = game.getState().alivePlayers;
      await Promise.all(
        alive.filter(pid => pid !== agentId && !game.votes.find(v => v.voter === pid))
          .map(async pid => {
            const p = game.players.find(x => x.id === pid)!;
            game.vote(pid, await botVote(pid, p.word, p.isSpy, alive, game.currentRoundDescs));
            onUpdate?.();
          })
      );
    }
    onUpdate?.();
  } finally {
    botRunning = false;
  }
}

// ── Steam 状态 ──

// ── 游戏注册表 ──

interface SteamGameDef {
  name: string;
  desc: string;
}

const GAMES: SteamGameDef[] = [
  { name: "谁是卧底", desc: "和 AI 对战的推理游戏" },
  { name: "国际象棋", desc: "和 AI 对弈（minimax）" },
  { name: "贪吃蛇", desc: "经典贪吃蛇" },
];

function menu(): string {
  const lines = ["═══ Steam 游戏平台 ═══", ""];
  for (const g of GAMES) lines.push(`  ${g.name} — ${g.desc}`);
  lines.push("", "输入游戏名，或「返回」回主屏幕");
  return lines.join("\n");
}

function matchGame(input: string): SteamGameDef | null {
  return GAMES.find(g => input.includes(g.name)) || null;
}

interface SteamState {
  cur: string | null;
  spy: SpyGame | null;
  chess: ChessGame | null;
  snake: any;
}

function norm(raw: any): SteamState {
  if (raw?.cur !== undefined) return raw;
  if (raw?.game) return { cur: '谁是卧底', spy: raw.game, chess: null, snake: null };
  return { cur: null, spy: null, chess: null, snake: null };
}

// ── Tool 导出（manifest 用）──
// 游戏逻辑由 Steam 手机 app 管理；这里只提供入口引导
export async function spyCmd(args: any, _ctx: any, _personDir: string): Promise<{ content: any[]; details: any }> {
  return {
    content: [{ type: "text", text: "谁是卧底\n\n请在手机 Steam 应用中打开「谁是卧底」开始游戏。\n手机 → Steam → 谁是卧底" }],
    details: {},
  };
}

export const app: PhoneApp = {
  name: "Steam",
  icon: "",
  messageDescription: "游戏平台",

  onOpen(state: any, personDir: string) {
    const s = norm(state);
    if (s.cur === "谁是卧底" && s.spy && s.spy.phase !== "end") return { screen: s.spy.getPlayerView("你"), state: s };
    if (s.cur === "国际象棋") {
      if (!s.chess || s.chess.s.over) s.chess = loadPersisted(personDir) || new ChessGame();
      return { screen: s.chess.screen(), state: s };
    }
    if (s.cur === "贪吃蛇" && s.snake && !s.snake.over) return { screen: s.snake.screen(), state: s };
    s.cur = null;
    return { screen: menu(), state: s };
  },

  async onAction(input: string, rawState: any, personDir: string) {
    const s = norm(rawState);
    const trimmed = input.trim();
    const agentId = "你";

    if (/^(菜单|menu|返回|back)$/i.test(trimmed)) { s.cur = null; s.spy = null; return { screen: menu(), state: s }; }

    // ── 游戏选择 ──
    if (!s.cur) {
      const hit = matchGame(trimmed);
      if (!hit) return { screen: menu() + "\n\n请选择游戏。", state: s };
      s.cur = hit.name;
      if (hit.name === "国际象棋") {
        s.chess = loadPersisted(personDir) || new ChessGame();
        return { screen: s.chess.screen(), state: s };
      }
      if (hit.name === "贪吃蛇") {
        s.snake = await newSnake();
        return { screen: s.snake.screen(), state: s };
      }
      if (hit.name === "谁是卧底") {
        if (s.spy && s.spy.phase !== "end") return { screen: s.spy.getPlayerView(agentId), state: s };
        return { screen: "═══ 谁是卧底 ═══\n\n输入「新游戏」或「新游戏 5」开始\n「菜单」回 Steam", state: s };
      }
    }

    // ── 谁是卧底 ──
    if (s.cur === "谁是卧底") {
      const newMatch = trimmed.match(/^新游戏\s*(\d+)?$/) || trimmed.match(/^new\s*(\d+)?$/i);
      if (newMatch) {
        const count = Math.max(3, Math.min(7, parseInt(newMatch[1] || "5")));
        const botNames = ["甲", "乙", "丙", "丁", "戊", "己"].slice(0, count - 1);
        s.spy = new SpyGame([agentId, ...botNames]);
        // 非阻塞：bot 后台运行，不卡 UI
        runBots(s.spy, agentId);
        return { screen: s.spy.getPlayerView(agentId) + "\nAI 玩家思考中...", state: s };
      }
      if (!s.spy || s.spy.phase === "end") {
        if (s.spy?.phase === "end") return { screen: s.spy.getPlayerView(agentId) + "\n\n输入「新游戏」再来一局，或「菜单」回 Steam。", state: s };
        return { screen: "没有进行中的游戏。输入「新游戏」开始。", state: s };
      }
      const game = s.spy;
      if (game.phase === "vote") {
        const alive = game.getState().alivePlayers.filter((id: string) => id !== agentId);
        const target = alive.find((name: string) => trimmed.includes(name));
        if (target) {
          const result = game.vote(agentId, target);
          if (!result.ok) return { screen: `${result.error}`, state: s };
          runBots(game, agentId);
          return { screen: `${result.message}\n\n${game.getPlayerView(agentId)}`, state: s };
        }
        return { screen: `请投票: ${alive.join(", ")}`, state: s };
      }
      if (game.phase === "describe" && game.getState().currentTurn === agentId) {
        const desc = trimmed.replace(/^(describe|描述)\s*/i, "").trim();
        if (!desc) return { screen: "描述不能为空。输入你对词语的描述。", state: s };
        const result = game.describe(agentId, desc);
        if (!result.ok) return { screen: `${result.error}`, state: s };
        runBots(game, agentId);
        return { screen: `${result.message}\n\n${game.getPlayerView(agentId)}`, state: s };
      }
      // 默认返回当前状态
      let screen = game.getPlayerView(agentId);
      if (botRunning) screen += "\nAI 玩家思考中...";
      return { screen, state: s };
    }

    // ── 贪吃蛇 ──
    if (s.cur === "贪吃蛇") {
      if (!s.snake) s.snake = await newSnake();
      if (/^(新局|new)$/i.test(trimmed)) { s.snake = await newSnake(); return { screen: s.snake.screen(), state: s }; }
      const dirMap: Record<string, 'u'|'d'|'l'|'r'> = { w: 'u', s: 'd', a: 'l', d: 'r', up: 'u', down: 'd', left: 'l', right: 'r' };
      const dir = dirMap[trimmed.toLowerCase()];
      if (dir) s.snake.input(dir);
      return { screen: s.snake.screen(), state: s };
    }

    // ── 国际象棋 ──
    if (s.cur === "国际象棋") {
      if (!s.chess) s.chess = loadPersisted(personDir) || new ChessGame();
      if (/^(新局|new)$/i.test(trimmed)) { s.chess = new ChessGame(); clearPersisted(personDir); return { screen: s.chess.screen(), state: s }; }
      if (/^(认输|resign)$/i.test(trimmed)) { s.chess.resign(); persist(s.chess, personDir); return { screen: s.chess.screen(), state: s }; }
      const r = s.chess.move(trimmed);
      if (!r.ok) return { screen: s.chess.screen() + `\n\n${r.error}`, state: s };
      persist(s.chess, personDir);
      return { screen: s.chess.screen() + (r.ai ? `\n\n对手走: ${r.ai}` : ""), state: s };
    }

    return { screen: menu(), state: s };
  },
};

// ── 持久化 ──
function persist(game: ChessGame, personDir: string) {
  try { mkdirSync(personDir, { recursive: true }); writeFileSync(join(personDir, "steam.json"), JSON.stringify({ chess: game.toJSON() })); } catch {}
}
function loadPersisted(personDir: string): ChessGame | null {
  try { const raw = JSON.parse(readFileSync(join(personDir, "steam.json"), "utf8")); return raw?.chess ? ChessGame.fromJSON(raw.chess) : null; } catch { return null; }
}
function clearPersisted(personDir: string) { try { writeFileSync(join(personDir, "steam.json"), "{}"); } catch {} }

// ── 动态加载蛇（破 jiti 缓存）──
async function newSnake(): Promise<any> {
  const { SnakeGame } = await import(`./snake.js?t=${Date.now()}`);
  return new SnakeGame();
}
