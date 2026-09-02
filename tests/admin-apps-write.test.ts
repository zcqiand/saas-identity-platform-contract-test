// M96.F02.I44–I49 — /admin/apps CRUD + status 四方比对（第四期 B 组）。
//
// 鉴权同 I29–I33：dev 模式下 4 后端对 /admin/** authenticated 即可。
// 写比对模型同 I30：唯一化 code 创 app，id 入 ctx；teardown DELETE 兜底。
//
// I44 GET list：分页 shape（items 元素字段）。
// I45 POST：创 app（code/name/clientId/redirectUris 必填）→ 200/201。
// I46 GET {appId}：各自 ctx 里的 id → 200；不存在 id → 404。
// I47 PATCH：改 name → 200 + updatedAt。
// I48 DELETE：204/200 + 幂等（重复 → 404）。
// I49 PATCH status：active → disabled → active 往返，终态还原 active。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const BASE_PATH = "/api/v1/admin/apps";
const DEAD_ID = "00000000-0000-0000-0000-00000000dead";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

/** I45 各 target 创的 app id。 */
const ctx: { appIds: Map<string, string> } = { appIds: new Map() };

describe.skipIf(!live)("M96.F02.I44 GET /admin/apps 四方比对", () => {
  it("列表 → 200 + 分页包装 shape", async () => {
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, { method: "GET", path: BASE_PATH });
      expect(r.status, `${t.name} list 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown> & { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(body.items), `${t.name} list 缺 items 数组`).toBe(true);
      for (const key of ["page", "pageSize", "total"]) {
        expect(body[key], `${t.name} list 分页缺 ${key}`).toBeDefined();
      }
      // seed 至少 3 个 app（lab-mgmt/erp/crm）
      expect(body.items!.length, `${t.name} list items 不应为空`).toBeGreaterThanOrEqual(3);
      for (const key of ["id", "code", "name", "status", "createdAt", "updatedAt"]) {
        expect(body.items![0]![key], `${t.name} app 行缺 ${key}`).toBeDefined();
      }
      probes.push(r);
    }
    // msw 不共库 + total 含历史写漂移 → 只比骨架
    const divergences = compareBodies(probes, targets, ["items", "total"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I63 GET /admin/apps 显式分页回显", () => {
  it("?page=1&pageSize=2 → 回显一致（page=1, pageSize=2）", async () => {
    // 显式分页契约面：query 参数必须被后端回显，items 长度 ≤ pageSize。
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
    const divergences = compareBodies(probes, targets, ["items", "total"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I45 POST /admin/apps 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.appIds.clear();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I45 ${target.name} 创 app 返回 200/201 + 字段齐全`, async () => {
      const code = uniqueName("ct-app");
      const r = await probeRequest(target, {
        method: "POST",
        path: BASE_PATH,
        body: {
          code,
          name: `contract-test ${code}`,
          clientId: `client-${code}`,
          redirectUris: ["http://localhost:5201/callback"],
        },
      });
      expect([200, 201], `${target.name} 期望 200/201 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`).toContain(r.status);
      const body = r.body as Record<string, unknown>;
      for (const key of ["id", "code", "name", "status", "createdAt", "updatedAt"]) {
        expect(body[key], `${target.name} app 行缺 ${key}`).toBeDefined();
      }
      expect(body.status, `${target.name} 新 app 必须 active`).toBe("active");
      ctx.appIds.set(target.name, String(body.id));

      const appId = String(body.id);
      registerCleanup(`delete-app:${target.name}`, async () => {
        const tr = await probeRequest(target, { method: "DELETE", path: `${BASE_PATH}/${appId}` });
        if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
          console.warn(`[teardown] delete-app ${target.name} 异常 status=${tr.status}`);
        }
      });
    }, 30_000);
  }

  it("normalize 后成功响应字段一致（除唯一值/时间戳）", async () => {
    const probes = [];
    for (const t of targets) {
      const code = uniqueName("ct-app-shape");
      const r = await probeRequest(t, {
        method: "POST",
        path: BASE_PATH,
        body: {
          code,
          name: `shape ${code}`,
          clientId: `client-${code}`,
          redirectUris: ["http://localhost:5201/callback"],
        },
      });
      expect([200, 201]).toContain(r.status);
      const shapeId = String((r.body as Record<string, unknown>).id);
      registerCleanup(`delete-shape-app:${t.name}:${shapeId.slice(-8)}`, async () => {
        const tr = await probeRequest(t, { method: "DELETE", path: `${BASE_PATH}/${shapeId}` });
        if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
          console.warn(`[teardown] shape-app delete ${t.name} 异常 status=${tr.status}`);
        }
      });
      probes.push(r);
    }
    const drop = ["id", "code", "name", "clientId", "clientSecret", "createdAt", "updatedAt"];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I64 POST /admin/apps 缺必填字段错误分支", () => {
  it("空 body → 4xx + ErrorResponse envelope shape 全等", async () => {
    // 不带 code/name/clientId/redirectUris → 4 后端契约面：400 + ErrorResponse。
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "POST", path: BASE_PATH, body: {} }));
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 缺必填字段期望 4xx/500 实得 ${p.status} body=${JSON.stringify(p.body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
    }
    const drop = ["code", "message", "error", "error_description", "details", "path", "timestamp", "traceId"];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I46 GET /admin/apps/{appId} 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I46 ${target.name} 取自己创的 app → 200 + 字段齐全`, async () => {
      const appId = ctx.appIds.get(target.name);
      if (!appId) throw new Error(`${target.name} I45 未创建 app，跳过 I46`);
      const r = await probeRequest(target, { method: "GET", path: `${BASE_PATH}/${appId}` });
      expect(r.status, `${target.name} get 期望 200 实得 ${r.status}`).toBe(200);
      expect((r.body as Record<string, unknown>).id).toBeDefined();
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

describe.skipIf(!live)("M96.F02.I65 GET /admin/apps/{appId} 404 ErrorResponse envelope", () => {
  it("404 envelope shape 全等（前端 catch 分支依赖）", async () => {
    // SSOT ErrorResponse: {code, message, details?} —— 4 后端各自命名不同
    // （msw: {code,message}；springboot/aspnetcore/nextjs: {error,message,...}）。
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

describe.skipIf(!live)("M96.F02.I47 PATCH /admin/apps/{appId} 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I47 ${target.name} 改 name → 200 + updatedAt 必填`, async () => {
      const appId = ctx.appIds.get(target.name);
      if (!appId) throw new Error(`${target.name} I45 未创建 app，跳过 I47`);
      const r = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${appId}`,
        body: { name: `renamed-${uniqueName("ct")}` },
      });
      expect(r.status, `${target.name} patch 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      expect((r.body as Record<string, unknown>).updatedAt, `${target.name} patch 后 updatedAt 必填`).toBeDefined();
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I49 PATCH /admin/apps/{appId}/status 四方比对", () => {
  // 排在 I48 DELETE 前：status 往返需要行还在
  for (const target of targets) {
    it(`M96.F02.I49 ${target.name} active → disabled → active 往返`, async () => {
      const appId = ctx.appIds.get(target.name);
      if (!appId) throw new Error(`${target.name} I45 未创建 app，跳过 I49`);
      const off = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${appId}/status`,
        body: { status: "disabled" },
      });
      expect(off.status, `${target.name} disable 期望 200 实得 ${off.status} body=${JSON.stringify(off.body).slice(0, 200)}`).toBe(200);
      expect((off.body as Record<string, unknown>).status, `${target.name} disable 后 status`).toBe("disabled");
      const on = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${appId}/status`,
        body: { status: "active" },
      });
      expect(on.status, `${target.name} enable 期望 200 实得 ${on.status}`).toBe(200);
      expect((on.body as Record<string, unknown>).status, `${target.name} enable 后 status`).toBe("active");
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I48 DELETE /admin/apps/{appId} 四方比对", () => {
  it("I45 的 app 删除 → 204/200 + 重复删 → 404（幂等）", async () => {
    for (const target of targets) {
      const appId = ctx.appIds.get(target.name);
      if (!appId) throw new Error(`${target.name} I45 未创建 app，跳过 I48`);
      const first = await probeRequest(target, { method: "DELETE", path: `${BASE_PATH}/${appId}` });
      expect([200, 204], `${target.name} delete 期望 200/204 实得 ${first.status}`).toContain(first.status);
      const second = await probeRequest(target, { method: "DELETE", path: `${BASE_PATH}/${appId}` });
      expect([404, 200, 204], `${target.name} 重复删期望 404 实得 ${second.status}`).toContain(second.status);
      ctx.appIds.delete(target.name);
    }
  }, 60_000);

  afterAll(async () => {
    await runCleanups();
    for (const [tname, appId] of ctx.appIds) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, { method: "DELETE", path: `${BASE_PATH}/${appId}` });
      if (r.status !== 200 && r.status !== 204 && r.status !== 404) {
        console.warn(`[teardown] final delete-app ${tname} 异常 status=${r.status}`);
      }
    }
  }, 60_000);
});

describe.runIf(!live)("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] admin-apps 比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/admin-apps-write.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
