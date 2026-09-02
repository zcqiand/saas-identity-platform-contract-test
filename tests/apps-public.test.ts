// M96.F02.I06 — `GET /api/v1/apps/{code}` 四方比对。
//
// tag=apps（非 admin-apps）按家族约定是公开路径；OIDC 登录页用它取 redirect 元数据。
// 这里带 Bearer 探（按家族约定未授权即 401，但公开路径应 200 走通）。
// 匿名访问（不带 Bearer）若未来要覆盖，独立加 describe，不混本 ID。
import { beforeAll, describe, expect, it } from "vitest";

import { compareAll, formatDivergences } from "../src/compare.js";
import { probeAll } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { SEED } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";

const PATH = pathWithParams("/api/v1/apps/{code}", { code: SEED.appCodes.labManagement });

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

  it("响应体是单对象 AppPublicInfo（不是数组）", () => {
    for (const p of probes) {
      expect(Array.isArray(p.body), `${p.target} 期望单对象`).toBe(false);
      expect(typeof p.body, `${p.target} 不是对象`).toBe("object");
      expect(p.body, `${p.target} body 为 null`).not.toBeNull();
    }
  });

  it("必填字段齐全（契约 required: id/code/name/status）", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      for (const key of ["id", "code", "name", "status"]) {
        expect(body[key], `${p.target} 缺 ${key}`).toBeDefined();
      }
      expect(body.code, `${p.target} code 应当等于查询参数`).toBe(SEED.appCodes.labManagement);
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
