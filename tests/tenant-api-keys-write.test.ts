// M96.F02.I16 / I17 / I18 — POST /api-keys + revoke 四方比对 + 写后 audit 事件断言。
//
// 写比对模型：3 后端共享一个 PG（V004 UNIQUE(tenant_id, prefix) 但 server 端
// 随机生成 prefix，跨 target 不冲突），msw 内存 fixture。比对 shape 不比 byte。
//
// I16: 每个 target 用 uniqueName 创一把 key，记 ctx.keyIds[target.name] → id。
// I17: 用 ctx 里那个 id 调 revoke，验 status 200 + 响应字段形状。
// I18: 250ms eventual-consistency buffer 后 GET ?action=api_key_created/_revoked，
//      按 metadata.apiKeyId 过滤找自己刚创的那条事件，比对 shape。
//      actorUserId 故意不参与比对（msw=undefined, 3 后端=alice）。
//
// teardown：afterAll 跑 runCleanups() + 防御性 revoke（200/404 容差）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareAll, compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const TENANT_ID = ALICE_PARAMS.tenantId;
const BASE_PATH = pathWithParams("/api/v1/tenants/{tenantId}/api-keys", { tenantId: TENANT_ID });

interface AuditItem {
  action: string;
  metadata?: { apiKeyId?: string };
  tenantId: string;
}

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

const ctx: { keyIds: Map<string, string> } = { keyIds: new Map() };

