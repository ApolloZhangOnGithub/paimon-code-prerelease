source: notes.ts @ 8bb18187

# Notes -- 备忘录

## 功能
本地持久化笔记，支持创建、编辑、置顶、标签、搜索。

## 操作
- `--add <title>` -- 新建笔记（可选 `--content`, `--tags tag1,tag2`）
- `--edit <id>` -- 编辑笔记（可传 `--content`, `--title`, `--tags`）
- `--show <id>` -- 查看笔记全文
- `--delete <id>` -- 删除笔记
- `--pin <id>` / `--unpin <id>` -- 置顶/取消置顶
- `--search <q>` -- 按标题/内容/标签搜索
- 无参数 -- 列出全部笔记（置顶优先，最多 20 条）

## 数据
`{personDir}/notes.json` -- Note[] JSON 数组。

## 备注
列表默认按更新时间倒序，置顶笔记始终排前。
