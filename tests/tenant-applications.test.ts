// M96.F02.I74–I77 — /tenants/{t}/applications CRUD 四方比对（第五期 B 组）。
//
// 9/8 schema-first pivot：新增 M00.F05 租户应用订阅（clientId 维度）。
// shared BASE 对齐（ADR-0023 跨仓覆盖映射，annotation 通道；Task 3.6 转正补锚）：
//   M00.F05.I01 列出租户应用 → I74
//   M00.F05.I02 订阅应用     → I75
//   M00.F05.I03 更新应用订阅 → I76
//   M00.F05.I04 移除应用订阅 → I77
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
const ctx: { clientIds: Map<string, string> } = { clientIds: new Map() };

/** I75 前置注册的 oauth_client（订阅的 FK 目标；teardown 兜底删，key=target 名）。 */
const precreatedClients: Map<string, string> = new Map();

// M00.F05.I01 列出租户应用：分页 shape 对齐 SSOT Page<TenantApplication>。
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
      // 元素 shape（id/clientId/tenantId/status/createdAt 必填；shared TenantApplication 无 updatedAt）
      if (body.items!.length > 0) {
        for (const key of ["id", "clientId", "tenantId", "status", "createdAt"]) {
          expect(body.items![0]![key], `${t.name} application 行缺 ${key}`).toBeDefined();
        }
        // 2026-10-02 强化（springboot toDto 漏 set createdAt 修复同批）：createdAt
        // 契约 REQUIRED，null 会炸严格解码端（swift 生成物非可选 Date）——
        // toBeDefined 拦不住 null，必须显式 not.toBeNull()。
        expect(
          body.items![0]!["createdAt"],
          `${t.name} application createdAt 契约 REQUIRED 不得为 null`,
        ).not.toBeNull();
      }
      probes.push(r);
    }
    // msw 不共库 + total 漂移 → 只比骨架
    const divergences = compareBodies(probes, targets, ["items", "total"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

// M00.F05.I02 订阅应用：oauth_client FK 前置（未知 clientId → 404，勿盲插）。
describe.skipIf(!live)("M96.F02.I75 POST /tenants/{tenantId}/applications 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.clientIds.clear();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I75 ${target.name} 订阅 application 返回 200/201 + 字段齐全`, async () => {
      const clientId = uniqueName("ct-app"); // 唯一化 clientId

      // 前置：先 POST /admin/clients 注册该 client（payload 形态同 admin-clients-write I45，
      // CreateOAuthClientRequest：grantTypes/redirectUris 是逗号串不是数组）。
      // oauth_client.client_id 是订阅的 FK 目标，未注册的 clientId 三真后端全炸
      // （springboot 500 / aspnetcore+nextjs 404），msw 不校验 FK 才让旧写法侥幸过。
      const createClient = await probeRequest(target, {
        method: "POST",
        path: "/api/v1/admin/clients",
        body: {
          clientId,
          clientName: `contract-test ${clientId}`,
          clientSecret: "ct-secret",
          grantTypes: "authorization_code",
          redirectUris: "http://localhost:5201/callback",
        },
      });
      expect(
        [200, 201],
        `${target.name} 前置建 client 期望 200/201 实得 ${createClient.status} body=${JSON.stringify(createClient.body).slice(0, 300)}`,
      ).toContain(createClient.status);
      precreatedClients.set(target.name, clientId);

      const r = await probeRequest(target, {
        method: "POST",
        path: BASE_PATH,
        // 2026-10-03 批：subscribe 带 expireTime——契约 SubscribeTenantApplicationRequest
        // expireTime? 语义，springboot 01704a2 参照落库；fastapi/rails 曾「镜像」旧
        // springboot 丢字段行为（镜像源已修），本断言治陈旧镜像。
        body: { clientId, expireTime: "2030-01-01T00:00:00Z" },
      });
      expect(
        [200, 201],
        `${target.name} 期望 200/201 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`,
      ).toContain(r.status);
      const body = r.body as Record<string, unknown>;
      for (const key of ["id", "clientId", "tenantId", "status", "createdAt"]) {
        expect(body[key], `${target.name} application 行缺 ${key}`).toBeDefined();
      }
      // 2026-10-02 强化（springboot toDto 漏 set createdAt 修复同批）：REQUIRED 字段 null 拦截。
      expect(
        body["createdAt"],
        `${target.name} application createdAt 契约 REQUIRED 不得为 null`,
      ).not.toBeNull();
      // 2026-10-03 批：subscribe 带 expireTime → 响应必须回读（null/缺席即红）。
      expect(
        body["expireTime"],
        `${target.name} subscribe expireTime 应落库回读（镜像源 springboot 01704a2）`,
      ).toBeTruthy();
      expect(
        String(body["expireTime"]).startsWith("2030-01-01"),
        `${target.name} subscribe expireTime 回读=${String(body["expireTime"])} 期望 2030-01-01`,
      ).toBe(true);

      // 2026-10-03 批（dup 泄漏治理）：重复订阅同 clientId → 400（nextjs 409 CONFLICT
      // 先例在案，分叉待家族对齐人裁）；错误 body 禁裸 DB 诊断——springboot/fastapi/
      // rails 曾把「constraint violation: <PG 驱动消息/约束名>」整段上 wire。
      const dup = await probeRequest(target, {
        method: "POST",
        path: BASE_PATH,
        body: { clientId },
      });
      expect(
        dup.status,
        `${target.name} 重复订阅期望 400（nextjs 409 先例）实得 ${dup.status}`,
      ).toBe(target.name === "nextjs" ? 409 : 400);
      expect(
        String((dup.body as Record<string, unknown>).message ?? ""),
        `${target.name} 重复订阅 message 泄漏 DB 诊断：${JSON.stringify(dup.body)}`,
      ).not.toMatch(/constraint violation|duplicate key|uk_tenant_client|详细/);

      // 寻址契约：/applications/{clientId} 用字符串 clientId 列（非 UUID id）
      ctx.clientIds.set(target.name, clientId);

      // teardown 顺序：application（child, tenant_application）先删，client（parent, oauth_client）后删
      registerCleanup(
        `delete-app:${target.name}`,
        async () => {
          const tr = await probeRequest(target, {
            method: "DELETE",
            path: `${BASE_PATH}/${clientId}`,
          });
          if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
            console.warn(`[teardown] delete-app ${target.name} 异常 status=${tr.status}`);
          }
        },
        { kind: "child" },
      );
      registerCleanup(
        `delete-client:${target.name}:${clientId.slice(-8)}`,
        async () => {
          const tr = await probeRequest(target, {
            method: "DELETE",
            path: `/api/v1/admin/clients/${clientId}`,
          });
          if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
            console.warn(`[teardown] delete-client ${target.name} 异常 status=${tr.status}`);
          }
        },
        { kind: "parent" },
      );
    }, 30_000);
  }
});

