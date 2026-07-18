#!/usr/bin/env python3
"""
论文 PDF 下载器

用法:
  python3 paper-dl.py <url|arxiv_id> [-o FILE]
  python3 paper-dl.py 2605.30322 -o gram.pdf

支持: arXiv ID、arXiv URL、直接 PDF URL
"""

import argparse, re, sys, os, urllib.request
from urllib.parse import urlparse

def validate_url(url: str):
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise ValueError(f"不支持协议: {p.scheme}")
    h = p.hostname or ""
    if h in ("localhost", "127.0.0.1", "[::1]") or re.match(r'^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)', h):
        raise ValueError(f"拒绝内网地址: {h}")


def resolve_url(ident: str) -> str:
    m = re.match(r"^(\d{4}\.\d{4,5})(v\d+)?$", ident)
    if m: return f"https://arxiv.org/pdf/{m.group(1)}"
    m = re.search(r"arxiv\.org/abs/(\d{4}\.\d{4,5})", ident)
    if m: return f"https://arxiv.org/pdf/{m.group(1)}"
    m = re.search(r"arxiv\.org/pdf/(\d{4}\.\d{4,5})", ident)
    if m: return f"https://arxiv.org/pdf/{m.group(1)}"
    if ident.startswith("http"): return ident
    raise ValueError(f"无法解析: {ident}")


def main():
    parser = argparse.ArgumentParser(description="论文 PDF 下载器")
    parser.add_argument("url", help="arXiv ID / URL / PDF URL")
    parser.add_argument("--output", "-o", help="输出路径 (默认: 自动命名)")
    args = parser.parse_args()

    try:
        pdf_url = resolve_url(args.url)
        validate_url(pdf_url)
        print(f">> 下载: {pdf_url}", file=sys.stderr)
        req = urllib.request.Request(pdf_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
        out = args.output or f"{args.url.replace('/','_')}.pdf"
        with open(out, "wb") as f:
            f.write(data)
        print(f">> 已保存: {out} ({len(data)} bytes)", file=sys.stderr)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
