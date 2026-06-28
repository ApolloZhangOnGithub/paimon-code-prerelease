// system.notifications/notifications.ts — 手机统一通知管线
// 任何 app 调 schedule/push，kernel 到时间自动 steer 打断主意识

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface Notification {
  id: string;
  app: string;
  title: string;
  body: string;
  ts: number;
}

interface ScheduledNotification extends Notification {
  fireAt: number;
  timer: ReturnType<typeof setTimeout>;
}

let pi: ExtensionAPI | null = null;
const pending: Notification[] = [];
const scheduled: Map<string, ScheduledNotification> = new Map();
let idCounter = 0;

export function initNotifications(piInstance: ExtensionAPI) {
  pi = piInstance;
}

// 立即推送——steer 打断主意识
export function push(app: string, title: string, body: string) {
  const n: Notification = { id: `notif-${++idCounter}`, app, title, body, ts: Date.now() };
  pending.push(n);
  if (pending.length > 100) pending.shift();

  if (!pi) return;
  try {
    pi.sendMessage(
      { messageType: "phone-notification", content: `${app}: ${title}\n${body}`, display: true },
      { deliverAs: "steer", isTriggerNewTurn: true }
    );
  } catch {}
}

// 定时推送——到时间自动 steer
export function schedule(app: string, title: string, body: string, delayMs: number): string {
  const id = `sched-${++idCounter}`;
  const fireAt = Date.now() + delayMs;

  const timer = setTimeout(() => {
    scheduled.delete(id);
    push(app, title, body);
  }, delayMs);

  scheduled.set(id, { id, app, title, body, ts: Date.now(), fireAt, timer });
  return id;
}

// 取消定时推送
export function cancel(id: string): boolean {
  const s = scheduled.get(id);
  if (!s) return false;
  clearTimeout(s.timer);
  scheduled.delete(id);
  return true;
}

// 查看未读通知
export function getNotifications(limit: number = 20): Notification[] {
  return pending.slice(-limit);
}

// 查看等待中的定时通知
export function getScheduled(): { id: string; app: string; title: string; fireAt: number }[] {
  return [...scheduled.values()].map(s => ({
    id: s.id, app: s.app, title: s.title, fireAt: s.fireAt,
  }));
}

// 清除所有通知
export function clearNotifications() {
  pending.length = 0;
}

// 清除所有定时
export function clearAllScheduled() {
  for (const s of scheduled.values()) clearTimeout(s.timer);
  scheduled.clear();
}
