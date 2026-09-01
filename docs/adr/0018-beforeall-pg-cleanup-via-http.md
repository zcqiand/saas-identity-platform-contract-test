# 0018. beforeAll 走 HTTP delete 清 PG 共库探针数据,不走直连 PG

- 状态: Proposed
- 日期: 2026-09-01
- 决策者: 项目所有者
- 接续: [suite ADR-0015 (contract-test repo 定义)](../../../../docs/adr/0015-contract-test-repo.md) §「黑盒契约」

## Context

contract-test live 模式 4 后端共享 PG,写测试用唯一化前缀创 user / api-key(`shape-user-xxx@x.io`、`invite-xxx@contract-test.io`、`contract-test-key-xxx`、`rot-shape-xxx` 等)。这些行在 `afterAll` 的 `registerCleanup` 钩子**没有被全部清掉**,原因是:

- `src/teardown.ts` 的 `registerCleanup` 用 `Map<key, fn>`,同名 key 会覆盖(注释承认:「vitest 同一进程跑多次 describe 时取最后一次的 cleanup」)。
- 上一会话的 session.json 实证「上一会话未真触发强删」,导致跨次跑残留累积。
- live mode 全量跑 I10(`GET /tenants/{t}/users` 列表),返回 20 条 items,后 7 条全是历次跑未清的 `shape-user-*` / `invite-*` 行 → `createdAt` 分叉(每个 run 不同时刻) → 断言 fail。

修法候选有两类:

- **A. 走 HTTP delete**:每个 target 各发请求,先 GET 列表拿 id,再 DELETE 逐个清。**慢**(每后端 3-5s)但**守住黑盒契约**。
- **B. 直连 PG 跑 SQL**:`DELETE FROM users WHERE email LIKE 'shape-%'@x.io';` 一行清完。但**让 contract-test 绑后端 schema**,违反 ADR-0015 黑盒契约。

调查还给出实施层细节:`vitest.globalSetup` 而非 `setupFiles`(进程级一次,worker 级 4 次浪费);msw 跳过(在内存 fixture,无 PG);DELETE 容差 200/204/404(aspnetcore DELETE 返 200 而非 204 是已知)。

## Decision

**选 A**:`src/cleanup-pg.ts` 走 HTTP delete,**新增 `tests/globalSetup.ts` + 在 `vitest.config.ts` 加 `globalSetup: [...]`**,**保留 `registerCleanup` 不动**做双层兜底。

### 1. `src/cleanup-pg.ts`(新增,~80 行)

```ts
const PROBE_PATTERNS = {
  users:    { path: "/api/v1/tenants/{tid}/users",     match: (u) => /^(shape-|invite-|ct-u2-|contract-test-user-)/.test(u.username ?? "") || /@(x|contract-test)\.io$/.test(u.email ?? "") },
  apiKeys:  { path: "/api/v1/tenants/{tid}/api-keys",   match: (k) => /^(contract-test-key-|rot-src|rot-shape-|delete-test-key-|shape)/.test(k.name ?? "") },
  apps:     { path: "/api/v1/admin/apps",                match: (a) => /^(ct-app-|ct-app-shape)/.test(a.code ?? "") },
  tenants:  { path: "/api/v1/admin/tenants",             match: (t) => /^(ct|ct-shape)/.test(t.code ?? "") },
  menus:    { path: "/api/v1/admin/apps/{aid}/menus",    match: (m) => /^ct-menu-/.test(m.code ?? "") },
  roles:    { path: "/api/v1/tenants/{tid}/roles",       match: (r) => /^(ct-role|shape-role)/.test(r.code ?? "") },
};
```

`cleanupAllProbeRows()` 对**每个 target**(msw 跳过)调 `login(target)` → `list+delete each`(pages)。失败 best-effort,warn 不 fail。慢的代价 ~15s 全 3 后端,可忽略(vitest run 全量 318s)。

### 2. `tests/globalSetup.ts`(新增,~20 行)

```ts
export async function setup() {
  if (!process.env.CONTRACT_TARGETS) return; // unit 模式不跑
  const { cleanupAllProbeRows } = await import("../src/cleanup-pg.js");
  await cleanupAllProbeRows();
}
```

### 3. `vitest.config.ts` 加一行

