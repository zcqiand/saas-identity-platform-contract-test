// ADR-0018: vitest.globalSetup 进程级一次, 不是 setupFiles（每 worker 跑一次浪费）。
// unit 模式（无 CONTRACT_TARGETS）early-return — 不连后端。
//
// 双层兜底: 本钩子 + afterAll runCleanups。
// - globalSetup 防上次跑残留污染
// - registerCleanup 清本次跑（Ctrl+C 中断时也能清当次行）
import { cleanupAllProbeRows } from "../src/cleanup-pg.js";
import { resetLiveExecLog } from "../src/live-floor.js";

export async function setup(): Promise<void> {
  // ADR-0040：live/unit 两模式都清 live-exec.jsonl 残留——unit 模式留旧文件，
  // 下次 flush 会把陈旧分组当成本 run 执行面（spec §2 生命周期）。
  resetLiveExecLog();
  if (!process.env.CONTRACT_TARGETS) return;
  await cleanupAllProbeRows();
}