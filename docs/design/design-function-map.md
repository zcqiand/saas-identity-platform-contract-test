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
| M96.F02.I19 | — | `POST /api/v1/tenants/{t}/users` | `users` (status 固定 active, 4 后端契约面) + `audit_events` (user_created) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I20 | — | `PUT /api/v1/tenants/{t}/roles/{r}/menus` | `role_menu_grants` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I21 | — | `DELETE /api/v1/tenants/{t}/api-keys/{k}` | `api_keys` (硬删；幂等返 204 / 404) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I22 | — | `POST /api/v1/auth/login` | `users` (session 验证) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I23 | — | `POST /api/v1/auth/logout` | saas session 撤销 | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I24 | — | `POST /api/v1/auth/refresh` | refresh token rotate 存储 | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I25 | — | `POST /api/v1/auth/oidc/callback` | `oauth_codes` (错误分支) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I26 | — | `POST /api/v1/oauth/authorize` | `oauth_codes` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I27 | — | `POST /api/v1/oauth/token` | `oauth_codes` / refresh token | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I28 | — | `POST /api/v1/me/tenants/{t}/switch` | `tenant_memberships` 校验 + 签发 | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I29 | — | `GET /api/v1/admin/tenants` | `tenants` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I30 | — | `POST /api/v1/admin/tenants` | `tenants` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I31 | — | `GET /api/v1/admin/tenants/{id}` | `tenants` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I32 | — | `PATCH /api/v1/admin/tenants/{id}` | `tenants` (updatedAt) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I33 | — | `DELETE /api/v1/admin/tenants/{id}` | `tenants` (硬删；幂等 204 / 404) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I34 | — | `POST /api/v1/tenants/{t}/roles` | `roles` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I35 | — | `PATCH /api/v1/tenants/{t}/roles/{r}` | `roles` (updatedAt) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I36 | — | `PUT /api/v1/tenants/{t}/roles/{r}/permissions` | `roles.permissionIds` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I37 | — | `DELETE /api/v1/tenants/{t}/roles/{r}` | `roles` (硬删；幂等 404) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I38 | — | `DELETE /api/v1/tenants/{t}/roles/{r}/menus` | `role_menu_grants` (清空；测后还原) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I39 | — | `PATCH /api/v1/tenants/{t}/users/{u}` | `users` (updatedAt) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I40 | — | `PUT /api/v1/tenants/{t}/users/{u}/roles` | `tenant_memberships` (authoritative) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I41 | — | `PATCH /api/v1/tenants/{t}/users/{u}/status` | `users.status` (往返还原) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I42 | — | `POST /api/v1/tenants/{t}/users/invitations` | `users` (status=invited) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I43 | — | `DELETE /api/v1/tenants/{t}/users/{u}` | `users` (硬删；幂等 404) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I44 | — | `GET /api/v1/admin/apps` | `apps` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I45 | — | `POST /api/v1/admin/apps` | `apps` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I46 | — | `GET /api/v1/admin/apps/{appId}` | `apps` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I47 | — | `PATCH /api/v1/admin/apps/{appId}` | `apps` (updatedAt) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I48 | — | `DELETE /api/v1/admin/apps/{appId}` | `apps` (硬删；幂等 404) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I49 | — | `PATCH /api/v1/admin/apps/{appId}/status` | `apps.status` (往返还原) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I50 | — | `GET /api/v1/admin/apps/{appId}/menus` | `menus` (扁平) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I51 | — | `POST /api/v1/admin/apps/{appId}/menus` | `menus` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I52 | — | `GET /api/v1/admin/apps/{appId}/menus/{menuId}` | `menus` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I53 | — | `PATCH /api/v1/admin/apps/{appId}/menus/{menuId}` | `menus` (updatedAt) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I54 | — | `DELETE /api/v1/admin/apps/{appId}/menus/{menuId}` | `menus` (硬删；幂等 404) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I55 | — | `PUT /api/v1/admin/apps/{appId}/menus/{menuId}/reorder` | `menus.sortOrder` | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I56 | — | `PATCH /api/v1/admin/apps/{appId}/menus/{menuId}/parent` | `menus.parentId` (测后还原顶级) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I57 | — | `POST /api/v1/tenants/{t}/api-keys/{k}/rotate` | `api_keys` (旧 revoke + 新行) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I58 | — | `POST /api/v1/tenants/{t}/audit-events/export` | `audit_events` (读区间) | — | REQ-2026-008 §2 AC-1 | 已上线 |
| M96.F02.I59 | — | `PUT /api/v1/tenants/{t}/audit-events/retention` | `audit_retention_policies` (测后还原) | — | REQ-2026-008 §2 AC-1 | 已上线 |
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
