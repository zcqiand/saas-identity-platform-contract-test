// M96.F03.I02 「未声明目标时返回空」的 unit 档真环境路径 —— Task 5.85(a) 自
// tests/compare.test.ts 的 `it.skipIf(!!CONTRACT_TARGETS)` 块迁出。
//
// 与 compare.test.ts 里保留的注入版用例的分工：
//   - 本文件走 **真实 env 默认参**（`selectedTargets(undefined)` 读 process.env），
//     只在 CONTRACT_TARGETS 被剥离的 unit 档成立；live 档 vitest 配置 exclude
//     tests/unit/**，不会以 inert 条目污染 require_live 的 skip=0 硬门。
//   - compare.test.ts 的同名用例改为显式注入空 env 读取函数，live 也能跑（可测性重构）。
import { describe, expect, it } from "vitest";

import { selectedTargets } from "../../src/targets.js";

describe("M96.F03.I02 未声明目标时返回空（unit 档真实 env 路径）", () => {
  it('selectedTargets("") 与 selectedTargets(undefined) 都返回空', () => {
    expect(selectedTargets("")).toEqual([]);
    // undefined → 落到默认参读 process.env.CONTRACT_TARGETS；unit 档该变量被剥离/未设
    expect(selectedTargets(undefined)).toEqual([]);
  });
});
