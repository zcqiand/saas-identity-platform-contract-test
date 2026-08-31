# 设计与功能对齐 — SaaS身份平台契约一致性验证仓

> 人填、人评审。机器只检查功能 ID 存在性。
> 回答一个问题：**这个功能子项，落到哪段代码、哪张表、哪个权限码上？**
> 答不上来的行，说明设计没做完，别开工。

## 映射表

| 功能子项 ID | 页面/组件 | 接口 | 数据表 | 权限码 | 设计稿 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| M96.F01.I01 | — | harness: `src/normalize.ts` `ALWAYS_VOLATILE` | — | — | [ADR-0015 §Decision.2 normalize 剔除清单](../../../../docs/adr/0015-contract-test-repo.md) | 已上线 |
| M96.F01.I02 | — | harness: `src/normalize.ts` `normalizeDate` | — | — | ADR-0015 §Decision.2 | 已上线 |
| M96.F01.I03 | — | harness: `src/normalize.ts` `normalize` + `stable`（null ≡ 缺失） | — | — | ADR-0015 §Decision.2 | 已上线 |
| M96.F01.I04 | — | harness: `src/normalize.ts` `stable`（递归 key/数组排序） | — | — | ADR-0015 §Decision.2 | 已上线 |
| M96.F02.I01 | — | harness: `src/compare.ts` `compareStatuses` | — | — | ADR-0015 §Decision.2（status 全等判定） | 已上线 |
| M96.F02.I02 | — | harness: `src/compare.ts` `compareBodies` | — | — | ADR-0015 §Decision.2（normalize 后 body 全等） | 已上线 |
| M96.F02.I03 | — | `GET /api/v1/me/tenants` | `tenant_memberships` | — | [REQ-2026-009 §2 AC-1](../requirements/REQ-2026-009-read-endpoint-coverage.md) | 已上线 |
| M96.F02.I04 | — | `GET /api/v1/me` | `users` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I05 | — | `GET /api/v1/me/menus` | `role_menu_grants` / `menus` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I06 | — | `GET /api/v1/apps/{code}` | `apps` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I07 | — | `GET /api/v1/tenants/{t}/roles` | `roles` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I08 | — | `GET /api/v1/tenants/{t}/roles/{r}` | `roles` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I09 | — | `GET /api/v1/tenants/{t}/roles/{r}/menus` | `role_menu_grants` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I10 | — | `GET /api/v1/tenants/{t}/users` | `users` / `tenant_memberships` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I11 | — | `GET /api/v1/tenants/{t}/users/{u}` | `users` / `tenant_memberships` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I12 | — | `GET /api/v1/tenants/{t}/audit-events` | `audit_events` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I13 | — | `GET /api/v1/tenants/{t}/audit-events/by-user/{u}` | `audit_events` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I14 | — | `GET /api/v1/tenants/{t}/audit-events/retention` | `audit_retention_policies` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I15 | — | `GET /api/v1/tenants/{t}/api-keys` | `api_keys` | — | REQ-2026-009 §2 AC-1 | 已上线 |
| M96.F02.I16 | — | `POST /api/v1/tenants/{t}/api-keys` | — | — | [REQ-2026-008 §2 AC-1](../requirements/REQ-2026-008-write-endpoint-coverage.md) | 已上线 |
| M96.F02.I17 | — | `POST /api/v1/tenants/{t}/api-keys/{k}/revoke` | — | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I18 | — | `GET /api/v1/tenants/{t}/audit-events?action=` | `audit_events` (metadata.apiKeyId) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F03.I01 | — | harness: `src/http.ts` POST/PATCH/PUT/DELETE + `src/unique.ts` + `src/teardown.ts` | — | — | REQ-2026-008 §3 T-1 | 已上线 |
| M96.F03.I02 | — | harness: `src/targets.ts` `selectedTargets` + `TargetError` | — | — | ADR-0015 §Decision.4（声明即必须可达） | 已上线 |

## 约定

1. **权限码 = 功能子项 ID。** 前端按钮的权限判断直接写 ID。
2. 一个接口服务多个子项时，多行重复写。不要为表好看而合并 —— 合并后看不清接口还有没有别的调用方。
3. 状态列必须与功能清单一致。不一致以功能清单为准。

## 评审时问这三个问题

1. 有没有子项没有权限码？→ 那它就是任何人都能点的按钮
2. 有没有一张表被三个以上模块直接写入？→ 边界破了
3. 「开发中」的行里接口和表填了吗？→ 没填就是还在纸上，别报进度
