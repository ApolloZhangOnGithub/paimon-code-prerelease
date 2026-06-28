source: settings.ts @ 1a7c9b08

# Settings -- 系统设置与状态

## 功能
查看系统运行状态和费用统计（当前会话 + 累计）。分主意识/海马体/潜意识三路统计。

## 操作
- `action: "status"` -- 显示平台/版本/运行时间/费用明细
- 其他 action 值 -- 返回"未知操作"

## 数据
- `{personDir}/cost_total.json` -- 累计费用（main/hippocampus/subconscious/total/sessions）
- `{personDir}/cost-{role}.json` -- 当前会话各角色费用

## 备注
pi 版本通过 shell 调用 `node -e` 读取 package.json 获取。仅只读查询，不修改设置。
