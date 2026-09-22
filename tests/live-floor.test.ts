// tests/live-floor.test.ts
// ADR-0040 live 执行面 side channel 单测（spec §2/§3，unit 层，无真后端）。
// 直接读写真实 .state/live-exec.jsonl（gitignore 内），afterEach 必清。
import { appendFileSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { deleteLiveExecLog, readLiveExecGroups, recordProbe, resetLiveExecLog, withLiveExecSuite } from "../src/live-floor.js";

afterEach(() => {
  resetLiveExecLog();
});

describe("readLiveExecGroups（jsonl 合并）", () => {
  it("文件缺失 → null（mode=live 时由调用方译为 side channel 故障）", () => {
    resetLiveExecLog();
    expect(readLiveExecGroups()).toBeNull();
  });

  it("按 suite 分组 distinct target；多行同 suite 去重", () => {
    mkdirSync(".state", { recursive: true });
    writeFileSync(
      ".state/live-exec.jsonl",
      [
        JSON.stringify({ suite: "A 比对", target: "nextjs", status: 200 }),
        JSON.stringify({ suite: "A 比对", target: "springboot", status: 404 }),
        JSON.stringify({ suite: "A 比对", target: "nextjs", status: 200 }),
        JSON.stringify({ suite: "B 写路径", target: "aspnetcore", status: 201 }),
        "",
      ].join("\n"),
      "utf-8",
    );
    const groups = readLiveExecGroups()!;
    expect(groups.get("A 比对")).toEqual(new Set(["nextjs", "springboot"]));
    expect(groups.get("B 写路径")).toEqual(new Set(["aspnetcore"]));
  });

  it("空文件（存在但零记录）→ 空 Map（mode=live 时译为全塌缩）", () => {
    mkdirSync(".state", { recursive: true });
    writeFileSync(".state/live-exec.jsonl", "", "utf-8");
    const groups = readLiveExecGroups()!;
    expect(groups.size).toBe(0);
  });

  it("单行损坏跳过，不毒化整批", () => {
    mkdirSync(".state", { recursive: true });
    appendFileSync(
      ".state/live-exec.jsonl",
      "{broken json\n" + JSON.stringify({ suite: "A", target: "nextjs", status: 200 }) + "\n",
      "utf-8",
    );
    const groups = readLiveExecGroups()!;
    expect(groups.get("A")).toEqual(new Set(["nextjs"]));
  });
});

describe("recordProbe 真实 vitest 上下文", () => {
  it("it() 内调用真实落盘，suite 字段 == 外层 describe 标题（非空串/非 undefined）", () => {
    recordProbe("some-target", 200);
    const text = readFileSync(".state/live-exec.jsonl", "utf-8");
    const lines = text.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]) as { suite: string; target: string; status: number };
    expect(row.suite).toBe("recordProbe 真实 vitest 上下文");
    expect(row.target).toBe("some-target");
    expect(row.status).toBe(200);
  });

  it("suiteOverride 显式传入时优先于自动探测（beforeAll 通道）", () => {
    recordProbe("other-target", 404, "显式 override 的 suite");
    const text = readFileSync(".state/live-exec.jsonl", "utf-8");
    const row = JSON.parse(text.split("\n").filter((l) => l.trim())[0]) as { suite: string };
    expect(row.suite).toBe("显式 override 的 suite");
  });

  it("withLiveExecSuite 包裹的 recordProbe 归因到 wrapper 名（wrapper 优先于自动探测）", async () => {
    await withLiveExecSuite("外层描述", async () => {
      recordProbe("wrapped-target", 200);
    });
    const text = readFileSync(".state/live-exec.jsonl", "utf-8");
    const row = JSON.parse(text.split("\n").filter((l) => l.trim())[0]) as { suite: string };
    // wrapper 名优先：若无 wrapper，it() 运行期自动探测会归到本 describe 标题
    expect(row.suite).toBe("外层描述");
  });

  it("wrapper 结束后状态清零（后续 recordProbe 不再归因到旧名）", async () => {
    await withLiveExecSuite("临时作用域", async () => {
      recordProbe("in-scope", 200);
    });
    recordProbe("after-scope", 200);
    const rows = readFileSync(".state/live-exec.jsonl", "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { suite: string });
    expect(rows).toHaveLength(2);
    expect(rows[0].suite).toBe("临时作用域");
    // 清零后回落到自动探测（it() 运行期 = 外层 describe 标题），绝不再归因旧名
    expect(rows[1].suite).toBe("recordProbe 真实 vitest 上下文");
  });
});

describe("deleteLiveExecLog", () => {
  it("删后 readLiveExecGroups 回 null；文件不存在也不抛", () => {
    mkdirSync(".state", { recursive: true });
    writeFileSync(".state/live-exec.jsonl", "{}\n", "utf-8");
    deleteLiveExecLog();
    expect(readLiveExecGroups()).toBeNull();
    expect(() => deleteLiveExecLog()).not.toThrow();
  });
});
