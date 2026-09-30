# REQ-2026-011 接入 fastapi target（saas 家族第 5 后端，X07 槽位）

| 项 | 值 |
|---|---|
| 提出人 | zcqiand（fastapi 仓 REQ-2026-006 跨仓档，总纲 T-5） |
| 提出日期 | 2026-09-30 |
| 优先级 | P1 |
| 状态 | 已实现（2026-09-30，live 2-way 验证随 fastapi 仓批5 收口） |
| 关联 ADR | conventions multi-repo-family.md §6（X07=5107 已分配）；contract-test-run-live.md :25（「fastapi 批5 起即 springboot,fastapi」预案） |

## 1. 需求

saas 家族第 5 种后端（fastapi）批1-批4 已把 shared 契约端点 impl 全部落地，按
conventions §6 X07 槽位（:5107）接入本仓 target 名单，live 常态 2-way 人裁档
（springboot 参照 + fastapi 被测）验证契约面前端不可区分。

### 范围裁决（与 rails 接入先例对齐）

- **只动 `src/targets.ts`**（+ fastapi 仓侧实现 `/health` 落 DEFAULT_HEALTH，
  fnReporter HEALTH_PATHS 不加条目——rails 同款）。
- **schemathesis/run.py、check_ssot_coverage.mjs、start-family.sh 不动**——rails
  接入时三者均未含 rails；start-family.sh 是全家族 4-way 一键工具，与 2026-09-29
  「live 常态 2」人裁方向相反，不扩。
- **`.harness/stack.json` trace_env 不纳入 fastapi**——纳入即 gate 档要求 fastapi
  可达，属升档人裁；live 验证走显式 shell env。
- ci.yml（CI 4-way 档）不随本批动，待全家族收敛显式升档时再议。

### M96.F03.I01 描述照实修正

I01 描述硬编码的端口名单（msw:5174 / nextjs:3000 / aspnetcore:5000 /
springboot:8080）是 2026 年中旧值，与 targets.ts 现行（nextjs:5101 /
aspnetcore:5104 / springboot:5105 / rails:5106 / fastapi:5107）不符——照实修正为
「以 src/targets.ts 为 SSOT，端口=conventions §6 家族分段显式字面量」，不再在树里
维护第二份端口名单。

## 2. 验收

| 编号 | 场景 | 操作 | 预期 |
|---|---|---|---|
| AC-1 | fastapi 起在 :5107 | CONTRACT_TARGETS 拼入 fastapi | 名字认识、探活 `/health` 200、live 档激活 |
| AC-2 | springboot(:5105)+fastapi(:5107) 双活 saas_dev | `CONTRACT_TARGETS=springboot,fastapi TRACE_MAP=1 npx vitest run` | live 全绿：status 全等 + normalize 后全等；mode=live、contract_targets=springboot,fastapi |
| AC-3 | fastapi 缺席 | CONTRACT_TARGETS=springboot,fastapi 且 :5107 无进程 | 红（声明即必须可达），不是 skip |

## 3. 任务拆解

| 任务 ID | 任务描述 | 状态 |
|---|---|---|
| T-1 | src/targets.ts 加 fastapi:5107 + tests/compare.test.ts 端口单测对齐 | 已完成 |
| T-2 | 本 REQ + M96.F03.I01 描述照实修正 + 仓内文档同步（CLAUDE.md / ARCHITECTURE.md） | 已完成 |
| T-3 | live 2-way 验收（AC-2，随 fastapi 仓批5 T-4 同波跑） | 已完成 |

## 4. 功能影响

无新功能：M96.F03.I01/I02 已上线行的实例化（新 target 条目 + 可达性验证）。
变更 1 处：M96.F03.I01 描述照实修正（非语义变更）。

## 5. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| fastapi 后端行为与家族参照漂移 → live 红 | 红即家族契约回归信号（本仓存在价值），按报红逐用例归因 | targets.ts 删一行即退场，无持久状态 |
