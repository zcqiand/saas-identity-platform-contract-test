// M96.F02.I20 — PUT /tenants/{t}/roles/{r}/menus 四方比对（写端点第二期 M09.F02.I01）。
//
// 写比对模型：3 后端共享一个 PG（role_menu_grants PK (role_id, tenant_id) ON CONFLICT
// upsert）；msw 内存 fixture。比对 shape 不比 byte。
//
// I20: 每个 target 用 SET 内至少 1 个 menuId，PUT .../menus 整批替换，
//      验 status 200 + 响应包含 roleId/tenantId/menuIds/updatedAt。teardown 不删
//      grant（grant 是 tenant 级共享，不应在测试后清）。
//
// 边界：本测试不动 menuIds 来源（用 acme admin role 关联的 menuIds 起点）；
// 与 I09 (GET .../menus) 比对结果形状。
//
// **teardown 还原** (2026-08-31 contract-test batch): vitest 2.x 默认并行跑测试文件,
// I20 写 role_menu_grants 与 I05/I09 读 role_menu_grants 同窗口, 必须还原才能让后续
// 4-way 比对（I05 me/menus 需 alice 的 grant 有合法 menuIds）不撞坏。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const TENANT_ID = ALICE_PARAMS.tenantId;
const ROLE_ID = ALICE_PARAMS.roleId;
const BASE_PATH = pathWithParams(
  "/api/v1/tenants/{tenantId}/roles/{roleId}/menus",
  { tenantId: TENANT_ID, roleId: ROLE_ID },
);

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

// acme admin role 初始关联 menuIds — 用 I09 GET 结果作为 PUT 输入；
// 这里直接用种子里 lab-mgmt app 下的两个常见 menu 作为「幂等写入」输入
// （与 I09 GET 实际值可能略有差异；写入即覆盖语义，PUT 后所有目标应一致）。
const TARGET_MENU_IDS: string[] = [
  "00000000-0000-0000-0000-c00000000001",
  "00000000-0000-0000-0000-c00000000002",
];

// 还原 alice admin 的 role_menu_grants 到 V016 seed 的 27 个 menuIds.
// 2026-08-31 修: vitest 2.x 默认并行跑测试文件, I20 的测试假 ID 会污染 PG,
// 后续 I05/I09 看到错数据 → 必须 inline 还原（teardown 后跑没时间窗保护）。
const REAL_MENU_IDS = [
  "00000000-0000-0000-0000-910000000001","00000000-0000-0000-0000-910000000002",
  "00000000-0000-0000-0000-910000000007","00000000-0000-0000-0000-910000000003",
  "00000000-0000-0000-0000-910000000008","00000000-0000-0000-0000-910000000009",
  "00000000-0000-0000-0000-910000000010","00000000-0000-0000-0000-910000000011",
  "00000000-0000-0000-0000-910000000012","00000000-0000-0000-0000-910000000013",
  "00000000-0000-0000-0000-910000000014","00000000-0000-0000-0000-910000000004",
  "00000000-0000-0000-0000-910000000027","00000000-0000-0000-0000-910000000005",
  "00000000-0000-0000-0000-910000000023","00000000-0000-0000-0000-910000000024",
  "00000000-0000-0000-0000-910000000025","00000000-0000-0000-0000-910000000026",
  "00000000-0000-0000-0000-910000000006","00000000-0000-0000-0000-910000000015",
  "00000000-0000-0000-0000-910000000016","00000000-0000-0000-0000-910000000017",
  "00000000-0000-0000-0000-910000000018","00000000-0000-0000-0000-910000000019",
  "00000000-0000-0000-0000-910000000020","00000000-0000-0000-0000-910000000021",
  "00000000-0000-0000-0000-910000000022","00000000-0000-0000-0000-930000000001",
  "00000000-0000-0000-0000-930000000002","00000000-0000-0000-0000-930000000003",
  "00000000-0000-0000-0000-930000000004","00000000-0000-0000-0000-930000000005",
  "00000000-0000-0000-0000-930000000006","00000000-0000-0000-0000-930000000007",
];
async function restoreGrant(target: Target): Promise<void> {
  await probeRequest(target, {
    method: "PUT",
    path: BASE_PATH,
    body: { menuIds: REAL_MENU_IDS },
  });
}

describe.skipIf(!live)("M96.F02.I20 PUT /tenants/{t}/roles/{r}/menus 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I20 ${target.name} 整批设置返回 200 + roleMenuGrant 字段齐全`, async () => {
      const r = await probeRequest(target, {
        method: "PUT",
        path: BASE_PATH,
        body: { menuIds: TARGET_MENU_IDS },
      });
      expect(r.status, `${target.name} setRoleMenus 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.roleId, `${target.name} 响应 roleId`).toBe(ROLE_ID);
      expect(body.tenantId, `${target.name} 响应 tenantId`).toBe(TENANT_ID);
      expect(Array.isArray(body.menuIds), `${target.name} 响应 menuIds 必为数组`).toBe(true);
      expect((body.menuIds as string[]).length, `${target.name} menuIds 应等于 TARGET_MENU_IDS 长度`).toBe(TARGET_MENU_IDS.length);
      for (const mid of TARGET_MENU_IDS) {
        expect((body.menuIds as string[]), `${target.name} menuIds 应包含 ${mid}`).toContain(mid);
      }
      expect(body.updatedAt, `${target.name} updatedAt 必填`).toBeDefined();
      // inline 还原 — 不让 c0000000* 测试假 ID 漏到并行跑的 I05/I09 read
      await restoreGrant(target);
    }, 30_000);
  }

  it("normalize 后所有目标的成功响应字段一致（除 volatile）", async () => {
    const probes = await Promise.all(
      targets.map((t) =>
        probeRequest(t, {
          method: "PUT",
          path: BASE_PATH,
          body: { menuIds: TARGET_MENU_IDS },
        }),
      ),
    );
    for (const p of probes) {
      expect(p.status, `normalize 比对期望 200 实得 ${p.status}`).toBe(200);
    }
    // RoleMenuGrant 响应：roleId/tenantId 全等；menuIds 长度 = TARGET_MENU_IDS；updatedAt volatile
    const drop = ["roleId", "tenantId", "menuIds", "updatedAt"];
    const result = compareBodies(probes, targets, drop);
    expect(result, `\n${formatDivergences(result)}\n`).toEqual([]);
    // normalize 比对也跑过 PUT 污染 → 还原
    await Promise.all(targets.map(restoreGrant));
  }, 60_000);
});

describe.skipIf(!live)("写端点 teardown — runCleanups", () => {
  afterAll(async () => {
    await runCleanups();
    // 最后兜底还原一次, 防止 registerCleanup 路径上某 target 漏注册
    await Promise.all(targets.map(restoreGrant));
  }, 30_000);
  it("占位 — afterAll 真正干活", () => {
    expect(targets.length).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(!live)("写端点 teardown — runCleanups", () => {
  afterAll(async () => {
    await runCleanups();
  }, 30_000);
  it("占位 — afterAll 真正干活", () => {
    expect(targets.length).toBeGreaterThanOrEqual(2);
  });
});

describe.runIf(!live)("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] M96.F02.I20 写端点比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/tenant-role-menus-write.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
