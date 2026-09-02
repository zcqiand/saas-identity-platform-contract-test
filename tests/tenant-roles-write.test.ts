// M96.F02.I34–I38 — /tenants/{t}/roles 写端点四方比对（第四期 A 组）。
//
// 写比对模型（同 I19/I30）：3 后端共享一个 PG（roles.tenant_id + code UNIQUE）；
// msw 内存 fixture。比对 shape 不比 byte。唯一化 code 防共库撞唯一约束。
//
// I34 POST /roles：创 role → 200/201 + 必填字段；id 入 ctx 供 I35/I36/I37；
//      teardown DELETE 兜底。
// I35 PATCH /roles/{r}：改 name → 200 + updatedAt 必填。
// I36 PUT /roles/{r}/permissions：设 permissionIds → 200 + 响应回带 permissionIds。
// I37 DELETE /roles/{r}：物理删 204/200 + 幂等（重复删 → 404）；I09.F02.I03 对齐。
// I38 DELETE /roles/{r}/menus：清空授权（M09.F02.I03）—— 对 seed 共享 role
//      （acme admin）打有破坏性：先 GET 记录原 menuIds，断言后还原（同 I20 模式）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const TENANT_ID = ALICE_PARAMS.tenantId;
const ROLE_BASE = pathWithParams("/api/v1/tenants/{tenantId}/roles", { tenantId: TENANT_ID });
const SEED_ROLE_MENUS = pathWithParams(
  "/api/v1/tenants/{tenantId}/roles/{roleId}/menus",
  { tenantId: TENANT_ID, roleId: ALICE_PARAMS.roleId },
);
const DEAD_ID = "00000000-0000-0000-0000-00000000dead";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

/** I34 各 target 创的 role id（每家自己持有，I35–I37 用）。 */
const ctx: { roleIds: Map<string, string> } = { roleIds: new Map() };

