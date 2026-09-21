import { configDefaults, defineConfig } from "vitest/config";
import FnReporter from "./tests/fnReporter";

// Task 5.85(a)：live 档（CONTRACT_TARGETS 声明 ≥2 目标，与 fnReporter DECLARED_TARGETS
// 同一判定）exclude tests/unit/** —— 该目录收纯单测性质用例（四方比对「未运行提示」、
// selectedTargets 真实 env 默认参路径），它们在 live 下结构性不成立。原实现用
// describe.runIf(!live) / it.skipIf 隔离，但 require_live 仓的 skip=0 硬门
// （harness.load_trace spec §3.5）把 live trace 里任何 inert 条目判红（5.54 saas
// full-tier EXIT=2 根因）。迁 tests/unit/ + 配置层 exclude 后：live trace 天然
// 0 inert，unit 档（gate --tier unit 剥 CONTRACT_TARGETS / 开发者裸跑）照常包含。
// 注意 configDefaults.exclude 含 node_modules —— 覆盖 exclude 时必须带上默认值。
const DECLARED = (process.env.CONTRACT_TARGETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LIVE = DECLARED.length >= 2;

export default defineConfig({
  // 同 saas-msw：package.json "type": "module" 下必须强制 ESM transform，
  // 否则 esbuild 默认输出 CJS 会撞 `ReferenceError: exports is not defined`。
  esbuild: { format: "esm" },
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: LIVE ? [...configDefaults.exclude, "tests/unit/**"] : configDefaults.exclude,
    testTimeout: 30000,
    // 2026-09-01：3 真后端共享一个 PG，vitest 2.x 默认文件级并行让写测试
    // （roles/users/menus/api-keys）与读比对（I05/I07/I10）同窗口互踩 —— 写进来的
    // 行改变读侧 items/total，teardown 又删不干净上一文件的残留。
    // 串行化牺牲速度换确定性；全量串行约 3-4 分钟，live 验证可接受。
    fileParallelism: false,
    // 2026-09-01 ADR-0018: 进程级一次 PG cleanup（不是 setupFiles 每 worker 一次）。
    // globalSetup 里的 setup() 只在 CONTRACT_TARGETS 存在时跑 cleanup,
    // unit 模式（无 env）early-return。
    globalSetup: ["./tests/globalSetup.ts"],
    reporters: ["default", new FnReporter() as never],
  },
});
