#!/usr/bin/env bash
# 增量部署 (开发机执行): 读取 web/deploy.local.json (gitignored):
#   { "target": "root@IP", "domain": "www.violet37.cn", "basic_user": "..", "basic_pass": ".." }
# 流程: 本地 vite build → rsync dist+server.js → 远端 restart → https(+BasicAuth) 健康检查。
# 用法: bash tools/deploy.sh   (或显式: bash tools/deploy.sh <user@host> <域名>)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/web/deploy.local.json"
if [ -f "$CFG" ]; then
  TARGET="${1:-$(python3 -c "import json;print(json.load(open('$CFG'))['target'])")}"
  DOMAIN="${2:-$(python3 -c "import json;print(json.load(open('$CFG'))['domain'])")}"
  GATE="$(python3 -c "import json;print(json.load(open('$CFG')).get('gate',''))")"
else
  TARGET="${1:?用法: bash tools/deploy.sh <user@host> <域名>}"
  DOMAIN="${2:?缺域名}"
  GATE="${CIYUAN_GATE:-}"
fi
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
ssh "$TARGET" "systemctl restart ciyuan-web && sleep 1 && systemctl is-active ciyuan-web"

echo "== 健康检查 =="
CURLA=()
if [ -n "$GATE" ]; then
  JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT
  curl -sc "$JAR" -m 10 -d "code=$GATE" "https://$DOMAIN/gate" >/dev/null
  CURLA=(-b "$JAR")
fi
for _ in $(seq 1 20); do
  code=$(curl -s -m 8 "${CURLA[@]+"${CURLA[@]}"}" -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/status" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "!! https://$DOMAIN/api/status 非 200 ($code)"; exit 1; }
curl -s -m 8 "${CURLA[@]+"${CURLA[@]}"}" "https://$DOMAIN/api/status"; echo
echo "== 部署完成: https://$DOMAIN =="
