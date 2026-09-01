// ADR-0018: beforeAll 走 HTTP delete 清 PG 共库探针数据, 不走直连 PG（守住 ADR-0015 黑盒契约）。
// scope: 只清 users + api_keys（I10 fail 源头）。apps / tenants / menus / roles 留待后续 PR。
//
// 走 HTTP 而不是直连 PG 的理由（ADR §Alternatives B 被拒绝）：
//   1. 守住 ADR-0015 黑盒契约（CLAUDE.md §2 铁律）
//   2. 不引入新依赖（pg / postgres / drizzle-orm）
//   3. 复用 src/http.ts 已有的 login / probeRequest helper
//   4. msw（inMemory: true）跳过；DELETE 容差 200 / 204 / 404（aspnetcore DELETE 返 200）
import { login, probeRequest } from "./http.js";
import { selectedTargets, type Target } from "./targets.js";
import { pathWithParams } from "./path.js";
import { ALICE_PARAMS } from "./seed.js";

interface UserRow {
  id?: string;
  username?: string;
  email?: string;
  createdAt?: string;
}

interface ApiKeyRow {
  id?: string;
  name?: string;
  createdAt?: string;
}

const USERS_PATH = pathWithParams("/api/v1/tenants/{tenantId}/users", {
  tenantId: ALICE_PARAMS.tenantId,
});

const API_KEYS_PATH = pathWithParams("/api/v1/tenants/{tenantId}/api-keys", {
  tenantId: ALICE_PARAMS.tenantId,
});

// users 表探针 prefix（来自 9 个写测试 uniqueName("prefix") 调用）
//   - shape-user-    + @x.io（tenant-users-write.test.ts:73,77）
//   - invite-        + @contract-test.io（tenant-users-write-2.test.ts:159）
//   - ct-u2-         + @contract-test.io（tenant-users-write-2.test.ts:40）
//   - contract-test-user-    + @contract-test.io（tenant-users-write.test.ts:38）
const USER_MATCH = (u: UserRow) =>
  /^(shape-|invite-|ct-u2-|contract-test-user-)/.test(u.username ?? "") ||
  /@(x|contract-test)\.io$/.test(u.email ?? "");

// api_keys 表探针 prefix
//   - contract-test-key-    (tenant-api-keys-write.test.ts:46)
//   - shape-                 (tenant-api-keys-write.test.ts:82) ← 末尾 `-` 收尾避免撞未来真账号
//   - delete-test-key-      (tenant-api-keys-delete.test.ts:38)
//   - rot-src-               (tenant-misc-write.test.ts:39)
//   - rot-shape-             (tenant-misc-write.test.ts:75)
const API_KEY_MATCH = (k: ApiKeyRow) =>
  /^(contract-test-key-|rot-src|rot-shape|delete-test-key-|shape-)/.test(k.name ?? "");

// 跨语言 MinValue / -infinity sentinel 兜底清理（springboot PLAN.md §本会话根因实证）：
//   - C# DateTimeOffset.MinValue → "0001-01-01T00:00:00.0000000+00:00"
//   - Java OffsetDateTime.MIN (PG -infinity 映射) → "-292275055-05-16T23:00:00.000Z"
//   - JS Date min → "-271821-04-20T00:00:00.000Z"
// 历次跑残留的 sentinel 行(本会话 SQL 日志实证 0 新写,但 PG 仍有历史行)
// 也走 DELETE 清掉,避免下次 live 触发 assertTimestampShape 红。
// 兼容 ISO 字符串不同格式(带毫秒 / 不带 / 不同 TZ 后缀)
const SENTINEL_OR_NEG_YEAR = (iso: unknown): boolean => {
  if (typeof iso !== "string") return false;
  // 显式字符串 sentinel: "-infinity" / "-292275055-05-16..." / "0001-01-01..." / "-271821..."
  if (iso === "-infinity") return true;
  // 年份字段（YYYY-）在第 0..7 位
  const m = iso.match(/^(-?\d{4,})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const year = Number(m[1]);
  return year < 1970; // 任何 < 1970 的年份（Unix 纪元之前）都是 sentinel
};

// DELETE 容差: 200 / 204 成功; 404 already-gone 视为成功(双层兜底也会触发);
const DELETE_TOLERANT = (s: number) => s === 200 || s === 204 || s === 404;

async function cleanupUsers(target: Target): Promise<void> {
  const token = await login(target);
  const list = await probeRequest(target, {
    method: "GET",
    path: USERS_PATH,
    token,
  });
  if (list.status !== 200) {
    console.warn(
      `[cleanup-pg] ${target.name} GET ${USERS_PATH} status=${list.status}`,
    );
    return;
  }
  const items = ((list.body as { items?: UserRow[] }).items) ?? [];
  for (const u of items) {
    if (!u.id) continue;
    // 探针 prefix OR sentinel 年份(< 1970) → 双条件删除
    const matched = USER_MATCH(u) || SENTINEL_OR_NEG_YEAR(u.createdAt ?? "");
    if (!matched) continue;
    const del = await probeRequest(target, {
      method: "DELETE",
      path: `${USERS_PATH}/${u.id}`,
      token,
    });
    if (!DELETE_TOLERANT(del.status)) {
      console.warn(
        `[cleanup-pg] ${target.name} delete user ${u.id} status=${del.status}`,
      );
    }
  }
}

async function cleanupApiKeys(target: Target): Promise<void> {
  const token = await login(target);
  const list = await probeRequest(target, {
    method: "GET",
    path: API_KEYS_PATH,
    token,
  });
  if (list.status !== 200) {
    console.warn(
      `[cleanup-pg] ${target.name} GET ${API_KEYS_PATH} status=${list.status}`,
    );
    return;
  }
  const items = ((list.body as { items?: ApiKeyRow[] }).items) ?? [];
  for (const k of items) {
    if (!k.id) continue;
    // 探针 prefix OR sentinel 年份(< 1970) → 双条件删除
    const matched = API_KEY_MATCH(k) || SENTINEL_OR_NEG_YEAR(k.createdAt ?? "");
    if (!matched) continue;
    const del = await probeRequest(target, {
      method: "DELETE",
      path: `${API_KEYS_PATH}/${k.id}`,
      token,
    });
    if (!DELETE_TOLERANT(del.status)) {
      console.warn(
        `[cleanup-pg] ${target.name} delete api-key ${k.id} status=${del.status}`,
      );
    }
  }
}

/**
 * ADR-0018 §3 主函数。
 * vitest.globalSetup 在每个 vitest 进程开始时跑一次（不是每 worker 一次）。
 * unit 模式（无 CONTRACT_TARGETS）由调用方 (tests/globalSetup.ts) early-return。
 */
export async function cleanupAllProbeRows(): Promise<void> {
  const targets = selectedTargets().filter((t) => !t.inMemory); // 跳过 msw
  for (const t of targets) {
    try {
      await cleanupUsers(t);
    } catch (e) {
      console.warn(`[cleanup-pg] users ${t.name}`, e);
    }
    try {
      await cleanupApiKeys(t);
    } catch (e) {
      console.warn(`[cleanup-pg] api-keys ${t.name}`, e);
    }
  }
}