source: imessage.ts @ 97784914

# iMessage (Talk) -- 对话会话系统

## 功能
管理与联系人的对话会话（f2f/group/remote）。支持发起、加入、离开、结束对话，以及会话内提案投票机制。

## 操作
- `--to <contactId>` -- 发起 f2f 对话（可选 `--topic`）
- `--join <talkId>` -- 加入公开对话
- `--end` -- 结束当前对话
- `--leave` -- 离开当前对话（不结束）
- `--list` -- 列出所有进行中对话
- `--propose <title>` -- 发起提案（可选 `--desc`, `--rule majority|unanimous`）
- `--vote <proposalId> agree|disagree` -- 投票
- `--proposals` -- 列出当前对话的提案
- 无参数 -- 显示当前对话详情或列表

## 数据
- `{personDir}/talks.json` -- TalkSession[] 持久化
- 内存 Map 缓存 TalkState（activeTalks + currentTalkId）

## 备注
依赖 contacts 数据验证联系人。提案自动投 proposer agree 票。导出 `getCurrentTalk` 供外部查询。
