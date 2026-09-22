// tests/fnReporter-live-floor.test.ts
// fnReporter v8 live_floor 三态分立单测（spec §3；fixture 直接操纵 .state/live-exec.jsonl）。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { computeLiveFloor } from "./fnReporter.js";

// W4 端到端实锤（2026-09-23）：live 全量轮按 size 序执行，本文件（5ms 级小文件）排
// 队尾时，afterEach 删掉真实 side channel → fnReporter flush 读缺文件 →
// executed_per_describe_min=null（side channel 故障假信号，trace {3,3,null}）。
// beforeAll 快照 + afterAll 恢复：unit 轮本就无真实数据，快照 miss → 恢复=删，行为不变。
let stash: string | null = null;
beforeAll(() => {
  try {
    stash = readFileSync(".state/live-exec.jsonl", "utf-8");
  } catch {
    stash = null;
  }
});
afterAll(() => {
  if (stash === null) rmSync(".state/live-exec.jsonl", { force: true });
  else writeFileSync(".state/live-exec.jsonl", stash, "utf-8");
});

afterEach(() => {
  rmSync(".state/live-exec.jsonl", { force: true });
});

function seedJsonl(content: string): void {
  mkdirSync(".state", { recursive: true });
  writeFileSync(".state/live-exec.jsonl", content, "utf-8");
}

describe("computeLiveFloor（v8，ADR-0040）", () => {
  it("live + 多 suite 记录 → distinct target 取 min", () => {
    seedJsonl(
      [
        JSON.stringify({ suite: "A", target: "nextjs", status: 200 }),
        JSON.stringify({ suite: "A", target: "aspnetcore", status: 200 }),
        JSON.stringify({ suite: "A", target: "springboot", status: 200 }),
        JSON.stringify({ suite: "B", target: "nextjs", status: 200 }),
        JSON.stringify({ suite: "B", target: "aspnetcore", status: 200 }),
      ].join("\n"),
    );
    expect(computeLiveFloor("live", 3, 3)).toEqual({
      declared: 3,
      effective: 3,
      executed_per_describe_min: 2,
    });
  });

  it("live + 文件缺失 → null（side channel 故障，门侧只警不红）", () => {
    expect(computeLiveFloor("live", 3, 3)).toEqual({
      declared: 3,
      effective: 3,
      executed_per_describe_min: null,
    });
  });

  it("live + 文件在但零记录 → 0（全塌缩，宁警勿静）", () => {
    seedJsonl("");
    expect(computeLiveFloor("live", 3, 3).executed_per_describe_min).toBe(0);
  });

  it("unit + 文件缺失 → 0（常态真值，非故障）", () => {
    expect(computeLiveFloor("unit", 0, 0).executed_per_describe_min).toBe(0);
  });
});
