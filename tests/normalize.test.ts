// M96.F01 normalize 契约的单元覆盖。不需要任何后端在跑。
//
// 这一层是整个仓的地基：normalize 写错，四方比对要么假绿要么假红。
import { describe, expect, it } from "vitest";

import {
  ALWAYS_VOLATILE,
  ID_KEYS,
  assertTimestampShape,
  normalize,
  normalizeDate,
  stable,
  TIMESTAMP_KEYS,
} from "../src/normalize.js";

describe("M96.F01.I02 日期归一化到 UTC Z", () => {
  it("把 +00:00 偏移改写成 Z", () => {
    expect(normalizeDate("2026-08-29T10:00:00+00:00")).toBe("2026-08-29T10:00:00.000Z");
  });

  it("把非零偏移换算到 UTC", () => {
    expect(normalizeDate("2026-08-29T18:00:00+08:00")).toBe("2026-08-29T10:00:00.000Z");
  });

  it("Jackson 与 System.Text.Json 的两种写法归一后相等", () => {
    const jackson = { joinedAt: "2026-08-29T10:00:00+00:00" };
    const stj = { joinedAt: "2026-08-29T10:00:00Z" };
    expect(stable(jackson)).toBe(stable(stj));
  });

  it("不是日期的字符串原样保留", () => {
    expect(normalize({ code: "BAD_REQUEST" })).toEqual({ code: "BAD_REQUEST" });
  });
});

describe("M96.F01.I03 缺失与显式 null 等价", () => {
  it("显式 null 与字段缺失归一后相等", () => {
    // ASP.NET 默认输出 null，Spring 的 NON_ABSENT 直接省略。契约层面都合法。
    expect(stable({ a: 1, details: null })).toBe(stable({ a: 1 }));
  });

  it("嵌套层里的 null 同样等价", () => {
    expect(stable({ x: { a: 1, b: null } })).toBe(stable({ x: { a: 1 } }));
  });
});

describe("M96.F01.I04 递归排序 object key 与数组", () => {
  it("字段顺序不属于契约", () => {
    expect(stable({ b: 1, a: 2 })).toBe(stable({ a: 2, b: 1 }));
  });

  it("数组顺序不属于契约", () => {
    expect(stable({ roleIds: ["r2", "r1"] })).toBe(stable({ roleIds: ["r1", "r2"] }));
  });

  it("嵌套对象数组也按稳定键排", () => {
    const a = { items: [{ n: 2 }, { n: 1 }] };
    const b = { items: [{ n: 1 }, { n: 2 }] };
    expect(stable(a)).toBe(stable(b));
  });
});

describe("M96.F01.I01 剔除非确定性字段", () => {
  it("token 类字段总是剔除", () => {
    const withToken = { accessToken: "aaa", userId: "u1" };
    const other = { accessToken: "bbb", userId: "u1" };
    expect(stable(withToken)).toBe(stable(other));
  });

  it("ALWAYS_VOLATILE 覆盖两种命名风格", () => {
    expect(ALWAYS_VOLATILE).toContain("accessToken");
    expect(ALWAYS_VOLATILE).toContain("access_token");
  });

  it("默认不剔 ID —— 三个真后端共库，UUID 本来就该相等", () => {
    // 这是 2026-08-29 落地时对 ADR-0015 的修正：无脑剔 ID 会丢掉最强的一路信号。
    const kept = normalize({ id: "t1", userId: "u1" }) as Record<string, unknown>;
    expect(kept.id).toBe("t1");
    expect(kept.userId).toBe("u1");
  });

  it("显式传 ID_KEYS 才剔 —— 比对含 msw（内存 fixture，不共库）时用", () => {
    const dropped = normalize({ id: "t1", status: "active" }, { drop: ID_KEYS });
    expect(dropped).toEqual({ status: "active" });
  });

  it("剔 ID 后 msw 的合成 ID 与真库 UUID 可比", () => {
    const fromMsw = { id: "00000000-0000-0000-0000-000000000001-user-alice", status: "active" };
    const fromPg = { id: "3f8a1c22-0f1e-4b7a-9c31-1d2e3f4a5b6c", status: "active" };
    expect(stable(fromMsw, { drop: ID_KEYS })).toBe(stable(fromPg, { drop: ID_KEYS }));
  });
});

