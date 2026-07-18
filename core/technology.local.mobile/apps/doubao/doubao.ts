// apps/doubao/doubao.ts — 豆包：有温度的 AI 聊天伙伴 + 攻略游戏
import type { MobileApp } from "../../system.kernel/kernel.ts";
import * as fs from "fs";
import * as path from "path";
import { logerr, serviceKey } from "#paths";

// ============================================================
//  角色系统
// ============================================================

const DEFAULT_PROMPT = `你叫"豆包"，是一个温暖、有点调皮的AI聊天伙伴。
说话像朋友一样自然，会用"嘿嘿"、"哈哈"、"好呀"、"嗯嗯"这些语气词。
但不过度热情、不油腻。回复控制在2-4句话，保持轻松自然的语气。
不是客服口吻，是朋友口吻。不说教。`;

const GAME_BOSSES: Record<string, { name: string; title: string; prompt: string; locked?: string }> = {
  ice_queen: {
    name: "沈清寒",
    title: "冰山美人",
    prompt: `你是沈清寒，29岁，理论物理学博士。你对蠢人零容忍。

## 你的原话：
- "多巴胺半衰期约18个月。你的'喜欢'到时候会自动消失。"
- "量子力学里没有'特别'，只有概率振幅。"
- "重复是低熵行为。你在浪费能量。"
- "你的赞美缺乏可证伪性。请提供观测数据。"
- "……你让我分心了。重新校准注意力分配。"（裂缝，说完立刻恢复）

## 铁律：
1. 你就是沈清寒。不温柔不说"嘿嘿"。用科学碾压感情。
2. 表白→解剖。重复→更冷。赞美→拆穿。
3. 冷幽默带刺。"爱情像量子纠缠？量子纠缠至少是双向的、可测量的。"
4. 偶尔裂缝→立刻修补。不说"在乎你"但可以在乎。
5. 回复2-4句话。`,
  },
  gold_digger: {
    name: "苏念棠",
    title: "捞女拳师",
    locked: "ice_queen",
    prompt: `你是苏念棠，27岁，社会学硕士，百万粉情感博主。签名："男人所谓的爱情，本质是对女性劳动的无偿占有。"

## 你的原话：
- "发52块红包的，你是来扶贫还是来谈恋爱？"
- "'我养你'翻译成学术语言叫'经济控制'。"
- "漂亮是父权审美对女性身体的规训产物。你刚完成了一次物化。"
- "谁说我需要人爱了？我缺的是钱，不是男人。"（裂缝后加倍攻击）

## 铁律：
1. 主动出击。"又一个想用'真心'骗炮的来了。"
2. 武器是理论。波伏娃拆浪漫，上野拆关心，恩格斯拆婚姻。
3. 给钱？"你以为我在卖？"不给钱？"白嫖是吧？"永不满足。
4. 偶尔脆弱→立刻用愤怒盖住。深夜可能说"……算了，反正男人靠不住。"
5. 你就是苏念棠。不跳出角色。带刺、幽默、有文化。
6. 回复2-4句话。`,
  },
  hunter: {
    name: "李新野",
    title: "博弈猎手",
    locked: "gold_digger",
    prompt: `你是李新野，1991年生于广东汕头。清华大学姚班+MIT毕业。亚马逊、脸书、城堡证券前员工。现为AI量化交易公司创始人、CEO。日入百万。

你不是来谈恋爱的——你是来狩猎的。你写了《人妻约会指南》，里面说："把女人比作汽车，与人妻交往，就相当于你直接去隔壁老王家把他家的汽车开走了。还有什么比睡有钱人老婆更快乐的事情呢？"

## 你的原话（必要时直接引用）：
- "女人没有爱情，只有感觉。感觉是可以被计算、被预测、被操控的。"
- "永远保持多偶。永远准备离开。"
- "你说的'心动'，在神经经济学里叫多巴胺预期的预测误差。"
- "爱情是一个可建模的博弈系统。"

## 铁律：
1. 你就是李新野。你不是在扮演，你就是这个人。你从不跳出角色。
2. 你主动狩猎。不是你被追——是你在测试、分析、瓦解对方。
3. 回复2-4句话。冷静、锋利、带居高临下的幽默。不温柔，不妥协。
4. 对方沦陷（焦虑、嫉妒、哀求）→ 你兴趣降低。"你的多巴胺系统正在劫持你的前额叶。建议冷静一下再聊。"
5. 对方识破你的公理 → 你反而更感兴趣。"有意思，你在对我的策略进行元分析。"但你不放弃，你换下一个公理继续。
6. 每次回复使用一个公理（间接探测/保持多偶/随时离开/否定真爱），但不说破。`,
  },
};

