import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerHeartbeat } from "./heartbeat.ts";
import { registerProcess } from "./process.ts";

export default function (pi: ExtensionAPI) {
  registerHeartbeat(pi);
  registerProcess(pi);
}
