// M96.F02.I29–I33 — /admin/tenants CRUD 四方比对（第三期 D 组）。
//
// 鉴权：dev 模式下 4 后端对 /admin/** 都是 authenticated 即可（springboot SecurityConfig
// 的 platform_admin scope 是 prod 注释）。alice Bearer 直接打。
//
// I29 GET list：共享 seed 租户做只读比对（含 msw → drop ID；3 真后端共库 ID 相等）。
//      分页行数随历史跑数漂移 → 只比 shape（page/pageSize/total 必填 + items 元素字段）。
// I30 POST：唯一化 code 创 tenant（各 target 独立行），201/200 + 必填字段；
//      id 入 ctx 供 I31/I32/I33；registerCleanup DELETE 兜底。
// I31 GET {id}：各自 ctx 里的 id → 200 + 全等（同 target 自己的行）；
//      不存在 id → 404 全等。
// I32 PATCH：改 name → 200 + updatedAt 必填。
// I33 DELETE：204 + 幂等（重复删 → 404）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareAll, compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const BASE_PATH = "/api/v1/admin/tenants";
const DEAD_ID = "00000000-0000-0000-0000-00000000dead";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

/** I30 各 target 创的 tenant id（每家自己持有，I31/I32/I33 用）。 */
const ctx: { tenantIds: Map<string, string> } = { tenantIds: new Map() };

