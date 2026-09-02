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
// 请求参数与 V017 后 seed 对齐：clientId=UUID（V014 收敛决策），redirectUri 在白名单。
import { describe, expect, it } from "vitest";

import { compareAll, compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

// V017 后 seed：lab-mgmt app 的 clientId（UUID）与 redirectUri 白名单（apps.json 同源）
const OAUTH_BODY = {
  clientId: "11111111-1111-1111-1111-111111111111",
  redirectUri: "http://localhost:5201/callback",
  responseType: "code",
  scope: "lab.read",
  state: "contract-test",
  tenantId: ALICE_PARAMS.tenantId,
} as const;

/** I26 成功分支各 target 拿的一次性 code（换 token 用，不跨后端）。 */
const authCodes = new Map<string, string>();

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
          // 合法 UUID 形状但未注册（V014 后 clientId 收敛为 UUID；非 UUID 字面量
          // 在 aspnetcore 走 NSwag Guid 反序列化 → 500，测的是解析器不是契约面）
          body: { ...OAUTH_BODY, clientId: "11111111-1111-1111-1111-222222222222" },
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
