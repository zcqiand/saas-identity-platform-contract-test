#!/usr/bin/env bash
# scripts/start-family.sh — 本机一键起 4 后端 + live vitest + gate
#
# 用途: 在本机 (Git Bash / macOS / Linux) 模拟 .github/workflows/ci.yml 的核心步骤,
# 跑通 contract-test 完整 live 验证。
#
# 前提 (CI runner 自动满足, 本机要手动确保):
#   1. 5 sibling 仓已在 ../saas-identity-platform-{shared,msw,aspnetcore,springboot,nextjs}/
#      (suite 作为 multi-repo-family 用 gitlink 挂载, 本仓库目录下 output/ 自带)
#   2. 各后端 .env.local 指向 PG (本机走 Tailscale 100.79.128.25:5432, 远程节点)
#   3. dotnet 8 SDK + JDK 21 + Maven + Node 24 已装
#   4. 4 端口 5100/5104/5105/5101 空闲（2026-09-02 端口分段 §6）
#
# 与 ci.yml 区别:
#   - 不 git clone (本机 sibling 已在)
#   - 不 docker 起 PG (本机走 Tailscale 远程 PG)
#   - trap cleanup EXIT 自动 kill 4 后端子进程 (含 Ctrl+C)
#   - 同一份 healthcheck 路径真相源 (改一处必须同步另一处)
#
# 用法:
#   cd output/saas-identity-platform-contract-test
#   bash scripts/start-family.sh
#
# 退出码:
#   0 全部通过 (13 端点 live 比对 0 warning, gate exit 0)
#   1 任一 healthcheck 失败 / vitest 失败 / L5 软告警 > 0
#   2 前置检查失败 / trace.json shape 不符

set -euo pipefail

# === 路径定位 ===
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUITE_ROOT="$(cd "$CT_ROOT/../.." && pwd)"

# sibling 仓都在 suite 根的 output/ 下, 与 contract-test 平级
SHARED_DIR="$SUITE_ROOT/output/saas-identity-platform-shared"
MSW_DIR="$SUITE_ROOT/output/saas-identity-platform-msw"
ASPNETCORE_DIR="$SUITE_ROOT/output/saas-identity-platform-aspnetcore"
SPRINGBOOT_DIR="$SUITE_ROOT/output/saas-identity-platform-springboot"
NEXTJS_DIR="$SUITE_ROOT/output/saas-identity-platform-nextjs"

mkdir -p "$CT_ROOT/.runtime-logs"

# === 1. 前置检查 ===
echo "=== [1/6] 工具链 + sibling 仓 + 端口 ==="
missing_tools=()
for t in node npm dotnet mvn java python curl; do
  if ! command -v "$t" >/dev/null 2>&1; then
    missing_tools+=("$t")
  fi
