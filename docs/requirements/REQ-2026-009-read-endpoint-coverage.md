# REQ-2026-009 读端点契约覆盖 (13 个 GET 端点四方比对)

| 项 | 值 |
|---|---|
| 提出人 | suite-operator |
| 提出日期 | 2026-08-31 |
| 优先级 | P1 |
| 状态 | 已验收 |
| 关联 ADR | suite `docs/adr/0015-contract-test-repo.md` + `0016-contract-test-live-mode.md` |

## 1. 需求描述

> 用户原话：「13 个 GET 端点（me / me/tenants / me/menus / apps/{code} / roles / roles/{r} / roles/{r}/menus / users / users/{u} / audit-events / audit-events/by-user / audit-events/retention / api-keys）已写完 tests/*.test.ts，但 live mode 从未实跑过；CI 默认走 unit mode，trace.json 全 inert，门绿但契约一致性无信号。」
>
> 收口为：「补完整文档 + 升状态到「已上线」+ 闭合 CI 编排 + 加 require_live 防御」+「live 跑过一次且 status 200 + normalize 全等 + trace 13 个非 inert + gate exit 0 + L5 软告警 0」。

### 澄清记录

| 疑问 | 澄清结论 | 澄清人 | 日期 |
|---|---|---|---|
| I03 之前是 ADR-0015 §7 指定的「第一个真端点」,要先单独升吗? | 否。用户拍板「一次性升 13 个」——A1 防御上完 + CI workflow 接通后,live 跑过一次 13 端点全绿则一起升。 | suite-operator | 2026-08-31 |
| shape 比对里 actorUserId/roleIds 这种 volatile 字段怎么办? | 不进 `ALWAYS_VOLATILE`。msw 与真后端的差别走 I-row 必填字段断言 + `compareBodies` normalize 后的全等判定;只有「完全无法对齐」的字段才在 extraDrop 里临时剔除(同 REQ-008 I18 处理 actorUserId 的方式)。 | suite-operator | 2026-08-31 |
| audit-events I12/I13 是分页包装,items 内容每次不同怎么比? | envelope (`page`, `pageSize`) 比对 + items 必填字段名集合断言;items 数据本身不参与 normalize 比对。已在 [tests/tenant-audit-read.test.ts:54-62](../design/../tests/tenant-audit-read.test.ts#L54) 通过 dynamicDrop 落实。 | suite-operator | 2026-08-31 |
| apps-public 是否要验匿名访问? | 不在本次范围。已知设计抉择:Bearer 路径覆盖契约面;无 Authorization 头由 family convention 公开路径保证,单独 describe 留待后续。 | suite-operator | 2026-08-31 |
| 是否要写 ADR-0016 记录 require_live 决策? | 是。跨 3 文件协同 (fnReporter + harness + stack.json) 必须有 ADR 锚定,否则未来软化无依据。 | suite-operator | 2026-08-31 |

## 2. 验收标准

| 编号 | 场景（给定） | 操作（当） | 预期（则） |
|---|---|---|---|
| AC-1 | 4 后端实跑 (msw:5174 / aspnetcore:5000 / springboot:8080 / nextjs:3000) + `CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs` + `TRACE_MAP=1` | 跑 `npx vitest run` | 13 个 GET 端点 describe 全部非 inert,合计 ~52 passed / 0 failed |
| AC-2 | 同上 | 跑 `python scripts/checks/_alignment.py -p saas-identity-platform-contract-test` | exit 0,`warnings_total: 0`,M96.F02.I03-I15 4 列对齐齐全 (requirements/flows/designs/tests 全非空) |
| AC-3 | 全跑后 | `python scripts/gate.py -p saas-identity-platform-contract-test` | exit 0,gate.json 5 道门全绿 |
| AC-4 | TRACE_MAP=1 run 后 | 查 `.state/trace.json` | `mode == "live"` 且 `contract_targets == ["msw","aspnetcore","springboot","nextjs"]`;M96.F02.I03-I15 全部出现在 non-inert tests 的 fns |
| AC-5 | 不设 CONTRACT_TARGETS(或只设单 target)跑 vitest + gate | 走 unit mode | gate exit 2,stderr 含 "stack.json 声明 require_live=true,但 trace.json 是 unit 模式" |

## 3. 任务拆解

| 任务 ID | 任务描述 | 类型 | 负责人 | 预估 | 状态 |
|---|---|---|---|---|---|
| T-1 | REQ-2026-009 + design-function-map 13 行 + flow-function-map 13 行孤儿表 + function-tree 13 行升「已上线」 | 文档 | suite-operator | 0.2 d | 已完成 |
| T-2 | `stack.json` 加 `require_live: true`;`fnReporter.ts` TraceFile 接口扩展 + flush 写 `mode`/`contract_targets`;`scripts/lib/harness.py` `load_trace` unit mode → ContractError | 防御层 | suite-operator | 0.3 d | 已完成 |
| T-3 | 新建 `.github/workflows/ci.yml`:checkout 6 sibling + 起 4 后端 + 90s healthcheck 串行 + vitest + L5 + gate | CI 编排 | suite-operator | 0.3 d | 已完成 |
| T-4 | ADR-0016-contract-test-live-mode.md 接续 ADR-0015 | 决策记录 | suite-operator | 0.1 d | 已完成 |
| T-5 | 本地端到端验证 (起 4 后端 + live vitest + trace.json shape 断言 + L5 alignment 0 warning + gate exit 0 + unit mode 反向 exit 2) | 验证 | suite-operator | 0.3 d | 已完成 |

## 4. 功能影响（需求与功能对齐唯一位置）

| 功能 ID | 功能名称 | 影响类型 | 说明 | 关联任务 |
|---|---|---|---|---|
| M96.F02.I03 | `GET /me/tenants` 四方比对 | 新增 | harness Tier A 只读;4 后端共库走 normalize 比对 | T-1, T-2, T-3 |
| M96.F02.I04 | `GET /me` 四方比对 | 新增 | CurrentUser 单对象;memberships 数组 | T-1, T-2, T-3 |
| M96.F02.I05 | `GET /me/menus` 四方比对 | 新增 | map<string, EffectiveMenuNode[]>;按 appCode 分组 | T-1, T-2, T-3 |
| M96.F02.I06 | `GET /apps/{code}` 四方比对 | 新增 | 公开 AppPublicInfo;带 Bearer 探 | T-1, T-2, T-3 |
| M96.F02.I07 | `GET /tenants/{t}/roles` 四方比对 | 新增 | 分页包装 `{items, page, pageSize, total}` | T-1, T-2, T-3 |
| M96.F02.I08 | `GET /tenants/{t}/roles/{r}` 四方比对 | 新增 | 单 Role;`roleId` 与查询参数一致性断言 | T-1, T-2, T-3 |
| M96.F02.I09 | `GET /tenants/{t}/roles/{r}/menus` 四方比对 | 新增 | RoleMenuGrant 单对象;`menuIds[]` | T-1, T-2, T-3 |
| M96.F02.I10 | `GET /tenants/{t}/users` 四方比对 | 新增 | 分页包装;`roleIds[]` 必填 + 数组类型断言 | T-1, T-2, T-3 |
| M96.F02.I11 | `GET /tenants/{t}/users/{u}` 四方比对 | 新增 | 单 User;`username === "alice"` | T-1, T-2, T-3 |
| M96.F02.I12 | `GET /tenants/{t}/audit-events` 四方比对 | 新增 | 分页包装;items 数据走 dynamicDrop,envelope 比对 | T-1, T-2, T-3 |
| M96.F02.I13 | `GET /tenants/{t}/audit-events/by-user/{u}` 四方比对 | 新增 | by-user 过滤;同 I12 envelope 比对 | T-1, T-2, T-3 |
| M96.F02.I14 | `GET /tenants/{t}/audit-events/retention` 四方比对 | 新增 | `{retentionDays: number}` 单对象 | T-1, T-2, T-3 |
| M96.F02.I15 | `GET /tenants/{t}/api-keys` 四方比对 | 新增 | 分页包装;envelope + items 字段集合,数据不参与 | T-1, T-2, T-3 |

> 13 个 ID 在 `docs/functions/function-tree.md` 状态「开发中」→「已上线」;本仓契约面只认 M96.*;shared 仓契约面 (Tenant / TenantMembership / CurrentUser / AppPublicInfo / Role / User / AuditEvent / ApiKey 等) 由 4 真后端的 OpenAPI 串联,不进本仓 function-tree。

## 5. 流程影响

无主流程变更。13 个端点全部进 `flow-function-map.md` 的「孤儿功能」表——读操作无业务流程,流程视角无法表达「同时打 4 端」的动作,声明即直写在 harness 自闭环。

## 6. 风险与回滚

1. **A1 hard 已上但 CI 未接通 → 全门红** — 见 plan §8 R1。临时绕过:`CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs` 前缀;彻底回滚:`git revert <defensive PR>`。
2. **13 个升状态后某端点契约分叉** — 见 plan §8 R2。不回退状态,先查 `compareAll` 输出区分真分叉 vs normalize 漏抽 vs describe 名拼错。
3. **CI 串行 healthcheck 太慢导致 timeout** — 当前 timeout-minutes: 25。aspnetcore 首次 build ~60s + springboot 首次跑 ~90s + nextjs turbopack warmup ~30s,合计 < 4 min;healthcheck 90s 兜底足够。若失败,调高 timeout 或并行 msw/nextjs 起 (它们快)、aspnetcore/springboot 串行。
4. **`Saas.Identity.AspNetCore.csproj` 路径或 nextjs `gen:shared` 命令名假设错** — 见 ci.yml 注释,实施时按子仓当前 PR 微调,不要盲目照搬。

---

## 7. 范围之外（下一批）

- 写端点第二期:POST /tenants/{t}/users、PUT /tenants/{t}/roles/{r}/menus、DELETE /tenants/{t}/api-keys/{k} 四方比对
- apps-public 匿名路径 (无 Authorization 头) 200 断言
- compareStatuses 加 `acceptedStatuses` 选项解决 I16 的 200/201 契约分叉
- I18 actorUserId 真正 drop 进 extraDrop(目前靠 normalize `null ≡ missing` 兜)
- ADR-0017:revoke 用 POST vs DELETE 的 REST 语义决策