#!/usr/bin/env bash
# 服务器端一次性初始化 (在腾讯云上以 sudo 权限执行):
#   bash deploy_init.sh <域名>
# 装 Node20/nginx/certbot, 建 systemd 单元 + nginx 反代 + Let's Encrypt 证书。
# 幂等: 可重复执行。应用文件由 deploy.sh 从开发机 rsync 上来。
set -euo pipefail
DOMAIN="${1:?用法: bash deploy_init.sh <域名>}"
APP_DIR=/opt/ciyuan/web

id -u sudo >/dev/null 2>&1 || true
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo "== 系统包 =="
if command -v apt-get >/dev/null; then
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq nginx rsync curl ca-certificates gnupg >/dev/null
  if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - >/dev/null
    $SUDO apt-get install -y -qq nodejs >/dev/null
  fi
  CERTBOT="certbot python3-certbot-nginx"; $SUDO apt-get install -y -qq $CERTBOT >/dev/null
elif command -v dnf >/dev/null || command -v yum >/dev/null; then
  PKG=$(command -v dnf || command -v yum)
  $SUDO $PKG install -y -q nginx rsync curl >/dev/null
  if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash - >/dev/null
    $SUDO $PKG install -y -q nodejs >/dev/null
  fi
  $SUDO $PKG install -y -q certbot python3-certbot-nginx >/dev/null
else
  echo "不支持的包管理器, 请手动装 node>=18 nginx certbot rsync" >&2
fi
node -v; nginx -v 2>&1

echo "== 应用目录 =="
$SUDO mkdir -p "$APP_DIR"
$SUDO chown -R "$(id -un):$(id -gn)" "$APP_DIR" 2>/dev/null || true

echo "== systemd 单元 =="
$SUDO tee /etc/systemd/system/ciyuan-web.service >/dev/null <<EOF
[Unit]
Description=Ciyuan Wallpaper Web (protocol gateway + static)
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=PORT=8787
Environment=HOST=127.0.0.1
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=always
RestartSec=3
# 凭据文件仅 root/属主可读
ProtectSystem=full
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable ciyuan-web >/dev/null 2>&1 || true

echo "== nginx 反代 =="
$SUDO tee /etc/nginx/conf.d/ciyuan.conf >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location / { proxy_pass http://127.0.0.1:8787; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; }
}
EOF
$SUDO nginx -t && $SUDO systemctl reload nginx

echo "== TLS 证书 =="
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  $SUDO certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos --register-unsafely-without-email || {
    echo "!! certbot 失败: 请确认 $DOMAIN 的 DNS A 记录已指向本机公网 IP 后重跑本脚本"; exit 1; }
else
  echo "证书已存在, 跳过"
fi

$SUDO systemctl restart ciyuan-web || echo "!! 服务启动失败 (可能应用文件尚未 rsync, 先跑 deploy.sh)"
echo "== init 完成: https://$DOMAIN =="
