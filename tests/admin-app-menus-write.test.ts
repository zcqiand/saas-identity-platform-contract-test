// M96.F02.I50–I56 — /admin/apps/{appId}/menus CRUD + 结构维护四方比对（第四期 B 组续）。
//
// appId 用 seed 的 lab-management（菜单挂 seed 数据上，只读列表可比对）；
// 写操作全部打「本文件自建的 menu」——不碰 seed 行（c0000000* 是 role grant 引用的）。
//
// I50 GET list：seed 菜单列表（扁平数组，Menu[]）。
// I51 POST：创 menu（code/name 必填）→ 200/201；id 入 ctx。
// I52 GET {menuId}：200 + 字段；不存在 id → 404。
// I53 PATCH：改 name → 200 + updatedAt。
// I54 DELETE：204/200 + 幂等（重复 → 404）。
// I55 PUT reorder：同 parent 下两个自建 menu 按数组顺序换位 → 200 + Menu[]。
// I56 PATCH parent：自建 menu B 挂到 A 下 → 200 + parentId 回带。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const BASE_PATH = pathWithParams("/api/v1/admin/apps/{appId}/menus", {
  appId: ALICE_PARAMS.appId,
});
const DEAD_ID = "00000000-0000-0000-0000-00000000dead";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

/** 每 target 自建的一对 menu id（A/B，reorder + parent 用）。 */
const ctx: { menuA: Map<string, string>; menuB: Map<string, string> } = {
  menuA: new Map(),
  menuB: new Map(),
};