done
if [ ${#missing_tools[@]} -gt 0 ]; then
  echo "FAIL: 缺工具链: ${missing_tools[*]}" >&2
  exit 2
fi

missing_repos=()
for d in "$SHARED_DIR" "$MSW_DIR" "$ASPNETCORE_DIR" "$SPRINGBOOT_DIR" "$NEXTJS_DIR"; do
  if [ ! -d "$d" ]; then
    missing_repos+=("$d")
  fi
done
if [ ${#missing_repos[@]} -gt 0 ]; then
  echo "FAIL: 缺 sibling 仓: ${missing_repos[*]}" >&2
  echo "  suite 用 gitlink 挂载, 仓应该在 $SUITE_ROOT/output/saas-identity-platform-*/" >&2
  exit 2
fi
echo "  ✓ 5 sibling 仓齐全 + 7 工具齐"

# 端口 preflight: 被老 node/dotnet 进程占着就 kill (上次跑没清的残留)。
# 只杀匹配已知后端进程名的进程 (next-server / Saas.Identity.AspNetCore /
# spring-boot:run / tsx), 不动用户其他 node 工作。
# Windows 上必须用 taskkill (kill -TERM 在 Git Bash 下杀不掉 native 进程)。
#
# 两轮清理:
#   1. 杀 4 端口 LISTENING 进程 (通常的端口冲突)
#   2. 杀匹配已知后端进程名的残留进程 (pre-LISTENING 阶段, 例如 mvn spring-boot:run
#      在 JPA entity manager fail 时 exit 但 mvn wrapper 还在, 或 nextjs 在 turbopack warmup)
echo "  [1/2] 检查 4 端口 LISTENING 残留进程..."
for p in 5100 5104 5105 5101; do
  pids=$(netstat -ano 2>/dev/null | awk -v port=":$p$" '$2 ~ port"$" && $4 == "LISTENING" {print $5}' | sort -u)
  for pid in $pids; do
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
      pname=$(powershell -NoProfile -Command "(Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName" 2>/dev/null | tr -d '\r')
      case "$pname" in
        node|java|SaaS.Identity.Host)
              echo "    端口 :$p 被 $pid ($pname) 占用, taskkill /F"
              taskkill //F //PID "$pid" > /dev/null 2>&1 ;;
        *)    echo "    端口 :$p 被 $pid ($pname) 占用 — 不是已知后端, 不杀, 让用户决定";;
      esac
    fi
  done
done
sleep 1

echo "  [2/2] 检查匹配后端进程名的残留进程 (pre-LISTENING 阶段)..."
# spring-boot:run 启动时 mvn wrapper 是 java.exe — 杀所有匹配 SaaS.Identity / spring-boot / tsx / next dev 的 java/node 进程
powershell -NoProfile -Command "
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    \$_.ProcessName -in @('java', 'node', 'dotnet', 'SaaS.Identity.Host') -and
    ((\$_.CommandLine -like '*spring-boot*') -or
     (\$_.CommandLine -like '*Saas.Identity.AspNetCore*') -or
     (\$_.CommandLine -like '*msw*server.ts*') -or
     (\$_.CommandLine -like '*next dev*'))
  } | ForEach-Object {
    Write-Host \"    \$(\$_.ProcessName) PID=\$(\$_.Id) \$(\$_.CommandLine.Substring(0, [Math]::Min(80, \$_.CommandLine.Length)))\"
    Stop-Process -Id \$_.Id -Force -ErrorAction SilentlyContinue
  }
" 2>&1 | head -10

sleep 2
echo "  ✓ 端口 preflight 完成"

# === 2. 各后端 gen-shared (读 shared 仓 OpenAPI 生成自己的客户端代码) ===
echo ""
echo "=== [2/6] 各后端 gen-shared (nextjs + springboot) ==="
# nextjs: npm run gen:shared — 读 ../saas-identity-platform-shared/generated/openapi/openapi.yaml
# springboot: bash scripts/gen-shared.sh — TypeSpec codegen + flyway migrations
# aspnetcore: NSwag 在 csproj build 时自动跑, 不需要单独 step
# msw: handlers/handlers-array.ts 是 shared emit:handlers 生成, 不需要单独 step
(cd "$NEXTJS_DIR" && npm run gen:shared 2>&1 | tail -3)
(cd "$SPRINGBOOT_DIR" && bash scripts/gen-shared.sh 2>&1 | tail -5)

# === 3. 后台起 4 后端 ===
echo ""
echo "=== [3/6] 后台起 4 后端 ==="
PIDS=()

# env 拆分策略:
#   COMMON_ENV = JWT_* / SAAS_CORS_* 等 4 后端共用 flat env (无 SERVER_PORT, 端口各自管)。
#   PER_BACKEND_SERVER_PORT = 每个后端各自 .env.example 读 SERVER_PORT 兜底,
#                 springboot 仓 .env.local 有 SERVER_PORT=8080 不能再直接复用 — 会让 aspnetcore
#                 也 listen :8080 与 springboot 冲突。
#   SPRINGBOOT_ONLY = springboot 特有 (DATABASE_USER/PASSWORD + JDBC_URL)。
#                 注意: springboot .env.local 的 DATABASE_URL=jdbc:postgresql://... 是 JDBC 格式,
#                 直接传给 aspnetcore 会让 ADO.NET 解析失败 (Format of initialization string does not conform)。
#                 所以 aspnetcore/msw/nextjs 用各自的 DB 连接源 (appsettings.json / 内嵌 / postgres.js),
#                 **不传** SPRINGBOOT_ONLY。
COMMON_ENV=$(grep -E '^(JWT_|SAAS_)' "$SPRINGBOOT_DIR/.env.local" | tr '\n' ' ')
SPRINGBOOT_ONLY=$(grep -E '^(DATABASE_USER|DATABASE_PASSWORD|DATABASE_NAME|JDBC_URL)' "$SPRINGBOOT_DIR/.env.local" | tr '\n' ' ')

# 各后端 SERVER_PORT 优先用各自 .env.local, 缺时 fallback .env.example, 最后硬编码兜底
# 注意: grep 无匹配返回 1, pipefail 会让 pipeline 整体返回 1, set -e 触发退出。
# 加 `|| true` 兜底, 缺 SERVER_PORT 时走 :="hardcode" 默认值。
MSW_PORT=$(grep -E '^SERVER_PORT' "$MSW_DIR/.env.example" 2>/dev/null | head -1 | cut -d= -f2 || true)
: "${MSW_PORT:=5100}"
ASPNETCORE_PORT=$(grep -E '^SERVER_PORT' "$ASPNETCORE_DIR/.env.example" 2>/dev/null | head -1 | cut -d= -f2 || true)
: "${ASPNETCORE_PORT:=5104}"
SPRINGBOOT_PORT=$(grep -E '^SERVER_PORT' "$SPRINGBOOT_DIR/.env.local" 2>/dev/null | head -1 | cut -d= -f2 || true)
: "${SPRINGBOOT_PORT:=5105}"
NEXTJS_PORT=$(grep -E '^SERVER_PORT' "$NEXTJS_DIR/.env.example" 2>/dev/null | head -1 | cut -d= -f2 || true)
: "${NEXTJS_PORT:=5101}"

# aspnetcore DATABASE_URL 兜底: appsettings.json 内嵌 Password=changeme 是占位,
# 不一定匹配 PG 真密码。从 springboot .env.local 那里拿真值, 加 single quote 包
# Password (绕过 ADO.NET 把 + 当 escape 字符的解析 bug)。
ASPNETCORE_PG_URL='Host=100.79.128.25;Port=5432;Database=saas_dev;Username=postgres;Password='\''qiand68+++'\'''

# msw: 2026-09-01 用 `npm start` 而不是 `npm run dev`,避免 tsx watch hot-reload
# 时 process.env 丢失导致 JWT_SIGNING_KEY 缺失,signAccessToken 抛 500
# (CLAUDE.md §5 列了 tsx-watch-丢失-env 的历史债)。
(cd "$MSW_DIR"        && nohup env $COMMON_ENV SERVER_PORT="$MSW_PORT"         npm start                                >"$CT_ROOT/.runtime-logs/msw.log"        2>&1) & PIDS+=($!)
# aspnetcore: 同时设 ASPNETCORE_URLS 强制端口 — SERVER_PORT 单独不够 (ServerPortShim 在
# ASPNETCORE_URLS 已设时 return null, 而 dotnet run 默认 launch profile = Production + ASPNETCORE_URLS=http://+:8080)。
(cd "$ASPNETCORE_DIR" && nohup env $COMMON_ENV SERVER_PORT="$ASPNETCORE_PORT" ASPNETCORE_URLS="http://+:$ASPNETCORE_PORT" DATABASE_URL="$ASPNETCORE_PG_URL" dotnet run --project src/Saas.Identity.AspNetCore.csproj >"$CT_ROOT/.runtime-logs/aspnetcore.log" 2>&1) & PIDS+=($!)
(cd "$SPRINGBOOT_DIR" && nohup env $COMMON_ENV $SPRINGBOOT_ONLY SERVER_PORT="$SPRINGBOOT_PORT" mvn -q spring-boot:run  >"$CT_ROOT/.runtime-logs/springboot.log" 2>&1) & PIDS+=($!)
(cd "$NEXTJS_DIR"     && nohup env $COMMON_ENV SERVER_PORT="$NEXTJS_PORT"      npm run dev                                >"$CT_ROOT/.runtime-logs/nextjs.log"     2>&1) & PIDS+=($!)

# nextjs 仓当前未实现 health endpoint (无 src/app/api/health/route.ts),
# healthcheck 必 FAIL。本机脚本自动跳过: 检测 route.ts 存在性。nextjs 加 endpoint 后
# 自动恢复 4 后端。NEXT_SKIP=1 强制跳过 (即使文件存在)。
NEXTJS_ACTIVE="true"
if [ "${NEXT_SKIP:-0}" = "1" ]; then NEXTJS_ACTIVE="false"; fi
if [ ! -f "$NEXTJS_DIR/src/app/api/health/route.ts" ]; then NEXTJS_ACTIVE="false"; fi

cleanup() {
  echo ""
  echo "=== cleanup: kill ${#PIDS[@]} children + grandchildren ==="
  for p in "${PIDS[@]}"; do kill -TERM "$p" 2>/dev/null || true; done
  # Git Bash 自带 pkill (来自 msys2); Windows 原生命令是 taskkill
  pkill -f Saas.Identity.AspNetCore 2>/dev/null || true
  pkill -f spring-boot:run          2>/dev/null || true
  pkill -f next-server              2>/dev/null || true
  pkill -f tsx                      2>/dev/null || true
  sleep 2
}
trap cleanup EXIT INT TERM

# === 4. healthcheck (90s 串行, 与 ci.yml 同) ===
echo ""
echo "=== [4/6] healthcheck 4 后端 (90s 串行) ==="
healthcheck() {
  local name=$1 url=$2
  for i in $(seq 1 90); do
    if curl -sf -o /dev/null --max-time 2 "$url"; then
      echo "  ✓ $name up after ${i}s"
      return 0
    fi
    sleep 1
  done
  echo "  ✗ $name FAIL within 90s at $url" >&2
  echo "  --- $name log tail-30 ---" >&2
  tail -n 30 "$CT_ROOT/.runtime-logs/$name.log" >&2 || true
  return 1
}

healthcheck msw        "http://localhost:5100/healthz"
healthcheck aspnetcore "http://localhost:5104/health"
healthcheck springboot "http://localhost:5105/actuator/health"
if [ "$NEXTJS_ACTIVE" = "true" ]; then
  healthcheck nextjs     "http://localhost:5101/api/health"
fi

# === 5. live vitest ===
echo ""
echo "=== [5/6] live vitest ==="
CONTRACT_TARGETS="msw,aspnetcore,springboot"
if [ "$NEXTJS_ACTIVE" = "true" ]; then
  CONTRACT_TARGETS="msw,aspnetcore,springboot,nextjs"
fi
echo "  CONTRACT_TARGETS=$CONTRACT_TARGETS"
# vitest 失败不中断 — contract-test 的目的是发现契约分叉, vitest failed 是结果不是故障。
# 让后续 [6/6] 继续跑 trace.json shape + L5 alignment, 由 L5 软告警统计覆盖率。
set +e
(
  cd "$CT_ROOT" && \
  CONTRACT_TARGETS="$CONTRACT_TARGETS" TRACE_MAP=1 npx --no vitest run
)
VITEST_EXIT=$?
set -e
echo "  vitest exit: $VITEST_EXIT (non-zero = 发现契约分叉, 看 [6/6] trace.json 详情)"

# === 6. trace.json shape + L5 alignment + gate ===
echo ""
echo "=== [6/6] trace.json shape + L5 alignment + gate ==="

# 6a. trace.json shape 断言
(
  cd "$CT_ROOT" && python - <<'PY'
import json, sys
d = json.load(open(".state/trace.json", encoding="utf-8"))
assert d.get("schema") == 1, f"schema={d.get('schema')!r}"
mode = d.get("mode")
targets = d.get("contract_targets", [])
non_inert = [t for t in d.get("tests", []) if not t.get("inert")]
fns = {fid for t in non_inert for fid in t.get("fns", [])}
expected = {f"M96.F02.I{n:02d}" for n in range(3, 22)}
miss = expected - fns
if mode != "live":
    print(f"FAIL: trace mode={mode!r} 不是 live")
    sys.exit(1)
if miss:
    print(f"FAIL: 19 端点覆盖缺失: {sorted(miss)}")
    sys.exit(1)
print(f"  ✓ mode={mode!r} targets={targets}")
print(f"  ✓ {len(non_inert)} non-inert tests, {len(fns)} 个 fn ID (含 I03-I21)")
PY
)

# 6b. L5 alignment
(cd "$SUITE_ROOT" && python scripts/checks/_alignment.py -p saas-identity-platform-contract-test)

# 6c. gate
(cd "$SUITE_ROOT" && python scripts/gate.py -p saas-identity-platform-contract-test)

echo ""
echo "=== 全部通过。Ctrl+C 或 exit 触发 cleanup。==="