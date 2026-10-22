#!/usr/bin/env bash
# =============================================================================
# 半页 / banyue 一键部署脚本（Ubuntu 22.04+，推荐 24.04）
#
# 用法：把整个项目拷贝到服务器后，在项目根目录执行：
#     bash deploy/install.sh
#
# 做什么：
#   1. 探测/安装 Node.js 22（node:sqlite 需要 >= 22.5）
#   2. 安装 pnpm（用 corepack）
#   3. 构建前端 web/dist
#   4. 用 systemd 把后端跑成服务（开机自启、崩溃自动重启）
#   5. 装了域名则用 Caddy 自动 HTTPS 反向代理；否则直接暴露端口
#   6. 健康检查
#
# 可重复执行（幂等）。配置项放在 deploy/.env（从 .env.example 复制）。
# =============================================================================
set -euo pipefail

# ---- 定位路径 ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
SERVICE_NAME="banyue"

log()  { printf '\033[1;32m[部署]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[提示]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- 读取配置（缺省值）----
PORT=8787
DOMAIN=""
QUOTA_MB=200
ADMINS=""
DATA_DIR="$APP_DIR/server/data"

if [[ -f "$ENV_FILE" ]]; then
  log "读取配置 $ENV_FILE"
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

# ---- 0. 前置检查 ----
[[ "$(id -u)" -eq 0 ]] || die "请用 root 运行：sudo bash deploy/install.sh"
command -v systemctl >/dev/null || die "需要 systemd（Ubuntu 默认自带）"
grep -qi ubuntu /etc/os-release || warn "非 Ubuntu 系统，脚本仍会尝试，但未充分测试"

# ---- 1. Node.js 22 ----
need_node() {
  # 返回 0 表示已有可用 node（>= 22.5）
  command -v node >/dev/null || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$major" -ge 22 ]] && node -e 'if (process.versions.node < "22.5.0") process.exit(1)' 2>/dev/null
}

if need_node; then
  NODE_BIN="$(command -v node)"
  log "已存在 Node $(node -v)（$NODE_BIN）"
else
  log "安装 Node.js 22（NodeSource）..."
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  NODE_BIN="$(command -v node)"
  log "Node $(node -v) 安装完成"
fi

# ---- 2. pnpm ----
if command -v pnpm >/dev/null; then
  log "已存在 pnpm $(pnpm -v)"
else
  log "安装 pnpm（corepack）..."
  corepack enable 2>/dev/null || npm install -g corepack
  corepack prepare pnpm@latest --activate
  hash -r
  log "pnpm $(pnpm -v) 安装完成"
fi

# ---- 3. 构建前端 ----
log "构建前端（web/dist）..."
cd "$APP_DIR/web"
if [[ ! -d node_modules ]]; then
  pnpm install --frozen-lockfile || pnpm install
fi
pnpm build
cd "$APP_DIR"

# ---- 4. 数据目录 ----
mkdir -p "$DATA_DIR/files"
log "数据目录：$DATA_DIR"

# ---- 5. systemd 服务 ----
UNIT_FILE="/etc/systemd/system/$SERVICE_NAME.service"
ADMIN_ENV_LINE=""
[[ -n "$ADMINS" ]] && ADMIN_ENV_LINE="Environment=BANYUE_ADMINS=$ADMINS"

log "写入 systemd 服务 $SERVICE_NAME"
sed \
  -e "s|__APP_DIR__|$APP_DIR|g" \
  -e "s|__PORT__|$PORT|g" \
  -e "s|__DATA_DIR__|$DATA_DIR|g" \
  -e "s|__QUOTA_MB__|$QUOTA_MB|g" \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__ADMIN_ENV__|$ADMIN_ENV_LINE|g" \
  "$SCRIPT_DIR/banyue.service.template" | sed '/^[[:space:]]*$/d' > "$UNIT_FILE"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"

# ---- 6. Caddy（可选）----
if [[ -n "$DOMAIN" ]]; then
  if ! command -v caddy >/dev/null; then
    log "安装 Caddy..."
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
  mkdir -p /etc/caddy
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" \
    "$SCRIPT_DIR/Caddyfile.template" > /etc/caddy/Caddyfile
  systemctl enable caddy >/dev/null 2>&1 || true
  systemctl restart caddy
  log "Caddy 已配置：https://$DOMAIN → 127.0.0.1:$PORT"
else
  warn "未配置 DOMAIN，直接暴露端口 $PORT（无 HTTPS）。要 HTTPS 就在 deploy/.env 里填 DOMAIN 后重跑本脚本。"
fi

# ---- 7. 防火墙（仅 ufw 且启用时）----
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
  log "已放行端口 $PORT/tcp"
fi

# ---- 8. 健康检查 ----
log "等待服务启动..."
sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/hidden-posts" >/dev/null 2>&1; then
  log "✅ 部署完成，后端已就绪"
  log "   访问地址：http://<服务器IP>:$PORT"
  [[ -n "$DOMAIN" ]] && log "   公网地址：https://$DOMAIN"
else
  warn "后端未立即响应，看日志：journalctl -u $SERVICE_NAME -n 50"
fi
