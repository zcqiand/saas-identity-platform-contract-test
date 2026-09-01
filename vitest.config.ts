import { defineConfig } from "vitest/config";
import FnReporter from "./tests/fnReporter";

export default defineConfig({
  // 同 saas-msw：package.json "type": "module" 下必须强制 ESM transform，
  // 否则 esbuild 默认输出 CJS 会撞 `ReferenceError: exports is not defined`。
  esbuild: { format: "esm" },
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
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
