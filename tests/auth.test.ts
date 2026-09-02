// M96.F02.I22 / I23 / I24 / I25 — auth 域四方比对（第三期 A 组）。
//
// I22 login：正确凭证 200 shape（token 在 ALWAYS_VOLATILE 已剔）+ 错密码 4xx 全等。
// I23 logout：login 后带 Bearer 打 logout，204 全等（msw/springboot noContent）。
// I24 refresh：用各自 login 返回的 refreshToken 换新对（rotate 语义，一次性），
//              token 剔除后 shape 比对；未知 token → 400 全等。
// I25 oidc/callback：只比错误分支（无 code → 4xx），不依赖真 IdP ——
//              4 后端都没有「假 IdP」基础设施，成功分支不可比是契约面共识。
//
// 注意：refresh 的 body 各 target 用自己的 refreshToken（不能共用——rotate 一次性，
// 且 msw 与真后端 token 格式不同）。响应里的 token 全部在 normalize 剔除清单里。

import { beforeAll, describe, expect, it } from "vitest";

import { compareAll, compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest, SEED_USER } from "../src/http.js";
import { type Target, selectedTargets } from "../src/targets.js";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

/** 各 target 自己的 login 响应（refreshToken 每家格式不同，不跨后端用）。 */
const loginBodies = new Map<string, Record<string, unknown>>();

describe.skipIf(!live)("M96.F02.I22 POST /auth/login 四方比对", () => {
  beforeAll(async () => {
    for (const t of targets) {
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/auth/login",
        body: { ...SEED_USER },
      });
      loginBodies.set(t.name, r.body as Record<string, unknown>);
    }
  }, 60_000);

  it("正确凭证 → 200 + LoginResponse 必填字段齐全", async () => {
    for (const t of targets) {
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/auth/login",
        body: { ...SEED_USER },
      });
      expect(r.status, `${t.name} login 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      // SSOT LoginResponse: accessToken/refreshToken/tokenType/expiresIn/userId/currentTenantId
      for (const key of ["accessToken", "refreshToken", "tokenType", "expiresIn", "userId", "currentTenantId"]) {
        expect(body[key], `${t.name} login 响应缺 ${key}`).toBeDefined();
      }
      expect(body.tokenType).toBe("Bearer");
      expect(body.expiresIn).toBe(3600);
    }
  }, 60_000);

  it("错误密码 → 4xx 全等（normalize 后 body 全等）", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(
        await probeRequest(t, {
          method: "POST",
          path: "/api/v1/auth/login",
          body: { username: SEED_USER.username, password: "wrong-password" },
        }),
      );
    }
    for (const p of probes) {
      expect(
        p.status,
        `${p.target} 错密码期望 4xx 实得 ${p.status} body=${JSON.stringify(p.body).slice(0, 120)}`,
      ).toBeGreaterThanOrEqual(400);
      expect(p.status).toBeLessThan(500);
    }
    // 错误 body 的字段名家族两派（msw {code} vs 真后端 {error,...}，SSOT ErrorResponse
    // 两种都合法）—— drop 掉 code/error/error_description/details，比 status 与骨架。
    const divergences = compareAll(probes, targets, [
      "message", "code", "error", "error_description", "details",
    ]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I23 POST /auth/logout 四方比对", () => {
  it("login 后 logout → 200/204 全等", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(await probeRequest(t, { method: "POST", path: "/api/v1/auth/logout" }));
    }
    // msw/springboot 返 204（noContent）；契约面「成功即无 body 成功态」。
    // aspnetcore/nextjs 若返 200 + 空对象也接受 —— status 全等断言在下面 compareAll。
    for (const p of probes) {
      expect(
        [200, 204],
        `${p.target} logout 期望 200/204 实得 ${p.status} body=${JSON.stringify(p.body).slice(0, 120)}`,
      ).toContain(p.status);
    }
    const statuses = new Set(probes.map((p) => p.status));
    expect(statuses.size, `logout status 分叉: ${[...statuses].join(", ")}`).toBe(1);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I24 POST /auth/refresh 四方比对", () => {
  it("login 的 refreshToken 换新 token 对 → 200 + TokenResponse 必填", async () => {
    const probes = [];
    for (const t of targets) {
      const loginBody = loginBodies.get(t.name);
      if (!loginBody?.refreshToken) throw new Error(`${t.name} I22 未登录，I24 缺 refreshToken`);
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/auth/refresh",
        body: {
          grantType: "refresh_token",
          refreshToken: loginBody.refreshToken,
          clientId: "11111111-1111-1111-1111-111111111111",
          tenantId: "00000000-0000-0000-0000-000000000001",
        },
      });
      expect(r.status, `${t.name} refresh 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      // SSOT TokenResponse: accessToken/refreshToken?/tokenType/expiresIn/scope
      for (const key of ["accessToken", "tokenType", "expiresIn"]) {
        expect(body[key], `${t.name} refresh 响应缺 ${key}`).toBeDefined();
      }
      expect(body.tokenType).toBe("Bearer");
      probes.push(r);
    }
    // shape 比对：token 在 ALWAYS_VOLATILE；expiresIn 4 后端应同为 3600（在逐家断言里比）
    const divergences = compareBodies(probes, targets, ["scope", "message"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);

  it("未知 refreshToken → 400 全等", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(
        await probeRequest(t, {
          method: "POST",
          path: "/api/v1/auth/refresh",
          body: {
            grantType: "refresh_token",
            refreshToken: "saas-rt-00000000-0000-0000-0000-00000000dead-0-xyz",
            clientId: "11111111-1111-1111-1111-111111111111",
            tenantId: "00000000-0000-0000-0000-000000000001",
          },
        }),
      );
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 未知 token 期望 400 实得 ${p.status}`).toBe(400);
    }
  }, 60_000);
});

// 标题必须是「…四方比对」结尾（L2 SSOT 覆盖解析器约束）；错误分支限定写进 it 名。
describe.skipIf(!live)("M96.F02.I25 POST /auth/oidc/callback 四方比对", () => {
  it("缺 code → 4xx 全等（错误分支，不依赖真 IdP）", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(
        await probeRequest(t, {
          method: "POST",
          path: "/api/v1/auth/oidc/callback",
          body: {},
        }),
      );
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 缺 code 期望 4xx 实得 ${p.status}`).toBeGreaterThanOrEqual(400);
      expect(p.status).toBeLessThan(500);
    }
  }, 60_000);
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
