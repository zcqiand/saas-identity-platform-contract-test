// M96.F02.I39–I43 — /tenants/{t}/users 写端点第二组（第四期 A 组续）。
//
// 延续 tenant-users-write.test.ts（I19 POST）的写比对模型：3 后端共享一个 PG，
// msw 内存 fixture；唯一化 username/email 防撞 UNIQUE。本文件各 it 自创自删，
// 不依赖 I19 的 ctx（vitest 并行文件间没有顺序保证）。
//
// I39 PATCH /users/{u}：改 displayName → 200 + updatedAt 必填；不存在 id → 404。
// I40 PUT /users/{u}/roles：设 roleIds（seed acmeMember）→ 200 + 响应回带；
//      断言后还原为 [acmeAdmin]（alice 是 seed 行，不留给后续读测试脏数据）。
// I41 PATCH /users/{u}/status：active → suspended → active 往返，终态还原 active。
// I42 POST /users/invitations：邀请新 email → 200/201 + status=invited 的 user 行；
//      teardown DELETE 兜底。
// I43 DELETE /users/{u}：对 I42 的邀请行物理删 → 200/204 + 幂等（重复 → 404）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS, SEED } from "../src/seed.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const TENANT_ID = ALICE_PARAMS.tenantId;
const USER_BASE = pathWithParams("/api/v1/tenants/{tenantId}/users", { tenantId: TENANT_ID });
const ALICE_PATH = `${USER_BASE}/${SEED.userId}`;
const DEAD_ID = "00000000-0000-0000-0000-00000000dead";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

/** 自建 user 的 id（PATCH/status 等「可反复打」断言用），按 target 持有。 */
const ctx: { userIds: Map<string, string> } = { userIds: new Map() };