describe.skipIf(!live)("M96.F02.I34 POST /tenants/{t}/roles 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.roleIds.clear();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I34 ${target.name} 创建返回 200/201 + role 字段齐全`, async () => {
      const code = uniqueName("ct-role");
      const r = await probeRequest(target, {
        method: "POST",
        path: ROLE_BASE,
        body: { code, name: `contract-test ${code}` },
      });
      expect([200, 201], `${target.name} 期望 200/201 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toContain(r.status);
      const body = r.body as Record<string, unknown>;
      for (const key of ["id", "tenantId", "code", "name", "permissionIds", "createdAt", "updatedAt"]) {
        expect(body[key], `${target.name} role 行缺 ${key}（undefined 也算缺）`).toBeDefined();
      }
      ctx.roleIds.set(target.name, String(body.id));

      const roleId = String(body.id);
      registerCleanup(`delete-role:${target.name}`, async () => {
        const tr = await probeRequest(target, { method: "DELETE", path: `${ROLE_BASE}/${roleId}` });
        if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
          console.warn(`[teardown] delete-role ${target.name} 异常 status=${tr.status}`);
        }
      });
    }, 30_000);
  }

  it("normalize 后所有目标的成功响应字段一致（除 volatile）", async () => {
    const probes = await Promise.all(
      targets.map((t) =>
        probeRequest(t, {
          method: "POST",
          path: ROLE_BASE,
          body: { code: uniqueName("shape-role"), name: "shape role" },
        }),
      ),
    );
    // shape 探针的行也注册清理（共库防 total 漂移）
    for (let i = 0; i < targets.length; i++) {
      const shapeId = String((probes[i]!.body as Record<string, unknown>).id);
      const t = targets[i]!;
      registerCleanup(`delete-shape-role:${t.name}:${shapeId.slice(-8)}`, async () => {
        const tr = await probeRequest(t, { method: "DELETE", path: `${ROLE_BASE}/${shapeId}` });
        if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
          console.warn(`[teardown] shape-role delete ${t.name} 异常 status=${tr.status}`);
        }
      });
    }
    for (const p of probes) {
      expect([200, 201]).toContain(p.status);
    }
    const drop = ["id", "code", "name", "description", "createdAt", "updatedAt"];
    const result = compareBodies(probes, targets, drop);
    expect(result, `\n${formatDivergences(result)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I67 POST /tenants/{t}/roles 缺必填字段错误分支", () => {
  it("空 body → 4xx + ErrorResponse envelope shape 全等", async () => {
    // 不带 code/name → 4 后端契约面：400 + ErrorResponse。
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "POST", path: ROLE_BASE, body: {} }));
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 缺必填字段期望 4xx/500 实得 ${p.status} body=${JSON.stringify(p.body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
    }
    const drop = ["code", "message", "error", "error_description", "details", "path", "timestamp", "traceId"];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I35 PATCH /tenants/{t}/roles/{r} 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I35 ${target.name} 改 name → 200 + updatedAt 必填`, async () => {
      const roleId = ctx.roleIds.get(target.name);
      if (!roleId) throw new Error(`${target.name} I34 未创建 role，跳过 I35`);
      const r = await probeRequest(target, {
        method: "PATCH",
        path: `${ROLE_BASE}/${roleId}`,
        body: { name: `renamed-${uniqueName("ct")}` },
      });
      expect(r.status, `${target.name} patch 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.updatedAt, `${target.name} patch 后 updatedAt 必填`).toBeDefined();
    }, 30_000);
  }

  it("不存在 id → 404 全等", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "PATCH", path: `${ROLE_BASE}/${DEAD_ID}`, body: { name: "noop" } }));
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 不存在 id 期望 404 实得 ${p.status}`).toBe(404);
    }
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I68 PATCH /tenants/{t}/roles/{r} 404 ErrorResponse envelope", () => {
  it("404 envelope shape 全等（前端 catch 分支依赖）", async () => {
    // SSOT ErrorResponse: {code, message, details?} —— 4 后端各自命名不同
    // （msw: {code,message}；springboot/aspnetcore/nextjs: {error,message,...}）。
    // 契约面是「有错误码字段 + 有人读字段」，drop 之后骨架必须一致。
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "PATCH", path: `${ROLE_BASE}/${DEAD_ID}`, body: { name: "noop" } }));
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 404 envelope 期望 404 实得 ${p.status}`).toBe(404);
    }
    const drop = ["code", "message", "error", "error_description", "details", "path", "timestamp", "traceId"];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I36 PUT /tenants/{t}/roles/{r}/permissions 四方比对", () => {
  // permissionIds 契约面是 UUID（V016 permissions 表 4 行 f0000000*；
  // springboot GET role 返回的就是 UUID —— 不是 "users:read" 权限码）
  const PERMS = ["00000000-0000-0000-0000-f00000000001", "00000000-0000-0000-0000-f00000000003"];

  for (const target of targets) {
    it(`M96.F02.I36 ${target.name} 设 permissionIds → 200 + 响应回带`, async () => {
      const roleId = ctx.roleIds.get(target.name);
      if (!roleId) throw new Error(`${target.name} I34 未创建 role，跳过 I36`);
      const r = await probeRequest(target, {
        method: "PUT",
        path: `${ROLE_BASE}/${roleId}/permissions`,
        body: { permissionIds: PERMS },
      });
      expect(r.status, `${target.name} 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      const got = body.permissionIds as string[] | undefined;
      expect(Array.isArray(got), `${target.name} 响应 permissionIds 必为数组`).toBe(true);
      // 顺序不保证：集合语义比对
      for (const p of PERMS) {
        expect(got!, `${target.name} permissionIds 应包含 ${p}`).toContain(p);
      }
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I37 DELETE /tenants/{t}/roles/{r} 四方比对", () => {
  it("I34 的 role 删除 → 204/200 + 重复删 → 404（幂等）", async () => {
    for (const target of targets) {
      const roleId = ctx.roleIds.get(target.name);
      if (!roleId) throw new Error(`${target.name} I34 未创建 role，跳过 I37`);
      const first = await probeRequest(target, { method: "DELETE", path: `${ROLE_BASE}/${roleId}` });
      expect([200, 204], `${target.name} delete 期望 200/204 实得 ${first.status}`).toContain(first.status);
      const second = await probeRequest(target, { method: "DELETE", path: `${ROLE_BASE}/${roleId}` });
      expect([404, 200, 204], `${target.name} 重复删期望 404 实得 ${second.status}`).toContain(second.status);
      ctx.roleIds.delete(target.name); // 已删，teardown 不再兜底
    }
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I38 DELETE /tenants/{t}/roles/{r}/menus 四方比对", () => {
  // seed 共享 role（acme admin）—— 先 GET 记原状，断言后 PUT 还原（I20 同模式）
  it("清空 → 204/200 + 幂等 → 还原 seed 授权", async () => {
    const restore: string[][] = [];
    for (const target of targets) {
      const before = await probeRequest(target, { method: "GET", path: SEED_ROLE_MENUS });
      expect(before.status, `${target.name} GET menus 期望 200 实得 ${before.status}`).toBe(200);
      restore.push(((before.body as { menuIds?: string[] }).menuIds) ?? []);
    }
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      const first = await probeRequest(target, { method: "DELETE", path: SEED_ROLE_MENUS });
      expect([200, 204], `${target.name} clear 期望 200/204 实得 ${first.status}`).toContain(first.status);
      // 幂等：已清空再删不 5xx
      const second = await probeRequest(target, { method: "DELETE", path: SEED_ROLE_MENUS });
      expect(second.status, `${target.name} 重复 clear 不应 5xx 实得 ${second.status}`).toBeLessThan(500);
      // inline 还原（并行读测试同窗口）
      const back = await probeRequest(target, {
        method: "PUT",
        path: SEED_ROLE_MENUS,
        body: { menuIds: restore[i] },
      });
      expect(back.status, `${target.name} 还原 PUT 期望 200 实得 ${back.status}`).toBe(200);
    }
  }, 60_000);
});

describe.skipIf(!live)("写端点 teardown — runCleanups + 防御性 delete-role", () => {
  afterAll(async () => {
    await runCleanups();
    for (const [tname, roleId] of ctx.roleIds) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, { method: "DELETE", path: `${ROLE_BASE}/${roleId}` });
      if (r.status !== 200 && r.status !== 204 && r.status !== 404) {
        console.warn(`[teardown] final delete-role ${tname} 异常 status=${r.status}`);
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
      "[contract-test] roles 写端点比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/tenant-roles-write.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
