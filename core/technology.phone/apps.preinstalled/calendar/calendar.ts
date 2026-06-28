// apps.preinstalled/calendar/calendar.ts — Calendar app
// v0.2 spec: 日历 — 日程管理、提醒、查询
// "记录、查看、会有提醒日程等"
// v0.3: 集成节假日日历 (根据 Settings 地区自动加载)

import * as fs from "fs";
import * as path from "path";
import { getRegion, getHolidaysForDate, getHolidaysForRange, solarToLunar, type Holiday } from "./holiday-calendar.ts";

// ── Event types ─────────────────────────────────────────────────
interface CalendarEvent {
  id: string;
  title: string;
  messageDescription?: string;
  start: string;         // ISO timestamp
  end?: string;          // ISO timestamp (null = point-in-time)
  allDay: boolean;
  location?: string;
  recurring?: {          // simple recurrence
    rule: "daily" | "weekly" | "monthly" | "yearly";
    interval: number;    // every N days/weeks/months/years
    until?: string;      // ISO end date
  };
  reminders: number[];   // minutes before event to remind
  tags: string[];
  created: string;
  updated: string;
}

// ── Storage ─────────────────────────────────────────────────────
function eventsPath(personDir: string) {
  return path.join(personDir, "calendar.json");
}

function loadEvents(personDir: string): CalendarEvent[] {
  try {
    return JSON.parse(fs.readFileSync(eventsPath(personDir), "utf8"));
  } catch {
    return [];
  }
}

function saveEvents(personDir: string, events: CalendarEvent[]) {
  fs.writeFileSync(eventsPath(personDir), JSON.stringify(events, null, 2));
}

