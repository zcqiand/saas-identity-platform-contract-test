// M96.F02.I04 / M96.F02.I05 — `GET /me` + `GET /me/menus` 四方比对。
//
// /me 返回单对象 CurrentUser（id/email/memberships + 可选 currentTenantId）。
// /me/menus 返回 map<string, EffectiveMenuNode[]>，按 appCode 分组。
//
// 共用一个文件：同一组登录 + 同一 describe「未运行」提示，省一次 targets 解析。
import { beforeAll, describe, expect, it } from "vitest";

import { compareAll, formatDivergences } from "../src/compare.js";
import { probeAll } from "../src/http.js";
import { type Target, selectedTargets } from "../src/targets.js";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

describe.skipIf(!live)("M96.F02.I04 GET /api/v1/me 四方比对", () => {
  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, "/api/v1/me");
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是单对象 CurrentUser（不是数组）", () => {
    for (const p of probes) {
      expect(Array.isArray(p.body), `${p.target} 期望单对象`).toBe(false);
      expect(typeof p.body, `${p.target} 不是对象`).toBe("object");
      expect(p.body, `${p.target} body 为 null`).not.toBeNull();
    }
  });

  it("必填字段齐全（契约 required: id/email/memberships）", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      for (const key of ["id", "email", "memberships"]) {
        expect(body[key], `${p.target} 缺 ${key}`).toBeDefined();
      }
      expect(Array.isArray(body.memberships), `${p.target} memberships 不是数组`).toBe(true);
    }
  });

  it("normalize 后所有目标全等", () => {
    const divergences = compareAll(probes, targets);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  });
});

describe.skipIf(!live)("M96.F02.I05 GET /api/v1/me/menus 四方比对", () => {
  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    // OpenAPI: getMyMenus(): Record<appCode, EffectiveMenuNode[]> — 全部 app map
    probes = await probeAll(targets, "/api/v1/me/menus");
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是 map（对象），每个 value 都是菜单数组", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      expect(typeof body, `${p.target} 不是对象`).toBe("object");
      expect(body, `${p.target} body 为 null`).not.toBeNull();
      const values = Object.values(body);
      // alice 至少应能看到某个 app 的菜单；空 map 也算合法但描述里要看得见
      for (const v of values) {
        expect(Array.isArray(v), `${p.target} 菜单 value 不是数组`).toBe(true);
      }
    }
  });

  it("菜单数组里必填字段齐全（EffectiveMenuNode.required: id/appId/code/name/type/sortOrder/children）", () => {
    const REQUIRED = ["id", "appId", "code", "name", "type", "sortOrder", "children"];
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      for (const value of Object.values(body)) {
        const arr = value as Array<Record<string, unknown>>;
        for (const node of arr) {
          for (const key of REQUIRED) {
            expect(node[key], `${p.target} 菜单节点缺 ${key}`).toBeDefined();
          }
          expect(Array.isArray(node.children), `${p.target} children 不是数组`).toBe(true);
        }
      }
    }
  });

  it("normalize 后所有目标全等", () => {
    const divergences = compareAll(probes, targets);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  });
});

describe.runIf(!live)("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
