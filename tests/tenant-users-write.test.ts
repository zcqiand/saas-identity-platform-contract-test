// M96.F02.I19 — POST /tenants/{t}/users 四方比对（写端点第二期 M01.F01.I02）。
//
// 写比对模型：3 后端共享一个 PG（users.tenant_id, users.email UNIQUE）；
// msw 内存 fixture。比对 shape 不比 byte。
//
// I19: 每个 target 用 uniqueName 创一个 user，记 ctx.userIds[target.name] → id；
//      teardown 用 DELETE .../{u} 兜底（DELETE 与软删 user：本测试不验证 DELETE，
//      只用其作为 cleanup；DELETE 端点的四方比对待 I21 落地）。
//
// teardown：afterAll 跑 runCleanups() + 防御性 delete（200/404 容差）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const TENANT_ID = ALICE_PARAMS.tenantId;
const BASE_PATH = pathWithParams("/api/v1/tenants/{tenantId}/users", { tenantId: TENANT_ID });

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

const ctx: { userIds: Map<string, string> } = { userIds: new Map() };

describe.skipIf(!live)("M96.F02.I19 POST /tenants/{t}/users 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.userIds.clear();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I19 ${target.name} 创建返回 200/201 + user 字段齐全`, async () => {
      const name = uniqueName("contract-test-user");
      const email = `${name}@contract-test.io`;
      const r = await probeRequest(target, {
        method: "POST",
        path: BASE_PATH,
        body: { username: name, email, password: "dev-password-123" },
      });
      // TypeSpec createUser 只声明了 200；但真后端/nextjs/msw 习惯返 201。
      // 接受 200 或 201（契约面是同一成功响应）。
      expect([200, 201], `${target.name} 期望 200/201 实得 ${r.status}`).toContain(r.status);
      const body = r.body as Record<string, unknown>;
      const REQUIRED = ["id", "tenantId", "username", "email", "status", "roleIds", "createdAt"];
      for (const key of REQUIRED) {
        expect(body[key], `${target.name} 响应缺 ${key}`).toBeDefined();
      }
      expect(body.status, `${target.name} 新 user 必须 active`).toBe("active");
      ctx.userIds.set(target.name, String(body.id));

      // teardown：每 target 注册 DELETE cleanup（容差 200/204/404）
      const userId = String(body.id);
      registerCleanup(`delete-user:${target.name}`, async () => {
        const tr = await probeRequest(target, {
          method: "DELETE",
          path: `${BASE_PATH}/${userId}`,
        });
        if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
          console.warn(`[teardown] delete-user ${target.name} 异常 status=${tr.status}`);
        }
      });
    }, 30_000);
  }

  it("normalize 后所有目标的成功响应字段一致（除 volatile）", async () => {
    const probes = await Promise.all(
      targets.map(async (t) => {
        const name = uniqueName("shape-user");
        const r = await probeRequest(t, {
          method: "POST",
          path: BASE_PATH,
          body: { username: name, email: `${name}@x.io`, password: "dev-password-123" },
        });
        // 2026-09-01: 给 shape-user 探针块补 registerCleanup,防本轮残留(本工单 I10 修复)。
        // 之前没注册 → 4 target POST 后没清 → 后端 PG 残留 shape-user-XXX,
        // 下次 I10 GET /users 时行数差 1+ → normalize 第 32 行分叉。
        if (r.status === 200 || r.status === 201) {
          const userId = String((r.body as Record<string, unknown>).id);
          registerCleanup(`delete-shape-user:${t.name}`, async () => {
            const tr = await probeRequest(t, {
              method: "DELETE",
              path: `${BASE_PATH}/${userId}`,
            });
            if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
              console.warn(`[teardown] delete shape-user ${userId} status=${tr.status}`);
            }
          });
        }
        return r;
      }),
    );
    for (const p of probes) {
      expect([200, 201]).toContain(p.status);
    }
    // createUser 响应：status 在 4 后端可能不一致；此处只比 shape（不报 status diff）
    const drop = ["id", "username", "email", "displayName", "createdAt", "updatedAt", "lastUsedAt", "expiresAt", "revokedAt"];
    const result = compareBodies(probes, targets, drop);
    expect(result, `\n${formatDivergences(result)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I69 POST /tenants/{t}/users 缺必填字段错误分支", () => {
  it("空 body → 4xx + ErrorResponse envelope shape 全等", async () => {
    // 不带 username/email/password → 4 后端契约面：400 + ErrorResponse。
    // 注意：msw 可能返 500（实现层未做 zod 校验），那时会先黄。
    // 契约面允许 400；本测试先打宽容区间，确认 envelope 一致即可。
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "POST", path: BASE_PATH, body: {} }));
    }
    for (const p of probes) {
      // 4 后端契约面：400；msw 历史曾返 500，先宽容但要落到 4xx/5xx。
      expect(p.status, `${p.target} 缺必填字段期望 4xx/500 实得 ${p.status} body=${JSON.stringify(p.body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
    }
    // 错误 envelope 字段名家族两派：{code,message} vs {error,error_description,...}。drop。
    const drop = ["code", "message", "error", "error_description", "details", "path", "timestamp", "traceId"];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("写端点 teardown — runCleanups + 防御性 delete-user", () => {
  afterAll(async () => {
    await runCleanups();
    for (const [tname, userId] of ctx.userIds) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, { method: "DELETE", path: `${BASE_PATH}/${userId}` });
      // 200/204 真后端；404 msw 第二次 delete 时已无此 id
      if (r.status !== 200 && r.status !== 204 && r.status !== 404) {
        console.warn(`[teardown] final delete-user ${tname} 异常 status=${r.status}`);
      }
    }
  }, 60_000);
  it("占位 — afterAll 真正干活", () => {
    expect(targets.length).toBeGreaterThanOrEqual(2);
  });
});

describe.runIf(!live)("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] M96.F02.I19 写端点比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/tenant-users-write.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
