#!/usr/bin/env bash
# 服务器端一次性初始化 (在目标机以 root/sudo 执行):
#   bash deploy_init.sh <域名> <basic_user> <basic_pass>
# 装 Node20/nginx/certbot/htpasswd, 建 systemd 单元 + nginx 反代(复用已有 Let's Encrypt
# 证书, 无证书时走 certbot 新签) + Basic Auth。幂等可重跑。应用文件由 deploy.sh rsync。
set -euo pipefail
DOMAIN="${1:?用法: bash deploy_init.sh <域名> <basic_user> <basic_pass>}"
BUSER="${2:?缺 basic_user}"
BPASS="${3:?缺 basic_pass}"
APP_DIR=/opt/ciyuan/web
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo "== 系统包 =="
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq nginx rsync curl ca-certificates apache2-utils >/dev/null
  if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - >/dev/null
    $SUDO apt-get install -y -qq nodejs >/dev/null
  fi
  $SUDO apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
elif command -v dnf >/dev/null || command -v yum >/dev/null; then
  PKG=$(command -v dnf || command -v yum)
  $SUDO $PKG install -y -q nginx rsync curl httpd-tools >/dev/null
  if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash - >/dev/null
    $SUDO $PKG install -y -q nodejs >/dev/null
  fi
  $SUDO $PKG install -y -q certbot python3-certbot-nginx >/dev/null
fi
node -v; nginx -v 2>&1

echo "== 应用目录 / Basic Auth =="
$SUDO mkdir -p "$APP_DIR"
$SUDO htpasswd -cb /etc/nginx/.ciyuan.htpasswd "$BUSER" "$BPASS"
$SUDO chmod 640 /etc/nginx/.ciyuan.htpasswd
$SUDO chown root:www-data /etc/nginx/.ciyuan.htpasswd 2>/dev/null || true

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
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable ciyuan-web >/dev/null 2>&1 || true

echo "== nginx 站点 =="
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
if [ -f "$CERT_DIR/fullchain.pem" ]; then
  echo "复用现有证书: $CERT_DIR"
  $SUDO tee /etc/nginx/conf.d/ciyuan.conf >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    auth_basic "ciyuan";
    auth_basic_user_file /etc/nginx/.ciyuan.htpasswd;
    client_max_body_size 50m;
    location /.well-known/ { auth_basic off; root /var/www/html; }
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
else
  echo "无现有证书, 先 HTTP 后 certbot"
  $SUDO tee /etc/nginx/conf.d/ciyuan.conf >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    auth_basic "ciyuan";
    auth_basic_user_file /etc/nginx/.ciyuan.htpasswd;
    location /.well-known/ { auth_basic off; root /var/www/html; }
    location / { proxy_pass http://127.0.0.1:8787; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; }
}
EOF
fi
$SUDO nginx -t && $SUDO systemctl reload nginx
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  $SUDO certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos --register-unsafely-without-email || {
    echo "!! certbot 失败: 确认 $DOMAIN 的 A 记录已指向本机后重跑"; exit 1; }
fi

echo "== 启动应用 =="
$SUDO systemctl restart ciyuan-web || echo "!! 应用启动失败 (等 deploy.sh rsync 后自动恢复)"
echo "== init 完成: https://$DOMAIN (Basic Auth: $BUSER) =="