describe("M96.F01 normalize 不吞掉真实差异", () => {
  it("字段值不同仍然不等", () => {
    expect(stable({ status: "active" })).not.toBe(stable({ status: "suspended" }));
  });

  it("数组长度不同仍然不等", () => {
    expect(stable({ roleIds: ["r1"] })).not.toBe(stable({ roleIds: ["r1", "r2"] }));
  });

  it("多出一个字段仍然不等", () => {
    expect(stable({ a: 1 })).not.toBe(stable({ a: 1, b: 2 }));
  });

  it("日期真的不同仍然不等", () => {
    expect(stable({ joinedAt: "2026-08-29T10:00:00Z" })).not.toBe(
      stable({ joinedAt: "2026-08-30T10:00:00Z" }),
    );
  });
});

describe("M96.F01 assertTimestampShape 年份边界（ADR-0015-amend，下界=1970-01-01）", () => {
  it("下界：1970-01-01T00:00:00Z 合法（= UnixEpoch / EPOCH / new Date(0)）", () => {
    expect(assertTimestampShape({ createdAt: "1970-01-01T00:00:00.000Z" })).toEqual([]);
  });

  it("下界 -1：1969-12-31T23:59:59Z 非法", () => {
    const errs = assertTimestampShape({ createdAt: "1969-12-31T23:59:59.000Z" });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.reason).toBe("year_range");
  });

  it("上界：2100-12-31T23:59:59Z 合法", () => {
    expect(assertTimestampShape({ updatedAt: "2100-12-31T23:59:59.000Z" })).toEqual([]);
  });

  it("上界 +1：2101-01-01T00:00:00Z 非法", () => {
    const errs = assertTimestampShape({ updatedAt: "2101-01-01T00:00:00.000Z" });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.reason).toBe("year_range");
  });

  it("C# DateTimeOffset.MinValue（年份 0001）非法", () => {
    const errs = assertTimestampShape({ createdAt: "0001-01-01T00:00:00+00:00" });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.reason).toBe("year_range");
  });

  it("Hibernate -infinity sentinel（年份 -292275055）非法（走 format 错，Date.parse NaN）", () => {
    const errs = assertTimestampShape({ updatedAt: "-292275055-05-16T23:00:00.000Z" });
    expect(errs.length).toBeGreaterThan(0);
    // Date.parse 对负 5 位数年份 + 5 位月份返回 NaN，所以是 format 而非 year_range
    expect(["format", "year_range"]).toContain(errs[0]?.reason);
  });

  it("业务时间戳（2026）合法", () => {
    expect(assertTimestampShape({ createdAt: "2026-09-01T10:00:00.000Z" })).toEqual([]);
  });

  it("非 TIMESTAMP_KEYS 字段不参与年份断言", () => {
    expect(assertTimestampShape({ randomField: "1969-12-31T23:59:59.000Z" })).toEqual([]);
  });

  it("数组里的 TIMESTAMP_KEYS 字段也走年份断言", () => {
    const errs = assertTimestampShape({
      items: [{ createdAt: "1969-12-31T23:59:59.000Z" }],
    });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.path).toBe("items.0.createdAt");
    expect(errs[0]?.reason).toBe("year_range");
  });

  it("TIMESTAMP_KEYS 暴露的下划线版（created_at）也覆盖", () => {
    expect(TIMESTAMP_KEYS).toContain("created_at");
    expect(assertTimestampShape({ created_at: "1970-01-01T00:00:00.000Z" })).toEqual([]);
  });
});
