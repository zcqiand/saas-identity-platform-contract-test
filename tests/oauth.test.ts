// M96.F02.I26 / I27 — OAuth authorize + token 四方比对（第三期 B 组）。
//
// I26 authorize：合法 clientId + session/Bearer → 200 {code, state}；code 是一次性
//      随机值（normalize 的 drop 处理不了「同名不同值」——它不是 ALWAYS_VOLATILE key，
//      故本文件比对时显式 drop "code"）；错 clientId → 400 全等。
// I27 token：用 I26 各自拿的 code 换 token 对（authorization_code grant），
//      token 在 ALWAYS_VOLATILE 已剔，shape 比对。
//
// 认证面：msw 要 saas session cookie（login 写 jar），3 真后端走 Bearer。
// contract-test 的 axios client 自带 cookie jar + login 顺手覆盖两者 —— 直接 probeRequest。
//
// 请求参数与 ADR-0032 D4 对齐：clientId 统一 code 形（oauth_client.client_id 字符串），
// V014 的「clientId=UUID」收敛决策已被取代；redirectUri 在白名单。
import { describe, expect, it } from "vitest";

import { compareAll, compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { ALICE_PARAMS, SEED } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

// seed：lab-management app 的 clientId（code 形）与 redirectUri 白名单（apps.json 同源）
const OAUTH_BODY = {
  clientId: SEED.clientIds.labManagement,
  redirectUri: "http://localhost:5201/callback",
  responseType: "code",
  scope: "lab.read",
  state: "contract-test",
  tenantId: ALICE_PARAMS.tenantId,
} as const;

/** I26 成功分支各 target 拿的一次性 code（换 token 用，不跨后端）。 */
const authCodes = new Map<string, string>();

/** I27 token 交换响应里的 refreshToken（I28 用）。 */
const refreshTokens = new Map<string, string>();

describe.skipIf(!live)("M96.F02.I26 POST /oauth/authorize 四方比对", () => {
  it("合法 clientId → 200 {code,state}（code 剔除后全等）", async () => {
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/oauth/authorize",
        body: { ...OAUTH_BODY },
      });
      expect(
        r.status,
        `${t.name} authorize 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(200);
      const body = r.body as { code?: string; state?: string };
      expect(body.code, `${t.name} authorize 响应缺 code`).toBeDefined();
      expect(body.state, `${t.name} authorize 响应缺 state`).toBe("contract-test");
      authCodes.set(t.name, String(body.code));
      probes.push(r);
    }
    // code 一次性随机值 → drop；state 应全等（同请求同回显）
    const divergences = compareAll(probes, targets, ["code"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);

  it("未知 clientId → 400 全等", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(
        await probeRequest(t, {
          method: "POST",
          path: "/api/v1/oauth/authorize",
          // ADR-0032 D4：clientId 统一 code 形字符串——未注册 code 直接 400，
          // 不再需要「UUID 形状躲 Guid 解析器」的旧 workaround
          body: { ...OAUTH_BODY, clientId: "no-such-client" },
        }),
      );
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 未知 clientId 期望 400 实得 ${p.status}`).toBe(400);
    }
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I27 POST /oauth/token 四方比对", () => {
  it("I26 的 code 换 token 对 → 200 + TokenResponse 必填", async () => {
    const probes = [];
    for (const t of targets) {
      const code = authCodes.get(t.name);
      if (!code) throw new Error(`${t.name} I26 未拿到 code，I27 无法继续`);
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/oauth/token",
        body: {
          grantType: "authorization_code",
          code,
          clientId: OAUTH_BODY.clientId,
          redirectUri: OAUTH_BODY.redirectUri,
          tenantId: OAUTH_BODY.tenantId,
        },
      });
      expect(
        r.status,
        `${t.name} token 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(200);
      const body = r.body as Record<string, unknown>;
      for (const key of ["accessToken", "tokenType", "expiresIn", "scope"]) {
        expect(body[key], `${t.name} token 响应缺 ${key}`).toBeDefined();
      }
      if (body.refreshToken) {
        refreshTokens.set(t.name, String(body.refreshToken));
      }
      probes.push(r);
    }
    // token 已剔；scope 各家可能排序/子集不同，drop 掉只比骨架
    const divergences = compareBodies(probes, targets, ["scope"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);

  it("已被消费的 code 重放 → 400 全等", async () => {
    const probes = [];
    for (const t of targets) {
      const code = authCodes.get(t.name);
      if (!code) throw new Error(`${t.name} I26 未拿到 code`);
      probes.push(
        await probeRequest(t, {
          method: "POST",
          path: "/api/v1/oauth/token",
          body: {
            grantType: "authorization_code",
            code,
            clientId: OAUTH_BODY.clientId,
            redirectUri: OAUTH_BODY.redirectUri,
            tenantId: OAUTH_BODY.tenantId,
          },
        }),
      );
    }
    for (const p of probes) {
      expect(p.status, `${p.target} code 重放期望 400 实得 ${p.status}`).toBe(400);
    }
  }, 60_000);
});

// M96.F02.I28 — POST /oauth/token (refresh_token grant) 四方比对
// 对应 shared BASE M04.F03.I09 令牌刷新（tsp routes/oauth.tsp 把 I08+I09 合并到一个
// `/oauth/token` op，按 grantType 字段路由；contract-test 用独立 describe 区分 grant
// 类型，命中独立 BASE ID）。
describe.skipIf(!live)("M96.F02.I28 POST /oauth/token (refresh_token grant) 四方比对", () => {
  it("合法 refreshToken → 200 + 新 TokenResponse 必填", async () => {
    const probes = [];
    for (const t of targets) {
      const rt = refreshTokens.get(t.name);
      if (!rt) throw new Error(`${t.name} I27 未拿到 refreshToken，I28 无法继续`);
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/oauth/token",
        body: {
          grantType: "refresh_token",
          refreshToken: rt,
          clientId: OAUTH_BODY.clientId,
          tenantId: OAUTH_BODY.tenantId,
        },
      });
      expect(
        r.status,
        `${t.name} refresh 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(200);
      const body = r.body as Record<string, unknown>;
      for (const key of ["accessToken", "tokenType", "expiresIn", "scope"]) {
        expect(body[key], `${t.name} refresh 响应缺 ${key}`).toBeDefined();
      }
      probes.push(r);
    }
    const divergences = compareBodies(probes, targets, ["scope"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);

  it("非法 refreshToken → 400 全等", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(
        await probeRequest(t, {
          method: "POST",
          path: "/api/v1/oauth/token",
          body: {
            grantType: "refresh_token",
            refreshToken: "not-a-real-token",
            clientId: OAUTH_BODY.clientId,
            tenantId: OAUTH_BODY.tenantId,
          },
        }),
      );
    }
    for (const p of probes) {
      expect(p.status, `${p.target} refresh 非法 rt 期望 400 实得 ${p.status}`).toBe(400);
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
