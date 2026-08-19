#!/usr/bin/env python3
"""Viteの単一ファイルビルドを Claude Artifact 互換のHTML断片に変換する。

Artifact は publish 時に <!doctype>〜<body> のスケルトンで包むため、
自前の doctype/html/head/body タグを剥がして中身だけにする。
使い方: python3 tools/make_artifact_html.py <in.html> <out.html>
"""
import re
import sys


def main():
    src, dst = sys.argv[1], sys.argv[2]
    html = open(src, encoding="utf-8").read()
    html = re.sub(r"<!doctype[^>]*>\s*", "", html, flags=re.I)
    html = re.sub(r"</?html[^>]*>\s*", "", html, flags=re.I)
    html = re.sub(r"</?head[^>]*>\s*", "", html, flags=re.I)
    html = re.sub(r"</?body[^>]*>\s*", "", html, flags=re.I)
    html = re.sub(r"<meta charset[^>]*>\s*", "", html, flags=re.I)
    html = re.sub(r"<meta name=\"viewport\"[^>]*>\s*", "", html, flags=re.I)
    banner = ("<!-- このファイルは web/ からの生成物です。直接編集せず "
              "`cd web && npm run build:artifact` で再生成してください。 -->\n")
    open(dst, "w", encoding="utf-8").write(banner + html.strip() + "\n")
    print(f"{src} -> {dst}")


if __name__ == "__main__":
    main()
