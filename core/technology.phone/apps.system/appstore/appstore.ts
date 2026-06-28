// apps.system/appstore/appstore.ts — AppStore tool (AI) — stub
import type { PhoneApp } from "../../system.kernel/kernel.ts";

export async function appstoreCmd(args: any, _ctx: any, _personDir: string): Promise<{ content: any[]; details: any }> {
  return { content: [{ type: "text", text: "AppStore 功能尚未实现" }], details: {} };
}

// ── PhoneApp ──────────────────────────────────────────────────
export const app: PhoneApp = {
  name: "App Store",
  icon: "商店",
  messageDescription: "应用商店",
  onOpen(_state, _personDir) {
    return {
      screen: "App Store\n\n功能开发中...",
      state: _state ?? {},
    };
  },
  onAction(_input, state, _personDir) {
    return { screen: "App Store\n\n功能开发中...", state };
  },
};