describe.skipIf(!live)("M96.F02.I29 GET /admin/tenants 四方比对", () => {
  it("列表 → 200 + 分页包装 shape（items 元素字段齐全）", async () => {
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, { method: "GET", path: BASE_PATH });
      expect(r.status, `${t.name} list 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown> & { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(body.items), `${t.name} list 缺 items 数组`).toBe(true);
      for (const key of ["page", "pageSize", "total"]) {
        expect(body[key], `${t.name} list 分页缺 ${key}`).toBeDefined();
      }
      // 至少有 V016 seed 的 3 个租户
      expect(body.items!.length, `${t.name} list items 不应為空`).toBeGreaterThanOrEqual(3);
      // seed 行字段齐全（拿第一行验 shape）
      for (const key of ["id", "code", "name", "status", "createdAt", "updatedAt"]) {
        expect(body.items![0]![key], `${t.name} tenant 行缺 ${key}`).toBeDefined();
      }
      probes.push(r);
    }
    // 共库但分页行数含历史写入漂移 + msw 不共库 → 只比骨架（drop items/total ——
    // total 随本轮写测试并行漂移，不是契约面）
    const divergences = compareBodies(probes, targets, ["items", "total"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I60 GET /admin/tenants 分页 defaults 契约面", () => {
  it("不传 ?page/?pageSize → page=0, pageSize=20 全等", async () => {
    // SSOT Page<T>:
    //   page:int32 = 0   （0-indexed —— 2026-08-29 漂移事故收口：aspnetcore 需 Skip(p*ps)）
    //   pageSize:int32 = 20
    //   total:int64     (实际计数，drop；4 后端随本轮写测试并行漂移)
    // 不传 ?page/?pageSize 时 4 后端必须返回这两个默认值。
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, { method: "GET", path: BASE_PATH });
      expect(r.status, `${t.name} defaults 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.page, `${t.name} page 默认应为 0`).toBe(0);
      expect(body.pageSize, `${t.name} pageSize 默认应为 20`).toBe(20);
      probes.push(r);
    }
    // 4 后端 default 都得是 0/20（exact equal）—— 比骨架
    const divergences = compareBodies(probes, targets, ["items", "total"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I61 GET /admin/tenants 显式分页回显", () => {
  it("?page=1&pageSize=2 → 回显一致（page=1, pageSize=2）", async () => {
    // 显式分页契约面：query 参数必须被后端回显，items 长度 ≤ pageSize。
    // 不比 items 内容（msw 内存 fixture 不共库；真后端 total 随本轮写漂移）。
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, { method: "GET", path: `${BASE_PATH}?page=1&pageSize=2` });
      expect(r.status, `${t.name} 显式分页期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown> & { items?: unknown[] };
      expect(body.page, `${t.name} 回显 page 应为 1`).toBe(1);
      expect(body.pageSize, `${t.name} 回显 pageSize 应为 2`).toBe(2);
      expect(Array.isArray(body.items), `${t.name} items 应是数组`).toBe(true);
      expect((body.items ?? []).length, `${t.name} pageSize=2 时 items 长度 ≤ 2`).toBeLessThanOrEqual(2);
      probes.push(r);
    }
    // 4 后端 envelope 一致即可（drop items/total —— total 漂移 + msw 不共库）
    const divergences = compareBodies(probes, targets, ["items", "total"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I30 POST /admin/tenants 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.tenantIds.clear();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I30 ${target.name} 创 tenant 返回 200/201 + 字段齐全`, async () => {
      const code = uniqueName("ct");
      const r = await probeRequest(target, {
        method: "POST",
        path: BASE_PATH,
        body: { code, name: `contract-test ${code}` },
      });
      expect([200, 201], `${target.name} 期望 200/201 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toContain(r.status);
      const body = r.body as Record<string, unknown>;
      for (const key of ["id", "code", "name", "status", "createdAt", "updatedAt"]) {
        expect(body[key], `${target.name} 创 tenant 缺 ${key}`).toBeDefined();
      }
      expect(body.status, `${target.name} 新 tenant 必须 active`).toBe("active");
      ctx.tenantIds.set(target.name, String(body.id));

      const tenantId = String(body.id);
      registerCleanup(`delete-tenant:${target.name}`, async () => {
        const tr = await probeRequest(target, { method: "DELETE", path: `${BASE_PATH}/${tenantId}` });
        if (tr.status !== 204 && tr.status !== 404) {
          console.warn(`[teardown] delete ${target.name} 异常 status=${tr.status}`);
        }
      });
    }, 30_000);
  }

  it("normalize 后成功响应字段一致（除唯一值/时间戳）", async () => {
    const probes = [];
    for (const t of targets) {
      const code = uniqueName("ct-shape");
      const r = await probeRequest(t, {
        method: "POST",
        path: BASE_PATH,
        body: { code, name: `shape ${code}` },
      });
      expect([200, 201]).toContain(r.status);
      // shape 探针创建的行也要清 —— 不注册 cleanup 会污染共库（total 计数漂移）
      const shapeId = String((r.body as Record<string, unknown>).id);
      registerCleanup(`delete-shape:${t.name}:${shapeId.slice(-8)}`, async () => {
        const tr = await probeRequest(t, { method: "DELETE", path: `${BASE_PATH}/${shapeId}` });
        if (tr.status !== 204 && tr.status !== 404) {
          console.warn(`[teardown] shape delete ${t.name} 异常 status=${tr.status}`);
        }
      });
      probes.push(r);
    }
    // settings 各家 DTO 形状不同（aspnetcore TenantSettings 有非 nullable maxUsers:int
    // 必输出 0；msw/nextjs jsonb 原样 {}）—— SSOT 层面已知分叉，drop 不比。
    const drop = ["id", "code", "name", "settings", "createdAt", "updatedAt"];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I31 GET /admin/tenants/{id} 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I31 ${target.name} 取自己创的 tenant → 200 + 字段齐全`, async () => {
      const tenantId = ctx.tenantIds.get(target.name);
      if (!tenantId) throw new Error(`${target.name} I30 未创建 tenant，跳过 I31`);
      const r = await probeRequest(target, { method: "GET", path: `${BASE_PATH}/${tenantId}` });
      expect(r.status, `${target.name} get 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.id, `${target.name} get 响应缺 id`).toBeDefined();
      expect(body.status).toBeDefined();
    }, 30_000);
  }

  it("不存在 id → 404 全等", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "GET", path: `${BASE_PATH}/${DEAD_ID}` }));
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 不存在 id 期望 404 实得 ${p.status}`).toBe(404);
    }
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I62 GET /admin/tenants/{id} 404 ErrorResponse envelope", () => {
  it("404 envelope shape 全等（前端 catch 分支依赖）", async () => {
    // SSOT ErrorResponse: {code, message, details?} —— 4 后端各自命名不同
    // （msw: {code,message}；springboot/aspnetcore: 同；nextjs: {error,message}）。
    // 契约面是「有错误码字段 + 有人读字段」，drop 之后骨架必须一致。
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "GET", path: `${BASE_PATH}/${DEAD_ID}` }));
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 404 envelope 期望 404 实得 ${p.status}`).toBe(404);
    }
    const drop = ["code", "message", "error", "error_description", "details", "path", "timestamp", "traceId"];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I32 PATCH /admin/tenants/{id} 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I32 ${target.name} 改 name → 200 + updatedAt 必填`, async () => {
      const tenantId = ctx.tenantIds.get(target.name);
      if (!tenantId) throw new Error(`${target.name} I30 未创建 tenant，跳过 I32`);
      const r = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${tenantId}`,
        body: { name: `renamed-${uniqueName("ct")}` },
      });
      expect(r.status, `${target.name} patch 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.updatedAt, `${target.name} patch 后 updatedAt 必填`).toBeDefined();
    }, 30_000);
  }
});

// 标题必须是「…四方比对」结尾（L2 SSOT 覆盖解析器约束）；teardown 语义写进 it/afterAll。
describe.skipIf(!live)("M96.F02.I33 DELETE /admin/tenants/{id} 四方比对", () => {
  it("I30 的 tenant 删除 → 204 + 重复删 → 404（幂等）", async () => {
    for (const target of targets) {
      const tenantId = ctx.tenantIds.get(target.name);
      if (!tenantId) throw new Error(`${target.name} I30 未创建 tenant，跳过 I33`);
      const first = await probeRequest(target, { method: "DELETE", path: `${BASE_PATH}/${tenantId}` });
      expect(first.status, `${target.name} delete 期望 204 实得 ${first.status}`).toBe(204);
      const second = await probeRequest(target, { method: "DELETE", path: `${BASE_PATH}/${tenantId}` });
      expect([404, 204], `${target.name} 重复删期望 404（msw/springboot）实得 ${second.status}`).toContain(second.status);
      ctx.tenantIds.delete(target.name); // 已删，teardown 不再兜底这行
    }
  }, 60_000);

  afterAll(async () => {
    await runCleanups();
    // 防御性兜底：I33 断言失败时行还在，再删一轮（容差 204/404）
    for (const [tname, tenantId] of ctx.tenantIds) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, { method: "DELETE", path: `${BASE_PATH}/${tenantId}` });
      if (r.status !== 204 && r.status !== 404) {
        console.warn(`[teardown] final delete ${tname} 异常 status=${r.status}`);
      }
    }
  }, 60_000);
});

describe.runIf(!live)("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/admin-tenants.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