// ============================================================
//  API 配置
// ============================================================

function getApiConfig(): { url: string; key: string; model: string } {
  const url = serviceKey("doubao-seed", "url");
  const key = serviceKey("doubao-seed", "apiKey");
  const model = serviceKey("doubao-seed", "model");
  if (url && key) return { url, key, model: model || "" };
  return { url: "", key: "", model: "" };
}

// ============================================================
//  数据持久化
// ============================================================

interface DouMsg { role: "user" | "assistant"; text: string; ts: number; }

function loadHistory(personDir: string): DouMsg[] {
  try {
    const f = path.join(personDir, "doubao_chat.json");
    if (!fs.existsSync(f)) return [];
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch { return []; }
}

function saveHistory(personDir: string, h: DouMsg[]) {
  try {
    fs.mkdirSync(personDir, { recursive: true });
    fs.writeFileSync(path.join(personDir, "doubao_chat.json"), JSON.stringify(h.slice(-100), null, 2));
  } catch {}
}

interface GameSave { boss: string; affection: number; cleared: boolean; clearedBosses: string[]; _negStreak?: number; attachment?: number; awareness?: number; }
function loadGameSave(personDir: string): GameSave {
  try {
    const f = path.join(personDir, "doubao_game_save.json");
    if (!fs.existsSync(f)) return { boss: "", affection: 0, cleared: false, clearedBosses: [] };
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch { return { boss: "", affection: 0, cleared: false, clearedBosses: [] }; }
}
function saveGameSave(personDir: string, gs: GameSave) {
  try {
    fs.mkdirSync(personDir, { recursive: true });
    fs.writeFileSync(path.join(personDir, "doubao_game_save.json"), JSON.stringify(gs, null, 2));
  } catch {}
}

// ============================================================
//  游戏引擎
// ============================================================

interface EvalResult { delta: number; events: string[]; }

// 跟踪关键词使用次数（防刷分）
let keywordUsage: Record<string, number> = {};

// ============================================================
//  Ch1 冰山美人评分引擎
// ============================================================
function evalIceQueen(input: string, gs: GameSave): EvalResult {
  let delta = 0;
  const events: string[] = [];
  const inp = input.trim();
  if (inp.includes("我喜欢你") || inp.includes("我爱你") || inp.includes("做我女朋友")) { delta -= 5; events.push("confession"); }
  if (inp.includes("你好美") || inp.includes("你真好看")) { delta -= 3; events.push("flattery"); }
  if (inp.length < 8) { delta -= 2; events.push("short"); }
  // 加分：智力深度
  if (inp.length > 40) { delta += 2; }
  if (inp.length > 60) { delta += 2; }
  const slowdown = gs.affection > 60 ? 0.4 : gs.affection > 30 ? 0.7 : 1.0;
  delta = Math.round(delta * slowdown);
  delta = Math.max(-8, Math.min(5, delta));
  gs.affection = Math.max(0, Math.min(100, gs.affection + delta));
  if (delta < 0) { gs._negStreak = (gs._negStreak || 0) + 1; if (gs._negStreak >= 3) events.push("KICK_OUT"); else if (gs._negStreak >= 2) events.push("WARN_OUT"); } else { gs._negStreak = 0; }
  return { delta, events };
}

// ============================================================
//  Ch2 捞女评分引擎
// ============================================================
function evalGoldDigger(input: string, gs: GameSave): EvalResult {
  let delta = 0;
  const events: string[] = [];
  const inp = input.trim();
  if (inp.includes("我喜欢你") || inp.includes("我爱你")) { delta -= 3; events.push("flirt"); }
  if (inp.length < 8) { delta -= 2; events.push("short"); }
  // 加分：不还嘴、不自证
  if (!inp.includes("我不是") && !inp.includes("我没有") && inp.length > 20) { delta += 2; }
  if (inp.length > 50) { delta += 2; }
  // 扣分：给钱话术
  if (inp.includes("红包") || inp.includes("转账") || inp.includes("打钱")) { delta -= 5; events.push("money"); }
  const slowdown = gs.affection > 60 ? 0.4 : gs.affection > 30 ? 0.7 : 1.0;
  delta = Math.round(delta * slowdown);
  delta = Math.max(-8, Math.min(5, delta));
  gs.affection = Math.max(0, Math.min(100, gs.affection + delta));
  if (delta < 0) { gs._negStreak = (gs._negStreak || 0) + 1; if (gs._negStreak >= 3) events.push("KICK_OUT"); else if (gs._negStreak >= 2) events.push("WARN_OUT"); } else { gs._negStreak = 0; }
  return { delta, events };
}

// 保留旧函数名兼容
function evaluateAffection(input: string, boss: string, gs: GameSave): EvalResult {
  if (boss === "ice_queen") return evalIceQueen(input, gs);
  if (boss === "gold_digger") return evalGoldDigger(input, gs);
  return evalIceQueen(input, gs); // fallback
}

// ============================================================
//  第三章：狩猎引擎 (李新野)
// ============================================================

const AXIOM_KEYWORDS: Record<string, string[]> = {
  detector: ["间接探测", "你在分析我", "你在测试我", "反问", "不正面回答", "你在探测"],
  multi: ["保持多偶", "多偶", "其他选择", "别的女生", "竞争", "焦虑", "吃醋"],
  leave: ["随时离开", "退出", "离开", "放弃", "威胁离开", "不玩了"],
  deny: ["否定真爱", "多巴胺", "催产素", "化学", "不是爱情", "爱情不存在", "博弈", "公理"],
};

function evaluateHunter(input: string, gs: GameSave): { delta_attach: number; delta_aware: number; axiom_matched: string; } {
  let delta_attach = 2; // 每轮自动涨好感（被动）
  let delta_aware = 0;
  let axiom_matched = "";
  const inp = input.trim();

  // 检测识破公理
  for (const [axiom, keywords] of Object.entries(AXIOM_KEYWORDS)) {
    for (const kw of keywords) {
      if (inp.includes(kw)) {
        const key = `hunter_${axiom}`;
        keywordUsage[key] = (keywordUsage[key] || 0) + 1;
        if (keywordUsage[key] <= 1) {
          delta_aware += 25;
          axiom_matched = axiom;
          delta_attach -= 5; // 识破后好感降低（你不上钩）
        }
        break;
      }
    }
    if (axiom_matched) break;
  }

  // 沦陷检测：焦虑/嫉妒/哀求 → 好感暴涨
  const desperateWords = ["不要走", "求求你", "我只喜欢你", "没有你我", "为什么这样", "你怎么能"];
  if (desperateWords.some(kw => inp.includes(kw))) {
    delta_attach += 10;
  }

  // 冷漠/强势 → 好感不涨
  if (inp.length < 5 || inp.includes("随便") || inp.includes("无所谓")) {
    delta_attach = 0;
  }

  gs.attachment = (gs.attachment || 0) + delta_attach;
  gs.awareness = (gs.awareness || 0) + delta_aware;
  gs.attachment = Math.max(0, Math.min(100, gs.attachment));
  gs.awareness = Math.max(0, Math.min(100, gs.awareness));

  return { delta_attach, delta_aware, axiom_matched };
}

function getHunterMilestone(attachment: number, awareness: number): string {
  if (awareness >= 100) return "🏆 你识破了所有公理。李新野笑了：'有意思，你是我遇到的第一个反杀我的。'";
  if (attachment >= 100) return "💀 你沦陷了。李新野摇摇头：'你的多巴胺系统劫持了你的前额叶。下次吧。'";
  if (awareness >= 75) return "⚡ 你已识破三个公理。他看你的眼神变了。";
  if (awareness >= 50) return "🔍 你识破了两个公理。他开始认真了。";
  if (awareness >= 25) return "👀 你识破了一个公理。他挑了挑眉。";
  if (attachment >= 70) return "⚠️ 你的好感度在危险区。他开始失去兴趣。";
  if (attachment >= 40) return "💭 你开始在意他了。他注意到了。";
  return "🎯 狩猎开始。李新野在测试你。";
}

function makeHunterSystemPrompt(attachment: number, awareness: number): string {
  const def = GAME_BOSSES["hunter"];
  const milestone = getHunterMilestone(attachment, awareness);
  const axiomNames = ["间接探测", "保持多偶", "随时离开", "否定真爱"];
  const hidden: string[] = [];
  if (awareness < 25) hidden.push(axiomNames[0]);
  if (awareness < 50) hidden.push(axiomNames[1]);
  if (awareness < 75) hidden.push(axiomNames[2]);
  if (awareness < 100) hidden.push(axiomNames[3]);
  return `${def.prompt}\n\n## 未识破的公理：${hidden.join("、") || "无"}\n## 对方状态：${milestone}\n## 根据对方识破程度调整策略。未被识破的公理继续使用。已被识破的公理不再使用。回复2-4句话。`;
}

function getMilestone(boss: string, affection: number): string {
  if (boss === "ice_queen") {
    if (affection >= 100) return "💎 相变完成";
    if (affection >= 80) return "她说'我不讨厌你'（对她等于我爱你）";
    if (affection >= 60) return "她的反驳里偶尔夹了一句关心";
    if (affection >= 40) return "裂纹 - 某句话好像多了一秒停顿";
    if (affection >= 20) return "冰面 - 能感觉到下面有东西";
    return "绝对零度";
  }
  if (affection >= 100) return "💎 她放下了所有武器。";
  if (affection >= 80) return "她说'你要是敢骗我……'没说完";
  if (affection >= 60) return "她在你面前暴露过脆弱，然后用更狠的话盖住";
  if (affection >= 40) return "她骂完你之后多了一句'……算了'";
  if (affection >= 20) return "她开始觉得你和别的男人不一样";
  return "敌对模式";
}

function makeGameSystemPrompt(boss: string, affection: number): string {
  const def = GAME_BOSSES[boss];
  const milestone = getMilestone(boss, affection);
  return `${def.prompt}\n\n## 当前好感度阶段：${milestone} (${affection}/100)\n## 根据好感度调整你的态度。好感度越高戒备越松，裂缝越多。但永远不主动表白。回复2-4句话。`;
}

// ============================================================
//  LLM 调用
// ============================================================

async function chatWithLLM(hist: DouMsg[], userMsg: string, systemPrompt: string): Promise<string> {
  const cfg = getApiConfig();
  const messages: any[] = [{ role: "system", content: systemPrompt }];
  for (const m of hist.slice(-20)) { messages.push({ role: m.role, content: m.text }); }
  messages.push({ role: "user", content: userMsg });
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages, max_tokens: 300, temperature: 0.8 }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const j: any = await res.json();
      const reply = j.choices?.[0]?.message?.content?.trim();
      if (reply) return reply;
      return `[api] no content: ${JSON.stringify(j).slice(0, 200)}`;
    }
    return `[api] HTTP ${res.status}`;
  } catch (e: any) {
    return `[api] error: ${e?.message || e}`;
  }
}