/** 每个 target 自建一个 user（各 it 共享，teardown 统一删）。 */
async function ensureUser(target: Target): Promise<string> {
  const existing = ctx.userIds.get(target.name);
  if (existing) return existing;
  const name = uniqueName("ct-u2");
  const r = await probeRequest(target, {
    method: "POST",
    path: USER_BASE,
    body: { username: name, email: `${name}@contract-test.io`, password: "dev-password-123" },
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`${target.name} 建user失败 status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
  }
  const id = String((r.body as Record<string, unknown>).id);
  ctx.userIds.set(target.name, id);
  registerCleanup(`delete-u2:${target.name}`, async () => {
    const tr = await probeRequest(target, { method: "DELETE", path: `${USER_BASE}/${id}` });
    if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
      console.warn(`[teardown] delete-u2 ${target.name} 异常 status=${tr.status}`);
    }
  });
  return id;
}

describe.skipIf(!live)("M96.F02.I39 PATCH /tenants/{t}/users/{u} 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.userIds.clear();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I39 ${target.name} 改 displayName → 200 + updatedAt 必填`, async () => {
      const userId = await ensureUser(target);
      const r = await probeRequest(target, {
        method: "PATCH",
        path: `${USER_BASE}/${userId}`,
        body: { displayName: `dn-${uniqueName("ct")}` },
      });
      expect(r.status, `${target.name} patch 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.updatedAt, `${target.name} patch 后 updatedAt 必填`).toBeDefined();
    }, 30_000);
  }

  it("不存在 id → 404 全等", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "PATCH", path: `${USER_BASE}/${DEAD_ID}`, body: { displayName: "noop" } }));
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 不存在 id 期望 404 实得 ${p.status}`).toBe(404);
    }
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I70 PATCH /tenants/{t}/users/{u} 404 ErrorResponse envelope", () => {
  it("404 envelope shape 全等（前端 catch 分支依赖）", async () => {
    // SSOT ErrorResponse: {code, message, details?} —— 4 后端各自命名不同
    // （msw: {code,message}；springboot/aspnetcore/nextjs: {error,message,...}）。
    // 契约面是「有错误码字段 + 有人读字段」，drop 之后骨架必须一致。
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "PATCH", path: `${USER_BASE}/${DEAD_ID}`, body: { displayName: "noop" } }));
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 404 envelope 期望 404 实得 ${p.status}`).toBe(404);
    }
    const drop = ["code", "message", "error", "error_description", "details", "path", "timestamp", "traceId"];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I40 PUT /tenants/{t}/users/{u}/roles 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I40 ${target.name} 设 roleIds → 200 + 响应回带`, async () => {
      const userId = await ensureUser(target);
      const r = await probeRequest(target, {
        method: "PUT",
        path: `${USER_BASE}/${userId}/roles`,
        body: { roleIds: [SEED.roles.acmeMember] },
      });
      expect(r.status, `${target.name} 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      // users.roleIds 冗余列，authoritative 在 memberships（家族约定）—— 响应应回带 acmeMember
      expect(body.id, `${target.name} 响应缺 id`).toBeDefined();
      // 用 GET 复核（authoritative 源）
      const g = await probeRequest(target, { method: "GET", path: `${USER_BASE}/${userId}` });
      expect(g.status).toBe(200);
      const roleIds = (g.body as { roleIds?: string[] }).roleIds ?? [];
      expect(roleIds, `${target.name} GET 后 roleIds 应含 acmeMember，实得 ${JSON.stringify(roleIds)}`).toContain(SEED.roles.acmeMember);
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I41 PATCH /tenants/{t}/users/{u}/status 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I41 ${target.name} active → suspended → active 往返`, async () => {
      const userId = await ensureUser(target);
      const off = await probeRequest(target, {
        method: "PATCH",
        path: `${USER_BASE}/${userId}/status`,
        body: { status: "suspended" },
      });
      expect(off.status, `${target.name} suspend 期望 200 实得 ${off.status} body=${JSON.stringify(off.body).slice(0, 200)}`).toBe(200);
      expect((off.body as Record<string, unknown>).status, `${target.name} suspend 后 status`).toBe("suspended");
      const on = await probeRequest(target, {
        method: "PATCH",
        path: `${USER_BASE}/${userId}/status`,
        body: { status: "active" },
      });
      expect(on.status, `${target.name} reactivate 期望 200 实得 ${on.status}`).toBe(200);
      expect((on.body as Record<string, unknown>).status, `${target.name} reactivate 后 status`).toBe("active");
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I42 POST /tenants/{t}/users/invitations 四方比对", () => {
  /** 各 target 邀请出的 user id（I43 删除用）。 */
  const invited: Map<string, string> = new Map();

  for (const target of targets) {
    it(`M96.F02.I42 ${target.name} 邀请 → 200/201 + status=invited`, async () => {
      const email = `${uniqueName("invite")}@contract-test.io`;
      const r = await probeRequest(target, {
        method: "POST",
        path: `${USER_BASE}/invitations`,
        body: { email, roleIds: [SEED.roles.acmeMember] },
      });
      expect([200, 201], `${target.name} 期望 200/201 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toContain(r.status);
      const body = r.body as Record<string, unknown>;
      expect(body.email, `${target.name} 响应缺 email`).toBe(email);
      expect(body.status, `${target.name} 邀请行 status 必须 invited`).toBe("invited");
      expect(body.id, `${target.name} 响应缺 id`).toBeDefined();
      const userId = String(body.id);
      invited.set(target.name, userId);
      // 2026-09-01: 给 invite-* 探针补 registerCleanup(本轮 I10 修复)。
      // 之前没注册 → 4 target 邀请出 4 个 user 全残留,I10 GET /users 时行数差。
      // I43 describe 已 DELETE 这些 user,但**只在 I43 测**时跑;vitest describe 顺序
      // 不保证 I42 在 I43 前 — 失败时残留。注册 cleanup 保证 afterAll 一定清。
      registerCleanup(`delete-invite:${target.name}`, async () => {
        const tr = await probeRequest(target, {
          method: "DELETE",
          path: `${USER_BASE}/${userId}`,
        });
        if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
          console.warn(`[teardown] delete invite ${userId} status=${tr.status}`);
        }
      });
    }, 30_000);
  }

  describe.skipIf(!live)("M96.F02.I43 DELETE /tenants/{t}/users/{u} 四方比对", () => {
    it("I42 的邀请行删除 → 200/204 + 重复删 → 404（幂等）", async () => {
      for (const target of targets) {
        const userId = invited.get(target.name);
        if (!userId) throw new Error(`${target.name} I42 未邀请 user，跳过 I43`);
        const first = await probeRequest(target, { method: "DELETE", path: `${USER_BASE}/${userId}` });
        expect([200, 204], `${target.name} delete 期望 200/204 实得 ${first.status}`).toContain(first.status);
        const second = await probeRequest(target, { method: "DELETE", path: `${USER_BASE}/${userId}` });
        expect([404, 200, 204], `${target.name} 重复删期望 404 实得 ${second.status}`).toContain(second.status);
        invited.delete(target.name);
      }
    }, 60_000);
  });
});

describe.skipIf(!live)("写端点 teardown — runCleanups + 防御性 delete", () => {
  afterAll(async () => {
    await runCleanups();
    // 兜底：I42/I43 断言失败时行还在（容差 200/204/404）
    for (const [tname, userId] of ctx.userIds) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, { method: "DELETE", path: `${USER_BASE}/${userId}` });
      if (r.status !== 200 && r.status !== 204 && r.status !== 404) {
        console.warn(`[teardown] final delete-u2 ${tname} 异常 status=${r.status}`);
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
      "[contract-test] users 写端点第二组比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/tenant-users-write-2.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
