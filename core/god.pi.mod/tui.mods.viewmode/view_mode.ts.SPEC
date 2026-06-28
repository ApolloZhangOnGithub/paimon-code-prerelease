source: view_mode.ts @ 8545d026

主 session 显示模式控制。

用户原话："要一个是折叠的，一个是完全隐藏的一个是原始的，用/view命令控制"

三种模式：
- /view full — 原始显示（thinking + tool use + text 全部展开）
- /view fold — thinking 和 tool use 折叠，只有白字展开
- /view clean — thinking 和 tool use 完全隐藏，只显示白字

独立插件，不在 unstop 里。
