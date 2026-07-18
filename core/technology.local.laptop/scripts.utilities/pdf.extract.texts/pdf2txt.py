#!/usr/bin/env python3
"""
PDF 文本提取器

用法:
  python3 pdf2txt.py <file.pdf> [-o FILE]
  python3 pdf2txt.py gram.pdf -o gram.txt

依赖 (二选一):
  - pdftotext (brew install poppler) — 推荐，最快最准
  - PyPDF2 (pip install PyPDF2) — 纯 Python fallback
"""

import argparse, subprocess, sys, os


def extract_pdftotext(path: str) -> str:
    r = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, timeout=30)
    if r.returncode == 0 and r.stdout.strip():
        return r.stdout
    raise RuntimeError("pdftotext 提取失败")


def extract_pypdf2(path: str) -> str:
    from PyPDF2 import PdfReader
    reader = PdfReader(path)
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n\n".join(pages)


def clean_text(text: str) -> str:
    lines = text.split("\n")
    out = []
    for line in lines:
        s = line.strip()
        if not s:
            if out and out[-1] != "":
                out.append("")
            continue
        if out and out[-1] and not out[-1].endswith((".", "?", "!", ":", ";", ",")):
            if s[0].islower() or s[0].isdigit():
                out[-1] = out[-1] + " " + s
                continue
        out.append(s)
    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser(description="PDF 文本提取器")
    parser.add_argument("file", help="PDF 文件路径")
    parser.add_argument("--output", "-o", help="输出文件 (默认: stdout)")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"Error: 文件不存在: {args.file}", file=sys.stderr)
        sys.exit(1)

    try:
        text = extract_pdftotext(args.file)
    except FileNotFoundError:
        try:
            text = extract_pypdf2(args.file)
        except ImportError:
            print("Error: pdftotext 和 PyPDF2 都不可用", file=sys.stderr)
            sys.exit(1)
    except Exception:
        try:
            text = extract_pypdf2(args.file)
        except Exception:
            print("Error: 提取失败", file=sys.stderr)
            sys.exit(1)

    text = clean_text(text)

    if args.output:
        with open(args.output, "w") as f:
            f.write(text)
        print(f">> 已保存: {args.output} ({len(text)} chars)", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
