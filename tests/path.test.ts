// pathWithParams 单测 —— 不需要后端在跑，纯字符串替换。
import { describe, expect, it } from "vitest";

import { pathWithParams } from "../src/path.js";

describe("pathWithParams 替换", () => {
  it("单个参数替换", () => {
    expect(pathWithParams("/tenants/{tenantId}/users", { tenantId: "abc" })).toBe(
      "/tenants/abc/users",
    );
  });

  it("多个参数按出现顺序逐个替换", () => {
    expect(
      pathWithParams("/tenants/{t}/users/{u}", { t: "T", u: "U" }),
    ).toBe("/tenants/T/users/U");
  });

  it("缺参数立即抛错 —— 不允许沉默 fallback", () => {
    expect(() => pathWithParams("/tenants/{tenantId}/users", {})).toThrow(/tenantId/);
  });

  it("多余参数忽略 —— 不想因为多加就炸", () => {
    expect(
      pathWithParams("/x", { a: "1", b: "2" }),
    ).toBe("/x");
  });

  it("对值做 URI encode —— 防止 appCode 之类含连字符的字符串拼坏 URL", () => {
    expect(pathWithParams("/apps/{code}", { code: "lab management/v1" })).toBe(
      "/apps/lab%20management%2Fv1",
    );
  });

  it("空模板原样返回", () => {
    expect(pathWithParams("", { a: "x" })).toBe("");
  });

  it("模板不含占位符时不做任何替换", () => {
    expect(pathWithParams("/api/v1/me", { tenantId: "ignored" })).toBe("/api/v1/me");
  });
});
