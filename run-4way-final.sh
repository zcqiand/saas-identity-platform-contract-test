#!/usr/bin/env bash
# 终验脚本：在 contract-test 仓内跑四方 live 比对（输出落本仓）
set -u
cd "$(dirname "$0")" || exit 2
echo "CWD=$(pwd)"
npx tsc --noEmit || exit 3
CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs TRACE_MAP=1 \
  npx vitest run --reporter=default --reporter=json --outputFile=vitest-4way-final.json \
  > vitest-4way-final.log 2>&1
echo "exit=$?"
