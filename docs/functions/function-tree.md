# 功能清单（Function Tree）— SaaS身份平台契约一致性验证仓

> **全体系唯一锚点。** 需求、流程、设计、测试都引用这里的 ID。
> 不在这里的 ID 是悬空引用，L5 门会拦。**改功能，先改这份表。**
>
> 本仓使用**保留命名空间 `M96`**（msw 仓已占 `M99`）。它不镜像 BASE 业务模块——
> 声明的是「验证层自己的功能」。跨仓检查方式是命名空间归属，不是集合比对。
> 依据：suite `docs/adr/0013-alignment-has-two-directions.md` + `0015-contract-test-repo.md`。

## 编号规则

| 层级 | 名称 | 格式 | 含义 |
|---|---|---|---|
| 一级 | 功能模块 | `M01` | 业务域边界，通常对应一级菜单 |
| 二级 | 功能 | `M01.F01` | 一个完整业务步骤 / 独立闭环流程 / 数据管理页面 |
| 三级 | 功能子项 | `M01.F01.I01` | 最小操作单元。标签页、查询条件、增删改查/审核/导入导出按钮 |

**硬规则**

1. 编号单调递增，永不复用。废弃改状态，不删行。
2. 子项编号必须以父级为前缀。
3. 一个子项 = 一个权限点。权限码即 ID，不另起一套编码。
4. 拆不出子项的功能 → 它其实是子项，往上并。子项超 20 个 → 它其实是模块，往下拆。

**状态**：`规划` | `开发中` | `已上线` | `已废弃`
**子项类型**：`页面` | `标签页` | `查询` | `按钮` | `报表` | `接口`

---

## 模块总览

| 模块 ID | 模块名称 | 业务域边界 | 状态 |
|---|---|---|---|
| M01 | （init_project 占位） | 从未是真实功能；本仓真实模块见 M96 | 已废弃 |
| M96 | 契约一致性验证 | 黑盒 HTTP 打每个后端，验「前端不可区分」 | 开发中 |

---

## M01 （init_project 占位）

| 功能 ID | 功能名称 | 闭环定义 | 状态 |
|---|---|---|---|
| M01.F01 | （init_project 占位） | | 已废弃 |

### M01.F01 （init_project 占位）

| 子项 ID | 名称 | 类型 | 说明 | 状态 |
|---|---|---|---|---|
| M01.F01.I01 | （init_project 占位） | 查询 | 脚手架生成的空行，非真实功能。号不回收 | 已废弃 |

---

## M96 契约一致性验证

| 功能 ID | 功能名称 | 闭环定义 | 状态 |
|---|---|---|---|
| M96.F01 | normalize 契约 | 把「同输出」从『逐字节相同』翻译成『前端不可区分』 | 已上线 |
| M96.F02 | 四方比对 | 同一请求打 N 个后端 → status 全等 + normalize 后全等 | 开发中 |
| M96.F03 | 目标声明与可达性 | 声明了就必须可达，不许静默跳过 | 已上线 |

### M96.F01 normalize 契约

| 子项 ID | 名称 | 类型 | 说明 | 状态 |
|---|---|---|---|---|
| M96.F01.I01 | 剔除非确定性字段 | 接口 | token/jti 总是剔；ID 默认保留（三个真后端共库，UUID 本该相等），仅比对含 msw 时传 `ID_KEYS` | 已上线 |
| M96.F01.I02 | 日期归一化到 UTC Z | 接口 | Jackson 出 `+00:00`、System.Text.Json 出 `Z`，OpenAPI 层面都合法 | 已上线 |
| M96.F01.I03 | 缺失与显式 null 等价 | 接口 | Spring `NON_ABSENT` 省略 null，ASP.NET 默认输出 null | 已上线 |
| M96.F01.I04 | 递归排序 object key 与数组 | 接口 | 字段顺序与集合顺序不属于契约 | 已上线 |

### M96.F02 四方比对

