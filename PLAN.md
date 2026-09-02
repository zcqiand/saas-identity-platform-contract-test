# PLAN — SaaS 身份平台契约一致性验证仓

> 待办与迭代方向。详细上下文见 `.state/session.json` 与 `docs/adr/`。

## 待办

### [DEBT] PG 共库污染 beforeAll teardown

- **状态**: 待实施(已起草 ADR-0018)
- **首次发现**: 2026-09-01 live mode 全量 contract-test run,`M96.F02.I10 GET /tenants/{t}/users 四方比对` 反复 fail
- **关联 ADR**: [docs/adr/0018-beforeall-pg-cleanup-via-http.md](docs/adr/0018-beforeall-pg-cleanup-via-http.md)
- **关联合约测试**: `M96.F02.I10` `I15` `I71`(列表端点,被历次跑残留污染)

### 症状(活证据)

live mode 全量跑 I10:

```
[body] aspnetcore: normalize 后第 28 行起分叉
  msw:       "email": "shape-user-mtijsqll-c50tv2@x.io",
  aspnetcore:       "email": "invite-mthvq6ks-osd5j5@contract-test.io",
[body] springboot: normalize 后第 28 行起分叉
  msw:       "email": "shape-user-mtijsqll-c50tv2@x.io",
  springboot:       "email": "invite-mthvq6ks-osd5j5@contract-test.io",
```

后端真后端多出来的 7 条 items 是历次跑未清的 `shape-user-xxx@x.io` / `invite-xxx@contract-test.io` 探针行(msw 用 fixture 不带这些)。

### 已知事实

- 本仓**没有** `beforeAll` / `globalSetup` 钩子,只有 `src/teardown.ts` 半成品 in-process 注册表 `Map<key, fn>`(afterAll 调用)。
- `registerCleanup` 同名 key 会覆盖(注释承认),不同 describe 文件不重名 id 行不受影响,但**同 describe 多次跑 / Ctrl+C 中断 / 进程 crash** 会导致某些行不注册成功。
- `package.json` 没 `pg` / `postgres` 依赖,本仓**没有 PG 直连能力**(CLAUDE.md §2 铁律「禁止 env 兜底」也禁止引入)。
- 4 后端共享 PG,3 真后端 + msw oracle 同一台 DB。

### 调查步骤(已通过 2026-09-01 调研完成,见 ADR-0018)

- [x] 1. 盘点现有 teardown 钩子(`src/teardown.ts` + 9 个写测试文件 + `registerCleanup` 同名覆盖 bug)
- [x] 2. 评估 PG 直连能力(无依赖,CLAUDE.md §2 禁止)
- [x] 3. 评估 per-it 清理(打散现有「跨 it 验证」模式)
- [x] 4. 选 HTTP delete + globalSetup 方案(守住黑盒契约,~15s 代价可忽略)

### 实施步骤

- [ ] 1. 新建 `src/cleanup-pg.ts`(~80 行,实现 `cleanupAllProbeRows()`)
- [ ] 2. 新建 `tests/globalSetup.ts`(~20 行,`export async function setup()` 调 cleanupAllProbeRows)
- [ ] 3. 改 `vitest.config.ts` 加 `test.globalSetup: ["./tests/globalSetup.ts"]`
- [ ] 4. 跑 `bash scripts/start-family.sh` 验证 I10 转绿
- [ ] 5. 跑第二次,验证不残留
- [ ] 6. 跑 CI `.github/workflows/ci.yml` 验证 GitHub Actions runner 上 globalSetup 路径也通

### 修复后回归

- [ ] contract-test I10 / I15 / I71 `normalize 后所有目标全等` 转绿
- [ ] 重跑前查 `SELECT count(*) FROM users WHERE email LIKE '%@x.io' OR email LIKE '%@contract-test.io' AND tenant_id = acme` = 0
- [ ] 重跑后再查,count ≤ 本次跑 it() 数 × 1
- [ ] acme tenant `api_keys` 表 count(前缀)同样 = 0
- [ ] 同一会话内连续两次跑 vitest 不挂账

### 风险

- `src/teardown.ts` 的 `Map<key, fn>` 同名覆盖 bug 暂不修 — 验证发现 `console.warn(cleanups.size)` 不为 0 即可;真修需要 `Map<key, fn[]>` 数组改造,另开 PR。
- 本 ADR 实施范围只清 **users + api_keys**(I10 源);apps / tenants / menus / roles 4 个表的探针残留**不在本 ADR 范围**,后续 PR 追加 PROBE_PATTERNS 条目。
- nextjs 没起 4 后端(无 `/api/health` endpoint)时,cleanup 函数自动跳过 nextjs(`target.baseUrl` 连不上 → catch + warn),不 hang 死。

## 迭代方向

- (待补)

## 跨仓默认值约定（user 拍板 2026-09-01）

contract-test `assertTimestampShape` 已把年份下限从 2000 调至 **1970**（Unix 纪元开始），与 3 后端实体的「合法默认值」对齐：

| 后端 | 推荐默认值 | 代码 |
|---|---|---|
| C# | `DateTimeOffset.UnixEpoch` 或 `new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)` | [aspnetcore PLAN.md](../saas-identity-platform-aspnetcore/PLAN.md) |
| Java | `Instant.EPOCH`（不要用 `LocalDateTime.of(1970, 1, 1, 0, 0)`，Jackson 不补 Z） | [springboot PLAN.md](../saas-identity-platform-springboot/PLAN.md) |
| JS/TS | `new Date(0)` // = 1970-01-01T00:00:00.000Z | (nextjs 待补) |

**意义**：实体字段兜底时不再返回 `MinValue`（年份 0001）或 Hibernate `-infinity` sentinel（年份 -292275055），而是返回 **1970-01-01**。contract-test 不再被误判为「明显荒谬」，entity 层 debug 也知道「1970 表示 fallback」。

**contract-test 配合**：
- [normalize.ts:71 `TS_YEAR_MIN = 1970`](src/normalize.ts) — 已改
- [compare.ts:70 错误文案 `[1970,2100]`](src/compare.ts) — 已改
- [tests/normalize.test.ts 新增 10 条年份边界测试](tests/normalize.test.ts) — 28/28 绿
