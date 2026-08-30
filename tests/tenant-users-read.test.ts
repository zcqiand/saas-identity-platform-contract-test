// M96.F02.I10 / I11 — 用户读四方比对。
//
// I10: GET /tenants/{t}/users     —— 分页包装
// I11: GET /tenants/{t}/users/{u} —— 单个 User
//
// User.required: id, tenantId, username, email, status, roleIds, createdAt, updatedAt。
// alice 是 acme 用户；列列表时 acme 应该至少有 alice/bob/carol 三条（V016 seed）。
import { beforeAll, describe, expect, it } from "vitest";

import { compareAll, formatDivergences } from "../src/compare.js";
import { probeAll } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

const USER_REQUIRED = [
  "id",
  "tenantId",
  "username",
  "email",
  "status",
  "roleIds",
  "createdAt",
  "updatedAt",
];

describe.skipIf(!live)("M96.F02.I10 GET /tenants/{t}/users 四方比对", () => {
  const PATH = pathWithParams("/api/v1/tenants/{tenantId}/users", {
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

  it("响应体是分页包装 {items: User[]}", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      expect(Array.isArray(body.items), `${p.target} items 不是数组`).toBe(true);
    }
  });

  it("每个 User 必填字段齐全", () => {
    for (const p of probes) {
      const items = (p.body as { items: Array<Record<string, unknown>> }).items;
      for (const user of items) {
        for (const key of USER_REQUIRED) {
          expect(user[key], `${p.target} user 缺 ${key}`).toBeDefined();
        }
        expect(Array.isArray(user.roleIds), `${p.target} roleIds 不是数组`).toBe(true);
      }
    }
  });

  it("normalize 后所有目标全等", () => {
    expect(compareAll(probes, targets), `\n${formatDivergences(compareAll(probes, targets))}\n`).toEqual([]);
  });
});

describe.skipIf(!live)("M96.F02.I11 GET /tenants/{t}/users/{u} 四方比对", () => {
  const PATH = pathWithParams("/api/v1/tenants/{tenantId}/users/{userId}", {
    tenantId: ALICE_PARAMS.tenantId,
    userId: ALICE_PARAMS.userId,
  });

  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, PATH);
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是单对象 User", () => {
    for (const p of probes) {
      expect(Array.isArray(p.body), `${p.target} 期望单对象`).toBe(false);
      expect(typeof p.body, `${p.target} 不是对象`).toBe("object");
      expect(p.body, `${p.target} body 为 null`).not.toBeNull();
    }
  });

  it("必填字段齐全（User.required）", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      for (const key of USER_REQUIRED) {
        expect(body[key], `${p.target} user 缺 ${key}`).toBeDefined();
      }
      expect(body.id, `${p.target} id 与查询参数不一致`).toBe(ALICE_PARAMS.userId);
      expect(body.username, `${p.target} username 不应是 alice 之外的人`).toBe("alice");
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
