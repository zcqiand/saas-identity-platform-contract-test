// M96.F02 四方比对 —— 同一请求打 N 个后端，比 status 与 normalize 后的 body。
//
// 不做 snapshot 逐字节比对：UUID / 时间戳 / token 天生不同，那个目标不可达（ADR-0015）。
// 判定标准是「前端不可区分」：前端会因为什么走进不同分支，就比什么。

import { ID_KEYS, normalize, stable, assertTimestampShape, type TimestampShapeError } from "./normalize.js";
import { ORACLE, type Target, needsIdDrop } from "./targets.js";

export interface Probe {
  readonly target: string;
  readonly status: number;
  readonly body: unknown;
}

export interface Divergence {
  readonly kind: "status" | "body";
  readonly target: string;
  readonly detail: string;
}

function dropKeys(targets: readonly Target[]): readonly string[] {
  return needsIdDrop(targets) ? ID_KEYS : [];
}

/** M96.F02.I01 —— 前端的 catch 分支由状态码决定，状态码必须全等。 */
export function compareStatuses(probes: readonly Probe[]): Divergence[] {
  if (probes.length < 2) return [];
  const oracle = probes.find((p) => p.target === ORACLE) ?? probes[0];
  return probes
    .filter((p) => p.target !== oracle.target && p.status !== oracle.status)
    .map((p) => ({
      kind: "status" as const,
      target: p.target,
      detail: `status ${p.status} ≠ ${oracle.target} 的 ${oracle.status}`,
    }));
}

/** M96.F02.I02 —— 前端渲染由字段名/类型/必填决定，normalize 后必须全等。 */
export function compareBodies(
  probes: readonly Probe[],
  targets: readonly Target[],
  extraDrop: readonly string[] = [],
): Divergence[] {
  if (probes.length < 2) return [];
  const drop = [...dropKeys(targets), ...extraDrop];
  const oracle = probes.find((p) => p.target === ORACLE) ?? probes[0];
  const want = stable(oracle.body, { drop });

  const divergences: Divergence[] = probes
    .filter((p) => p.target !== oracle.target)
    .flatMap((p) => {
      const got = stable(p.body, { drop });
      if (got === want) return [];
      return [
        {
          kind: "body" as const,
          target: p.target,
          detail: firstDiff(want, got, oracle.target, p.target),
        },
      ];
    });

  // ADR-0015-amend：normalize 全等之后，单独跑时间戳格式 + 年份范围断言。
  // 任意 probe 的 TIMESTAMP_KEYS 字段值不合规 → 报 divergence（独立于 body shape 比对）。
  for (const p of probes) {
    for (const err of assertTimestampShape(p.body)) {
      divergences.push({
        kind: "body",
        target: p.target,
        detail: `${err.path}: 时间戳 ${err.reason === "format" ? "格式不合 ISO 8601 毫秒 UTC" : "年份超出 [1970,2100]"} (${err.value})`,
      });
    }
  }
  return divergences;
}

/** 只报第一处差异 —— 一次修一个，比甩 200 行 diff 有用。 */
function firstDiff(want: string, got: string, oracleName: string, target: string): string {
  const a = want.split("\n");
  const b = got.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return (
        `normalize 后第 ${i + 1} 行起分叉\n` +
        `    ${oracleName}: ${a[i] ?? "(缺行)"}\n` +
        `    ${target}: ${b[i] ?? "(缺行)"}`
      );
    }
  }
  return `长度不同: ${oracleName} ${a.length} 行 / ${target} ${b.length} 行`;
}

export function compareAll(
  probes: readonly Probe[],
  targets: readonly Target[],
  extraDrop: readonly string[] = [],
): Divergence[] {
  return [...compareStatuses(probes), ...compareBodies(probes, targets, extraDrop)];
}

export function formatDivergences(items: readonly Divergence[]): string {
  return items.map((d) => `  [${d.kind}] ${d.target}: ${d.detail}`).join("\n");
}

export { normalize };
