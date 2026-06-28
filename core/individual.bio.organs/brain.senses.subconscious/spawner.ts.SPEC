source: spawner.ts @ 443d6408

潜意识扩展入口。

用户原话："应该是潜意识激活的，潜意识是另一个 pi session，这个始终内部自动运行，
并且能看到明窗口的内容，在有的时候可以往明窗口说话。"
"模型不是表演给人看的，一定是做给自己的。"

启动时在进程内创建一个潜意识 AgentSession，只有 read_conscious 和 aware 两个工具。
潜意识和明 session 共享同一个生命周期——明 session 启动时启动，关闭时关闭。
潜意识也是活的，用 wait 歇一会然后自动醒。

详细设计见 Smart Claude/pi/CONSCIOUS_SPEC.md