```ts
test: { globalSetup: ["./tests/globalSetup.ts"] }
```

### 4. 保留 `registerCleanup` / `runCleanups` 不动

双层兜底:beforeAll 防上次跑残留,afterAll 清本次跑(Ctrl+C 中断时也能清当次行)。

## Alternatives considered

### B. 直连 PG 跑 SQL DELETE

被拒绝,理由:
- **违反 ADR-0015 黑盒契约**:「同输出 = 前端不可区分」语义要求 contract-test 是黑盒测试。直连 PG 让 contract-test 变成「绑后端 schema 的白盒测试」。
- 引入新依赖(`pg` / `postgres`),动 package.json(本仓禁止,version-lock 钉死)。
- 一旦某天后端表名 / 列名变(如分表、改 schema),contract-test 跟着碎,失去对前端契约的独立性。
- DSN 真源在 `scripts/start-family.sh:158` 硬编码 `Host=100.79.128.25;...`,contract-test 仓**没有读** `DATABASE_URL` 的代码(CLAUDE.md §2 铁律「禁止 env 兜底」),跨环境(CI 用 `postgresql://saas:saas@localhost:5432/saas?schema=public`)硬接 DSN 必然坏。

### C. 每次 it() 各自 create+delete(per-it 清理)

被拒绝,理由:
- contract-test 现有测试有「跨 it 验证」模式(如 `tenant-users-write-2.test.ts:122-127` I40 在 create 后 GET 复核 roleIds),per-it 清理会打散这种验证。
- 文件并行 `fileParallelism: false` 已经串行,无并发争抢;唯一缺口是「跨进程残留 → 本次跑」,正好是 beforeAll 全清的目标场景。
- per-it 清理把契约测试变成「单端点单步测试」,失去 contract-test 本意(「同一资源跨多步的契约面验证」)。

### D. 只清 acme tenant users + api_keys(不全清)

被接受。**本 ADR 实施范围**只清 users + api_keys(就是 I10 fail 源头),其他表(apps / tenants / menus / roles)留给后续 PR。本 ADR `next` 条目里挂账。

## Consequences

**正面:**

- I10 `M96.F02.I10 GET /tenants/{t}/users 四方比对` 转绿(无残留 `shape-user-*` / `invite-*` 干扰)
- 跨次跑不再有「上一次跑残留 → 本次跑 fail」耦合;同一会话内多次跑 vitest 也可重入
- 黑盒契约守住:contract-test 仍只发 HTTP,不依赖 schema

**负面:**

- ~15s 慢的代价(`globalSetup` 进程级一次,不是每 worker 一次)
- 「apps / tenants / menus / roles」4 个表暂不清理(本 ADR 范围外),后续 PR 追加对应 PROBE_PATTERNS 条目
- `src/teardown.ts` 的 `Map<key, fn>` 同名覆盖 bug 暂不修,验证发现 `console.warn(cleanups.size)` 不为 0 即可;真修需要 `Map<key, fn[]>` 数组改造,另开 PR
- CI 路径下 `globalSetup` 跑得对不对,本会话未跑 CI 验证;**Acceptance precondition 第 2 条留待 CI 实证**

## Acceptance precondition

1. 本机 `bash scripts/start-family.sh` 跑通,contract-test live mode I10 / I15 / I71 转绿
2. 重跑前先查 `SELECT count(*) FROM users WHERE email LIKE '%@x.io' OR email LIKE '%@contract-test.io'` 在 acme tenant 下 = 0
3. 重跑后再查,count 仍 ≤ 本次跑 it() 数 × 1(允许小残留,下次跑前自动清)
4. CI `.github/workflows/ci.yml` 跑一次,确认 `globalSetup` 路径在 GitHub Actions runner 上也通

## 落地顺序

1. 新建 `src/cleanup-pg.ts`(~80 行)
2. 新建 `tests/globalSetup.ts`(~20 行)
3. 改 `vitest.config.ts` 加 `globalSetup: [...]`
4. 跑 dry-run(本机 `bash scripts/start-family.sh`),验证:
   - I10 转绿
   - acme tenant `users` count(前缀) = 0
   - acme tenant `api_keys` count(前缀) = 0
5. 跑第二次,验证不残留
6. CI 路径 ADR-0017 跑通后,本 ADR 状态 Proposed → Accepted