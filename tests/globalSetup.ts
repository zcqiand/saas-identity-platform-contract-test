// ADR-0018: vitest.globalSetup 进程级一次, 不是 setupFiles（每 worker 跑一次浪费）。
// unit 模式（无 CONTRACT_TARGETS）early-return — 不连后端。
//
// 双层兜底: 本钩子 + afterAll runCleanups。
// - globalSetup 防上次跑残留污染
// - registerCleanup 清本次跑（Ctrl+C 中断时也能清当次行）
import { cleanupAllProbeRows } from "../src/cleanup-pg.js";

export async function setup(): Promise<void> {
  if (!process.env.CONTRACT_TARGETS) return;
  await cleanupAllProbeRows();
}