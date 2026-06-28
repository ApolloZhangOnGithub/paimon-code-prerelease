source: notifications.ts

# system.notifications — 手机通知系统

## 职责
手机通知的接收、聚合和投递（到 pi 上下文）。
通过 pi.sendMessage({customType: "phone-notification"}) 把通知喂给模型。
