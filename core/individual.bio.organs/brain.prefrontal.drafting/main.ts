import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAlwaysThink } from "./drafting.ts";

// always_think — 边写边想(草稿态)
// 模型写东西时,脑不该"就是手"。允许它在输出任意位置打一个 <need think> 标记,
// 写作立即暂停(自触发 mid-stream abort),模型转入思考,想透后从断点续写。
// 一次输出里可以这样停想任意多次。
//
// 依赖:continuous 的 steer→abort dist 补丁(agent.js: steer() 时 abortController.abort())。
// 这个补丁让"投递一条 steer 消息"等价于"暂停当前生成",always_think 就建在它上面。
export default function (pi: ExtensionAPI) {
  registerAlwaysThink(pi);
}
