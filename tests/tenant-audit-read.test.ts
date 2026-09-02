// M96.F02.I12 / I13 / I14 — 审计事件读四方比对。
//
// I12: GET /tenants/{t}/audit-events                 —— 分页包装
// I13: GET /tenants/{t}/audit-events/by-user/{u}     —— 按用户过滤
// I14: GET /tenants/{t}/audit-events/retention       —— 单对象 {retentionDays:int32}
//
// 注意 I14 的响应是单字段对象，形状断言与分页/列表都不同。
import { beforeAll, describe, expect, it } from "vitest";

import { compareAll, compareBodies, formatDivergences } from "../src/compare.js";
import { probeAll, probeRequest } from "../src/http.js";
import { pathWithParams } from "../src/path.js";
import { ALICE_PARAMS } from "../src/seed.js";
import { type Target, selectedTargets } from "../src/targets.js";

const targets: Target[] = selectedTargets();
const live = targets.length >= 2;

const AUDIT_REQUIRED = ["id", "tenantId", "action", "occurredAt"];

describe.skipIf(!live)("M96.F02.I12 GET /tenants/{t}/audit-events 四方比对", () => {
  const PATH = pathWithParams("/api/v1/tenants/{tenantId}/audit-events", {
    tenantId: ALICE_PARAMS.tenantId,
  });

  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, PATH);
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是分页包装 {items: AuditEvent[]}", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      expect(Array.isArray(body.items), `${p.target} items 不是数组`).toBe(true);
    }
  });

  it("每个 AuditEvent 必填字段齐全（id/tenantId/action/occurredAt）", () => {
    for (const p of probes) {
      const items = (p.body as { items: Array<Record<string, unknown>> }).items;
      for (const ev of items) {
        for (const key of AUDIT_REQUIRED) {
          expect(ev[key], `${p.target} event 缺 ${key}`).toBeDefined();
        }
      }
    }
  });

  it("normalize 后所有目标全等", () => {
    // audit_events 每次 probeAll 调用登录都生成新行, 而 DB 累积不可清零 —— 字节级比较 items 不可达.
    // 这里只比 envelope (page/pageSize/total), 比对 dynamicDrop 跳过的字段 (occurredAt 等).
    const dynamicDrop = ["occurredAt", "metadata", "actorUserId", "targetUserId", "items", "total"];
    expect(
      compareAll(probes, targets, dynamicDrop),
      `\n${formatDivergences(compareAll(probes, targets, dynamicDrop))}\n`,
    ).toEqual([]);
  });
});

describe.skipIf(!live)("M96.F02.I72 GET /tenants/{t}/audit-events ?action= 过滤", () => {
  it("?action=login_success — 响应分页 envelope 全等", async () => {
    // SSOT listAuditEvents ?action=AuditAction —— 契约面是接受合法枚举值不报错。
    // 比 envelope：page/pageSize/total/items 长度（msw vs 真后端 filter 实现可能不同）。
    const PATH = pathWithParams("/api/v1/tenants/{tenantId}/audit-events", {
      tenantId: ALICE_PARAMS.tenantId,
    });
    const filterPath = `${PATH}?action=login_success`;
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, { method: "GET", path: filterPath });
      expect(r.status, `${t.name} ?action=login_success 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown> & { items?: unknown[] };
      expect(Array.isArray(body.items), `${t.name} filtered items 必须是数组`).toBe(true);
      for (const key of ["page", "pageSize", "total"]) {
        expect(body[key], `${t.name} filtered 响应分页缺 ${key}`).toBeDefined();
      }
      probes.push(r);
    }
    // envelope 一致：drop items + total + 事件字段（msw 不实现 filter vs 真后端真过滤）
    const drop = [
      "items", "total",
      "id", "tenantId", "actorUserId", "action", "targetUserId", "metadata", "occurredAt",
    ];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I73 GET /tenants/{t}/audit-events ?actorUserId= 过滤", () => {
  it("?actorUserId=<alice> — 响应分页 envelope 全等", async () => {
    // SSOT listAuditEvents ?actorUserId=UUID —— 契约面是接受合法 UUID 不报错。
    const PATH = pathWithParams("/api/v1/tenants/{tenantId}/audit-events", {
      tenantId: ALICE_PARAMS.tenantId,
    });
    const filterPath = `${PATH}?actorUserId=${ALICE_PARAMS.userId}`;
    const probes = [];
    for (const t of targets) {
      const r = await probeRequest(t, { method: "GET", path: filterPath });
      expect(r.status, `${t.name} ?actorUserId 期望 200 实得 ${r.status}`).toBe(200);
      const body = r.body as Record<string, unknown> & { items?: unknown[] };
      expect(Array.isArray(body.items), `${t.name} filtered items 必须是数组`).toBe(true);
      for (const key of ["page", "pageSize", "total"]) {
        expect(body[key], `${t.name} filtered 响应分页缺 ${key}`).toBeDefined();
      }
      probes.push(r);
    }
    const drop = [
      "items", "total",
      "id", "tenantId", "actorUserId", "action", "targetUserId", "metadata", "occurredAt",
    ];
    const divergences = compareBodies(probes, targets, drop);
    expect(divergences, `\n${formatDivergences(divergences)}\n`).toEqual([]);
  }, 60_000);
});

describe.skipIf(!live)("M96.F02.I13 GET /tenants/{t}/audit-events/by-user/{u} 四方比对", () => {
  const PATH = pathWithParams("/api/v1/tenants/{tenantId}/audit-events/by-user/{userId}", {
    tenantId: ALICE_PARAMS.tenantId,
    userId: ALICE_PARAMS.userId,
  });

  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, PATH);
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是分页包装 {items: AuditEvent[]}", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      expect(Array.isArray(body.items), `${p.target} items 不是数组`).toBe(true);
    }
  });

  it("每个 AuditEvent 必填字段齐全", () => {
    for (const p of probes) {
      const items = (p.body as { items: Array<Record<string, unknown>> }).items;
      for (const ev of items) {
        for (const key of AUDIT_REQUIRED) {
          expect(ev[key], `${p.target} event 缺 ${key}`).toBeDefined();
        }
      }
    }
  });

  it("normalize 后所有目标全等", () => {
    const dynamicDrop = ["occurredAt", "metadata", "actorUserId", "targetUserId", "items", "total"];
    expect(
      compareAll(probes, targets, dynamicDrop),
      `\n${formatDivergences(compareAll(probes, targets, dynamicDrop))}\n`,
    ).toEqual([]);
  });
});

describe.skipIf(!live)("M96.F02.I14 GET /tenants/{t}/audit-events/retention 四方比对", () => {
  const PATH = pathWithParams("/api/v1/tenants/{tenantId}/audit-events/retention", {
    tenantId: ALICE_PARAMS.tenantId,
  });

  let probes: Awaited<ReturnType<typeof probeAll>>;

  beforeAll(async () => {
    probes = await probeAll(targets, PATH);
  }, 60_000);

  it("每个目标都返回 200", () => {
    const bad = probes.filter((p) => p.status !== 200);
    expect(bad, `非 200: ${bad.map((p) => `${p.target}=${p.status}`).join(", ")}`).toEqual([]);
  });

  it("响应体是单对象 {retentionDays: number}", () => {
    for (const p of probes) {
      const body = p.body as Record<string, unknown>;
      expect(typeof body.retentionDays, `${p.target} retentionDays 不是 number`).toBe("number");
    }
  });

  it("normalize 后所有目标全等", () => {
    expect(compareAll(probes, targets), `\n${formatDivergences(compareAll(probes, targets))}\n`).toEqual([]);
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
