source: clock.ts @ cf71e1ae

# clock.ts SPEC
## 用途
时钟工具——闹钟、秒表、计时器。根据 BlueBox OS Clock.app 的 Info.plist 定义的 intents 实现为 pi AI 工具。
## 为什么需要
用户指令原话："里面规划的app的功能都要实现"——要求按 BlueBox OS SPECS 把各 App 能力做成 pi 工具。Clock 是第一个。
## 能力
- 闹钟: 创建/删除/批量删除/开关/列表
- 秒表: 启动/暂停/继续/重置/计次/查询
- 计时器: 启动/取消/查询
