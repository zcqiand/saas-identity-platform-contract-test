// src/live-floor.ts
// live 执行面 side channel（ADR-0040 / REQ-2026-010，spec 2026-09-22 §2/§3）。
// 探针层每打到一个 HTTP 响应（任意 status——status 是被比对对象，4xx/5xx 由断言管）
// append 一行 {suite, target, status} 到 .state/live-exec.jsonl；fnReporter flush 时
// 合并计算 executed_per_describe_min 写进 trace.live_floor，随后删除文件。
//
// vitest 任务树没有 per-target 粒度（比对在 beforeAll/it 内部循环里），且 reporter 在
// 主进程、测试在 worker——磁盘是唯一可达通道。fileParallelism: false 已串行化，无并发写。
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
// 必须从 vitest/suite 导入——vitest 2.1.9 根入口（dist/index.d.ts）不导出这些 API，
// 从根导入拿到 undefined，recordProbe 会永久 no-op（修复轮 1 实锤，见 node_modules grep）。
import { getCurrentSuite, getCurrentTest } from "vitest/suite";

const LIVE_EXEC_FILE = path.resolve(".state", "live-exec.jsonl");

export interface LiveExecRow {
  suite: string;
  target: string;
  status: number;
}

/**
 * suite 名解析序（vitest 2.1.9 实测，见 tests/live-floor.test.ts 回归用例）：
 * 0. hookSuiteName——withLiveExecSuite beforeAll 通道（钩子运行期 vitest 无 API 可取
 *    suite 名，钩子首参 ctx 是唯一通道，经包装器置入动态作用域）。
 * 1. 显式 override——beforeAll 钩子内两个 getter 都拿不到 describe（getCurrentSuite 返回根
 *    default suite 的空名 ""、getCurrentTest 是 undefined），钩子只能靠自身首参（即 suite
 *    task 对象）把名字穿进来，Task 2 接线时用。
 * 2. getCurrentTest()?.suite?.name——it() 运行期的正解，返回真正所属 describe 的标题。
 * 3. getCurrentSuite()?.name——collect 期上下文兜底；运行期它是 ""（falsy）→ 归 null。
 * 全部落空 → null，探针不登记：预热不得虚增执行面。
 */
function currentSuiteName(override?: string): string | null {
  if (hookSuiteName) return hookSuiteName;
  if (override) return override;
  try {
    const fromTest = getCurrentTest()?.suite?.name;
    if (fromTest) return fromTest;
    return getCurrentSuite()?.name || null;
  } catch {
    return null; // 防御：vitest 运行时内部态在极端时序下可能不可用
  }
}

/** beforeAll 归因通道：钩子运行期 vitest 无 API 可取 suite 名（2.1.9 实证），
 * 钩子首参 ctx 是唯一通道。钩子体内探针调用经本包装获得归因；包装器清零晚于
 * 全部 await，单 worker 串行（fileParallelism: false）下动态作用域安全。 */
let hookSuiteName: string | null = null;

export async function withLiveExecSuite<T>(
  suiteName: string,
  fn: () => Promise<T>,
): Promise<T> {
  hookSuiteName = suiteName;
  try {
    return await fn();
  } finally {
    hookSuiteName = null;
  }
}

/**
 * 探针出口点调用（probeGet / probeWithToken 成功拿到响应处）。无 suite 上下文则 no-op。
 * suiteOverride：beforeAll 内钩子把首参（suite task）的 name 穿进来的通道；it() 内不必传。
 */
export function recordProbe(
  target: string,
  status: number,
  suiteOverride?: string,
): void {
  const suite = currentSuiteName(suiteOverride);
  if (!suite) return;
  mkdirSync(path.dirname(LIVE_EXEC_FILE), { recursive: true });
  const row: LiveExecRow = { suite, target, status };
  appendFileSync(LIVE_EXEC_FILE, JSON.stringify(row) + "\n", "utf-8");
}

/** globalSetup 开跑时清残留。live/unit 两模式都要清——unit 留旧文件会让下次 flush 读到陈旧分组。 */
export function resetLiveExecLog(): void {
  rmSync(LIVE_EXEC_FILE, { force: true });
}

/**
 * fnReporter flush 用：合并 jsonl → 按 suite 分组的 distinct target 集合。
 * null = 文件缺失（mode=live 时是 side channel 故障信号；mode=unit 时是常态）。
 * 空 Map = 文件在但零记录（live 模式下即全部 describe 未探到任何目标 = 全塌缩）。
 */
export function readLiveExecGroups(): Map<string, Set<string>> | null {
  let text: string;
  try {
    text = readFileSync(LIVE_EXEC_FILE, "utf-8");
  } catch {
    return null;
  }
  const groups = new Map<string, Set<string>>();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t) as Partial<LiveExecRow>;
      // 5.97⑤：JSON 合法但形状不对（缺字段/错型，外部手工损坏面）与损坏行同判跳过
      // ——recordProbe 恒写全字段，此守卫只防手改；放行会产 undefined 键垃圾分组（假红侧）。
      if (
        typeof row.suite !== "string" ||
        !row.suite ||
        typeof row.target !== "string" ||
        !row.target ||
        typeof row.status !== "number" ||
        !Number.isFinite(row.status)
      )
        continue;
      if (!groups.has(row.suite)) groups.set(row.suite, new Set());
      groups.get(row.suite)!.add(row.target);
    } catch {
      // 单行损坏跳过——半行写入不得毒化整批
    }
  }
  return groups;
}

/** fnReporter flush 读完即删，防残留污染下次 run。 */
export function deleteLiveExecLog(): void {
  rmSync(LIVE_EXEC_FILE, { force: true });
}
