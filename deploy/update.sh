#!/usr/bin/env bash
# =============================================================================
# 半页 / banyue 更新脚本（服务器端执行）
#
# 前提：项目是用 deploy/install.sh 部署的（systemd 服务名 banyue）。
# 用法（在服务器项目根目录）：
#     sudo bash deploy/update.sh
#
# 流程：
#   1. git pull 拉最新代码（若无 .git 或拉取失败则跳过，仅用本地文件）
#   2. 重新构建前端 web/dist
#   3. 重启后端服务（后端代码/新依赖才会生效）
#
# 幂等，可重复执行。数据在 server/data/，不受影响。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="banyue"
ENV_FILE="$SCRIPT_DIR/.env"

log()  { printf '\033[1;36m[更新]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "请用 root 运行：sudo bash deploy/update.sh"

# ---- 1. 拉代码 ----
cd "$APP_DIR"
if [[ -d .git ]] && command -v git >/dev/null; then
  log "拉取最新代码（git pull）..."
  # 显式指定 origin main，避免新环境没设 upstream 时裸 pull 失效
  if ! git pull --ff-only origin main; then
    log "git pull 未成功（可能是非快进或有本地改动），使用当前工作区文件继续"
  fi
else
  log "没有 git 仓库，跳过拉取，用当前文件"
fi

# ---- 2. 构建前端 ----
log "构建前端..."
cd "$APP_DIR/web"
command -v pnpm >/dev/null || die "未找到 pnpm，请先跑 deploy/install.sh"
# 依赖没变就完全跳过 install（pnpm install 即使本地有 node_modules 也会联网校验，
# 在服务器网络慢时会卡很久）。改了依赖请手动在 web/ 下跑 pnpm install。
if [[ -d node_modules ]]; then
  log "依赖已存在，跳过安装"
else
  pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts || die "依赖安装失败"
fi
pnpm build
cd "$APP_DIR"

# ---- 3. 重启后端（加载新代码）----
log "重启后端服务 $SERVICE_NAME..."
systemctl restart "$SERVICE_NAME"

# ---- 4. 健康检查 ----
source "$ENV_FILE" 2>/dev/null || true
PORT="${PORT:-8787}"
sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/hidden-posts" >/dev/null 2>&1; then
  log "✅ 更新完成，服务已就绪"
else
  log "⚠️  服务未立即响应，查看日志：journalctl -u $SERVICE_NAME -n 50"
fi
