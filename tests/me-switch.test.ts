// M96.F02.I28 — POST /me/tenants/{t}/switch 四方比对（第三期 C 组）。
//
// alice 切到自己所属 tenant（acme）→ 200 SwitchTenantResponse：
//   accessToken（ALWAYS_VOLATILE 已剔）/ refreshToken?（已剔）/ expiresAt / tenantId
// 切不存在的 tenant → 404 全等（msw/springboot 语义：非成员同面）。
//
// 注意：真后端 switch 是无状态签发（不写库），无 teardown 需求。
import { describe, expect, it } from "vitest";

import { compareAll, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

const PATH = pathWithParams("/api/v1/me/tenants/{tenantId}/switch", {
  tenantId: ALICE_PARAMS.tenantId,
});
const DEAD_TENANT = "00000000-0000-0000-0000-00000000dead";

describe.skipIf(!live)(`M96.F02.I28 POST /me/tenants/{t}/switch 四方比对`, () => {
  it("alice 切到所属 tenant → 200 + SwitchTenantResponse 必填", async () => {
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, { method: "POST", path: PATH });
      expect(
        r.status,
        `${t.name} switch 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
      ).toBe(200);
      const body = r.body as Record<string, unknown>;
      // SSOT SwitchTenantResponse: accessToken/refreshToken?/expiresAt/tenantId
      expect(body.accessToken, `${t.name} switch 响应缺 accessToken`).toBeDefined();
      expect(body.expiresAt, `${t.name} switch 响应缺 expiresAt`).toBeDefined();
      expect(body.tenantId, `${t.name} switch tenantId 应回显`).toBe(ALICE_PARAMS.tenantId);
      probes.push(r);
    }
    // accessToken/refreshToken 在 ALWAYS_VOLATILE；expiresAt 是 ISO 时间戳（normalize 归一化）
    // 但各家签发时刻不同到秒级 → drop。tenantId 已逐家断言相等。
    const divergences = compareAll(probes, targets, ["expiresAt"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);

  it("切到不存在的 tenant → 404 全等", async () => {
    const probes = [];
    for (const t of targets) {
      probes.push(
        await probeRequest(t, {
          method: "POST",
          path: pathWithParams("/api/v1/me/tenants/{tenantId}/switch", { tenantId: DEAD_TENANT }),
        }),
      );
    }
    for (const p of probes) {
      expect(p.status, `${p.target} 不存在 tenant 期望 404 实得 ${p.status}`).toBe(404);
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