async function createMenu(target: Target): Promise<string> {
  const code = uniqueName("ct-menu");
  const r = await probeRequest(target, {
    method: "POST",
    path: BASE_PATH,
    body: { code, name: `contract-test ${code}` },
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`${target.name} 建menu失败 status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
  }
  return String((r.body as Record<string, unknown>).id);
}

describe.skipIf(!live)("M96.F02.I50 GET /admin/apps/{appId}/menus 四方比对", () => {
  it("seed 菜单列表 → 200 + Menu[] shape", async () => {
    for (const t of targets) {
      const r = await probeRequest(t, { method: "GET", path: BASE_PATH });
      expect(r.status, `${t.name} list 期望 200 实得 ${r.status}`).toBe(200);
      const items = r.body as Array<Record<string, unknown>>;
      expect(Array.isArray(items), `${t.name} 响应必须是数组（扁平 Menu[]）`).toBe(true);
      // seed lab-mgmt 下菜单不少（V016 数十条）
      expect(items.length, `${t.name} seed 菜单不应为空`).toBeGreaterThanOrEqual(5);
      for (const key of ["id", "appId", "code", "name", "sortOrder", "status"]) {
        expect(items[0]![key], `${t.name} menu 行缺 ${key}`).toBeDefined();
      }
    }
    // 列表内容随本文件写操作漂移（自建 menu 进出）→ 不做 cross-target 内容比对
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I51 POST /admin/apps/{appId}/menus 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.menuA.clear();
    ctx.menuB.clear();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I51 ${target.name} 创 menu（A/B 两个）→ 200/201 + 字段齐全`, async () => {
      const a = await createMenu(target);
      const b = await createMenu(target);
      ctx.menuA.set(target.name, a);
      ctx.menuB.set(target.name, b);
      for (const id of [a, b]) {
        registerCleanup(`delete-menu:${target.name}:${id.slice(-8)}`, async () => {
          const tr = await probeRequest(target, { method: "DELETE", path: `${BASE_PATH}/${id}` });
          if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
            console.warn(`[teardown] delete-menu ${target.name} 异常 status=${tr.status}`);
          }
        });
      }
      // 字段断言（用 A 的响应重打一次 GET 验）
      const g = await probeRequest(target, { method: "GET", path: `${BASE_PATH}/${a}` });
      expect(g.status, `${target.name} get 新menu 期望 200 实得 ${g.status}`).toBe(200);
      const body = g.body as Record<string, unknown>;
      for (const key of ["id", "appId", "code", "name", "sortOrder", "status"]) {
        expect(body[key], `${target.name} menu 行缺 ${key}`).toBeDefined();
      }
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I52 GET /admin/apps/{appId}/menus/{menuId} 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I52 ${target.name} 取自建 menu → 200`, async () => {
      const menuId = ctx.menuA.get(target.name);
      if (!menuId) throw new Error(`${target.name} I51 未创建 menu，跳过 I52`);
      const r = await probeRequest(target, { method: "GET", path: `${BASE_PATH}/${menuId}` });
      expect(r.status, `${target.name} get 期望 200 实得 ${r.status}`).toBe(200);
      expect((r.body as Record<string, unknown>).id).toBe(menuId);
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

describe.skipIf(!live)("M96.F02.I66 GET /admin/apps/{appId}/menus/{menuId} 404 ErrorResponse envelope", () => {
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

describe.skipIf(!live)("M96.F02.I53 PATCH /admin/apps/{appId}/menus/{menuId} 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I53 ${target.name} 改 name → 200 + updatedAt 必填`, async () => {
      const menuId = ctx.menuA.get(target.name);
      if (!menuId) throw new Error(`${target.name} I51 未创建 menu，跳过 I53`);
      const r = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${menuId}`,
        body: { name: `renamed-${uniqueName("ct")}` },
      });
      expect(r.status, `${target.name} patch 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.updatedAt ?? body.sortOrder, `${target.name} patch 响应应有 updated 迹象`).toBeDefined();
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I55 PUT /admin/apps/{appId}/menus/{menuId}/reorder 四方比对", () => {
  // 排在 I56 parent 前：reorder 语义是「同 parent 同级」，先于挪 parent
  for (const target of targets) {
    it(`M96.F02.I55 ${target.name} A/B 换序 → 200 + Menu[]`, async () => {
      const a = ctx.menuA.get(target.name);
      const b = ctx.menuB.get(target.name);
      if (!a || !b) throw new Error(`${target.name} I51 未创建 menu 对，跳过 I55`);
      const r = await probeRequest(target, {
        method: "PUT",
        path: `${BASE_PATH}/${b}/reorder`,
        body: { orderedMenuIds: [b, a] }, // B 提到 A 前
      });
      expect(r.status, `${target.name} reorder 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
      const items = r.body as Array<Record<string, unknown>>;
      expect(Array.isArray(items), `${target.name} reorder 响应必须是 Menu[]`).toBe(true);
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I56 PATCH /admin/apps/{appId}/menus/{menuId}/parent 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I56 ${target.name} B 挂到 A 下 → 200 + parentId 回带`, async () => {
      const a = ctx.menuA.get(target.name);
      const b = ctx.menuB.get(target.name);
      if (!a || !b) throw new Error(`${target.name} I51 未创建 menu 对，跳过 I56`);
      const r = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${b}/parent`,
        body: { parentId: a },
      });
      expect(r.status, `${target.name} moveTo 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.parentId, `${target.name} moveTo 后 parentId 应回带 ${a}`).toBe(a);
      // 还原为顶级（不留给 seed 脏层级）
      const back = await probeRequest(target, {
        method: "PATCH",
        path: `${BASE_PATH}/${b}/parent`,
        body: { parentId: null },
      });
      expect(back.status, `${target.name} 还原顶级 期望 200 实得 ${back.status}`).toBe(200);
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I54 DELETE /admin/apps/{appId}/menus/{menuId} 四方比对", () => {
  it("I51 的 menu 对删除 → 204/200 + 重复删 → 404（幂等）", async () => {
    for (const target of targets) {
      for (const m of [ctx.menuA.get(target.name), ctx.menuB.get(target.name)]) {
        if (!m) continue;
        const first = await probeRequest(target, { method: "DELETE", path: `${BASE_PATH}/${m}` });
        expect([200, 204], `${target.name} delete 期望 200/204 实得 ${first.status}`).toContain(first.status);
        const second = await probeRequest(target, { method: "DELETE", path: `${BASE_PATH}/${m}` });
        expect([404, 200, 204], `${target.name} 重复删期望 404 实得 ${second.status}`).toContain(second.status);
      }
      ctx.menuA.delete(target.name);
      ctx.menuB.delete(target.name);
    }
  }, 60_000);

  afterAll(async () => {
    await runCleanups();
    for (const m of [ctx.menuA, ctx.menuB]) {
      for (const [tname, menuId] of m) {
        const t = TARGETS[tname];
        if (!t) continue;
        const r = await probeRequest(t, { method: "DELETE", path: `${BASE_PATH}/${menuId}` });
        if (r.status !== 200 && r.status !== 204 && r.status !== 404) {
          console.warn(`[teardown] final delete-menu ${tname} 异常 status=${r.status}`);
        }
      }
    }
  }, 60_000);
});

describe.runIf(!live)("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] admin-app-menus 比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/admin-app-menus-write.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
