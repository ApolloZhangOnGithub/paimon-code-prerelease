source: homepage.ts @ fbf4078a

# iPhone -- 手机主界面与导航

## 功能
模拟 iPhone 主屏幕、通知中心、应用切换器。管理手机 UI 状态（当前应用、历史栈）和通知队列。

## 操作
- `--home` -- 回到主屏幕，显示全部内置应用列表
- `--open <app>` -- 打开指定应用（按名称模糊匹配）
- `--back` -- 应用内返回上页，或返回上一个应用/主页
- `--close` -- 关闭当前应用，回到上一个应用或主页
- `--notifications` -- 显示未读通知并标记已读（保留最近 200 条）
- `--appswitcher` -- 显示运行中的应用列表
- 无参数 -- 等同 `--home`

## 数据
- `{personDir}/phone_notifications.json` -- Notification[] 通知队列
- 内存 Map 缓存 PhoneState（unlocked/currentApp/appHistory）

## 备注
内置 10 个应用定义（BUILTIN_APPS）。导出 `addNotification` 供其他应用推送通知。通知队列上限 200 条。
