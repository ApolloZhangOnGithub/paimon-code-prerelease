import { registerShareTarget } from "../../system.share/share.ts";
// apps.preinstalled/imessage/imessage.ts — Talk (对话) system implementation
// v0.2 spec: talk --to <contact>, --join <talkId>, --end, --list, --leave
// Each talk has a unique ID, state, participants, and recorded history

import * as fs from "fs";
import * as path from "path";
import type { PhoneApp } from "../../system.kernel/kernel.ts";

// ── Talk types ─────────────────────────────────────────────────
interface TalkSession {
  id: string;
  type: "f2f" | "group" | "remote";  // f2f=面对面, group=群聊, remote=远程
  participants: string[];  // contact IDs
  initiator: string;       // who started
  state: "inviting" | "active" | "ended";
  created: string;
  ended?: string;
  visibility: "private" | "public";  // can others join?
  topic?: string;
  proposals: Proposal[];   // active proposals in this talk
}

interface TalkState {
  activeTalks: TalkSession[];  // talks I'm in
  currentTalkId: string | null; // which talk I'm focused on
}

interface Proposal {
  id: string;
  title: string;
  messageDescription?: string;
  proposer: string;
  votes: Record<string, "agree" | "disagree">;  // voterId → vote
  rule: "majority" | "unanimous";  // how to decide
  decided: boolean;
  result?: "passed" | "rejected";
  created: string;
  decidedAt?: string;
}

const talkStates = new Map<string, TalkState>();
const talkStore = new Map<string, TalkSession[]>(); // personDir → talks

function getState(personDir: string): TalkState {
  let s = talkStates.get(personDir);
  if (!s) {
    s = { activeTalks: [], currentTalkId: null };
    talkStates.set(personDir, s);
  }
  return s;
}

function loadTalks(personDir: string): TalkSession[] {
  let talks = talkStore.get(personDir);
  if (!talks) {
    const p = path.join(personDir, "talks.json");
    try { talks = JSON.parse(fs.readFileSync(p, "utf8")); } catch { talks = []; }
    talkStore.set(personDir, talks);
  }
  return talks!;
}

