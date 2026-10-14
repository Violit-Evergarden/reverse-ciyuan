#!/usr/bin/env bash
# 增量部署 (开发机执行): 构建前端 → rsync 应用+产物 → 远端重启 → 健康检查。
#   bash tools/deploy.sh <ssh目标 user@host> <域名>
# secrets.local.json 仅远端缺失时上传一次 (chmod 600), 之后不覆盖远端 token 缓存。
set -euo pipefail
TARGET="${1:?用法: bash tools/deploy.sh <user@host> <域名>}"
DOMAIN="${2:?缺域名}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR=/opt/ciyuan/web

echo "== 本地构建 =="
(cd "$ROOT/web/frontend" && npm run build)

echo "== rsync =="
ssh "$TARGET" "mkdir -p $APP_DIR"
rsync -az --delete "$ROOT/web/dist/" "$TARGET:$APP_DIR/dist/"
rsync -az "$ROOT/web/server.js" "$TARGET:$APP_DIR/server.js"
if ! ssh "$TARGET" "test -f $APP_DIR/secrets.local.json"; then
  echo "== 上传 secrets (仅首次) =="
  rsync -az "$ROOT/web/secrets.local.json" "$TARGET:$APP_DIR/secrets.local.json"
  ssh "$TARGET" "chmod 600 $APP_DIR/secrets.local.json"
fi

echo "== 远端重启 =="
ssh "$TARGET" "sudo systemctl restart ciyuan-web && sleep 1 && systemctl is-active ciyuan-web"

echo "== 健康检查 =="
for _ in $(seq 1 20); do
  code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/status" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "!! https://$DOMAIN/api/status 非 200 ($code)"; exit 1; }
curl -s -m 8 "https://$DOMAIN/api/status"; echo
echo "== 部署完成: https://$DOMAIN =="
