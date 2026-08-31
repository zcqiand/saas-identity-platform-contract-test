# REQ-2026-008 写端点契约覆盖 (api-key 写 + audit 副作用)

| 项 | 值 |
|---|---|
| 提出人 | suite-operator |
| 提出日期 | 2026-08-31 |
| 优先级 | P1 |
| 状态 | 已验收 |
| 关联 ADR | suite `docs/adr/0015-contract-test-repo.md` |

## 1. 需求描述

> 用户原话：「端点扩展 (audit write / api-keys create / 多仓实装) multi-day，跨 4 后端 + msw + 写测试」
>
> 收口为：「断言写端点产生审计事件」+「每目标唯一 body + 形状比对 + revoke 收尾」+「一次性全做完再验」。

### 澄清记录

| 疑问 | 澄清结论 | 澄清人 | 日期 |
|---|---|---|---|
| audit write 是新增 HTTP 端点？ | 否。契约里没有 audit 摄入端点（insert-only 设计）。收口为「写操作后 audit_events 出现对应事件」。 | suite-operator | 2026-08-31 |
| 共享 PG 写怎么隔离？ | 每 target 用 `uniqueName()` + `metadata.apiKeyId` 过滤 + afterAll revoke 收尾（200/404 容差）。 | suite-operator | 2026-08-31 |
| 是否动 normalize？ | 否。volatile 字段（actorUserId）走 I-row 形状比对规避，不进 ALWAYS_VOLATILE。 | suite-operator | 2026-08-31 |
| actorUserId 怎么对齐？ | 不强制对齐。msw=undefined（系统），3 真后端=alice；I18 形状比对只取 `{action, metadata.apiKeyId, tenantId}`。 | suite-operator | 2026-08-31 |

## 2. 验收标准

| 编号 | 场景（给定） | 操作（当） | 预期（则） |
|---|---|---|---|
| AC-1 | 4 后端实跑 (msw:5174 / aspnetcore:5000 / springboot:8080 / nextjs:3000) + CONTRACT_TARGETS 声明 | 跑 `npx vitest run tests/tenant-api-keys-write.test.ts` | 12 passed / 0 failed / 0 skipped |
| AC-2 | 同上 | 跑 `npx vitest run` | 100 passed / 0 failed / 8 skipped（88 baseline + 12 new） |
| AC-3 | 全跑后 | `python scripts/gate.py -p saas-identity-platform-contract-test` | exit 0 |
| AC-4 | TRACE_MAP=1 run 后 | 查 `.state/trace.json` | M96.F02.I16/I17/I18 均为非 inert |

## 3. 任务拆解

| 任务 ID | 任务描述 | 类型 | 负责人 | 预估 | 状态 |
|---|---|---|---|---|---|
| T-1 | harness 写支持（src/http.ts POST/PATCH/PUT/DELETE + unique.ts + teardown.ts） | 实现 | suite-operator | 0.5 d | 已完成 |
| T-2 | msw oracle emit api_key_created/revoked + `?action=` filter | 实现 | suite-operator | 0.1 d | 已完成 |
| T-3 | shared TypeSpec + function-tree rows + openapi regen | 实现 | suite-operator | 0.2 d | 已完成 |
| T-4 | aspnetcore AuditWriter + Program.cs DI + CompositionRootTests | 实现 | suite-operator | 0.3 d | 已完成 |
| T-5 | springboot AuditWriter + TenantApiKeyService 接线 | 实现 | suite-operator | 0.3 d | 已完成 |
| T-6 | nextjs lib/audit.ts + api-keys POST/revoke 接线 | 实现 | suite-operator | 0.3 d | 已完成 |
| T-7 | contract-test I16/I17/I18 + afterAll teardown | 实现 | suite-operator | 0.5 d | 已完成 |
| T-8 | 文档（function-tree + REQ + design-function-map） | 实现 | suite-operator | 0.3 d | 已完成 |
| T-9 | 6 仓 commit/push + 4 后端实跑 + gate.py | 验证 | suite-operator | 0.5 d | 已完成 |

## 4. 功能影响（需求与功能对齐唯一位置）

| 功能 ID | 功能名称 | 影响类型 | 说明 | 关联任务 |
|---|---|---|---|---|
| M96.F02.I16 | POST /api-keys 四方比对 | 新增 | harness + I-row | T-1, T-7 |
| M96.F02.I17 | POST /api-keys/:id/revoke 四方比对 | 新增 | harness + I-row | T-1, T-7 |
| M96.F02.I18 | 写端点副作用 — audit_events 进 | 新增 | I18 shape 比对 | T-1, T-7 |

> api-key + audit 是 shared 仓契约面的 ID，在 `../saas-identity-platform-shared/docs/functions/function-tree.md` 登记；本仓契约面只认 M96.*。L5 check_deploy_parity 与 L5 alignment 共享同一索引但跨仓 ID 不入 L5 引用完整性检查。

## 5. 风险与回滚

1. **共享 PG audit_events 累积** — 不回滚。metadata.apiKeyId 过滤 + uniqueName() 保证每次跑独立。
2. **msw actorUserId = undefined** — 不回滚。I18 shape 比对刻意剔除 actorUserId；契约本身不要求 actor 一致。
3. **aspnetcore composition root 盲区** — IAuditWriter 注册加 CompositionRootTests 断言（记忆：composition-root-blind-spot）。
4. **springboot stringtype=unspecified** — pre-flight 已验证 application.yml:31；V006 audit_action enum 安全。

## 6. 范围之外（下一批）

- user_created / role_assigned / oauth_token_issued 4 后端 emit 补齐
- nextjs `audit-events POST export` 端点
- 任何 UI 改造
- normalize volatile 字段扩容（不变更）
