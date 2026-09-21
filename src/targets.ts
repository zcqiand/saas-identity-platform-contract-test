// M96.F03 目标声明与可达性。
//
// 端口是 conventions §6 的显式字面量，不是 env 兜底（CLAUDE.md 硬规则：禁止 env 默认值兜底）。
// 「打哪些目标」由 CONTRACT_TARGETS 显式声明；**声明了就必须可达**，连不上是红不是跳过。

export interface Target {
  readonly name: string;
  readonly baseUrl: string;
  /** true = 内存 fixture，不与三个真后端共库（ADR-0012）。比对时需额外剔 ID。 */
  readonly inMemory: boolean;
}

/** conventions §6 端口表。改这里必须同步改 conventions。 */
export const TARGETS: Readonly<Record<string, Target>> = {
  nextjs: { name: "nextjs", baseUrl: "http://localhost:5101", inMemory: false },
  aspnetcore: { name: "aspnetcore", baseUrl: "http://localhost:5104", inMemory: false },
  springboot: { name: "springboot", baseUrl: "http://localhost:5105", inMemory: false },
};

export class TargetError extends Error {}

/**
 * M96.F03.I02 —— 从 CONTRACT_TARGETS 读要打的目标。
 * 未设置返回空数组（只跑单元测试）；设置了但名字不认识 → 抛错，不静默忽略。
 *
 * readEnv 注入（Task 5.85 可测性重构）：默认参读 process.env.CONTRACT_TARGETS 的
 * 路径在 live 档结构性不可测（env 恒已声明），原实现只能 it.skipIf 隔离 → 撞
 * require_live 的 skip=0 硬门。现在测试可注入替身 env 读取函数，该用例 live 照跑；
 * 生产调用方不传 readEnv，行为与旧签名逐字节一致（`selectedTargets()` 照旧读 env）。
 */
export function selectedTargets(
  raw?: string,
  readEnv: () => string | undefined = () => process.env.CONTRACT_TARGETS,
): Target[] {
  const value = raw ?? readEnv();
  if (!value || value.trim() === "") return [];
  const names = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = names.filter((n) => !(n in TARGETS));
  if (unknown.length > 0) {
    throw new TargetError(
      `CONTRACT_TARGETS 里有不认识的目标: ${unknown.join(", ")}。` +
        `可选: ${Object.keys(TARGETS).join(", ")}`,
    );
  }
  return names.map((n) => TARGETS[n]);
}

/** 比对集合里只要含内存后端，ID 就不可比 —— 它不共库。 */
export function needsIdDrop(targets: readonly Target[]): boolean {
  return targets.some((t) => t.inMemory);
}
