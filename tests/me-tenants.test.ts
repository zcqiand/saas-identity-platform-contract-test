// M96.F02.I03 GET /api/v1/me/tenants 四方比对 —— 第一个落地端点（ADR-0015 §7）。
//
// 选它的理由：只读、无写（不碰共库的唯一约束）、4 个后端都实现。
// 跑法：
//   CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run
// 未声明 CONTRACT_TARGETS → 整组跳过（fnReporter 会把它记成 inert，不计入 trace）。
// **声明了却连不上 = 红，不是跳过。**
import { beforeAll, describe, expect, it } from "vitest";

import { compareAll, formatDivergences } from "../src/compare.js";
import { probeAll } from "../src/http.js";
import { withLiveExecSuite } from "../src/live-floor.js";
import { type Target, selectedTargets } from "../src/targets.js";

const PATH = "/api/v1/me/tenants";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

describe.skipIf(!live)(`M96.F02.I03 ${PATH} 四方比对`, () => {
  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async (ctx) => {
    probes = await withLiveExecSuite(ctx.name, () => probeAll(targets, PATH));
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是 TenantMembership 数组", () => {
    for (const p of probes) {
      expect(Array.isArray(p.body), `${p.target} 返回的不是数组`).toBe(true);
    }
  });

  it("必填字段齐全（契约 required: id/userId/tenantId/roleIds/status/joinedAt）", () => {
    for (const p of probes) {
      for (const row of p.body as Record<string, unknown>[]) {
        for (const key of ["id", "userId", "tenantId", "roleIds", "status", "joinedAt"]) {
          expect(row[key], `${p.target} 的成员少了 ${key}`).toBeDefined();
        }
      }
    }
  });

  it("normalize 后所有目标全等", () => {
    const divergences = compareAll(probes, targets);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  });
});

