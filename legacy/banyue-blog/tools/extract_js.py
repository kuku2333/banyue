#!/usr/bin/env python3
"""把 blog.html 里最后一个 <script> 的内容抽到 build/inline.js，供语法检查用。"""
import re
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[1]
html = (root / "blog.html").read_text(encoding="utf-8")
blocks = re.findall(r"<script>([\s\S]*?)</script>", html)
if not blocks:
    sys.exit("没有找到内联脚本")

out = root / "build"
out.mkdir(exist_ok=True)
target = out / "inline.js"
target.write_text(blocks[-1], encoding="utf-8")
print(f"提取 {len(blocks)} 个 script 块，最后一个 {len(blocks[-1])} 字符 -> {target.relative_to(root)}")