| 子项 ID | 名称 | 类型 | 说明 | 状态 |
|---|---|---|---|---|
| M96.F02.I01 | status 全等 | 接口 | 前端的 catch 分支由状态码决定 | 已上线 |
| M96.F02.I02 | normalize 后 body 全等 | 接口 | 前端渲染由字段名/类型/必填决定；只报第一处分叉 | 已上线 |
| M96.F02.I03 | `GET /me/tenants` 四方比对 | 接口 | 首个落地端点：只读、无写、4 后端都实现。CI 实跑通过（trace 非 inert + gate exit 0） | 已上线 |
| M96.F02.I04 | `GET /me` 四方比对 | 接口 | alice profile（id/email/memberships）；CurrentUser 单对象 | 已上线 |
| M96.F02.I05 | `GET /me/menus` 四方比对 | 接口 | 按 appCode 分组的菜单树，map<string,EffectiveMenuNode[]> | 已上线 |
| M96.F02.I06 | `GET /apps/{code}` 四方比对 | 接口 | 公开 AppPublicInfo；带 Bearer 探 | 已上线 |
| M96.F02.I07 | `GET /tenants/{t}/roles` 四方比对 | 接口 | 角色列表，分页包装 `{items,page,pageSize,total}` | 已上线 |
| M96.F02.I08 | `GET /tenants/{t}/roles/{r}` 四方比对 | 接口 | 单个 Role | 已上线 |
| M96.F02.I09 | `GET /tenants/{t}/roles/{r}/menus` 四方比对 | 接口 | 角色绑定的菜单 ID 列表 | 已上线 |
| M96.F02.I10 | `GET /tenants/{t}/users` 四方比对 | 接口 | 用户列表，分页包装 | 已上线 |
| M96.F02.I11 | `GET /tenants/{t}/users/{u}` 四方比对 | 接口 | 单个 User | 已上线 |
| M96.F02.I12 | `GET /tenants/{t}/audit-events` 四方比对 | 接口 | 审计事件列表，分页包装 | 已上线 |
| M96.F02.I13 | `GET /tenants/{t}/audit-events/by-user/{u}` 四方比对 | 接口 | by-user 过滤的审计事件 | 已上线 |
| M96.F02.I14 | `GET /tenants/{t}/audit-events/retention` 四方比对 | 接口 | 留存策略 `{retentionDays:int32}` | 已上线 |
| M96.F02.I15 | `GET /tenants/{t}/api-keys` 四方比对 | 接口 | api-keys 列表，分页包装 | 已上线 |
| M96.F02.I16 | `POST /tenants/{t}/api-keys` 四方比对 | 接口 | 创 key：201 + 必填字段 shape 比对；target.keyId 入 ctx 供 I17/I18 | 已上线 |
| M96.F02.I17 | `POST /tenants/{t}/api-keys/{k}/revoke` 四方比对 | 接口 | 200 + revokedAt 必填；真后端 idempotent，msw 二次 404 | 已上线 |
| M96.F02.I18 | 写端点副作用 — api_key_created/revoked 进 audit_events | 接口 | 250ms buffer 后 GET ?action=，按 metadata.apiKeyId 过滤找自己刚创的 key；shape 比对，actorUserId 不参与（msw=undefined vs real=alice） | 已上线 |
| M96.F02.I19 | `POST /tenants/{t}/users` 四方比对 | 接口 | 创 user：200/201 + 必填字段 shape 比对；status 固定 `active`（4 后端契约面，msw 真后端全一致）；target.userId 入 ctx（cleanup 用 DELETE） | 已上线 |
| M96.F02.I20 | `PUT /tenants/{t}/roles/{r}/menus` 四方比对 | 接口 | 整批替换 setRoleMenus：200 + roleId/tenantId/menuIds/updatedAt 必填；menuIds 长度按 TARGET_MENU_IDS | 已上线 |
| M96.F02.I21 | `DELETE /tenants/{t}/api-keys/{k}` 四方比对 | 接口 | 物理删：204 + 幂等（重复删 → 404）；M05.F01.I05 跨后端覆盖；msw/springboot NoSuchElementException→404，aspnetcore KeyNotFoundException→404 | 已上线 |
| M96.F02.I22 | `POST /auth/login` 四方比对 | 接口 | 正确凭证 200 shape 比对（token 剔除）+ 错误密码 4xx 全等；M03.F01.I01 跨后端覆盖 | 已上线 |
| M96.F02.I23 | `POST /auth/logout` 四方比对 | 接口 | 带有效 session 200/204 全等；M03.F03.I05 跨后端覆盖 | 已上线 |
| M96.F02.I24 | `POST /auth/refresh` 四方比对 | 接口 | login 的 refreshToken 各自换新对，token 剔除后 shape 比对；M03.F02.I04 跨后端覆盖；前置 msw 补确定性 handler | 已上线 |
| M96.F02.I25 | `POST /auth/oidc/callback` 四方比对 | 接口 | 只比错误分支（无 code/错误 4xx），不依赖真 IdP；M03.F02.I03 跨后端覆盖 | 已上线 |
| M96.F02.I26 | `POST /oauth/authorize` 四方比对 | 接口 | 合法 client_id + alice session → {code,state} shape（code 一次性，normalize 剔除）；错 client_id 4xx 全等；M04.F02.I07 跨后端覆盖 | 已上线 |
| M96.F02.I27 | `POST /oauth/token` 四方比对 | 接口 | authorize 的 code 换 token，token 剔除后 shape 比对；M04.F02.I08 跨后端覆盖 | 已上线 |
| M96.F02.I28 | `POST /me/tenants/{t}/switch` 四方比对 | 接口 | alice 切到自己所属 tenant → 200 shape；切不存在 tenant → 4xx 全等；M00.F02.I03 跨后端覆盖；前置 msw 补确定性 handler | 已上线 |
| M96.F02.I29 | `GET /admin/tenants` 四方比对 | 接口 | 平台 admin 租户列表，只读分页包装 shape；dev 模式 authenticated 即可打 admin/** | 已上线 |
| M96.F02.I30 | `POST /admin/tenants` 四方比对 | 接口 | 唯一化前缀 `ct-<ts>-` 创 tenant，201 + 必填 shape；id 入 ctx 供 I31/I32/I33 | 已上线 |
| M96.F02.I31 | `GET /admin/tenants/{id}` 四方比对 | 接口 | 用 I30 创的 tenant 逐后端 GET（id 各自持有）；不存在 id → 404 全等 | 已上线 |
| M96.F02.I32 | `PATCH /admin/tenants/{id}` 四方比对 | 接口 | 改 name → 200 + updatedAt 必填 shape 比对 | 已上线 |
| M96.F02.I33 | `DELETE /admin/tenants/{id}` 四方比对 | 接口 | 物理删 204 + 幂等（重复删 → 404）；teardown 兜底 | 已上线 |
| M96.F02.I34 | `POST /tenants/{t}/roles` 四方比对 | 接口 | 创 role：唯一化 code 防共库 UNIQUE；200/201 + 必填 shape；id 入 ctx 供 I35–I37；M02.F01.I02 跨后端覆盖 | 已上线 |
| M96.F02.I35 | `PATCH /tenants/{t}/roles/{r}` 四方比对 | 接口 | 改 name → 200 + updatedAt；不存在 id → 404 全等；M02.F01.I04 跨后端覆盖 | 已上线 |
| M96.F02.I36 | `PUT /tenants/{t}/roles/{r}/permissions` 四方比对 | 接口 | 设 permissionIds → 200 + 响应回带（集合语义，顺序不比）；M02.F02.I01 跨后端覆盖 | 已上线 |
| M96.F02.I37 | `DELETE /tenants/{t}/roles/{r}` 四方比对 | 接口 | 物理删 200/204 + 幂等（重复删 → 404）；M02.F01.I05 跨后端覆盖 | 已上线 |
| M96.F02.I38 | `DELETE /tenants/{t}/roles/{r}/menus` 四方比对 | 接口 | 清空 seed 共享 role（acme admin）授权：先 GET 记原状、断言后 PUT 还原（I20 同模式）；M09.F02.I03 跨后端覆盖 | 已上线 |
| M96.F02.I39 | `PATCH /tenants/{t}/users/{u}` 四方比对 | 接口 | 改 displayName → 200 + updatedAt；不存在 id → 404 全等；M01.F01.I04 跨后端覆盖 | 已上线 |
| M96.F02.I40 | `PUT /tenants/{t}/users/{u}/roles` 四方比对 | 接口 | 设 roleIds（seed acmeMember）→ 200 + GET 复核（authoritative 在 memberships）；M01.F02.I01 跨后端覆盖 | 已上线 |
| M96.F02.I41 | `PATCH /tenants/{t}/users/{u}/status` 四方比对 | 接口 | active → suspended → active 往返，终态还原 active；M01.F02.I03 跨后端覆盖 | 已上线 |
| M96.F02.I42 | `POST /tenants/{t}/users/invitations` 四方比对 | 接口 | 邀请 email → 200/201 + status=invited；id 供 I43 删除；M01.F02.I02 跨后端覆盖 | 已上线 |
| M96.F02.I43 | `DELETE /tenants/{t}/users/{u}` 四方比对 | 接口 | 删 I42 邀请行 → 200/204 + 幂等（重复 → 404）；M01.F01.I05 跨后端覆盖 | 已上线 |
| M96.F02.I44 | `GET /admin/apps` 四方比对 | 接口 | 平台 app 列表分页 shape（msw 不共库 → drop items/total）；M07.F01.I01 跨后端覆盖 | 已上线 |
| M96.F02.I45 | `POST /admin/apps` 四方比对 | 接口 | 创 app（code/name/clientId/redirectUris 必填）→ 200/201；id 入 ctx 供 I46–I49；M07.F01.I02 跨后端覆盖 | 已上线 |
| M96.F02.I46 | `GET /admin/apps/{appId}` 四方比对 | 接口 | 取自建 app → 200；不存在 id → 404 全等；M07.F01.I03 跨后端覆盖 | 已上线 |
| M96.F02.I47 | `PATCH /admin/apps/{appId}` 四方比对 | 接口 | 改 name → 200 + updatedAt；M07.F01.I04 跨后端覆盖 | 已上线 |
| M96.F02.I48 | `DELETE /admin/apps/{appId}` 四方比对 | 接口 | 物理删 200/204 + 幂等（重复 → 404）；M07.F01.I05 跨后端覆盖 | 已上线 |
| M96.F02.I49 | `PATCH /admin/apps/{appId}/status` 四方比对 | 接口 | active → disabled → active 往返（排在 I48 前：status 往返需行还在）；M07.F02.I06 跨后端覆盖 | 已上线 |
| M96.F02.I50 | `GET /admin/apps/{appId}/menus` 四方比对 | 接口 | seed lab-mgmt 菜单扁平数组 Menu[] shape；M08.F01.I01 跨后端覆盖 | 已上线 |
| M96.F02.I51 | `POST /admin/apps/{appId}/menus` 四方比对 | 接口 | 创 menu A/B 对（reorder/parent 用）→ 200/201 + 字段；不碰 seed 行（role grant 引用）；M08.F01.I02 跨后端覆盖 | 已上线 |
| M96.F02.I52 | `GET /admin/apps/{appId}/menus/{menuId}` 四方比对 | 接口 | 取自建 menu → 200 + id 回带；不存在 id → 404 全等；M08.F01.I03 跨后端覆盖 | 已上线 |
| M96.F02.I53 | `PATCH /admin/apps/{appId}/menus/{menuId}` 四方比对 | 接口 | 改 name → 200；M08.F01.I04 跨后端覆盖 | 已上线 |
| M96.F02.I54 | `DELETE /admin/apps/{appId}/menus/{menuId}` 四方比对 | 接口 | 删自建 menu 对 → 200/204 + 幂等（重复 → 404）；M08.F01.I05 跨后端覆盖 | 已上线 |
| M96.F02.I55 | `PUT /admin/apps/{appId}/menus/{menuId}/reorder` 四方比对 | 接口 | A/B 换序 → 200 + Menu[]（同 parent 同级语义，排在 I56 parent 前）；M08.F02.I06 跨后端覆盖 | 已上线 |
| M96.F02.I56 | `PATCH /admin/apps/{appId}/menus/{menuId}/parent` 四方比对 | 接口 | B 挂 A 下 → 200 + parentId 回带，断言后还原顶级；M08.F02.I07 跨后端覆盖 | 已上线 |
| M96.F02.I57 | `POST /tenants/{t}/api-keys/{k}/rotate` 四方比对 | 接口 | 先创再 rotate：新 prefix/secret/status=active（≠旧值）；新旧行 teardown 物理 DELETE；M05.F01.I04 跨后端覆盖 | 已上线 |
| M96.F02.I58 | `POST /tenants/{t}/audit-events/export` 四方比对 | 接口 | {from,to,format} → 200 + {downloadUrl} shape（URL 本身 drop）；M06.F01.I03 跨后端覆盖 | 已上线 |
| M96.F02.I59 | `PUT /tenants/{t}/audit-events/retention` 四方比对 | 接口 | 设 42 → 回显，断言后还原 seed 原值（共享状态）；M06.F02.I02 跨后端覆盖 | 已上线 |
| M96.F02.I60 | `GET /admin/tenants` 分页 defaults 契约面 | 接口 | 不传 ?page/?pageSize → page=0/pageSize=20 全等（0-indexed 收口）；2026-09-01 从 I29 拆出独立锚点 | 已上线 |
| M96.F02.I61 | `GET /admin/tenants` 显式分页回显 | 接口 | ?page=1&pageSize=2 → 回显一致 + items ≤ pageSize；从 I29 拆出 | 已上线 |
| M96.F02.I62 | `GET /admin/tenants/{id}` 404 ErrorResponse envelope | 接口 | drop code/message 等 5 key 后骨架全等（前端 catch 分支依赖）；从 I31 拆出 | 已上线 |
| M96.F02.I63 | `GET /admin/apps` 显式分页回显 | 接口 | ?page=1&pageSize=2 → 回显一致；从 I44 拆出；live 已暴露 aspnetcore page=1 漂移待修 | 已上线 |
| M96.F02.I64 | `POST /admin/apps` 缺必填字段错误分支 | 接口 | 空 body → 4xx + envelope shape 全等；从 I45 拆出；live 已暴露 msw 返 201 的 oracle 缺陷待修 | 已上线 |
| M96.F02.I65 | `GET /admin/apps/{appId}` 404 ErrorResponse envelope | 接口 | 404 envelope shape 全等；从 I46 拆出 | 已上线 |
| M96.F02.I66 | `GET /admin/apps/{appId}/menus/{menuId}` 404 ErrorResponse envelope | 接口 | 404 envelope shape 全等；从 I52 拆出 | 已上线 |
| M96.F02.I67 | `POST /tenants/{t}/roles` 缺必填字段错误分支 | 接口 | 空 body → 4xx + envelope shape 全等；从 I34 拆出；live 已暴露 springboot body 分歧待修 | 已上线 |
| M96.F02.I68 | `PATCH /tenants/{t}/roles/{r}` 404 ErrorResponse envelope | 接口 | 404 envelope shape 全等；从 I35 拆出；live 已暴露 aspnetcore 500 待修 | 已上线 |
| M96.F02.I69 | `POST /tenants/{t}/users` 缺必填字段错误分支 | 接口 | 空 body → 4xx + envelope shape 全等；从 I19 拆出；live 已暴露 springboot body 分歧待修 | 已上线 |
| M96.F02.I70 | `PATCH /tenants/{t}/users/{u}` 404 ErrorResponse envelope | 接口 | 404 envelope shape 全等；从 I39 拆出；live 已暴露 aspnetcore 500 待修 | 已上线 |
| M96.F02.I71 | `GET /tenants/{t}/users` ?status= 过滤 | 接口 | 合法枚举 ?status=active → 200 + envelope 全等（不比 items）；从 I10 拆出；live 已暴露 springboot 400 待修 | 已上线 |
| M96.F02.I72 | `GET /tenants/{t}/audit-events` ?action= 过滤 | 接口 | 合法枚举 ?action=login_success → 200 + envelope 全等；从 I12 拆出 | 已上线 |
| M96.F02.I73 | `GET /tenants/{t}/audit-events` ?actorUserId= 过滤 | 接口 | 合法 UUID ?actorUserId → 200 + envelope 全等；从 I12 拆出 | 已上线 |

### M96.F03 目标声明与可达性

| 子项 ID | 名称 | 类型 | 说明 | 状态 |
|---|---|---|---|---|
| M96.F03.I01 | 目标端口声明 | 接口 | msw:5174 / nextjs:3000 / aspnetcore:5000 / springboot:8080，显式字面量，非 env 兜底 | 已上线 |
| M96.F03.I02 | 声明即必须可达 | 接口 | `CONTRACT_TARGETS` 列了却连不上 = 红；名字不认识 = 抛错，不静默忽略 | 已上线 |

---

## 维护约定

- 谁改功能，谁改表，同一个 commit。
- `规划` → `开发中`：必须先有需求文档引用它。
- `开发中` → `已上线`：L5 会警告它缺设计映射与测试引用。警告不阻断，由人裁量。
- **不给未真正运行的比对挂功能 ID**：四方比对未启用时，那条提示测试的描述里不写 `M96.*`，
  故 `M96.F02.I03` 在未跑活后端前不会被 trace 记为已覆盖。
