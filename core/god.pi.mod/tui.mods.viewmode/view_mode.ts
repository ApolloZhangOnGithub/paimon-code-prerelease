import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ViewMode = "full" | "fold" | "clean";

export default function (pi: ExtensionAPI) {
  // Set default
  (globalThis as any).__piViewMode = "full";

  pi.registerCommand("view_mode", {
    messageDescription: "Display mode: /view_mode [full|fold|clean]",
    getArgumentCompletions: (prefix: string) => {
      const modes = ["full", "fold", "clean"];
      const filtered = modes.filter(m => m.startsWith(prefix));
      return filtered.length > 0
        ? filtered.map(m => ({
            value: m,
            label: m,
            messageDescription: m === "full" ? "Everything expanded"
              : m === "fold" ? "Thinking & tools collapsed"
              : "Only plain text, no thinking/tools",
          }))
        : null;
    },
    handler: async (args, ctx) => {
      const a = (args ?? "").trim().toLowerCase();

      let mode: ViewMode;
      if (a === "full" || a === "fold" || a === "clean") {
        mode = a;
      } else if (a === "") {
        const choice = await ctx.ui.select("View mode:", ["full — everything expanded", "fold — thinking & tools collapsed", "clean — only plain text"]);
        if (!choice) return;
        mode = choice.split(" ")[0] as ViewMode;
      } else {
        ctx.ui.notify("/view_mode [full|fold|clean]", "warning");
        return;
      }

      (globalThis as any).__piViewMode = mode;

      const labels: Record<ViewMode, string> = {
        full: "full — everything expanded",
        fold: "fold — thinking & tools collapsed",
        clean: "clean — only plain text",
      };
      ctx.ui.notify(`View: ${labels[mode]}`, "info");
      ctx.ui.setStatus("view_mode", `view_mode: ${mode}`);
    },
  });
}
