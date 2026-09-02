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
  msw: { name: "msw", baseUrl: "http://localhost:5100", inMemory: true },
  nextjs: { name: "nextjs", baseUrl: "http://localhost:5101", inMemory: false },
  aspnetcore: { name: "aspnetcore", baseUrl: "http://localhost:5104", inMemory: false },
  springboot: { name: "springboot", baseUrl: "http://localhost:5105", inMemory: false },
};

/** ADR-0015：msw 是 oracle —— 打它必须绿，红了说明套件写错而不是后端错。 */
export const ORACLE = "msw";

export class TargetError extends Error {}

/**
 * M96.F03.I02 —— 从 CONTRACT_TARGETS 读要打的目标。
 * 未设置返回空数组（只跑单元测试）；设置了但名字不认识 → 抛错，不静默忽略。
 */
export function selectedTargets(raw = process.env.CONTRACT_TARGETS): Target[] {
  if (!raw || raw.trim() === "") return [];
  const names = raw
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
