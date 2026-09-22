// tests/fnReporter-live-floor.test.ts
// fnReporter v8 live_floor 三态分立单测（spec §3；fixture 直接操纵 .state/live-exec.jsonl）。
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { computeLiveFloor } from "./fnReporter.js";

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
