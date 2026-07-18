#!/usr/bin/env python3
"""Arxiv论文搜索+下载。用法: python3 arxiv-search.py <query> [-n N] [--pdf ID] [-o FILE]"""
import argparse, sys, urllib.request, urllib.parse, html, re, json, os

def search(query: str, max_results: int = 5):
    url = f"https://export.arxiv.org/api/query?search_query=all:{urllib.parse.quote(query)}&max_results={max_results}&sortBy=relevance"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read().decode("utf-8")
    entries = re.findall(r"<entry>(.*?)</entry>", data, re.DOTALL)
    results = []
    for e in entries:
        title_m = re.search(r"<title>(.*?)</title>", e)
        summary_m = re.search(r"<summary>(.*?)</summary>", e)
        link_m = re.search(r"<id>(http://arxiv.org/abs/\d+\.\d+).*?</id>", e)
        if not title_m: continue
        title = html.unescape(title_m.group(1).strip())
        if "arxiv" in title.lower() and "query" in title.lower(): continue
        arxiv_id = link_m.group(1).split("/abs/")[-1] if link_m else ""
        results.append({
            "title": title, "summary": html.unescape(summary_m.group(1).strip())[:400] if summary_m else "",
            "link": link_m.group(1).replace("http://", "https://") if link_m else "",
            "published": re.search(r"<published>(\d{4}-\d{2}-\d{2})", e).group(1) if re.search(r"<published>", e) else "",
            "arxiv_id": arxiv_id,
        })
    return results

def download_pdf(arxiv_id: str, output: str = ""):
    url = f"https://arxiv.org/pdf/{arxiv_id}"
    out = output or f"{arxiv_id}.pdf"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        with open(out, "wb") as f:
            while True:
                chunk = resp.read(8192)
                if not chunk: break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    print(f"\r>> {downloaded*100//total}% ({downloaded}/{total})", end="", file=sys.stderr)
    print(f"\n>> 完成: {out}", file=sys.stderr)
    return out

def main():
    p = argparse.ArgumentParser(description="Arxiv搜索+下载")
    p.add_argument("query", nargs="?", default="")
    p.add_argument("-n", type=int, default=5)
    p.add_argument("--pdf", default="", help="下载论文PDF (arxiv ID)")
    p.add_argument("-o", "--output", default="", help="输出路径")
    a = p.parse_args()
    try:
        if a.pdf:
            download_pdf(a.pdf, a.output)
        elif a.query:
            for i, r in enumerate(search(a.query, a.n), 1):
                print(f"{i}. {r['title']}\n   {r['link']} ({r['published'][:4]})\n   {r['summary']}\n")
        else:
            p.print_help()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr); sys.exit(1)

if __name__ == "__main__": main()