// M00.F05.I03 更新应用订阅：PATCH 寻址 clientId 字符串列；status int32 回读 + expireTime 字段在位。
describe.skipIf(!live)("M96.F02.I76 PATCH /tenants/{tenantId}/applications/{clientId} 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I76 ${target.name} 改 status → 200 + status/expireTime 回读`, async () => {
      const clientId = ctx.clientIds.get(target.name);
      if (!clientId) throw new Error(`${target.name} I75 未创 application，跳过 I76`);
      // 5.18 断言（Task 3.6 审查 minor ② 补账）：先显式带 expireTime 写入已知值，
      // 再 PATCH 不带 expireTime → 回读值必须不变（partial-update 语义；
      // nextjs/springboot 早已「不传不改」，aspnetcore 5.18 前会覆写 MinValue 0001-01-01）。
      const r = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${clientId}`,
        // SSOT TenantApplication.status = int32（同 I49 admin/clients 风格：0=disabled 1=active）
        body: { status: 0, expireTime: "2030-01-01T00:00:00Z" },
      });
      expect(
        r.status,
        `${target.name} patch 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(200);
      // 回读契约：UpdateTenantApplicationRequest{status, expireTime?} → TenantApplication
      const body = r.body as Record<string, unknown>;
      expect(body.status, `${target.name} patch 回读 status 期望 0`).toBe(0);
      expect(
        "expireTime" in body,
        `${target.name} patch 回读缺 expireTime 字段（SSOT TenantApplication.expireTime?）`,
      ).toBe(true);
      expect(
        String(body.expireTime).startsWith("2030-01-01"),
        `${target.name} patch 带 expireTime 回读期望 2030-01-01 实得 ${body.expireTime}`,
      ).toBe(true);

      // 不带 expireTime 再 PATCH：回读值不变（同后端自比对，绕开跨后端时间格式差异）
      const r2 = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${clientId}`,
        body: { status: 0 },
      });
      expect(r2.status, `${target.name} patch(不带 expireTime) 期望 200 实得 ${r2.status}`).toBe(200);
      const body2 = r2.body as Record<string, unknown>;
      expect(
        String(body2.expireTime).startsWith("2030-01-01"),
        `${target.name} patch 不带 expireTime 必须不改旧值（partial-update）实得 ${body2.expireTime}`,
      ).toBe(true);
    }, 30_000);
  }
});

// M00.F05.I04 移除应用订阅：DELETE 204/200 + 重复删幂等（404/200/204 容差，家族删语义未收敛）。
describe.skipIf(!live)("M96.F02.I77 DELETE /tenants/{tenantId}/applications/{clientId} 四方比对", () => {
  it("I75 的 application 删除 → 204/200 + 重复删 → 404（幂等）", async () => {
    for (const target of targets) {
      const clientId = ctx.clientIds.get(target.name);
      if (!clientId) throw new Error(`${target.name} I75 未创 application，跳过 I77`);
      const first = await probeRequest(target, {
        method: "DELETE",
        path: `${BASE_PATH}/${clientId}`,
      });
      expect(
        [200, 204],
        `${target.name} delete 期望 200/204 实得 ${first.status}`,
      ).toContain(first.status);
      const second = await probeRequest(target, {
        method: "DELETE",
        path: `${BASE_PATH}/${clientId}`,
      });
      expect(
        [404, 200, 204],
        `${target.name} 重复删期望 404 实得 ${second.status}`,
      ).toContain(second.status);
      ctx.clientIds.delete(target.name);
    }
  }, 60_000);

  afterAll(async () => {
    await runCleanups();
    for (const [tname, clientId] of ctx.clientIds) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, {
        method: "DELETE",
        path: `${BASE_PATH}/${clientId}`,
      });
      if (r.status !== 200 && r.status !== 204 && r.status !== 404) {
        console.warn(`[teardown] final delete-app ${tname} 异常 status=${r.status}`);
      }
    }
    // 防御性兜底：I75 前置建的 client 若因断言失败没走 registerCleanup，这里再删一轮
    // （已删过 → 404，容差内；顺序在 application 之后，不会撞 FK）
    for (const [tname, clientId] of precreatedClients) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, {
        method: "DELETE",
        path: `/api/v1/admin/clients/${clientId}`,
      });
      if (r.status !== 200 && r.status !== 204 && r.status !== 404) {
        console.warn(`[teardown] final delete-client ${tname} 异常 status=${r.status}`);
      }
    }
  }, 60_000);
});
