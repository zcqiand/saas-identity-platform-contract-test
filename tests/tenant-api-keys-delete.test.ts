// M96.F02.I21 — DELETE /tenants/{t}/api-keys/{k} 四方比对（写端点第二期 M05.F01.I05）。
//
// 写比对模型：3 后端共享一个 PG；msw 内存 fixture。比对 shape 不比 byte。
//
// I21: 每个 target 先 POST /api-keys 创一把（用 uniqueName），记 ctx.keyIds[target.name] → id；
//      再 DELETE .../{k}，期望 204（OpenAPI 显式声明 204 No Content）。
//      再 DELETE 一次期望 404（幂等性 — 真后端 FirstAsync 抛 KeyNotFoundException /
//      NoSuchElementException → 404；msw 元素已删除返 404）。
//
// teardown：afterAll 跑 runCleanups() + 防御性 revoke（I17 软删兜底）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const TENANT_ID = ALICE_PARAMS.tenantId;
const BASE_PATH = pathWithParams("/api/v1/tenants/{tenantId}/api-keys", { tenantId: TENANT_ID });

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

const ctx: { keyIds: Map<string, string> } = { keyIds: new Map() };

describe.skipIf(!live)("M96.F02.I21 DELETE /tenants/{t}/api-keys/{k} 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.keyIds.clear();
  }, 30_000);

  // 第一步：每个 target 先创一把 key（POST /api-keys），记 ctx.keyIds
  for (const target of targets) {
    it(`M96.F02.I21 ${target.name} 前置：POST /api-keys 创一把 key`, async () => {
      const name = uniqueName("delete-test-key");
      const r = await probeRequest(target, {
        method: "POST",
        path: BASE_PATH,
        body: { name },
      });
      expect([200, 201], `${target.name} 前置 POST 期望 200/201 实得 ${r.status}`).toContain(r.status);
      const body = r.body as { apiKey?: { id?: string } };
      expect(body.apiKey?.id, `${target.name} 前置 POST 响应缺 apiKey.id`).toBeDefined();
      ctx.keyIds.set(target.name, String(body.apiKey!.id));
    }, 30_000);
  }

  // 第二步：用 ctx 里那个 keyId 调 DELETE，期望 204
  for (const target of targets) {
    it(`M96.F02.I21 ${target.name} DELETE 物理删除返回 204`, async () => {
      const keyId = ctx.keyIds.get(target.name);
      if (!keyId) throw new Error(`${target.name} 前置未创建 key，跳过 DELETE`);
      const r = await probeRequest(target, {
        method: "DELETE",
        path: `${BASE_PATH}/${keyId}`,
      });
      expect(r.status, `${target.name} DELETE 期望 204 实得 ${r.status}`).toBe(204);
    }, 30_000);
  }

  // 第三步：再 DELETE 一次，期望 404（幂等性 — 重复删已不存在的 keyId）
  for (const target of targets) {
    it(`M96.F02.I21 ${target.name} 重复 DELETE 期望 404（幂等性）`, async () => {
      const keyId = ctx.keyIds.get(target.name);
      if (!keyId) throw new Error(`${target.name} 前置未创建 key，跳过重复 DELETE`);
      const r = await probeRequest(target, {
        method: "DELETE",
        path: `${BASE_PATH}/${keyId}`,
      });
      expect(r.status, `${target.name} 重复 DELETE 期望 404 实得 ${r.status}`).toBe(404);
    }, 30_000);
  }
});

describe.skipIf(!live)("写端点 teardown — runCleanups + 防御性 revoke", () => {
  afterAll(async () => {
    await runCleanups();
    // 物理删已不留痕；如某后端漏掉 204 返了 200，防御性 revoke 兜底
    for (const [tname, keyId] of ctx.keyIds) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, { method: "POST", path: `${BASE_PATH}/${keyId}/revoke` });
      if (r.status !== 200 && r.status !== 404) {
        console.warn(`[teardown] final revoke ${tname} 异常 status=${r.status}`);
      }
    }
  }, 60_000);
  it("占位 — afterAll 真正干活", () => {
    expect(targets.length).toBeGreaterThanOrEqual(2);
  });
});

describe.runIf(!live)("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] M96.F02.I21 写端点比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/tenant-api-keys-delete.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101；keyId 跨 run 不持久化（基 UUID）",
    );
  });
});