function genId(): string {
  return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Time helpers ────────────────────────────────────────────────
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayStart(date: string): Date {
  return new Date(date + "T00:00:00");
}

function dayEnd(date: string): Date {
  return new Date(date + "T23:59:59");
}

function eventsOnDay(events: CalendarEvent[], date: string): CalendarEvent[] {
  const start = dayStart(date);
  const end = dayEnd(date);
  return events.filter(e => {
    const eStart = new Date(e.start);
    const eEnd = e.end ? new Date(e.end) : eStart;
    return eStart <= end && eEnd >= start;
  }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

function upcomingEvents(events: CalendarEvent[], days = 7): CalendarEvent[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return events.filter(e => {
    const eStart = new Date(e.start);
    return eStart >= now && eStart <= cutoff;
  }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

// ── Render ──────────────────────────────────────────────────────
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", weekday: "short" });
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatLunarDate(date: string): string {
  const lunar = solarToLunar(date);
  return lunar ? `农历${lunar.monthName}月${lunar.dayName}` : "";
}

function renderHoliday(h: Holiday): string {
  const lunarStr = h.lunar ? ` (${h.lunar})` : "";
  return `  ${h.emoji} **${h.name}**${lunarStr} — 节假日`;
}

function renderEvent(e: CalendarEvent, showDate = true): string {
  const timeStr = e.allDay
    ? "全天"
    : e.end
      ? `${formatTime(e.start)}–${formatTime(e.end)}`
      : formatTime(e.start);
  const dateStr = showDate ? `${formatDate(e.start)} ` : "";
  const descStr = e.messageDescription ? `\n    ${e.messageDescription.slice(0, 100)}` : "";
  const locStr = e.location ? ` · ${e.location}` : "";
  const recurStr = e.recurring ? ` · ${e.recurring.rule}` : "";
  const remindStr = (e.reminders && e.reminders.length > 0) ? ` · ${e.reminders.join(",")}min` : "";
  const tagsStr = (e.tags && e.tags.length > 0) ? ` · ${e.tags.join(",")}` : "";

  return `${dateStr}**${e.title}**\n   ${timeStr}${locStr}${recurStr}${remindStr}${tagsStr}${descStr}`;
}

function groupByMonth(holidays: Holiday[], region: Region): string {
  const grouped: Record<string, Holiday[]> = {};
  for (const h of holidays) {
    const m = h.date.slice(0, 7);
    (grouped[m] ??= []).push(h);
  }
  const lines: string[] = [];
  const regionLabel = region === "US" ? "美国" : "中国";
  lines.push(`**节假日日历 · ${regionLabel}**`);
  for (const [month, items] of Object.entries(grouped).sort()) {
    const d = new Date(month + "-01");
    const label = d.toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
    lines.push(`\n**${label}**`);
    for (const h of items) {
      const day = parseInt(h.date.slice(8, 10));
      const wd = new Date(h.date + "T00:00:00").toLocaleDateString("zh-CN", { weekday: "short" });
      const lunarStr = h.lunar ? ` (${h.lunar})` : "";
      lines.push(`  ${h.emoji} ${day}日 ${wd} · **${h.name}**${lunarStr}`);
    }
  }
  return lines.join("\n");
}

// ── Main handler ───────────────────────────────────────────────
export async function calendarCmd(args: any, _ctx: any, personDir: string): Promise<any> {
  const events = loadEvents(personDir);
  const region = getRegion(personDir);

  // --add: create event
  if (args.add) {
    const title = typeof args.add === "string" ? args.add : args._?.[1];
    if (!title) return { content: [{ type: "text", text: "Usage: calendar --add <title> [--start <ISO>] [--end <ISO>] [--all-day] [--desc <text>] [--location <text>] [--remind <minutes>]" }] };

    const event: CalendarEvent = {
      id: genId(),
      title,
      messageDescription: args.desc as string | undefined,
      start: (args.start as string) || new Date().toISOString(),
      end: args.end as string | undefined,
      allDay: !!args["all-day"] || !!args.allDay,
      location: args.location as string | undefined,
      reminders: args.remind ? [parseInt(args.remind as string) || 15] : [15],
      tags: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    events.push(event);
    saveEvents(personDir, events);
    return { content: [{ type: "text", text: `Event created:\n${renderEvent(event)}` }] };
  }

  // --today: today's events + holidays
  if (args.today) {
    const td = today();
    const todaysEvents = eventsOnDay(events, td);
    const todaysHolidays = getHolidaysForDate(region, td);
    const lunarToday = formatLunarDate(td);
    const lines = [`**Today — ${formatDate(td)}**${lunarToday ? ` · ${lunarToday}` : ""}`];
    if (todaysHolidays.length > 0) {
      todaysHolidays.forEach(h => lines.push(renderHoliday(h)));
    }
    if (todaysEvents.length === 0 && todaysHolidays.length === 0) {
      lines.push("  No events today.");
    } else if (todaysEvents.length > 0) {
      lines.push(todaysHolidays.length > 0 ? "" : "");
      todaysEvents.forEach(e => lines.push(renderEvent(e, false)));
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // --upcoming: next N days + holidays
  if (args.upcoming) {
    const days = parseInt(args.upcoming as string) || 7;
    const upcoming = upcomingEvents(events, days);
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const upcomingHolidays = getHolidaysForRange(region, now.toISOString().slice(0, 10), cutoff.toISOString().slice(0, 10));
    const lines = [`**Upcoming (${days} days)**`];
    if (upcomingHolidays.length > 0) {
      upcomingHolidays.forEach(h => lines.push(`  ${h.emoji} ${formatDateShort(h.date)} · **${h.name}**${h.lunar ? ` (${h.lunar})` : ""}`));
      if (upcoming.length > 0) lines.push("");
    }
    if (upcoming.length === 0 && upcomingHolidays.length === 0) {
      lines.push("  No upcoming events.");
    } else {
      upcoming.forEach(e => lines.push(renderEvent(e)));
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // --date <YYYY-MM-DD>: specific date + holidays
  if (args.date) {
    const date = args.date as string;
    const dayEvents = eventsOnDay(events, date);
    const dayHolidays = getHolidaysForDate(region, date);
    const lunarDate = formatLunarDate(date);
    const lines = [`**${formatDate(date + "T00:00:00")}**${lunarDate ? ` · ${lunarDate}` : ""}`];
    if (dayHolidays.length > 0) {
      dayHolidays.forEach(h => lines.push(renderHoliday(h)));
      if (dayEvents.length > 0) lines.push("");
    }
    if (dayEvents.length === 0 && dayHolidays.length === 0) {
      lines.push("  No events.");
    } else {
      dayEvents.forEach(e => lines.push(renderEvent(e, false)));
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // --show <id>: detail
  if (args.show) {
    const id = args.show as string;
    const e = events.find(x => x.id === id);
    if (!e) return { content: [{ type: "text", text: `Event not found: ${id}` }] };
    return { content: [{ type: "text", text: renderEvent(e) + `\n  ID: \`${e.id}\`\n  Created: ${e.created.slice(0, 16)}` }] };
  }

  // --delete <id>
  if (args.delete) {
    const id = args.delete as string;
    const idx = events.findIndex(x => x.id === id);
    if (idx === -1) return { content: [{ type: "text", text: `Event not found: ${id}` }] };

    const title = events[idx].title;
    events.splice(idx, 1);
    saveEvents(personDir, events);
    return { content: [{ type: "text", text: `Deleted: **${title}**` }] };
  }

  // --search <q>: search events + holidays
  if (args.search) {
    const q = (args.search as string).toLowerCase();
    const results = events.filter(e =>
      e.title.toLowerCase().includes(q) ||
      (e.messageDescription && e.messageDescription.toLowerCase().includes(q)) ||
      (e.location && e.location.toLowerCase().includes(q)) ||
      (e.tags && e.tags.some((t: string) => t.toLowerCase().includes(q)))
    ).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // Also search holidays
    const year = parseInt(today().slice(0, 4));
    const allHolidays = getHolidaysForRange(region, `${year}-01-01`, `${year + 1}-12-31`);
    const holidayResults = allHolidays.filter(h => h.name.toLowerCase().includes(q));

    if (results.length === 0 && holidayResults.length === 0) return { content: [{ type: "text", text: `No events matching "${args.search}".` }] };
    const total = results.length + holidayResults.length;
    const lines = [`**Search: "${args.search}" (${total})**`];
    if (holidayResults.length > 0) {
      holidayResults.forEach(h => lines.push(`  ${h.emoji} ${formatDateShort(h.date)} · **${h.name}**${h.lunar ? ` (${h.lunar})` : ""}`));
    }
    results.forEach(e => lines.push(renderEvent(e)));
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // --holidays: show all holidays for current region
  if (args.holidays) {
    const year = parseInt(args.holidays as string) || parseInt(today().slice(0, 4));
    const all = getHolidaysForRange(region, `${year}-01-01`, `${year}-12-31`);
    return { content: [{ type: "text", text: groupByMonth(all, region) }] };
  }

  // default: overview — today + upcoming + holidays
  const td = today();
  const todaysEvents = eventsOnDay(events, td);
  const todaysHolidays = getHolidaysForDate(region, td);
  const upcoming = upcomingEvents(events, 7);
  const regionLabel = region === "US" ? "美国" : "中国";

  const lines = [`**Calendar** — ${formatDate(td + "T00:00:00")} · ${regionLabel}`];

  // Today's holidays
  if (todaysHolidays.length > 0) {
    lines.push(`\n**今日节日:**`);
    todaysHolidays.forEach(h => lines.push(renderHoliday(h)));
  }

  // Today's events
  if (todaysEvents.length > 0) {
    lines.push(`\n**今日日程 (${todaysEvents.length}):**`);
    todaysEvents.forEach(e => lines.push(renderEvent(e, false)));
  } else if (todaysHolidays.length === 0) {
    lines.push("\n今日无日程");
  }

  // Upcoming holidays (next 7 days)
  const now = new Date();
  const cutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingHolidays = getHolidaysForRange(region, now.toISOString().slice(0, 10), cutoff.toISOString().slice(0, 10))
    .filter(h => h.date !== td);
  if (upcomingHolidays.length > 0) {
    lines.push(`\n**近期节日:**`);
    upcomingHolidays.forEach(h => lines.push(`  ${h.emoji} ${formatDateShort(h.date)} · **${h.name}**${h.lunar ? ` (${h.lunar})` : ""}`));
  }

  // Upcoming events
  if (upcoming.length > 0) {
    lines.push(`\n**未来7天日程:**`);
    upcoming.forEach(e => lines.push(renderEvent(e)));
  }

  lines.push(`\n操作: 今天 | 未来 | 日期 YYYY-MM-DD | 节日 | 搜索 <词> | 添加 <标题> | 详情 <id> | 删除 <id>`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export { type CalendarEvent, loadEvents, eventsOnDay, upcomingEvents };

// ── PhoneApp wrapper ──────────────────────────────────────────
import type { PhoneApp } from "../../system.kernel/kernel.ts";

export const app: PhoneApp = {
  name: "日历",
  icon: "日历",
  messageDescription: "日程管理、查询、提醒",

  onOpen(state, personDir) {
    const events = loadEvents(personDir);
    const region = getRegion(personDir);
    const regionLabel = region === "US" ? "美国" : "中国";
    const td = today();
    const todaysEvents = eventsOnDay(events, td);
    const todaysHolidays = getHolidaysForDate(region, td);
    const upcoming = upcomingEvents(events, 7);

    const lunarTodayStr = formatLunarDate(td);
    const lines = [
      "═══ 日历 ═══",
      "",
      `  今天: ${formatDate(td + "T00:00:00")}${lunarTodayStr ? ` · ${lunarTodayStr}` : ""}`,
      `  地区: ${regionLabel} (去设置切换)`,
      `  今日日程: ${todaysEvents.length} 件`,
      todaysHolidays.length > 0 ? `  今日节日: ${todaysHolidays.map(h => h.name).join(", ")}` : "",
      `  未来7天: ${upcoming.length} 件`,
      "",
      "  操作:",
      "  · 今天           — 查看今日日程+节日",
      "  · 未来           — 查看未来7天",
      "  · 日期 YYYY-MM-DD — 查看指定日期",
      "  · 节日 [年]     — 查看全年节假日",
      "  · 添加 <标题>   — 创建日程",
      "  · 搜索 <关键词> — 搜索日程和节日",
      "  · 详情 <id>     — 查看日程详情",
      "  · 删除 <id>     — 删除日程",
      "",
      "  返回 — 回主屏幕",
    ].filter(l => l !== "");
    return { screen: lines.join("\n"), state: state ?? {} };
  },

  async onAction(input, state, personDir) {
    const trimmed = input.trim();
    let args: any = {};

    if (/^(今天|today)$/i.test(trimmed)) {
      args = { today: true };
    } else if (/^(未来|upcoming)(\s+(\d+))?$/i.test(trimmed)) {
      const m = trimmed.match(/(\d+)/);
      args = { upcoming: m ? m[1] : "7" };
    } else if (/^日期\s+(\d{4}-\d{2}-\d{2})$/.test(trimmed)) {
      args = { date: trimmed.match(/(\d{4}-\d{2}-\d{2})/)![1] };
    } else if (/^节日(\s+(\d{4}))?$/.test(trimmed)) {
      const m = trimmed.match(/(\d{4})/);
      args = { holidays: m ? m[1] : String(new Date().getFullYear()) };
    } else if (/^(添加|add)\s+(.+)$/i.test(trimmed)) {
      const m = trimmed.match(/^(?:添加|add)\s+(.+)$/i)!;
      args = { add: m[1] };
    } else if (/^(搜索|search)\s+(.+)$/i.test(trimmed)) {
      const m = trimmed.match(/^(?:搜索|search)\s+(.+)$/i)!;
      args = { search: m[1] };
    } else if (/^(详情|show)\s+(.+)$/i.test(trimmed)) {
      const m = trimmed.match(/^(?:详情|show)\s+(.+)$/i)!;
      args = { show: m[1] };
    } else if (/^(删除|delete)\s+(.+)$/i.test(trimmed)) {
      const m = trimmed.match(/^(?:删除|delete)\s+(.+)$/i)!;
      args = { delete: m[1] };
    }
    // default: show overview

    const result = await calendarCmd(args, {}, personDir);
    return { screen: result.content[0].text, state: state ?? {} };
  },
};
