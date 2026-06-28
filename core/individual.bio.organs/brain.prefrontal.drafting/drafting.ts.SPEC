source: drafting.ts @ 2eb28026

# drafting.ts — Pre-thinking injection: pause-and-think during generation

## 职责
Implements "always think" (边写边想): when the model writes `<need think>` mid-output, generation is paused via steer-triggered abort, a thinking prompt is injected, and the model resumes from the breakpoint after reflection. Allows the model to self-interrupt for deeper reasoning during long outputs.

## 接口
- `registerAlwaysThink(pi: ExtensionAPI): void` — installs hooks and /always_think command

## 依赖
- `#runtime` (getPrompt for "drafting.think")
- `@mariozechner/pi-coding-agent` (ExtensionAPI)

## 行为要点
- Marker `<need think>` is detected in streaming assistant output via message_update hook
- On detection: sends a steer message (messageType "always-think-pause") that aborts current generation
- Partial output preserved by pi's native partial mechanism; model continues from breakpoint
- Max 50 pauses per turn (MAX_PAUSES_PER_TURN) to prevent pathological loops
- Each marker triggers only once per message (triggeredForCurrentMessage flag)
- Pause counter resets on agent_start; trigger flag resets on message_start
- /always_think [on|off] command toggles the feature
- Prompt text from coded.dna with {MARKER} placeholder replaced at load time
- Depends on unstop's steer->abort dist patch (agent.js: steer() triggers abortController.abort())
