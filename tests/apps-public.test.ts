// M96.F02.I06 — `GET /api/v1/clients/{clientId}` 四方比对。
//
// 9/8 schema-first pivot：apps → oauth_client。clientId 是 SSOT 字段；
// OIDC 登录页用这个公开端点取 client 元数据。公开路径（无 admin 守卫）。
// 这里带 Bearer 探（公开端点应 200 走通；不强制 JWT 鉴权）。
import { beforeAll, describe, expect, it } from "vitest";

import { compareAll, formatDivergences } from "../src/compare.js";
import { probeAll } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { SEED } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";

const PATH = pathWithParams("/api/v1/clients/{clientId}", {
  clientId: SEED.clientIds.labManagement,
});

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

describe.skipIf(!live)(`M96.F02.I06 ${PATH} 四方比对`, () => {
  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, PATH);
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是单对象 OAuthClientPublicInfo（不是数组）", () => {
    for (const p of probes) {
      expect(Array.isArray(p.body), `${p.target} 期望单对象`).toBe(false);
      expect(typeof p.body, `${p.target} 不是对象`).toBe("object");
      expect(p.body, `${p.target} body 为 null`).not.toBeNull();
    }
  });

  it("必填字段齐全（契约 required: clientId/clientName/status）", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      for (const key of ["clientId", "clientName", "status"]) {
        expect(body[key], `${p.target} 缺 ${key}`).toBeDefined();
      }
      expect(body.clientId, `${p.target} clientId 应当等于查询参数`).toBe(SEED.clientIds.labManagement);
    }
  });

  it("normalize 后所有目标全等", () => {
    const divergences = compareAll(probes, targets);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  });
});
