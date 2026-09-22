// 5.12 语义镜像收债（lab-management-system-contract-test 同名文件移植，2026-09-22）：
// fnReporter probeLive 重试语义单测（假 fetch + 假定时器，无真 live 栈）。
//
// 修前红：probeLive 单发 fetch 3s 超时、单次失败即判死 → 「前 2 次失败第 3 次成功
// → mode=live」必红（lab 侧 45% 丢包窗口连续 4 轮假红的实证根因，Task 2.3；
// saas-ct 因独立债未跟 5.12，单发形态一直留在 v7）。
// 修后：N=3 次尝试 + 退避 1s/2s + 单次 10s 封顶，全部尝试失败才判死；
// 判死 warn 留痕每次尝试的耗时与失败原因。
// mode 判定规则本身不改（全部 2xx = live；任一目标最终失败 = unit + 清空 targets）。
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// probeLive 读模块级 DECLARED_TARGETS（import 时求值）—— 必须在 import 前设 env。
const PREV_TARGETS = vi.hoisted(() => {
  const prev = process.env.CONTRACT_TARGETS;
  process.env.CONTRACT_TARGETS = "aspnetcore,springboot,nextjs";
  return prev;
});

import { probeLive } from "./fnReporter.js";

afterAll(() => {
  // 恢复 worker 的 env：fileParallelism:false 下同 worker 可能续跑其他测试文件，
  // 泄漏 CONTRACT_TARGETS 会把 unit 轮染成 live 尝试。
  if (PREV_TARGETS === undefined) delete process.env.CONTRACT_TARGETS;
  else process.env.CONTRACT_TARGETS = PREV_TARGETS;
});

/** 假定时器下推进直到 promise 落定（退避/超时全是 setTimeout，虚拟化后秒级快进）。 */
async function settle<T>(p: Promise<T>): Promise<T> {
  for (let i = 0; i < 120 && p instanceof Promise; i++) {
    await vi.advanceTimersByTimeAsync(1000);
  }
  return p;
}

describe("probeLive 重试语义（5.12 语义镜像，unit 层）", () => {
  let warned = "";
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(
      (...args: unknown[]) => (warned += args.map(String).join(" ") + "\n"),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    warned = "";
  });

  it("裁定场景 1：每个目标前 2 次失败第 3 次成功 → mode=live（修前单发即死 = 红）", async () => {
    const calls = new Map<string, number>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const key = String(url);
        const n = (calls.get(key) ?? 0) + 1;
        calls.set(key, n);
        if (n <= 2) throw new Error("ECONNRESET");
        return { ok: true, status: 200 } as Response;
      }),
    );
    const d = await settle(probeLive());
    expect(d.mode).toBe("live");
    expect(d.targets).toEqual(["aspnetcore", "springboot", "nextjs"]);
    // 每个目标恰好 3 次尝试（前 2 次失败 + 第 3 次成功）
    expect(calls.size).toBe(3);
    for (const n of calls.values()) expect(n).toBe(3);
  });

  it("裁定场景 2：全部尝试失败 → mode=unit、targets 清空，warn 留痕每次尝试证据", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const d = await settle(probeLive());
    expect(d.mode).toBe("unit");
    expect(d.targets).toEqual([]);
    expect(warned).toContain("ECONNREFUSED");
    expect(warned).toMatch(/3\/3/);
  });

  it("健康端点先 503 后 200（非 2xx 同样重试）→ mode=live", async () => {
    const calls = new Map<string, number>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const key = String(url);
        const n = (calls.get(key) ?? 0) + 1;
        calls.set(key, n);
        return (n <= 2 ? { ok: false, status: 503 } : { ok: true, status: 200 }) as Response;
      }),
    );
    const d = await settle(probeLive());
    expect(d.mode).toBe("live");
  });
});