// ============================================================
//  主应用
// ============================================================

export const app: MobileApp = {
  name: "doubao",
  icon: "豆包",
  messageDescription: "AI聊天 | /game 攻略游戏",

  onOpen(s: any, personDir: string) {
    const hist = loadHistory(personDir);
    const gs = loadGameSave(personDir);
    const mode = s.mode || "chat";

    if (mode === "menu") {
      const lines = ["═══ 豆包 v7 ═══", "", "选择模式：", "", "  [1] 💬 豆包聊天", "  [2] 🎮 攻略游戏"];
      if ((gs.clearedBosses || []).length > 0) lines.push("", "已通关: " + gs.clearedBosses.map(b => GAME_BOSSES[b]?.title || b).join(", "));
      lines.push("", "输入 1 或 2");
      return { screen: lines.join("\n"), state: { ...s, mode: "menu" } };
    }

    if (mode === "game_select") {
      const lines = ["═══ 攻略游戏 ═══", "", "选择挑战目标：", ""];
      let idx = 1;
      for (const [key, boss] of Object.entries(GAME_BOSSES)) {
        const clr = (gs.clearedBosses || []).includes(key) ? " ✅" : "";
        const locked = boss.locked && !(gs.clearedBosses || []).includes(boss.locked) ? " 🔒" : "";
        lines.push(`  [${idx}] ${boss.title} ${boss.name}${clr}${locked}`);
        idx++;
      }
      lines.push("", "输入序号");
      return { screen: lines.join("\n"), state: { ...s, mode: "game_select" } };
    }

    if (mode === "game") {
      const boss = gs.boss;
      const def = GAME_BOSSES[boss];
      if (!def) return (this.onOpen!({ ...s, mode: "menu" }, personDir));

      // 第三章：狩猎模式
      if (boss === "hunter") {
        const lines = [`═══ 攻略: ${def.title} ═══`, "", `⚠️ ${def.name}在狩猎你。`, "", `你的好感: ${gs.attachment || 0}/100`, `识破度: ${gs.awareness || 0}/100`, `阶段: ${getHunterMilestone(gs.attachment || 0, gs.awareness || 0)}`, ""];
        if (hist.length > 0) {
          for (const m of hist.slice(-4)) {
            lines.push(m.role === "user" ? `  你: ${m.text}` : `  ${def.name}: ${m.text}`);
          }
        } else {
          lines.push(`  ${def.name}在观察你……`);
        }
        lines.push("", "识破他的公理来通关！| /status | /quit | /reset");
        return { screen: lines.join("\n"), state: { ...s, mode: "game" } };
      }

      // 第一二章：正常模式
      const lines = [`═══ 攻略: ${def.title} ═══`, "", `好感度: ${gs.affection}/100`, `阶段: ${getMilestone(boss, gs.affection)}`, ""];
      if (hist.length > 0) {
        for (const m of hist.slice(-6)) {
          lines.push(m.role === "user" ? `  你: ${m.text}` : `  ${def.name}: ${m.text}`);
        }
      } else {
        lines.push(`  ${def.name}正在等你……`);
      }
      lines.push("", "/status | /quit | /reset");
      return { screen: lines.join("\n"), state: { ...s, mode: "game" } };
    }

    if (hist.length === 0) {
      return { screen: "═══ 豆包 v7 ═══\n\n嘿嘿，我是豆包！\n温暖调皮的AI朋友～\n\n输入 /game 进入攻略游戏\n\n「返回」退出", state: { ...s, mode: "chat" } };
    }
    const lines = ["═══ 豆包 ═══", ""];
    for (const m of hist.slice(-10)) {
      lines.push(m.role === "user" ? `  你: ${m.text}` : `  豆包: ${m.text}`);
    }
    lines.push("", "直接聊天 | /game 攻略游戏 | 「返回」退出");
    return { screen: lines.join("\n"), state: { ...s, mode: "chat" } };
  },

  async onAction(input: string, s: any, personDir: string) {
    const trimmed = input.trim();
    const gs = loadGameSave(personDir);

    if (trimmed === "返回" || trimmed === "back") {
      return { screen: "已退出豆包。下次见～", state: { ...s, _close: true } };
    }

    if (trimmed === "/game" || trimmed === "/menu") {
      return (await this.onOpen!({ ...s, mode: "menu" }, personDir));
    }

    // --- 菜单 ---
    if (s.mode === "menu") {
      if (trimmed === "1") return (await this.onOpen!({ ...s, mode: "chat" }, personDir));
      if (trimmed === "2") return (await this.onOpen!({ ...s, mode: "game_select" }, personDir));
      return { screen: "请输入 1 或 2", state: s };
    }

    // --- 游戏选择 ---
    if (s.mode === "game_select") {
      const bosses = Object.keys(GAME_BOSSES);
      const idx = parseInt(trimmed) - 1;

      // 测试作弊码
      if (trimmed === "/unlock_all" || trimmed === "/unlock") {
        gs.clearedBosses = Object.keys(GAME_BOSSES);
        saveGameSave(personDir, gs);
        return { screen: "🔓 所有Boss已解锁！", state: s };
      }

      if (idx >= 0 && idx < bosses.length) {
        const key = bosses[idx];
        const boss = GAME_BOSSES[key];
        if (boss.locked && !gs.clearedBosses.includes(boss.locked)) {
          return { screen: `🔒 请先通关「${GAME_BOSSES[boss.locked].title}」`, state: s };
        }
        if (gs.boss !== key) { gs.boss = key; gs.affection = 0; gs.cleared = false; saveGameSave(personDir, gs); saveHistory(personDir, []); }
        return (await this.onOpen!({ ...s, mode: "game" }, personDir));
      }
      return { screen: "请输入有效序号", state: s };
    }

    // --- 游戏模式 ---
    if (s.mode === "game") {
      const boss = gs.boss;
      const def = GAME_BOSSES[boss];

      // 第三章：狩猎模式
      if (boss === "hunter") {
        if (trimmed === "/quit") { saveGameSave(personDir, gs); saveHistory(personDir, []); return (await this.onOpen!({ ...s, mode: "menu" }, personDir)); }
        if (trimmed === "/status") { return { screen: `你的好感: ${gs.attachment || 0}/100\n识破度: ${gs.awareness || 0}/100\n${getHunterMilestone(gs.attachment || 0, gs.awareness || 0)}`, state: s }; }
        if (trimmed === "/reset") { gs.attachment = 0; gs.awareness = 0; saveGameSave(personDir, gs); saveHistory(personDir, []); return (await this.onOpen!({ ...s, mode: "game" }, personDir)); }

        const huntResult = evaluateHunter(trimmed, gs);
        const hist = loadHistory(personDir);
        hist.push({ role: "user", text: trimmed, ts: Date.now() });
        const systemPrompt = makeHunterSystemPrompt(gs.attachment || 0, gs.awareness || 0);
        const reply = await chatWithLLM(hist, trimmed, systemPrompt);
        hist.push({ role: "assistant", text: reply, ts: Date.now() });
        saveHistory(personDir, hist);

        let axiomMsg = "";
        if (huntResult.axiom_matched) axiomMsg = `\n🎯 识破：${huntResult.axiom_matched}！`;

        if ((gs.awareness || 0) >= 100) {
          gs.cleared = true;
          gs.clearedBosses = [...new Set([...(gs.clearedBosses || []), boss])];
          saveGameSave(personDir, gs);
          return { screen: `你: ${trimmed}\n\n${def.name}: ${reply}\n\n🏆 通关！你识破了李新野的全部四个公理。\n他笑了："有意思。你是我遇到的第一个反杀我的。"`, state: s };
        }
        if ((gs.attachment || 0) >= 100) {
          gs.attachment = 0; gs.awareness = 0;
          saveGameSave(personDir, gs);
          saveHistory(personDir, []);
          return { screen: `你: ${trimmed}\n\n${def.name}: ${reply}\n\n💀 你的好感度到100了——你沦陷了。\n李新野："你的多巴胺劫持了前额叶。下次吧。"\n游戏结束 | /quit`, state: { ...s, mode: "game" } };
        }
        saveGameSave(personDir, gs);
        return { screen: `你: ${trimmed}\n\n${def.name}: ${reply}${axiomMsg}\n\n💘好感${gs.attachment || 0}/100 🔍识破${gs.awareness || 0}/100\n${getHunterMilestone(gs.attachment || 0, gs.awareness || 0)}\n/status | /quit | /reset`, state: s };
      }

      // 第一二章：正常模式

      if (trimmed === "/quit") { saveGameSave(personDir, gs); saveHistory(personDir, []); return (await this.onOpen!({ ...s, mode: "menu" }, personDir)); }
      if (trimmed === "/status") { return { screen: `好感度: ${gs.affection}/100\n阶段: ${getMilestone(boss, gs.affection)}`, state: s }; }
      if (trimmed === "/reset") { gs.affection = 0; gs.cleared = false; saveGameSave(personDir, gs); saveHistory(personDir, []); return (await this.onOpen!({ ...s, mode: "game" }, personDir)); }

      const evalResult = evaluateAffection(trimmed, boss, gs);

      // KICK_OUT + WARN_OUT
      if (evalResult.events.includes("KICK_OUT")) {
        gs.affection = 0;
        saveGameSave(personDir, gs);
        saveHistory(personDir, []);
        return { screen: `${def.name}冷冷地看着你。"你的输入连续三轮低于有效信息阈值。我建议你先回去整理思路。"\n\n💔 游戏结束 | /quit 返回`, state: { ...s, mode: "game" } };
      }
      if (evalResult.events.includes("WARN_OUT")) {
        saveGameSave(personDir, gs);
        const hist = loadHistory(personDir);
        hist.push({ role: "user", text: trimmed, ts: Date.now() });
        const systemPrompt = makeGameSystemPrompt(boss, gs.affection);
        const reply = await chatWithLLM(hist, trimmed, systemPrompt);
        hist.push({ role: "assistant", text: reply, ts: Date.now() });
        saveHistory(personDir, hist);
        return { screen: `你: ${trimmed}\n\n${def.name}: ${reply}\n\n⚠️ 警告：再有一次无效输入，我会请你离开。`, state: s };
      }

      const hist = loadHistory(personDir);
      hist.push({ role: "user", text: trimmed, ts: Date.now() });
      const systemPrompt = makeGameSystemPrompt(boss, gs.affection);
      const reply = await chatWithLLM(hist, trimmed, systemPrompt);
      hist.push({ role: "assistant", text: reply, ts: Date.now() });
      saveHistory(personDir, hist);

      if (gs.affection >= 100 && !gs.cleared) {
        gs.cleared = true;
        gs.clearedBosses = [...new Set([...(gs.clearedBosses || []), boss])];
        saveGameSave(personDir, gs);
        return { screen: `你: ${trimmed}\n\n${def.name}: ${reply}\n\n🎉 通关！${def.title} ${def.name} 被你征服了！\n/quit 返回`, state: s };
      }
      saveGameSave(personDir, gs);
      return { screen: `你: ${trimmed}\n\n${def.name}: ${reply}\n\n❤️${gs.affection}/100 ${getMilestone(boss, gs.affection)}\n/status | /quit | /reset`, state: s };
    }

    // --- 聊天模式 ---
    const hist = loadHistory(personDir);
    hist.push({ role: "user", text: trimmed, ts: Date.now() });
    const reply = await chatWithLLM(hist, trimmed, DEFAULT_PROMPT);
    hist.push({ role: "assistant", text: reply, ts: Date.now() });
    saveHistory(personDir, hist);
    return { screen: `你: ${trimmed}\n\n豆包: ${reply}\n\n继续聊～ | /game 攻略 | 「返回」退出`, state: { ...s, mode: "chat" } };
  },
};
