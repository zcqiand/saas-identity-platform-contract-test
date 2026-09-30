// M96.F02 四方比对逻辑的单元覆盖 + M96.F03 目标声明。不需要后端在跑。
import { describe, expect, it } from "vitest";

import { type Probe, compareAll, compareBodies, compareStatuses } from "../src/compare.js";
import { type Target, TARGETS, TargetError, needsIdDrop, selectedTargets } from "../src/targets.js";

const REAL = [TARGETS.aspnetcore, TARGETS.springboot];
// 内存 fixture 目标（msw 退役后无真实实例，用字面量驱动 needsIdDrop 机器）。
const MEM_TARGET: Target = { name: "mem", baseUrl: "http://localhost:5999", inMemory: true };

function probe(target: string, status: number, body: unknown): Probe {
  return { target, status, body };
}

describe("M96.F02.I01 status 全等", () => {
  it("状态码一致时无分歧", () => {
    const probes = [probe("nextjs", 200, []), probe("aspnetcore", 200, [])];
    expect(compareStatuses(probes)).toEqual([]);
  });

  it("状态码分叉时点名是哪个后端", () => {
    // springboot 缺 M08 菜单这类缺口就会长这样：一个 200 一个 404。
    const probes = [probe("nextjs", 200, []), probe("springboot", 404, {})];
    const out = compareStatuses(probes);
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("springboot");
    expect(out[0].detail).toContain("404");
  });

  it("单个目标不比对", () => {
    expect(compareStatuses([probe("nextjs", 200, [])])).toEqual([]);
  });
});

describe("M96.F02.I02 normalize 后 body 全等", () => {
  it("只有字段顺序/日期格式不同 → 不算分歧", () => {
    const probes = [
      probe("nextjs", 200, [{ status: "active", joinedAt: "2026-08-29T10:00:00Z" }]),
      probe("aspnetcore", 200, [{ joinedAt: "2026-08-29T10:00:00+00:00", status: "active" }]),
    ];
    expect(compareBodies(probes, REAL)).toEqual([]);
  });

  it("字段值真不同 → 报分歧并指出第一处", () => {
    const probes = [
      probe("nextjs", 200, [{ status: "active" }]),
      probe("aspnetcore", 200, [{ status: "suspended" }]),
    ];
    const out = compareBodies(probes, REAL);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("body");
    expect(out[0].detail).toContain("分叉");
  });

  it("含内存 fixture 时剔 ID —— 它不共库（needsIdDrop 机器，msw 退役后由字面量驱动）", () => {
    const probes = [
      probe("mem", 200, [{ id: "0000-user-alice", status: "active" }]),
      probe("aspnetcore", 200, [{ id: "3f8a1c22-0f1e-4b7a-9c31-1d2e3f4a5b6c", status: "active" }]),
    ];
    expect(compareBodies(probes, [MEM_TARGET, TARGETS.aspnetcore])).toEqual([]);
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
  it("目标端口与 conventions §6 一致", () => {
    expect(TARGETS.nextjs.baseUrl).toContain(":5101");
    expect(TARGETS.aspnetcore.baseUrl).toContain(":5104");
    expect(TARGETS.springboot.baseUrl).toContain(":5105");
    expect(TARGETS.rails.baseUrl).toContain(":5106");
    expect(TARGETS.fastapi.baseUrl).toContain(":5107");
  });

  it("内存 fixture 目标触发剔 ID；三个真后端不剔", () => {
    expect(needsIdDrop([MEM_TARGET])).toBe(true);
    expect(needsIdDrop(REAL)).toBe(false);
  });
});

describe("M96.F03.I02 声明即必须可达", () => {
  // 「未声明目标时返回空」原本 it.skipIf(!!CONTRACT_TARGETS) 隔离 —— live 档恒 skip，
  // 撞 require_live 的 skip=0 硬门（5.54 EXIT=2 根因之一）。Task 5.85 可测性重构：
  // selectedTargets 增加注入点，用替身 env 读取函数显式模拟「未声明」，live 照跑；
  // 真实 env 默认参路径（selectedTargets(undefined) 读 process.env）的 unit 档覆盖
  // 在 tests/unit/compare-env.unit.test.ts。
  it("未声明目标时返回空 —— 注入空 env 读取，live 也能跑", () => {
    expect(selectedTargets("", () => undefined)).toEqual([]);
    expect(selectedTargets(undefined, () => undefined)).toEqual([]);
  });

  it("声明了认识的目标就返回它们", () => {
    expect(selectedTargets("nextjs,springboot").map((t) => t.name)).toEqual(["nextjs", "springboot"]);
  });

  it("声明了不认识的名字 → 抛错，不静默忽略", () => {
    expect(() => selectedTargets("nextjs,typo")).toThrow(TargetError);
  });
});

describe("M96.F02 compareAll 汇总", () => {
  it("status 与 body 的分歧都收进来", () => {
    const probes = [probe("nextjs", 200, [{ a: 1 }]), probe("springboot", 500, { code: "BOOM" })];
    expect(compareAll(probes, REAL).length).toBeGreaterThanOrEqual(2);
  });
});
