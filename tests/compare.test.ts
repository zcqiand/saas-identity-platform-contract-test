// M96.F02 四方比对逻辑的单元覆盖 + M96.F03 目标声明。不需要后端在跑。
import { describe, expect, it } from "vitest";

import { type Probe, compareAll, compareBodies, compareStatuses } from "../src/compare.js";
import { TARGETS, TargetError, needsIdDrop, selectedTargets } from "../src/targets.js";

const REAL = [TARGETS.aspnetcore, TARGETS.springboot];
const WITH_MSW = [TARGETS.msw, TARGETS.aspnetcore];

function probe(target: string, status: number, body: unknown): Probe {
  return { target, status, body };
}

describe("M96.F02.I01 status 全等", () => {
  it("状态码一致时无分歧", () => {
    const probes = [probe("msw", 200, []), probe("aspnetcore", 200, [])];
    expect(compareStatuses(probes)).toEqual([]);
  });

  it("状态码分叉时点名是哪个后端", () => {
    // springboot 缺 M08 菜单这类缺口就会长这样：一个 200 一个 404。
    const probes = [probe("msw", 200, []), probe("springboot", 404, {})];
    const out = compareStatuses(probes);
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("springboot");
    expect(out[0].detail).toContain("404");
  });

  it("单个目标不比对", () => {
    expect(compareStatuses([probe("msw", 200, [])])).toEqual([]);
  });
});

describe("M96.F02.I02 normalize 后 body 全等", () => {
  it("只有字段顺序/日期格式不同 → 不算分歧", () => {
    const probes = [
      probe("msw", 200, [{ status: "active", joinedAt: "2026-08-29T10:00:00Z" }]),
      probe("aspnetcore", 200, [{ joinedAt: "2026-08-29T10:00:00+00:00", status: "active" }]),
    ];
    expect(compareBodies(probes, REAL)).toEqual([]);
  });

  it("字段值真不同 → 报分歧并指出第一处", () => {
    const probes = [
      probe("msw", 200, [{ status: "active" }]),
      probe("aspnetcore", 200, [{ status: "suspended" }]),
    ];
    const out = compareBodies(probes, REAL);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("body");
    expect(out[0].detail).toContain("分叉");
  });

  it("含 msw 时剔 ID —— 它是内存 fixture，ID 不共库", () => {
    const probes = [
      probe("msw", 200, [{ id: "0000-user-alice", status: "active" }]),
      probe("aspnetcore", 200, [{ id: "3f8a1c22-0f1e-4b7a-9c31-1d2e3f4a5b6c", status: "active" }]),
    ];
    expect(compareBodies(probes, WITH_MSW)).toEqual([]);
  });

  it("只比两个真后端时 ID 参与比对 —— 共库就该相等", () => {
    const probes = [
      probe("aspnetcore", 200, [{ id: "aaa", status: "active" }]),
      probe("springboot", 200, [{ id: "bbb", status: "active" }]),
    ];
    expect(compareBodies(probes, REAL)).toHaveLength(1);
  });
});

describe("M96.F03.I01 目标端口声明", () => {
  it("四个目标端口与 conventions §6 一致", () => {
    expect(TARGETS.msw.baseUrl).toContain(":5100");
    expect(TARGETS.nextjs.baseUrl).toContain(":5101");
    expect(TARGETS.aspnetcore.baseUrl).toContain(":5104");
    expect(TARGETS.springboot.baseUrl).toContain(":5105");
  });

  it("只有 msw 是内存 fixture", () => {
    expect(needsIdDrop([TARGETS.msw])).toBe(true);
    expect(needsIdDrop(REAL)).toBe(false);
  });
});

describe("M96.F03.I02 声明即必须可达", () => {
  // 「未声明目标时返回空」只在没设 CONTRACT_TARGETS 的单测模式才有意义；
  // live 模式下 CONTRACT_TARGETS 已设，这条断言的前提不成立。skipIf 隔离两条上下文。
  it.skipIf(!!process.env.CONTRACT_TARGETS)("未声明目标时返回空 —— 只跑单元测试", () => {
    expect(selectedTargets("")).toEqual([]);
    expect(selectedTargets(undefined)).toEqual([]);
  });

  it("声明了认识的目标就返回它们", () => {
    expect(selectedTargets("msw,springboot").map((t) => t.name)).toEqual(["msw", "springboot"]);
  });

  it("声明了不认识的名字 → 抛错，不静默忽略", () => {
    expect(() => selectedTargets("msw,typo")).toThrow(TargetError);
  });
});

describe("M96.F02 compareAll 汇总", () => {
  it("status 与 body 的分歧都收进来", () => {
    const probes = [probe("msw", 200, [{ a: 1 }]), probe("springboot", 500, { code: "BOOM" })];
    expect(compareAll(probes, REAL).length).toBeGreaterThanOrEqual(2);
  });
});
