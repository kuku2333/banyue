#!/usr/bin/env bash
# 本地起服务，默认 8000
set -e
cd "$(dirname "$0")/.."
PORT="${1:-8000}"
echo "http://localhost:${PORT}/blog.html"
python3 -m http.server "$PORT"
