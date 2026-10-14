#!/usr/bin/env bash
# 次元壁纸 Web 端冒烟验证 (无需浏览器): 语法 + 服务端 API + 静态资源。
# 布局顺序/交互类断言另走无头浏览器 (chrome-devtools MCP) 流程, 见 web/README.md。
# 用法: bash tools/web_verify.sh   (可用 PORT 环境变量改测试端口, 默认 8799)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8799}"
BASE="http://127.0.0.1:$PORT"

echo "== 语法 =="
node --check web/server.js && echo "  server.js OK"
if [ -f web/public/app.js ]; then
  cp web/public/app.js /tmp/.cy_verify.mjs && node --check /tmp/.cy_verify.mjs && rm -f /tmp/.cy_verify.mjs && echo "  public/app.js OK"
fi
if [ -d web/frontend/src ]; then
  (cd web/frontend && npx --no-install tsc --noEmit) && echo "  frontend TS OK"
fi

if [ ! -f web/secrets.local.json ]; then
  echo "== 跳过 API 断言: 缺 web/secrets.local.json (凭据不入库) =="
  exit 0
fi

echo "== 启动服务 (PORT=$PORT) =="
PORT="$PORT" node web/server.js >/tmp/.cy_verify_server.log 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  curl -sf -m 2 "$BASE/api/status" >/dev/null 2>&1 && break
  sleep 0.3
done

pass=0; fail=0
chk() { # chk <name> <cond-exit-code>
  if [ "$2" -eq 0 ]; then echo "  PASS $1"; pass=$((pass+1)); else echo "  FAIL $1"; fail=$((fail+1)); fi
}

curl -sf -m 5 "$BASE/api/status" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["code"]==0 else 1)'
chk "status code=0" $?

curl -sf -m 15 "$BASE/api/rank" | python3 -c 'import json,sys; j=json.load(sys.stdin); sys.exit(0 if j["code"]==0 and len(j["data"]["items"])==4 else 1)'
chk "rank 4 组" $?

curl -sf -m 30 "$BASE/api/wallpapers" | python3 -c '
import json,sys
j=json.load(sys.stdin); ws=j["wallpapers"]; ca=[int(w["createdAt"]) for w in ws]
sys.exit(0 if j["code"]==0 and len(ws)==100 and all(ca[i]>=ca[i+1] for i in range(len(ca)-1)) else 1)'
chk "wallpapers 100 条且 createdAt 降序" $?

code=$(curl -s -m 30 "$BASE/api/search?keyword=test" | python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])')
[ "$code" = "0" ] || [ "$code" = "-5" ]
chk "search 透传 (0=Pro 可用 / -5=付费墙)" $?

curl -sf -m 5 "$BASE/" | grep -qE 'filter-bar|id="root"'
chk "静态首页 200 且含入口节点" $?

echo "== 结果: $pass PASS, $fail FAIL =="
exit "$fail"
