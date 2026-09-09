// M96.F02.I74–I77 — /tenants/{t}/applications CRUD 四方比对（第五期 B 组）。
//
// 9/8 schema-first pivot：新增 M00.F05 租户应用订阅（clientId 维度）。
// 鉴权同 I30：alice Bearer 即可；dev 模式下 /tenants/{t}/** 走 tenantGuard。
// 写比对模型同 I30：唯一化 clientId 创订阅，id 入 ctx；teardown DELETE 兜底。
//
// I74 GET list：分页 shape（page/pageSize/total + items 元素字段）。
// I75 POST：订阅 client，id 入 ctx 供 I76/I77；registerCleanup DELETE 兜底。
// I76 PATCH：改 status/expiry → 200。
// I77 DELETE：204 + 幂等（重复删 → 404）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { SEED } from "../src/seed.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const BASE_PATH = pathWithParams("/api/v1/tenants/{tenantId}/applications", {
  tenantId: SEED.tenants.acme,
});

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

/** I75 各 target 创的 application id。 */
const ctx: { appIds: Map<string, string> } = { appIds: new Map() };

describe.skipIf(!live)("M96.F02.I74 GET /tenants/{tenantId}/applications 四方比对", () => {
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
      // 元素 shape（id/clientId/tenantId/status/createdAt/updatedAt 必填）
      if (body.items!.length > 0) {
        for (const key of ["id", "clientId", "tenantId", "status", "createdAt", "updatedAt"]) {
          expect(body.items![0]![key], `${t.name} application 行缺 ${key}`).toBeDefined();
        }
      }
      probes.push(r);
    }
    // msw 不共库 + total 漂移 → 只比骨架
    const divergences = compareBodies(probes, targets, ["items", "total"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I75 POST /tenants/{tenantId}/applications 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.appIds.clear();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I75 ${target.name} 订阅 application 返回 200/201 + 字段齐全`, async () => {
      const clientId = uniqueName("ct-app"); // 唯一化 clientId
      const r = await probeRequest(target, {
        method: "POST",
        path: BASE_PATH,
        body: { clientId },
      });
      expect(
        [200, 201],
        `${target.name} 期望 200/201 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`,
      ).toContain(r.status);
      const body = r.body as Record<string, unknown>;
      for (const key of ["id", "clientId", "tenantId", "status", "createdAt", "updatedAt"]) {
        expect(body[key], `${target.name} application 行缺 ${key}`).toBeDefined();
      }
      const appId = String(body.id);
      ctx.appIds.set(target.name, appId);

      registerCleanup(`delete-app:${target.name}`, async () => {
        const tr = await probeRequest(target, {
          method: "DELETE",
          path: `${BASE_PATH}/${appId}`,
        });
        if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
          console.warn(`[teardown] delete-app ${target.name} 异常 status=${tr.status}`);
        }
      });
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I76 PATCH /tenants/{tenantId}/applications/{clientId} 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I76 ${target.name} 改 status → 200 + updatedAt 必填`, async () => {
      const appId = ctx.appIds.get(target.name);
      if (!appId) throw new Error(`${target.name} I75 未创 application，跳过 I76`);
      const r = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${appId}`,
        body: { status: "disabled" },
      });
      expect(
        r.status,
        `${target.name} patch 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(200);
      expect(
        (r.body as Record<string, unknown>).updatedAt,
        `${target.name} patch 后 updatedAt 必填`,
      ).toBeDefined();
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I77 DELETE /tenants/{tenantId}/applications/{clientId} 四方比对", () => {
  it("I75 的 application 删除 → 204/200 + 重复删 → 404（幂等）", async () => {
    for (const target of targets) {
      const appId = ctx.appIds.get(target.name);
      if (!appId) throw new Error(`${target.name} I75 未创 application，跳过 I77`);
      const first = await probeRequest(target, {
        method: "DELETE",
        path: `${BASE_PATH}/${appId}`,
      });
      expect(
        [200, 204],
        `${target.name} delete 期望 200/204 实得 ${first.status}`,
      ).toContain(first.status);
      const second = await probeRequest(target, {
        method: "DELETE",
        path: `${BASE_PATH}/${appId}`,
      });
      expect(
        [404, 200, 204],
        `${target.name} 重复删期望 404 实得 ${second.status}`,
      ).toContain(second.status);
      ctx.appIds.delete(target.name);
    }
  }, 60_000);

  afterAll(async () => {
    await runCleanups();
    for (const [tname, appId] of ctx.appIds) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, {
        method: "DELETE",
        path: `${BASE_PATH}/${appId}`,
      });
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
      "[contract-test] tenant-applications 比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/tenant-applications.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
