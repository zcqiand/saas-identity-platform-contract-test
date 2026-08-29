// M96.F01 normalize 契约 —— 把「同输出」从『逐字节相同』翻译成『前端不可区分』。
//
// 设计要点（ADR-0015，2026-08-29 落地时修正）：
// 原 ADR 写「剔除 id / *_id」。实测发现这对本家族太钝：nextjs / aspnetcore / springboot
// **共用同一个 PG**，schema 由 V*.sql 逐字节复制、seed 由 V014/V015 提供，所以三者返回的
// UUID 本来就该逐字相同 —— 剔掉等于丢掉最强的一路信号。
// 故拆成两档：
//   FORMAT 档（总是跑）  —— 日期归一化、key 排序、数组排序、null≡缺失。纯方言，不丢语义。
//   VOLATILE 档（可选） —— 剔除每次请求都不同的值（token / jti）。
//                          比对含 msw 时再额外剔 ID（它是内存 fixture，不共库）。

export interface NormalizeOptions {
  /** 额外剔除的字段名（除 ALWAYS_VOLATILE 外）。含 msw 的比对传 ID_KEYS。 */
  readonly drop?: readonly string[];
}

/** 每次请求都不同 —— 任何比对都不该依赖。 */
export const ALWAYS_VOLATILE: readonly string[] = [
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "jti",
];

/** 主键类字段。**只在比对涉及 msw 时剔除** —— 三个真后端共库，ID 应当相等。 */
export const ID_KEYS: readonly string[] = ["id", "userId", "tenantId", "user_id", "tenant_id"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/** M96.F01.I02 —— Jackson 出 `+00:00`、System.Text.Json 出 `Z`，OpenAPI 层面都合法。 */
export function normalizeDate(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toISOString();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 数组排序键：对元素归一化后取稳定 JSON。集合顺序不属于契约。 */
function sortKey(v: unknown): string {
  return JSON.stringify(v);
}

export function normalize(value: unknown, options: NormalizeOptions = {}): unknown {
  const drop = new Set<string>([...ALWAYS_VOLATILE, ...(options.drop ?? [])]);
  return walk(value, drop);
}

function walk(value: unknown, drop: Set<string>): unknown {
  if (typeof value === "string") {
    return ISO_DATE.test(value) ? normalizeDate(value) : value;
  }

  if (Array.isArray(value)) {
    const items = value.map((v) => walk(v, drop));
    return [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (drop.has(key)) continue;
      const child = value[key];
      // M96.F01.I03 —— 「字段缺失」与「显式 null」等价：两者都不进结果。
      // Spring 的 NON_ABSENT 省略 null，ASP.NET 默认输出 null，契约层面都合法。
      if (child === null || child === undefined) continue;
      out[key] = walk(child, drop);
    }
    return out;
  }

  return value;
}

/** 便于断言的稳定序列化。 */
export function stable(value: unknown, options: NormalizeOptions = {}): string {
  return JSON.stringify(normalize(value, options), null, 2);
}
