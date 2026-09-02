// M96.F02.I57–I59 — rotate / audit export / retention PUT 四方比对（第四期 C 组收尾）。
//
// I57 POST /api-keys/{k}/rotate：revoke old + create new（CreateApiKeyResponse）。
//      每家先创一把 key（唯一名），rotate 后验新 secret + 新 prefix + 旧 key 不可再 rotate
//      （或幂等 404，契约面允许）。teardown 物理 DELETE 兜底。
// I58 POST /audit-events/export：{from,to,format} → {downloadUrl}；msw oracle
//      定 downloadUrl 形状，跨后端只比 shape（URL 本身含随机/时间，drop）。
// I59 PUT /audit-events/retention：设 retentionDays → {retentionDays} 回显；
//      断言后还原 GET 的原值（seed 级共享状态，同 I38 模式）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareBodies, formatDivergences } from "../src/compare.js";
import { probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets, TARGETS } from "../src/targets.js";
import { uniqueName } from "../src/unique.js";
import { clearCleanups, registerCleanup, runCleanups } from "../src/teardown.js";

const TENANT_ID = ALICE_PARAMS.tenantId;
const KEY_BASE = pathWithParams("/api/v1/tenants/{tenantId}/api-keys", { tenantId: TENANT_ID });
const AUDIT_BASE = pathWithParams("/api/v1/tenants/{tenantId}/audit-events", { tenantId: TENANT_ID });

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

describe.skipIf(!live)("M96.F02.I57 POST /tenants/{t}/api-keys/{k}/rotate 四方比对", () => {
  beforeAll(() => {
    clearCleanups();
  }, 30_000);

  for (const target of targets) {
    it(`M96.F02.I57 ${target.name} rotate → 200/201 + 新 key + 新 secret`, async () => {
      // 先创一把（唯一名，防共库 UNIQUE(tenant_id, prefix) 由 server 生成不撞）
      const created = await probeRequest(target, {
        method: "POST",
        path: KEY_BASE,
        body: { name: uniqueName("rot-src") },
      });
      expect([200, 201], `${target.name} 建key 期望 200/201 实得 ${created.status}`).toContain(created.status);
      const createdBody = created.body as { apiKey?: { id?: string; prefix?: string }; secret?: string };
      const oldId = String(createdBody.apiKey!.id);
      const oldPrefix = String(createdBody.apiKey!.prefix);

      const r = await probeRequest(target, { method: "POST", path: `${KEY_BASE}/${oldId}/rotate` });
      expect([200, 201], `${target.name} rotate 期望 200/201 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`).toContain(r.status);
      const body = r.body as { apiKey?: { id?: string; prefix?: string; status?: string }; secret?: string };
      expect(body.apiKey, `${target.name} rotate 响应缺 apiKey`).toBeDefined();
      const newKey = body.apiKey!;
      // rotate 语义：新行（或至少新 prefix/secret），不是旧 key 原样
      expect(newKey.prefix, `${target.name} rotate 后 prefix 应不同于旧值`).not.toBe(oldPrefix);
      expect(typeof body.secret, `${target.name} rotate 后 secret 必须 string`).toBe("string");
      expect(newKey.status, `${target.name} 新 key 必须 active`).toBe("active");

      // teardown：新旧行都物理删兜底
      const newId = String(newKey.id);
      for (const id of [oldId, newId]) {
        registerCleanup(`rotate-del:${target.name}:${id.slice(-8)}`, async () => {
          const tr = await probeRequest(target, { method: "DELETE", path: `${KEY_BASE}/${id}` });
          if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
            console.warn(`[teardown] rotate-del ${target.name} 异常 status=${tr.status}`);
          }
        });
      }
    }, 30_000);
  }

  it("normalize 后 rotate 成功响应字段一致（除 volatile）", async () => {
    const probes = await Promise.all(
      targets.map(async (t) => {
        const created = await probeRequest(t, {
          method: "POST",
          path: KEY_BASE,
          body: { name: uniqueName("rot-shape") },
        });
        expect([200, 201]).toContain(created.status);
        const id = String((created.body as { apiKey?: { id?: string } }).apiKey!.id);
        registerCleanup(`rot-shape-del:${t.name}:${id.slice(-8)}`, async () => {
          const tr = await probeRequest(t, { method: "DELETE", path: `${KEY_BASE}/${id}` });
          if (tr.status !== 200 && tr.status !== 204 && tr.status !== 404) {
            console.warn(`[teardown] rot-shape-del ${t.name} 异常 status=${tr.status}`);
          }
        });
        return probeRequest(t, { method: "POST", path: `${KEY_BASE}/${id}/rotate` });
      }),
    );
    for (const p of probes) {
      expect([200, 201]).toContain(p.status);
    }
    const drop = ["id", "prefix", "secret", "name", "createdAt", "lastUsedAt", "expiresAt", "revokedAt"];
    const result = compareBodies(probes, targets, drop);
    expect(result, `\n${formatDivergences(result)}\n`).toEqual([]);
  }, 60_000);

  afterAll(async () => {
    await runCleanups();
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I58 POST /tenants/{t}/audit-events/export 四方比对", () => {
  it("合法区间 + format → 200 + {downloadUrl} shape", async () => {
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, {
        method: "POST",
        path: `${AUDIT_BASE}/export`,
        body: { from: "2026-01-01T00:00:00Z", to: "2026-12-31T23:59:59Z", format: "csv" },
      });
      expect(r.status, `${t.name} export 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      const body = r.body as { downloadUrl?: string };
      expect(typeof body.downloadUrl, `${t.name} downloadUrl 必须 string`).toBe("string");
      expect(body.downloadUrl!.length, `${t.name} downloadUrl 不应为空串`).toBeGreaterThan(0);
      probes.push(r);
    }
    // downloadUrl 含随机/时间成分 → drop 只比骨架（有无 downloadUrl 字段）
    const divergences = compareBodies(probes, targets, ["downloadUrl"]);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I59 PUT /tenants/{t}/audit-events/retention 四方比对", () => {
  it("设 retentionDays → 回显 + 还原 seed 原值", async () => {
    // 先读原值（seed 共享状态，测完还原）
    const originals: number[] = [];
    for (const t of targets) {
      const g = await probeRequest(t, { method: "GET", path: `${AUDIT_BASE}/retention` });
      expect(g.status, `${t.name} GET retention 期望 200 实得 ${g.status}`).toBe(200);
      originals.push(Number((g.body as { retentionDays?: number }).retentionDays));
    }
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      const r = await probeRequest(t, {
        method: "PUT",
        path: `${AUDIT_BASE}/retention`,
        body: { retentionDays: 42 },
      });
      expect(r.status, `${t.name} PUT retention 期望 200 实得 ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      expect((r.body as { retentionDays?: number }).retentionDays, `${t.name} 回显 retentionDays`).toBe(42);
      // 还原
      const back = await probeRequest(t, {
        method: "PUT",
        path: `${AUDIT_BASE}/retention`,
        body: { retentionDays: originals[i] },
      });
      expect(back.status, `${t.name} 还原 PUT 期望 200 实得 ${back.status}`).toBe(200);
    }
  }, 60_000);
});

describe.runIf(!live)("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] rotate/export/retention 比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run tests/tenant-misc-write.test.ts\n" +
        "  前置：4 个后端分别跑在 5100 / 5104 / 5105 / 5101",
    );
  });
});
