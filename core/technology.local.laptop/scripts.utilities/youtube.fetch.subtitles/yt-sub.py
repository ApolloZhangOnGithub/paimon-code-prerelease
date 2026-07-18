#!/usr/bin/env python3
"""
YouTube 字幕下载器 (通用)

用法:
  python3 yt-sub.py <url|video_id> [--lang en] [--output FILE]

示例:
  python3 yt-sub.py https://www.youtube.com/watch?v=V04bm-3d6EQ
  python3 yt-sub.py V04bm-3d6EQ --lang zh-Hans -o /tmp/sub.txt

依赖:
  - yt-dlp (brew install yt-dlp 或 pip install yt-dlp)
"""

import argparse, re, subprocess, sys, tempfile, os
from urllib.parse import urlparse

def validate_url(url: str):
    """只允许远程 YouTube URL，阻止内网/本地。"""
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise ValueError(f"不支持协议: {p.scheme}")
    h = p.hostname or ""
    if h in ("localhost", "127.0.0.1", "[::1]") or re.match(r'^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)', h):
        raise ValueError(f"拒绝内网地址: {h}")

def download_vtt(url: str, lang: str = "en") -> str:
    """用 yt-dlp 下载字幕 VTT，返回文件路径。"""
    tmpdir = tempfile.mkdtemp(prefix="yt_sub_")
    out_tmpl = os.path.join(tmpdir, "%(id)s")
    cmd = [
        "yt-dlp", "--no-update",
        "--extractor-args", "youtube:player_client=android",
        "--user-agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
        "--skip-download",
        "--write-auto-subs",
        "--sub-lang", lang,
        "--sub-format", "vtt",
        "--output", out_tmpl,
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp 失败:\n{result.stderr}")

    # 找到生成的 .vtt 文件（yt-dlp 可能输出 .{lang}.vtt 或其他变体）
    for f in os.listdir(tmpdir):
        if f.endswith(f".{lang}.vtt"):
            return os.path.join(tmpdir, f)
        if f.endswith(".vtt"):
            return os.path.join(tmpdir, f)
    # 列出目录帮助调试
    found = os.listdir(tmpdir)
    raise FileNotFoundError(f"未找到 .{lang}.vtt 字幕 (tmpdir={tmpdir}, found={found})")


def clean_vtt(vtt_path: str) -> str:
    """清洗 VTT 为纯文本（去时间戳/去重复/合并碎片）。"""
    with open(vtt_path) as f:
        raw = f.read()

    # 去头
    raw = re.sub(r"^WEBVTT.*?\n\n", "", raw, flags=re.DOTALL)
    blocks = re.split(r"\n\n+", raw.strip())

    # 只取纯文本块（无 <c> 标签），它们不重叠
    lines = []
    for b in blocks:
        b = b.strip()
        m = re.match(r"(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3}).*", b)
        if not m:
            continue
        text = b[m.end():].strip()
        if not text or "<c>" in text:
            continue
        text = " ".join(text.split())
        if text and text != "[music]":
            lines.append(text)

    # 合并续句（小写开头 = 接上一行）
    merged = []
    for line in lines:
        if merged and line and line[0].islower() and not line.startswith(">>"):
            merged[-1] = merged[-1] + " " + line
        elif merged and merged[-1].endswith(","):
            merged[-1] = merged[-1] + " " + line
        else:
            merged.append(line)

    # 清理 [music] 标签，合并短语片
    merged = [re.sub(r"\[music\]\s*", "", l).strip() for l in merged]
    merged = [l for l in merged if l]

    result = []
    for l in merged:
        if result and len(result[-1].split()) <= 3 and not result[-1].endswith((".", "?", "!")):
            result[-1] = result[-1] + " " + l
        else:
            result.append(l)

    return "\n\n".join(result)


def main():
    parser = argparse.ArgumentParser(description="YouTube 字幕下载器")
    parser.add_argument("url", help="YouTube URL 或 video ID")
    parser.add_argument("--lang", default="en", help="字幕语言代码 (默认: en)")
    parser.add_argument("--output", "-o", help="输出文件路径 (默认: stdout)")
    args = parser.parse_args()

    # 规范化 URL
    video_id = args.url
    if "youtube.com" in video_id or "youtu.be" in video_id:
        m = re.search(r"(?:v=|/)([a-zA-Z0-9_-]{11})", video_id)
        if m:
            video_id = f"https://www.youtube.com/watch?v={m.group(1)}"
    elif len(video_id) == 11 and re.match(r"^[a-zA-Z0-9_-]+$", video_id):
        video_id = f"https://www.youtube.com/watch?v={video_id}"

    print(f">> 下载字幕: {video_id} (lang={args.lang})", file=sys.stderr)
    validate_url(video_id)
    try:
        vtt_path = download_vtt(video_id, args.lang)
    except (FileNotFoundError, RuntimeError) as e:
        print(f"该视频没有可用字幕 ({args.lang})", file=sys.stderr)
        sys.exit(1)
    print(f">> 清洗字幕...", file=sys.stderr)
    text = clean_vtt(vtt_path)

    if args.output:
        with open(args.output, "w") as f:
            f.write(text)
        print(f">> 已保存: {args.output} ({len(text)} chars)", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
