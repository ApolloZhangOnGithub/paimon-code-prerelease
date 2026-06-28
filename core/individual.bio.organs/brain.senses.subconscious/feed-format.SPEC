# conscious-feed.jsonl 数据格式规范

> 写入：subconscious/index.ts message_end
> 读取：tools.ts read_conscious
> 消费者：潜意识（通过 read_conscious 读历史，用 aware 发送反思）

## 铁律

- 每行一条 JSON，`role` + `type` 唯一确定一种记录
- **role** = 谁产生的：`user` | `assistant` | `system`
- **type** = 具体干什么：见下表
- 所有记录必有 `ts` (unix ms)
- **主意识和潜意识共用同一个 feed**，但 type 体系各自独立——潜意识的 type（如 aware）只由潜意识写入，主意识的 type 只由主意识写入。写入时按 role 区分来源，读取时按 role 过滤。

---

## role 枚举

| role | 含义 | 写入者 |
|------|------|--------|
| `user` | 用户输入 | 主意识 session (input 事件) |
| `assistant` | 模型产出 | 主意识 session (message_end 事件) |
| `system` | 系统消息 | 主意识 + 潜意识 |

---

## type 枚举（主意识侧）

| type | role | 内容字段 | 示例 |
|------|------|---------|------|
| `user_msg` | `user` | `content: string` | `{"role":"user","type":"user_msg","content":"你好","ts":...}` |
| `think` | `assistant` | `think: string` | `{"role":"assistant","type":"think","think":"内部推理","ts":...}` |
| `text` | `assistant` | `text: string` | `{"role":"assistant","type":"text","text":"回复内容","ts":...}` |
| `mouth` | `assistant` | `content: string` | `{"role":"assistant","type":"mouth","content":"朗读文本","ts":...}` |
| `toolCall` | `assistant` | `tool: {name, args}` | `{"role":"assistant","type":"toolCall","tool":{"name":"bash","args":"ls"},"ts":...}` |
| `toolResult` | `system` | `content: string` | `{"role":"system","type":"toolResult","content":"file1 file2","ts":...}` |
| `start_msg` | `system` | `content: string` | `{"role":"system","type":"start_msg","content":"系统提示词/date","ts":...}` |

---

## type 枚举（潜意识侧——独立体系，待设计）

| type | role | 内容字段 | 示例 |
|------|------|---------|------|
| `aware` | `system` | `title, thought, strength` | `{"role":"system","type":"aware","title":"...","thought":"...","strength":0.8,"ts":...}` |

⚠️ 潜意识目前有自己的 feed 写入逻辑，**不要用主意识的 type 去框它**。潜意识需要另外设计 role 和 type。当前只确保主意识侧的格式正确，潜意识侧不改动。

---

## 设计约束

1. **不用 `content` 数组**：不再嵌套 `[{type:"thinking"}, {type:"text"}]`。一条 feed entry = 一个 think 或一个 text 或一个 toolCall。
2. **`text` 和 `think` 分两条写**：模型一次产出包含 think+text 时，拆成两条独立 entry。
3. **纯 think（无 text）不丢弃**：think 需要进入 feed，供潜意识反思主意识的思考过程。
4. **mouth 保留 `content` 字段**：mouth 是 TTS 朗读文本，不需要拆分 text/think。
