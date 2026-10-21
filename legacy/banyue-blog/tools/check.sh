#!/usr/bin/env bash
# 提交前自检：语法 + 零外链 + 关键常量
set -e
cd "$(dirname "$0")/.."

echo "== 1/4 提取内联脚本 =="
python3 tools/extract_js.py

echo "== 2/4 JS 语法 =="
if command -v node >/dev/null 2>&1; then
  node --check build/inline.js && echo "OK"
else
  echo "未安装 node，跳过（只做了提取）"
fi

echo "== 3/4 零外链检查 =="
if grep -nE '<script[^>]+src=|<link[^>]+stylesheet' blog.html; then
  echo "失败：发现外部 script/link 引用，破坏单文件零依赖约定"
  exit 1
else
  echo "OK"
fi

echo "== 4/4 关键常量 =="
for k in WRITE_DB_ID CLOUD_BOOK_DB CLOUD_MUSIC_DB; do
  if grep -q "const $k" blog.html; then echo "  $k OK"; else echo "  缺少 $k"; exit 1; fi
done

echo
printf "文件体积：%s\n" "$(du -h blog.html | cut -f1)"
