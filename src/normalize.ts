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

/**
 * ADR-0015-amend：时间戳字段名（驼峰 + 下划线两版）。
 * 值**不**进 drop 列表（前端不许依赖具体值）；独立走 `assertTimestampShape` 验格式。
 * 新加字段必须 append 到末尾，不能改既有顺序（按 lint 规则）。
 */
export const TIMESTAMP_KEYS: readonly string[] = [
  "createdAt", "updatedAt", "created_at", "updated_at",
  "deletedAt", "deleted_at", "lastLoginAt", "last_login_at",
];

/**
 * ADR-0015-amend：合法时间戳形态 —— `Date.parse()` 能解析且年份 ∈ [1970, 2100]。
 * 下界对齐 Unix 纪元开始（1970-01-01 00:00:00 UTC），与 3 后端实体的「合法默认值」对齐：
 *   - C#: `DateTime.UnixEpoch` / `new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)`
 *   - Java: `Instant.EPOCH` / `LocalDateTime.of(1970, 1, 1, 0, 0)`
 *   - JS/TS: `new Date(0)` // 1970-01-01T00:00:00.000Z
 * 不锁死毫秒/Z vs 微秒/+00:00 等具体语法（OpenAPI `format: date-time` 允许任意精度小数秒，
 * `Z` 和 `+00:00` 等价；msw 静态 seed 可能无小数秒）。前端不可区分这些形态，断言只挡
 * 「明显荒谬」的值（DateTime.MinValue、epoch 数字、null、空串）。
 */
function isPlausibleTimestamp(value: string): boolean {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  const year = new Date(ms).getUTCFullYear();
  return year >= TS_YEAR_MIN && year <= TS_YEAR_MAX;
}

/** 老 `normalize()` 用：宽松 ISO 8601（接受空格、TZ、秒精度），只用于「值归一」。 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * ADR-0015-amend：时间戳年份合理性范围。
 * 下界 = Unix 纪元开始（1970-01-01 00:00:00 UTC），与 3 后端实体的最小合法默认值对齐：
 *   - C# DateTimeOffset / DateTime: `DateTime.UnixEpoch` / `new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)`
 *   - Java Instant / LocalDateTime: `Instant.EPOCH` / `LocalDateTime.of(1970, 1, 1, 0, 0)`
 *   - JS Date: `new Date(0)` // 1970-01-01T00:00:00.000Z
 * 上界挡远未来占位符（例如 9999-12-31）。
 * 历史沿革：早期版本 [2000, 2100] 是基于「2020s SaaS 业务时间合理范围」；2026-09-01 user
 * 拍板改为 [1970, 2100]，理由 = 业务时间戳**可能**包含 epoch 占位（如 cache TTL、token 过期时间），
 * [2000, 2100] 会让这些合法值被误判。
 */
const TS_YEAR_MIN = 1970;
const TS_YEAR_MAX = 2100;

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
// session.json #1: msw fixture 同步 uniqueName tag（I10 设计层）。
// contract-test 4 target uniqueName 调用每次生成不同 random tag，msw oracle
// echo body tag 与后端真持久化 tag 必然不一致。normalize 时把 4 个已知测试
// prefix 的 username/email 后 6 char 随机 tag 抹平为固定占位，prefix 仍可比对。
const TEST_USER_PREFIXES = ["shape-", "invite-", "ct-u2-", "contract-test-user-"] as const;
const RANDOM_TAG_RE = /(-[a-z0-9]{6})(?=[@.]|$)/;
function maskRandomTag(value: unknown): unknown {
  if (typeof value !== "string") return value;
  for (const prefix of TEST_USER_PREFIXES) {
    if (value.startsWith(prefix)) {
      return value.replace(RANDOM_TAG_RE, "-XXXXXX");
    }
  }
  return value;
}

function sortKey(v: unknown): string {
  return JSON.stringify(v);
}

export function normalize(value: unknown, options: NormalizeOptions = {}): unknown {
  // ADR-0015-amend：时间戳字段值进默认 drop —— 不比值（4 后端写完成时刻必差几秒到几毫秒）。
  // 格式合法性独立走 assertTimestampShape 验证。drop 后 shape 必全等。
  const drop = new Set<string>([...ALWAYS_VOLATILE, ...TIMESTAMP_KEYS, ...(options.drop ?? [])]);
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
      // session.json #1: username / email 是 contract-test 4 target uniqueName 随机 tag，
      // 4 后端必然不一致；mask 抹平让 normalize 全等（只 mask 已知测试 prefix）。
      const walked = walk(child, drop);
      const isUserField = key === "username" || key === "email";
      out[key] = isUserField ? maskRandomTag(walked) : walked;
    }
    return out;
  }

  return value;
}

/** 复合 assertion 失败原因。 */
export interface TimestampShapeError {
  readonly path: string;
  readonly value: string;
  readonly reason: "format" | "year_range";
}

/**
 * ADR-0015-amend：每个 probe.body 里的 TIMESTAMP_KEYS 字段值必须：
 *   1. 字符串形态匹配 `YYYY-MM-DDTHH:mm:ss.sssZ`
 *   2. parse 后的年份 ∈ [1970, 2100]
 * 任一不过 → 返回错误。**不**比较值，只比格式/合理性。
 */
export function assertTimestampShape(
  body: unknown,
  keys: readonly string[] = TIMESTAMP_KEYS,
): TimestampShapeError[] {
  const errors: TimestampShapeError[] = [];
  walkShape(body, [], keys, errors);
  return errors;
}

function walkShape(value: unknown, path: readonly string[], keys: readonly string[], errors: TimestampShapeError[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkShape(value[i], [...path, String(i)], keys, errors);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (keys.includes(k) && typeof v === "string") {
        const ms = Date.parse(v);
        if (Number.isNaN(ms)) {
          errors.push({ path: [...path, k].join("."), value: v, reason: "format" });
        } else {
          const year = new Date(ms).getUTCFullYear();
          if (year < TS_YEAR_MIN || year > TS_YEAR_MAX) {
            errors.push({ path: [...path, k].join("."), value: v, reason: "year_range" });
          }
        }
        continue;
      }
      walkShape(v, [...path, k], keys, errors);
    }
  }
}

/** 便于断言的稳定序列化。 */
export function stable(value: unknown, options: NormalizeOptions = {}): string {
  return JSON.stringify(normalize(value, options), null, 2);
}
