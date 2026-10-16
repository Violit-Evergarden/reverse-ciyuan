#!/usr/bin/env bash
# 增量部署 (开发机执行): 读取 web/deploy.local.json (gitignored):
#   { "target": "root@IP", "domain": "www.violet37.cn", "gate": ".." }
# 流程: 本地 vite build → 同步 dist+server.js → 远端 restart → https(+门禁) 健康检查。
# 用法: bash tools/deploy.sh   (或显式: bash tools/deploy.sh <user@host> <域名>)
# 跨平台: 有 rsync 用 rsync; Windows Git Bash 无 rsync 时 dist 走 tar-over-ssh
#   "新目录+原子换名" (等效 --delete, 旧内容哈希 assets 不堆积), 单文件走 cat 管道。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/web/deploy.local.json"
# python3 在 Windows 是商店存根 (exit 49), 探测失败回退 python
PY=python3; $PY -c '' >/dev/null 2>&1 || PY=python
if [ -f "$CFG" ]; then
  TARGET="${1:-$($PY -c "import json;print(json.load(open('$CFG'))['target'])")}"
  DOMAIN="${2:-$($PY -c "import json;print(json.load(open('$CFG'))['domain'])")}"
  GATE="$($PY -c "import json;print(json.load(open('$CFG')).get('gate',''))")"
else
  TARGET="${1:?用法: bash tools/deploy.sh <user@host> <域名>}"
  DOMAIN="${2:?缺域名}"
  GATE="${CIYUAN_GATE:-}"
fi
APP_DIR=/opt/ciyuan/web

echo "== 本地构建 =="
(cd "$ROOT/web/frontend" && npm run build)

sync_dist() {
  if command -v rsync >/dev/null 2>&1; then
    rsync -az --delete "$ROOT/web/dist/" "$TARGET:$APP_DIR/dist/"
  else
    ssh "$TARGET" "rm -rf $APP_DIR/dist.new $APP_DIR/dist.old && mkdir -p $APP_DIR/dist.new"
    tar -C "$ROOT/web/dist" -cf - . | ssh "$TARGET" "tar -C $APP_DIR/dist.new -xf -"
    ssh "$TARGET" "mv $APP_DIR/dist $APP_DIR/dist.old && mv $APP_DIR/dist.new $APP_DIR/dist && rm -rf $APP_DIR/dist.old"
  fi
}
sync_file() { # <local> <remote>
  if command -v rsync >/dev/null 2>&1; then
    rsync -az "$1" "$TARGET:$2"
  else
    cat "$1" | ssh "$TARGET" "cat > $2"
  fi
}

echo "== 同步 =="
ssh "$TARGET" "mkdir -p $APP_DIR"
sync_dist
sync_file "$ROOT/web/server.js" "$APP_DIR/server.js"
if ! ssh "$TARGET" "test -f $APP_DIR/secrets.local.json"; then
  echo "== 上传 secrets (仅首次) =="
  sync_file "$ROOT/web/secrets.local.json" "$APP_DIR/secrets.local.json"
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