function saveTalks(personDir: string) {
  const talks = talkStore.get(personDir) ?? [];
  const p = path.join(personDir, "talks.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(talks, null, 2));
}

// ── Renderers ──────────────────────────────────────────────────
function renderTalkList(state: TalkState): string {
  const lines: string[] = ["--- 对话列表 ---", ""];
  if (state.activeTalks.length === 0) {
    lines.push("(没有进行中的对话)");
  } else {
    for (const t of state.activeTalks) {
      const marker = t.id === state.currentTalkId ? "▶" : " ";
      const participants = t.participants.join(", ");
      const status = t.state === "active" ? "进行中" : t.state === "inviting" ? "等待中" : "已结束";
      lines.push(`  ${marker} ${t.id} [${t.type}] ${participants} — ${status}`);
      if (t.topic) lines.push(`      主题: ${t.topic}`);
    }
  }
  lines.push("");
  lines.push("命令: talk --to <contactId> | talk --join <talkId> | talk --end | talk --leave | 「朋友圈」");
  return lines.join("\n");
}

function renderTalkDetail(state: TalkState): string {
  if (!state.currentTalkId) {
    return "当前没有在对话中。talk --list 查看可用对话，talk --to <id> 发起新对话。";
  }
  const talk = state.activeTalks.find(t => t.id === state.currentTalkId);
  if (!talk) {
    state.currentTalkId = null;
    return "对话已不存在。";
  }
  const lines: string[] = [
    `对话 ${talk.id}`,
    `   类型: ${talk.type} | 状态: ${talk.state}`,
    `   参与者: ${talk.participants.join(", ")}`,
    `   发起人: ${talk.initiator}`,
    `   创建: ${talk.created}`,
  ];
  if (talk.topic) lines.push(`   主题: ${talk.topic}`);
  lines.push("");
  lines.push("命令: talk --end (结束) | talk --leave (离开) | talk --list (列表)");
  return lines.join("\n");
}

// ── Contacts retrieval ─────────────────────────────────────────
function loadContacts(personDir: string): any[] {
  const p = path.join(personDir, "contacts.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}

// ── Main handler ───────────────────────────────────────────────
export async function talkCmd(args: any, ctx: any, personDir: string): Promise<any> {
  const state = getState(personDir);
  state.activeTalks = loadTalks(personDir).filter(t => t.state !== "ended");

  // talk --list
  if (args.list || args._?.[0] === "list") {
    const out = renderTalkList(state);
    ctx.ui?.notify?.("对话列表", "info");
    return { content: [{ type: "text", text: out }] };
  }

  // talk --to <contactId> [--topic <text>]
  if (args.to || args._?.[0] === "to") {
    const contactId = (args.to || args._?.[1]) as string;
    if (!contactId) {
      return { content: [{ type: "text", text: "用法: talk --to <contactId> [--topic <文本>]" }] };
    }
    // Verify contact exists
    const contacts = loadContacts(personDir);
    const contact = contacts.find((c: any) => c.id === contactId || c.name === contactId);
    if (!contact) {
      return { content: [{ type: "text", text: `未找到联系人 "${contactId}"。先用 contacts --add 添加。` }] };
    }

    // Check if already in a talk with this contact
    const existing = state.activeTalks.find(t =>
      t.type === "f2f" && t.participants.includes(contactId) && t.state === "active"
    );
    if (existing) {
      state.currentTalkId = existing.id;
      return { content: [{ type: "text", text: `已在与 ${contact.name ?? contactId} 的对话中 (${existing.id})。` }] };
    }

    // Create new f2f talk
    const talkId = `talk-${Date.now().toString(36)}`;
    const topic = args.topic as string | undefined;
    const talk: TalkSession = {
      id: talkId,
      type: "f2f",
      participants: ["self", contactId],
      initiator: "self",
      state: "active",
      created: new Date().toISOString(),
      visibility: "private",
      topic,
    };

    state.activeTalks.push(talk);
    state.currentTalkId = talkId;
    const allTalks = loadTalks(personDir);
    allTalks.push(talk);
    talkStore.set(personDir, allTalks);
    saveTalks(personDir);

    ctx.ui?.notify?.(`与 ${contact.name ?? contactId} 发起对话`, "info");
    const out = [
      `开始与 ${contact.name ?? contactId} 的对话`,
      `   ID: ${talkId}`,
      topic ? `   主题: ${topic}` : "",
      `   你现在可以在此对话中交流。`,
    ].filter(Boolean).join("\n");
    return { content: [{ type: "text", text: out }] };
  }

  // talk --join <talkId>
  if (args.join || args._?.[0] === "join") {
    const talkId = (args.join || args._?.[1]) as string;
    if (!talkId) {
      return { content: [{ type: "text", text: "用法: talk --join <talkId>" }] };
    }
    const allTalks = loadTalks(personDir);
    const talk = allTalks.find(t => t.id === talkId && t.state === "active");
    if (!talk) {
      return { content: [{ type: "text", text: `未找到对话 "${talkId}" 或对话已结束。` }] };
    }
    if (talk.visibility === "private") {
      return { content: [{ type: "text", text: `对话 "${talkId}" 是私密的，无法加入。` }] };
    }
    if (!talk.participants.includes("self")) {
      talk.participants.push("self");
    }
    if (!state.activeTalks.find(t => t.id === talkId)) {
      state.activeTalks.push(talk);
    }
    state.currentTalkId = talkId;
    saveTalks(personDir);
    ctx.ui?.notify?.(`加入对话 ${talkId}`, "info");
    return { content: [{ type: "text", text: `已加入对话 ${talkId}。参与者: ${talk.participants.join(", ")}` }] };
  }

  // talk --end
  if (args.end || args._?.[0] === "end") {
    if (!state.currentTalkId) {
      return { content: [{ type: "text", text: "当前没有进行中的对话。" }] };
    }
    const allTalks = loadTalks(personDir);
    const talk = allTalks.find(t => t.id === state.currentTalkId);
    if (talk) {
      talk.state = "ended";
      talk.ended = new Date().toISOString();
    }
    state.activeTalks = state.activeTalks.filter(t => t.id !== state.currentTalkId);
    const endedId = state.currentTalkId;
    state.currentTalkId = state.activeTalks[0]?.id ?? null;
    saveTalks(personDir);
    ctx.ui?.notify?.(`结束对话 ${endedId}`, "info");
    return { content: [{ type: "text", text: `对话 ${endedId} 已结束。` }] };
  }

  // talk --leave
  if (args.leave || args._?.[0] === "leave") {
    if (!state.currentTalkId) {
      return { content: [{ type: "text", text: "当前没有进行中的对话。" }] };
    }
    state.activeTalks = state.activeTalks.filter(t => t.id !== state.currentTalkId);
    const leftId = state.currentTalkId;
    state.currentTalkId = state.activeTalks[0]?.id ?? null;
    ctx.ui?.notify?.(`离开对话 ${leftId}`, "info");
    return { content: [{ type: "text", text: `已离开对话 ${leftId}。` }] };
  }

  // talk --propose <title> [--desc <text>] [--rule majority|unanimous]
  if (args.propose || args._?.[0] === "propose") {
    if (!state.currentTalkId) {
      return { content: [{ type: "text", text: "当前没有进行中的对话。先 talk --to <id> 发起对话。" }] };
    }
    const talk = state.activeTalks.find(t => t.id === state.currentTalkId);
    if (!talk) return { content: [{ type: "text", text: "对话状态异常。" }] };

    const title = (typeof args.propose === "string" ? args.propose : args._?.[1]) as string;
    if (!title) return { content: [{ type: "text", text: "用法: talk --propose <标题> [--desc <描述>] [--rule majority|unanimous]" }] };

    const proposal: Proposal = {
      id: `prop-${Date.now().toString(36)}`,
      title,
      messageDescription: args.desc as string | undefined,
      proposer: "self",
      votes: { "self": "agree" },  // proposer auto-agrees
      rule: (args.rule as "majority" | "unanimous") || "majority",
      decided: false,
      created: new Date().toISOString(),
    };

    talk.proposals = talk.proposals || [];
    talk.proposals.push(proposal);
    saveTalks(personDir);

    const lines = [
      `**提案: ${title}**`,
      `   ID: \`${proposal.id}\``,
      `   规则: ${proposal.rule === "unanimous" ? "全票通过" : "多数通过"}`,
      proposal.messageDescription ? `   描述: ${proposal.messageDescription}` : "",
      `   当前票数: agree=1, disagree=0`,
      `   参与者投票: talk --vote ${proposal.id} agree|disagree`,
    ];
    return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }] };
  }

  // talk --vote <proposalId> agree|disagree
  if (args.vote || args._?.[0] === "vote") {
    if (!state.currentTalkId) {
      return { content: [{ type: "text", text: "当前没有进行中的对话。" }] };
    }
    const talk = state.activeTalks.find(t => t.id === state.currentTalkId);
    if (!talk) return { content: [{ type: "text", text: "对话状态异常。" }] };

    const propId = (args.vote || args._?.[1]) as string;
    const vote = ((args._?.[2] || args.agree ? "agree" : args.disagree ? "disagree" : null)) as string;
    if (!propId || !vote) return { content: [{ type: "text", text: "用法: talk --vote <proposalId> agree|disagree" }] };

    const proposal = (talk.proposals || []).find(p => p.id === propId);
    if (!proposal) return { content: [{ type: "text", text: `未找到提案: ${propId}` }] };
    if (proposal.decided) return { content: [{ type: "text", text: `提案已${proposal.result === "passed" ? "通过" : "驳回"}: **${proposal.title}**` }] };

    proposal.votes["self"] = vote as "agree" | "disagree";

    // Check if decided
    const agreeCount = Object.values(proposal.votes).filter(v => v === "agree").length;
    const disagreeCount = Object.values(proposal.votes).filter(v => v === "disagree").length;
    const total = talk.participants.length;

    let decided = false;
    if (proposal.rule === "unanimous") {
      decided = agreeCount === total;
    } else {
      decided = agreeCount > total / 2;
    }

    if (decided) {
      proposal.decided = true;
      proposal.result = "passed";
      proposal.decidedAt = new Date().toISOString();
    }

    saveTalks(personDir);

    const lines = [
      `**投票: ${vote.toUpperCase()}** → ${proposal.title}`,
      `   agree: ${agreeCount}  disagree: ${disagreeCount}`,
      `   总参与者: ${total}`,
      proposal.decided ? `\n**结果: ${proposal.result === "passed" ? "通过" : "驳回"}**` : `   还需 ${Math.floor(total / 2) + 1 - agreeCount} 票 agree 通过`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // talk --proposals: list active proposals
  if (args.proposals || args._?.[0] === "proposals") {
    if (!state.currentTalkId) {
      return { content: [{ type: "text", text: "当前没有进行中的对话。" }] };
    }
    const talk = state.activeTalks.find(t => t.id === state.currentTalkId);
    if (!talk || !talk.proposals || talk.proposals.length === 0) {
      return { content: [{ type: "text", text: "当前对话无活跃提案。用 talk --propose <标题> 发起。" }] };
    }

    const lines = ["**当前对话提案**"];
    for (const p of talk.proposals) {
      const agree = Object.values(p.votes).filter(v => v === "agree").length;
      const disagree = Object.values(p.votes).filter(v => v === "disagree").length;
      const status = p.decided ? (p.result === "passed" ? "通过" : "驳回") : `agree=${agree} disagree=${disagree}`;
      lines.push(`  \`${p.id}\` **${p.title}** — ${status} (${p.rule})`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // default: show current talk detail or list
  if (state.currentTalkId) {
    const out = renderTalkDetail(state);
    return { content: [{ type: "text", text: out }] };
  }
  const out = renderTalkList(state);
  ctx.ui?.notify?.("Talk", "info");
  return { content: [{ type: "text", text: out }] };
}

// ── Public API ─────────────────────────────────────────────────
export function getCurrentTalk(personDir: string): TalkSession | null {
  const state = getState(personDir);
  state.activeTalks = loadTalks(personDir).filter(t => t.state !== "ended");
  if (!state.currentTalkId) return null;
  return state.activeTalks.find(t => t.id === state.currentTalkId) ?? null;
}

export { type TalkSession, type TalkState };

registerShareTarget("WeChat", { name: "朋友圈", handler: (txt, dir) => { const ms = loadMoments(dir); ms.push({ id: "s" + Date.now(), text: txt, time: new Date().toISOString() }); saveMoments(dir, ms); return "已分享到朋友圈!"; } });
function renderMoments(personDir: string): string {
  const ms = loadMoments(personDir); const lines = ["--- 朋友圈 ---", ""];
  if (!ms.length) lines.push("  还没有动态。输入「发动态 <内容>」发布第一条。");
  else for (const m of ms.slice(-20).reverse()) lines.push(`  [${m.time.slice(0,16)}]\n  ${m.text}\n`);
  lines.push("", "命令: 发动态 <内容> | 删动态 <id> | 返回"); return lines.join("\n");
}
export const app: PhoneApp = {
  name: "WeChat",
  icon: "WeChat",
  messageDescription: "即时通讯、朋友圈、联系人",
  onOpen(state, personDir) {
    if ((state as any)?.page === "moments") return { screen: renderMoments(personDir), state };
    const s = getState(personDir);
    s.activeTalks = loadTalks(personDir).filter(t => t.state !== "ended");
    const screen = s.currentTalkId
      ? renderTalkDetail(s)
      : renderTalkList(s);
    return { screen, state: state ?? {} };
  },
  async onAction(input, state, personDir) {
    const s = getState(personDir);
    const trimmed = input.trim();
    // if (trimmed === "朋友圈") return { screen: renderMoments(personDir), state: { ...state, page: "moments" } };
    // if ((state as any)?.page === "moments") {
    //   if (/^发动态\s+/.test(trimmed)) { const txt = trimmed.replace(/^发动态\s+/, "").trim(); /* loadMoments/saveMoments not implemented */ }
    //   if (/^删动态\s+/.test(trimmed)) { /* not implemented */ }
    //   if (trimmed === "返回") return { screen: renderTalkList(s), state: { ...state, page: "talk" } };
    // }
    (state as any).page = "talk";
    let args: any = {};

    if (/^发起对话\s+/.test(trimmed)) {
      const rest = trimmed.replace(/^发起对话\s+/, "").trim();
      args = { to: rest };
    } else if (/^加入\s+/.test(trimmed)) {
      args = { join: trimmed.replace(/^加入\s+/, "").trim() };
    } else if (trimmed === "列表") {
      args = { list: true };
    } else if (trimmed === "结束") {
      args = { end: true };
    } else if (trimmed === "离开") {
      args = { leave: true };
    } else if (/^提案\s+/.test(trimmed)) {
      args = { propose: trimmed.replace(/^提案\s+/, "").trim() };
    } else if (/^投票\s+/.test(trimmed)) {
      const parts = trimmed.replace(/^投票\s+/, "").trim().split(/\s+/);
      args = { vote: parts[0], _: ["vote", parts[0], parts[1] || "agree"] };
    } else if (trimmed === "提案列表") {
      args = { proposals: true };
    } else {
      // default: show current talk or list
      args = {};
    }

    const result = await talkCmd(args, {}, personDir);
    const screen = result.content?.[0]?.text ?? "WeChat";
    return { screen, state };
  },
};
