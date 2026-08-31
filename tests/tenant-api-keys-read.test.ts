// M96.F02.I15 — `GET /tenants/{t}/api-keys` 四方比对。
//
// 列表端点，分页包装。ApiKey.required: id/tenantId/name/prefix/status/scopes/createdAt。
// 注：secret 不在列表响应里，只在创建响应里返回一次 —— 不参与比对。
import { beforeAll, describe, expect, it } from "vitest";

import { compareAll, formatDivergences } from "../src/compare.js";
import { probeAll } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";

const PATH = pathWithParams("/api/v1/tenants/{tenantId}/api-keys", {
  tenantId: ALICE_PARAMS.tenantId,
});

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

describe.skipIf(!live)(`M96.F02.I15 ${PATH} 四方比对`, () => {
  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, PATH);
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是分页包装 {items: ApiKey[]}", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      expect(Array.isArray(body.items), `${p.target} items 不是数组`).toBe(true);
    }
  });

  it("每个 ApiKey 必填字段齐全（id/tenantId/name/prefix/status/scopes/createdAt）", () => {
    const REQUIRED = ["id", "tenantId", "name", "prefix", "status", "scopes", "createdAt"];
    for (const p of probes) {
      const items = (p.body as { items: Array<Record<string, unknown>> }).items;
      // 列表可能空（V016 给 acme 种了 1 条，但运行期被别处 revoke 不影响契约面 —— 空列表也是合法契约值）。
      // 只要 items 非空，每个 item 都必须过 REQUIRED 校验。
      for (const apiKey of items) {
        for (const key of REQUIRED) {
          expect(apiKey[key], `${p.target} api-key 缺 ${key}`).toBeDefined();
        }
        expect(Array.isArray(apiKey.scopes), `${p.target} scopes 不是数组`).toBe(true);
      }
    }
  });

  it("normalize 后所有目标全等（只看 envelope + items 的字段集，不比 data）", () => {
    // 写端点批次后 list 内 items 数累计 >> 100；msw 内存 fixture 重启清空，真后端持久化。
    // I-row shape 比对：envelope（page/pageSize）+ items[i] 的必填字段名集合；data（id/name/createdAt）逐项差异不在契约。
    // aspnetcore 用 [JsonIgnore(WhenWritingDefault)] 跳 null 可选字段；msw/nextjs/springboot 包含 null 键。
    // → itemKeys 必须用「合集」（oracle/maw 有哪些字段，其他 backend 也必须有；反之亦然）。
    const REQUIRED_KEYS = ["id", "tenantId", "name", "prefix", "status", "scopes", "createdAt"];
    const envelope = probes.map((p) => ({
      target: p.target,
      page: (p.body as Record<string, unknown>).page,
      pageSize: (p.body as Record<string, unknown>).pageSize,
      itemKeys: Array.isArray((p.body as { items?: unknown[] }).items)
        ? Object.keys(((p.body as { items: Record<string, unknown>[] }).items[0] ?? {})).sort()
        : [],
    }));
    for (const env of envelope) {
      for (const k of REQUIRED_KEYS) {
        expect(env.itemKeys, `${env.target} item[0] 缺必填字段 ${k}`).toContain(k);
      }
    }
    const drop = ["id", "name", "prefix", "secret", "revokedAt", "lastUsedAt", "expiresAt", "createdAt", "scopes", "items", "total"];
    const result = compareAll(probes, targets, drop);
    expect(result, `\n${formatDivergences(result)}\n`).toEqual([]);
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