describe.skipIf(!live)("M96.F02.I16 POST /tenants/{t}/api-keys 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
    ctx.keyIds.clear();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I16 ${target.name} 创建返回 200/201 + apiKey 字段齐全`, async () => {
      const name = uniqueName("contract-test-key");
      const r = await probeRequest(target, {
        method: "POST",
        path: BASE_PATH,
        body: { name },
      });
      // TypeSpec createApiKey 只声明了 200；但 nextjs/aspnetcore/msw 习惯返 201。
      // 接受 200 或 201（契约面是同一成功响应）。
      expect([200, 201], `${target.name} 期望 200/201 实得 ${r.status}`).toContain(r.status);
      const body = r.body as { apiKey?: Record<string, unknown>; secret?: string };
      expect(body.apiKey, `${target.name} 响应缺 apiKey`).toBeDefined();
      const REQUIRED = ["id", "tenantId", "name", "prefix", "status", "scopes", "createdAt"];
      for (const key of REQUIRED) {
        expect(body.apiKey![key], `${target.name} apiKey 缺 ${key}`).toBeDefined();
      }
      expect(body.apiKey!.status, `${target.name} 新 key 必须 active`).toBe("active");
      expect(typeof body.secret, `${target.name} secret 必须 string`).toBe("string");
      ctx.keyIds.set(target.name, String(body.apiKey!.id));

      // teardown：每 target 注册 revoke cleanup（容差 200/404）
      const keyId = String(body.apiKey!.id);
      registerCleanup(`revoke:${target.name}`, async () => {
        const tr = await probeRequest(target, {
          method: "POST",
          path: `${BASE_PATH}/${keyId}/revoke`,
        });
        if (tr.status !== 200 && tr.status !== 404) {
          console.warn(`[teardown] revoke ${target.name} 异常 status=${tr.status}`);
        }
      });
    }, 30_000);
  }

  it("normalize 后所有目标的成功响应字段一致（除 volatile）", async () => {
    const probes = await Promise.all(
      targets.map(async (t) => {
        const r = await probeRequest(t, { method: "POST", path: BASE_PATH, body: { name: uniqueName("shape") } });
        return r;
      }),
    );
    for (const p of probes) {
      expect([200, 201]).toContain(p.status);
    }
    // createApiResponse 状态码在 4 后端不一致（TypeSpec 只声明 200，msw/aspnetcore/nextjs 返 201）；
    // 此处只比 shape（不报 status diff）。status 一致性由 I16 每个 it 单独断言。
    const drop = ["id", "prefix", "secret", "name", "createdAt", "lastUsedAt", "expiresAt", "revokedAt"];
    const result = compareBodies(probes, targets, drop);
    expect(result, `\n${formatDivergences(result)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I17 POST /tenants/{t}/api-keys/{k}/revoke 四方比对", () => {
  for (const target of targets) {
    it(`M96.F02.I17 ${target.name} revoke 返回 200 + 字段齐全`, async () => {
      const keyId = ctx.keyIds.get(target.name);
      if (!keyId) throw new Error(`${target.name} I16 未创建 key，跳过 I17`);
      const r = await probeRequest(target, {
        method: "POST",
        path: `${BASE_PATH}/${keyId}/revoke`,
      });
      expect(r.status, `${target.name} revoke 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.id, `${target.name} revoke 响应缺 id`).toBeDefined();
      expect(body.status, `${target.name} revoke 后 status 必须 revoked`).toBe("revoked");
      expect(body.revokedAt, `${target.name} revoke 后 revokedAt 必填`).toBeDefined();
    }, 30_000);
  }
});

describe.skipIf(!live)("M96.F02.I18 写端点副作用 — api_key_created/revoked 事件进 audit_events", () => {
  // 1000ms eventual consistency buffer —— 共享 PG + REQUIRES_NEW 事务提交到 GET 可见的窗口
  beforeAll(async () => {
    await new Promise((r) => setTimeout(r, 1000));
  }, 5_000);

  for (const target of targets) {
    it(`M96.F02.I18 ${target.name} api_key_created + api_key_revoked 各至少一条`, async () => {
      const keyId = ctx.keyIds.get(target.name);
      if (!keyId) throw new Error(`${target.name} I16 未创建 key，跳过 I18`);
      for (const action of ["api_key_created", "api_key_revoked"]) {
        // 跨多次跑累积事件数可能 >> 100，按 pageSize=100 逐页找自己刚创的那条；
        // 找到即停，最多翻 5 页（500 行上限，正常跑根本用不上）。
        let found: AuditItem | undefined;
        for (let page = 0; page < 5 && !found; page++) {
          const r = await probeRequest(target, {
            method: "GET",
            path: `${BASE_PATH.replace("/api-keys", "/audit-events")}?action=${action}&pageSize=100&page=${page}`,
          });
          expect(r.status, `${target.name} GET audit-events p=${page} 期望 200 实得 ${r.status}`).toBe(200);
          const items = ((r.body as { items?: AuditItem[] }).items) ?? [];
          found = items.find((e) => e.metadata?.apiKeyId === keyId);
        }
        expect(
          found,
          `${target.name} ?action=${action} 5 页内未找到 metadata.apiKeyId=${keyId} 的事件`,
        ).toBeDefined();
        const ev = found!;
        // shape 比对：字段名 + 必填存在；actorUserId 故意不参与（msw=undefined, real=alice）
        expect(ev.action, `${target.name} event.action`).toBe(action);
        expect(ev.tenantId, `${target.name} event.tenantId`).toBe(TENANT_ID);
        expect(ev.metadata?.apiKeyId, `${target.name} event.metadata.apiKeyId`).toBe(keyId);
      }
    }, 30_000);
  }
});

describe.skipIf(!live)("写端点 teardown — runCleanups + 防御性 revoke", () => {
  afterAll(async () => {
    await runCleanups();
    for (const [tname, keyId] of ctx.keyIds) {
      const t = TARGETS[tname];
      if (!t) continue;
      const r = await probeRequest(t, { method: "POST", path: `${BASE_PATH}/${keyId}/revoke` });
      // 200 idempotent 真后端；404 msw 第二次 revoke 时已无此 id
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
      "[contract-test] 写端点比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/tenant-api-keys-write.test.ts\n" +
        "  前置：4 个后端分别跑在 5174 / 5000 / 8080 / 3000",
    );
  });
});
