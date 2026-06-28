#!/usr/bin/env python3
"""轻量 Google 搜索代理 — 用 Chrome cookie 绕过反爬"""
import sqlite3, shutil, os, tempfile, json, re, sys
from pathlib import Path
from urllib.parse import urlencode
from http.server import HTTPServer, BaseHTTPRequestHandler
import requests

PORT = int(os.environ.get("SEARCH_PORT", "8889"))
COOKIE_DB = Path.home() / "Library/Application Support/Google/Chrome/Default/Cookies"

def load_cookies():
    if not COOKIE_DB.exists():
        return {}
    tmp = tempfile.mktemp(suffix=".sqlite")
    shutil.copy2(COOKIE_DB, tmp)
    try:
        conn = sqlite3.connect(tmp)
        rows = conn.execute("SELECT host_key, name, value FROM cookies WHERE host_key LIKE '%google%'").fetchall()
        return {name: value for _, name, value in rows}
    finally:
        os.unlink(tmp)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

def search_google(query: str, num: int = 8) -> list:
    params = {"q": query, "num": num, "hl": "zh-CN"}
    cookies = load_cookies()
    if not cookies:
        return [{"title": "错误", "url": "", "snippet": "无法读取 Chrome cookie——请先登录 Google"}]
    try:
        r = requests.get("https://www.google.com/search", params=params, headers=HEADERS, cookies=cookies, timeout=8)
        if r.status_code != 200:
            return [{"title": f"Google 返回 {r.status_code}", "url": "", "snippet": ""}]
        # 简单 HTML 提取
        results = []
        # 匹配: <a href="/url?q=REAL_URL" ...><h3>TITLE</h3></a> ... <div ...>SNIPPET</div>
        blocks = re.findall(r'<a[^>]*href="/url\?q=([^"&]+)[^"]*"[^>]*>(.*?)</a>(.*?)<div[^>]*class="[^"]*BNeawe[^"]*"[^>]*>(.*?)</div>', r.text, re.DOTALL)
        for url, title_html, _, snippet in blocks[:num]:
            title = re.sub(r'<[^>]+>', '', title_html)
            if not title.strip():
                continue
            results.append({
                "title": title.strip(),
                "url": url,
                "snippet": re.sub(r'<[^>]+>', '', snippet).strip()[:200]
            })
        return results or [{"title": "无结果", "url": "", "snippet": f"页面长度: {len(r.text)}"}]
    except Exception as e:
        return [{"title": "搜索异常", "url": "", "snippet": str(e)}]

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/search"):
            q = self.path.split("?q=")[-1].split("&")[0] if "?q=" in self.path else ""
            from urllib.parse import unquote
            q = unquote(q)
            results = search_google(q)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"query": q, "results": results}, ensure_ascii=False).encode())
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b'Google Search Proxy - GET /search?q=QUERY')

if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"🔍 Google 搜索代理启动: http://127.0.0.1:{PORT}/search?q=test")
    server.serve_forever()
