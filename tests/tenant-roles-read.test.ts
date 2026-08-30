// M96.F02.I07 / I08 / I09 — 角色三件套四方比对。
//
// I07: GET /tenants/{t}/roles           —— 分页包装 {items,page,pageSize,total}
// I08: GET /tenants/{t}/roles/{r}       —— 单个 Role
// I09: GET /tenants/{t}/roles/{r}/menus —— 角色绑定的菜单（RoleMenuGrant）
//
// 路径参数全用 ALICE_PARAMS：tenant=acme, role=acmeAdmin。
// {t}/roles 列表的 items[0].id 不一定等于 acmeAdmin —— 排序是后端决定的；
// 我们只断言形状与必填字段，不绑定具体 ID。
import { beforeAll, describe, expect, it } from "vitest";

import { compareAll, formatDivergences } from "../src/compare.js";
import { probeAll } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

const ROLE_REQUIRED = ["id", "tenantId", "code", "name", "permissionIds", "createdAt", "updatedAt"];
const ROLE_MENU_GRANT_REQUIRED = ["roleId", "tenantId", "menuIds", "updatedAt"];

describe.skipIf(!live)("M96.F02.I07 GET /tenants/{t}/roles 四方比对", () => {
  const PATH = pathWithParams("/api/v1/tenants/{tenantId}/roles", {
    tenantId: ALICE_PARAMS.tenantId,
  });

  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, PATH);
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是分页包装 {items: Role[]}", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      expect(Array.isArray(body.items), `${p.target} items 不是数组`).toBe(true);
    }
  });

  it("每个 Role 必填字段齐全", () => {
    for (const p of probes) {
      const items = (p.body as { items: Array<Record<string, unknown>> }).items;
      for (const role of items) {
        for (const key of ROLE_REQUIRED) {
          expect(role[key], `${p.target} role 缺 ${key}`).toBeDefined();
        }
        expect(Array.isArray(role.permissionIds), `${p.target} permissionIds 不是数组`).toBe(true);
      }
    }
  });

  it("normalize 后所有目标全等", () => {
    expect(compareAll(probes, targets), `\n${formatDivergences(compareAll(probes, targets))}\n`).toEqual([]);
  });
});

describe.skipIf(!live)("M96.F02.I08 GET /tenants/{t}/roles/{r} 四方比对", () => {
  const PATH = pathWithParams("/api/v1/tenants/{tenantId}/roles/{roleId}", {
    tenantId: ALICE_PARAMS.tenantId,
    roleId: ALICE_PARAMS.roleId,
  });

  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, PATH);
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是单对象 Role", () => {
    for (const p of probes) {
      expect(Array.isArray(p.body), `${p.target} 期望单对象`).toBe(false);
      expect(typeof p.body, `${p.target} 不是对象`).toBe("object");
      expect(p.body, `${p.target} body 为 null`).not.toBeNull();
    }
  });

  it("必填字段齐全（Role.required）", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      for (const key of ROLE_REQUIRED) {
        expect(body[key], `${p.target} role 缺 ${key}`).toBeDefined();
      }
      expect(body.id, `${p.target} id 与查询参数不一致`).toBe(ALICE_PARAMS.roleId);
    }
  });

  it("normalize 后所有目标全等", () => {
    expect(compareAll(probes, targets), `\n${formatDivergences(compareAll(probes, targets))}\n`).toEqual([]);
  });
});

describe.skipIf(!live)("M96.F02.I09 GET /tenants/{t}/roles/{r}/menus 四方比对", () => {
  const PATH = pathWithParams("/api/v1/tenants/{tenantId}/roles/{roleId}/menus", {
    tenantId: ALICE_PARAMS.tenantId,
    roleId: ALICE_PARAMS.roleId,
  });

  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, PATH);
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是单对象 RoleMenuGrant", () => {
    for (const p of probes) {
      expect(Array.isArray(p.body), `${p.target} 期望单对象`).toBe(false);
      expect(typeof p.body, `${p.target} 不是对象`).toBe("object");
      expect(p.body, `${p.target} body 为 null`).not.toBeNull();
    }
  });

  it("必填字段齐全（RoleMenuGrant.required: roleId/tenantId/menuIds/updatedAt）", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      for (const key of ROLE_MENU_GRANT_REQUIRED) {
        expect(body[key], `${p.target} 缺 ${key}`).toBeDefined();
      }
      expect(Array.isArray(body.menuIds), `${p.target} menuIds 不是数组`).toBe(true);
      expect(body.roleId, `${p.target} roleId 与查询参数不一致`).toBe(ALICE_PARAMS.roleId);
    }
  });

  it("normalize 后所有目标全等", () => {
    expect(compareAll(probes, targets), `\n${formatDivergences(compareAll(probes, targets))}\n`).toEqual([]);
  });
});

describe.runIf(!live)("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：4 个后端分别跑在 5174 / 5000 / 8080 / 3000",
    );
  });
});
