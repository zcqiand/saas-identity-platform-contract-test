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
    reporters: ["default", new FnReporter() as never],
  },
});
