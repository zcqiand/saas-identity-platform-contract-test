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
import { client, probeRequest } from "../src/http.js";
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

  // 2026-09-15 收敛回归：登录页跳板分支的真实请求形状（shared tsp
  // AuthorizeCodeRequest 无 tenantId，三前端 login 页都不传）。nextjs 曾 zod
  // 必填 tenantId → authorize 必 400，lab SSO 全链路阻断（当日修复）。
  it("登录页形状（无 body tenantId）→ 200 全等，code 绑认证身份", async () => {
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/oauth/authorize",
        body: {
          clientId: SEED.clientIds.labManagement,
          redirectUri: "http://localhost:5201/callback",
          responseType: "code",
          scope: "lab.read",
          state: "contract-test-notenant",
          // 刻意不带 tenantId
        },
      });
      expect(
        r.status,
        `${t.name} 无 tenantId authorize 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(200);
      expect((r.body as { state?: string }).state).toBe("contract-test-notenant");
      probes.push(r);
    }
    const divergences = compareAll(probes, targets, ["code"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);

  // 2026-09-15 收敛回归：认证前置。四家共同语义 = 无 session/Bearer 拒签 code
  // （msw 401 UNAUTHORIZED / springboot 401 INVALID_CREDENTIALS / aspnetcore 401 /
  // nextjs 401 UNAUTHORIZED）。fresh client（无 cookie jar 登录态、无 Bearer）。
  // 错误 body 形状各家不同，只比状态码（对齐「未知 clientId」用例的比对粒度）。
  it("无认证 → 401 全等（禁匿名签 code）", async () => {
    for (const t of targets) {
      const http = client(t);
      const res = await http.post("/api/v1/oauth/authorize", {
        clientId: SEED.clientIds.labManagement,
        redirectUri: "http://localhost:5201/callback",
        responseType: "code",
        scope: "lab.read",
        state: "contract-test-noauth",
      });
      expect(
        res.status,
        `${t.name} 无认证 authorize 期望 401 实得 ${res.status} body=${JSON.stringify(res.data).slice(0, 200)}`,
      ).toBe(401);
    }
  }, 60_000);

  // 2026-09-15 第二轮收敛：redirect 白名单四家全查（springboot 此前单侧缺失）。
  // msw 400 INVALID_REDIRECT_URI / nextjs 400 / aspnetcore 400 ArgumentException /
  // springboot 400 IAE——错误 body 形状各家不同，只比状态码。
  it("非白名单 redirectUri → 400 全等", async () => {
    for (const t of targets) {
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/oauth/authorize",
        body: { ...OAUTH_BODY, redirectUri: "https://evil.example.com/cb", state: "contract-test-evil" },
      });
      expect(
        r.status,
        `${t.name} 非白名单 redirectUri 期望 400 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(400);
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

  // 2026-09-15 第二轮收敛：TokenRequest 无 tenantId 字段（shared tsp）——
  // msw+nextjs 此前 zod/handlers 必填 + 比对是单侧漂移；现四家统一忽略 body
  // tenantId，user/tenant 取 code 行绑定值。lab 消费端（ISaasAuthClient）不发该字段。
  it("无 body tenantId 换 token → 200 + TokenResponse 必填", async () => {
    for (const t of targets) {
      const auth = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/oauth/authorize",
        body: {
          clientId: SEED.clientIds.labManagement,
          redirectUri: "http://localhost:5201/callback",
          responseType: "code",
          scope: "lab.read",
          state: "contract-test-tok-notenant",
        },
      });
      expect(auth.status, `${t.name} 前置 authorize 期望 200 实得 ${auth.status}`).toBe(200);
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/oauth/token",
        body: {
          grantType: "authorization_code",
          code: (auth.body as { code: string }).code,
          clientId: SEED.clientIds.labManagement,
          redirectUri: "http://localhost:5201/callback",
          // 刻意不带 tenantId
        },
      });
      expect(
        r.status,
        `${t.name} 无 tenantId token 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(200);
      const body = r.body as Record<string, unknown>;
      for (const key of ["accessToken", "tokenType", "expiresIn", "scope"]) {
        expect(body[key], `${t.name} 无 tenantId token 响应缺 ${key}`).toBeDefined();
      }
    }
  }, 60_000);

  // 2026-09-15 第二轮收敛：RFC 6749 §4.1.3——token 交换的 redirectUri 必须与
  // authorize 时一致（springboot 此前单侧缺失；msw/nextjs/aspnetcore 已有）。
  // authorize 用白名单内的 /login，交换时故意换成 /callback → 400 全等。
  it("redirectUri 与 authorize 时不一致 → 400 全等", async () => {
    for (const t of targets) {
      const auth = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/oauth/authorize",
        body: {
          clientId: SEED.clientIds.labManagement,
          redirectUri: "http://localhost:5201/login",
          responseType: "code",
          scope: "lab.read",
          state: "contract-test-uri-mismatch",
        },
      });
      expect(auth.status, `${t.name} 前置 authorize 期望 200 实得 ${auth.status}`).toBe(200);
      const r = await probeRequest(t, {
        method: "POST",
        path: "/api/v1/oauth/token",
        body: {
          grantType: "authorization_code",
          code: (auth.body as { code: string }).code,
          clientId: SEED.clientIds.labManagement,
          redirectUri: "http://localhost:5201/callback",
          tenantId: ALICE_PARAMS.tenantId,
        },
      });
      expect(
        r.status,
        `${t.name} redirectUri 不一致期望 400 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(400);
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
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });
});
