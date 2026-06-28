source: prompts.ts, prompts.json

# prompts — 统一提示词档案

## 职责
所有散落的提示词（system prompt、工具描述、行为指令）集中到此。
其他文件从此 import/read，禁止任何文件含内联提示词文本。
- prompts.json: JSON 数据文件
- prompts.ts: 加载器/读取器
