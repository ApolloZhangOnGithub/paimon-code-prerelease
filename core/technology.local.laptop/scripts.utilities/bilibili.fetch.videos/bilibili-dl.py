#!/usr/bin/env python3
"""
B站视频下载器 (原生API, 零外部依赖)
用法: python3 bilibili-dl.py <bvid> [-o FILE]
示例: python3 bilibili-dl.py BV1Yr766EE7H -o /tmp/deepmind_diffusion.mp4
"""

import argparse, sys, urllib.request, json, re

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com/",
}

def get_cid(bvid: str) -> tuple:
    url = f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    if data["code"] != 0:
        raise RuntimeError(f"API error: {data.get('message', 'unknown')}")
    return data["data"]["cid"], data["data"]["title"]

def get_video_url(bvid: str, cid: int) -> str:
    url = f"https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&qn=80&fnval=1&fourk=1"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    if data["code"] != 0:
        raise RuntimeError(f"playurl error: {data.get('message', 'unknown')}")
    return data["data"]["durl"][0]["url"]

def download(video_url: str, output: str):
    dl_headers = dict(HEADERS)
    dl_headers["Referer"] = "https://www.bilibili.com/"
    req = urllib.request.Request(video_url, headers=dl_headers)
    with urllib.request.urlopen(req, timeout=300) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        with open(output, "wb") as f:
            while True:
                chunk = resp.read(8192)
                if not chunk: break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 // total
                    print(f"\r>> {pct}% ({downloaded}/{total})", end="", file=sys.stderr)
    print(f"\n>> 完成: {output}", file=sys.stderr)

def main():
    parser = argparse.ArgumentParser(description="B站视频下载器")
    parser.add_argument("bvid", help="B站 BV号")
    parser.add_argument("-o", "--output", default="", help="输出路径")
    args = parser.parse_args()
    bvid = args.bvid.strip()
    if not bvid.startswith("BV"): bvid = f"BV{bvid}"
    try:
        cid, title = get_cid(bvid)
        safe = re.sub(r'[\\/*?:"<>|]', '', title)[:50]
        out = args.output or f"{safe}.mp4"
        print(f">> {title}", file=sys.stderr)
        video_url = get_video_url(bvid, cid)
        download(video_url, out)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
