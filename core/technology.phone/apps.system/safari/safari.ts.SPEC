source: safari.ts @ 0db96e05

# Safari — 动态网页浏览器

## 功能
通过 browser-service（playleft + headless Chrome）访问网页，支持 JS 动态内容渲染。不再用 curl/fetch 抓静态 HTML。

## 操作
- search_web: DuckDuckGo 搜索，浏览器渲染结果
- open_url/open: 打开任意 URL，返回渲染后文字
- read/text: 读当前页面文字
- links: 列出链接
- click: 点击元素
- search_page: 页面内搜索
- scroll: 滚动
- back: 后退
- 书签/历史: add_bookmark, query_bookmarks, query_history

## 依赖
browser-service (technology.server/browser-service.cjs) 必须运行。PI_BROWSER 环境变量指定地址（默认 localhost:9222）。

## 数据
书签: {personDir}/safari_bookmarks.json
历史: {personDir}/safari_history.json
