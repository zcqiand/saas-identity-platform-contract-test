// ADR-0018: beforeAll 走 HTTP delete 清 PG 共库探针数据, 不走直连 PG（守住 ADR-0015 黑盒契约）。
// scope: 清 users(members) / roles / menus（I05 fail 源头：ct-menu- 留 → me/menus normalize 分叉）。
//   2026-09-12：api_keys 清理随 M05 域移除删除；users/roles/menus 三处 pre-pivot
//   字段名(code/name)与改名前路径(/users, /admin/apps/{appId}/menus)已修正为现行契约。
// 留待后续 PR: apps / tenants（admin scope，写测试自身已 uniqName 创 + teardown 删；本仓不主动扫）。
//
// 走 HTTP 而不是直连 PG 的理由（ADR §Alternatives B 被拒绝）：
//   1. 守住 ADR-0015 黑盒契约（CLAUDE.md §2 铁律）
//   2. 不引入新依赖（pg / postgres / drizzle-orm）
//   3. 复用 src/http.ts 已有的 login / probeRequest helper
//   4. msw（inMemory: true）跳过；DELETE 容差 200 / 204 / 404（aspnetcore DELETE 返 200）
import { login, probeRequest } from "./http.js";
import { selectedTargets, type Target } from "./targets.js";
import { pathWithParams } from "./path.js";
import { ALICE_PARAMS, SEED } from "./seed.js";

interface UserRow {
  id?: string;
  username?: string;
  email?: string;
  createdAt?: string;
}

// 2026-09-12 修复：ADR-0032 后成员端点改名 /tenants/{tenantId}/members（扁平
// TenantMemberUserView，{userId} = user.id），旧 /users 路径恒 404 → users 清理
// 静默空转（同 roles/menu 的路径漂移）。
const USERS_PATH = pathWithParams("/api/v1/tenants/{tenantId}/members", {
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
  const items = (list.body as { items?: UserRow[] }).items ?? [];
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

interface RoleRow {
  id?: string;
  roleCode?: string;
  roleName?: string;
  createdAt?: string;
}

const ROLES_PATH = pathWithParams("/api/v1/tenants/{tenantId}/roles", {
  tenantId: ALICE_PARAMS.tenantId,
});

// roles 探针 prefix(来自 tenant-roles-write 写测试 uniqueName("ct-role") / uniqueName("shape-role"))。
// 2026-09-12 修复：9/7 SSOT pivot 后 SysRole 返回 roleCode/roleName，此前读 pre-pivot
// 的 code/name 恒 undefined → ROLE_MATCH 恒 false → roles 清理静默空转，
// shape-role-* 残留落 PG，下一轮 live 角色列表 normalize 首行即分叉（msw 无残留）。
const ROLE_MATCH = (r: RoleRow) =>
  /^(ct-role|shape-role|contract-test-role)/.test(r.roleCode ?? "");

async function cleanupRoles(target: Target): Promise<void> {
  const token = await login(target);
  const list = await probeRequest(target, {
    method: "GET",
    path: ROLES_PATH,
    token,
  });
  if (list.status !== 200) {
    console.warn(
      `[cleanup-pg] ${target.name} GET ${ROLES_PATH} status=${list.status}`,
    );
    return;
  }
  const items = (list.body as { items?: RoleRow[] }).items ?? [];
  for (const r of items) {
    if (!r.id) continue;
    const matched = ROLE_MATCH(r) || SENTINEL_OR_NEG_YEAR(r.createdAt ?? "");
    if (!matched) continue;
    const del = await probeRequest(target, {
      method: "DELETE",
      path: `${ROLES_PATH}/${r.id}`,
      token,
    });
    if (!DELETE_TOLERANT(del.status)) {
      console.warn(
        `[cleanup-pg] ${target.name} delete role ${r.id} status=${del.status}`,
      );
    }
  }
}

// cleanupApiKeys 已删（2026-09-12）：M05 api-keys 域 2026-09-08 从 shared 契约整域移除，
// 端点不存在，清理恒 404 空转。历史 api_keys 残留行不参与任何现行比对。

interface MenuRow {
  id?: string;
  title?: string;
  createdAt?: string;
}

interface OAuthClientRow {
  id?: string;
  clientId?: string;
  clientName?: string;
  createdAt?: string;
}

interface TenantApplicationRow {
  id?: string;
  clientId?: string;
  tenantId?: string;
  createdAt?: string;
}

// 9/10 I66/I75：上一轮 run 的 ct-app-* OAuth client / tenant_application 没清掉，本轮
// oauth_access_token INSERT 引用被删的 ct-app-* → 23503。同 prefix 兜底清。
const ADMIN_CLIENTS_PATH = "/api/v1/admin/clients";
const ADMIN_TENANTS_APPS_PATH = pathWithParams(
  "/api/v1/tenants/{tenantId}/applications",
  { tenantId: ALICE_PARAMS.tenantId },
);

// admin/clients + tenant_applications 探针 prefix 全为 ct-app-（admin-clients-write /
// tenant-applications 唯一化）。seed lab-management / erp / crm 不动。
const OAUTH_CLIENT_MATCH = (c: OAuthClientRow) =>
  /^ct-app-/.test(c.clientId ?? "");
const TENANT_APP_MATCH = (a: TenantApplicationRow) =>
  /^ct-app-/.test(a.clientId ?? "");

async function cleanupAdminClients(target: Target): Promise<void> {
  const token = await login(target);
  const list = await probeRequest(target, {
    method: "GET",
    path: ADMIN_CLIENTS_PATH,
    token,
  });
  if (list.status !== 200) {
    console.warn(
      `[cleanup-pg] ${target.name} GET ${ADMIN_CLIENTS_PATH} status=${list.status}`,
    );
    return;
  }
  const rawBody = list.body as { items?: OAuthClientRow[] } | OAuthClientRow[];
  const items: OAuthClientRow[] = Array.isArray(rawBody)
    ? rawBody
    : (rawBody.items ?? []);
  for (const c of items) {
    if (!c.clientId) continue;
    if (!OAUTH_CLIENT_MATCH(c) && !SENTINEL_OR_NEG_YEAR(c.createdAt ?? ""))
      continue;
    const del = await probeRequest(target, {
      method: "DELETE",
      path: `${ADMIN_CLIENTS_PATH}/${c.clientId}`,
      token,
    });
    if (!DELETE_TOLERANT(del.status)) {
      console.warn(
        `[cleanup-pg] ${target.name} delete client ${c.clientId} status=${del.status}`,
      );
    }
  }
}

async function cleanupTenantApplications(target: Target): Promise<void> {
  const token = await login(target);
  const list = await probeRequest(target, {
    method: "GET",
    path: ADMIN_TENANTS_APPS_PATH,
    token,
  });
  if (list.status !== 200) {
    console.warn(
      `[cleanup-pg] ${target.name} GET ${ADMIN_TENANTS_APPS_PATH} status=${list.status}`,
    );
    return;
  }
  const rawBody =
    (list.body as { items?: TenantApplicationRow[] }).items ??
    (list.body as TenantApplicationRow[]) ??
    [];
  for (const a of rawBody) {
    if (!a.clientId || !a.tenantId) continue;
    if (!TENANT_APP_MATCH(a) && !SENTINEL_OR_NEG_YEAR(a.createdAt ?? ""))
      continue;
    const del = await probeRequest(target, {
      method: "DELETE",
      path: `${ADMIN_TENANTS_APPS_PATH}/${a.clientId}`,
      token,
    });
    if (!DELETE_TOLERANT(del.status)) {
      console.warn(
        `[cleanup-pg] ${target.name} delete tenant_application ${a.clientId} status=${del.status}`,
      );
    }
  }
}

// 2026-09-12 修复：M08 路径 2026-09-08 已从 /admin/apps/{appId}/menus 改名
// /clients/{clientId}/menus（client-menus-write.test.ts BASE_PATH 同源），旧路径恒
// 404 → menus 清理静默空转。clientId 用 code 形（"lab-management"）。
const MENUS_PATH = pathWithParams("/api/v1/clients/{clientId}/menus", {
  clientId: SEED.clientIds.labManagement,
});

// menus 探针 prefix（来自 client-menus-write.test.ts:40 uniqueName("ct-menu")）。
// 2026-09-06 I05 fail：上次 run teardown 删菜单 nextjs 超时失败，ct-menu- 行落 PG，
// 后续 me.test.ts GET /me/menus 把 alice 可见菜单拉下来 → nextjs 多一条 vs msw 内存 fixture 空。
// 走 /clients/{clientId}/menus 全表扫 + prefix 删 = 把「写测试自己 teardown
// 失败的兜底」放进 globalSetup，下次 run 进 describe 前 PG 已经干净。
// 2026-09-12 修复：9/7 SSOT pivot 后 SysMenu 无 code/name，uniqueName 落在
// title（`contract-test ct-menu-XXXXXX`），匹配改读 title。
const MENU_MATCH = (m: MenuRow) =>
  /^contract-test ct-menu-/.test(m.title ?? "");

async function cleanupMenus(target: Target): Promise<void> {
  const token = await login(target);
  const list = await probeRequest(target, {
    method: "GET",
    path: MENUS_PATH,
    token,
  });
  if (list.status !== 200) {
    console.warn(
      `[cleanup-pg] ${target.name} GET ${MENUS_PATH} status=${list.status}`,
    );
    return;
  }
  const items = (list.body as MenuRow[]) ?? [];
  for (const m of items) {
    if (!m.id) continue;
    const matched = MENU_MATCH(m) || SENTINEL_OR_NEG_YEAR(m.createdAt ?? "");
    if (!matched) continue;
    const del = await probeRequest(target, {
      method: "DELETE",
      path: `${MENUS_PATH}/${m.id}`,
      token,
    });
    if (!DELETE_TOLERANT(del.status)) {
      console.warn(
        `[cleanup-pg] ${target.name} delete menu ${m.id} (title=${m.title}) status=${del.status}`,
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
  // 2026-09-02 I07/I10：cleanup 三类探针行（users/roles/api-keys）对 msw 一视同仁 ——
  // 它是内存态，任何一轮 run 的 teardown 失败（或手工 curl 探针）残留行会活到
  // 后续所有 run（进程不重启不清零），列表比对立即分叉。msw 有 DELETE 端点，
  // 按同一 prefix/sentinel 匹配清内存行。3 真后端共库，残留同样会撞唯一约束/漂移 total。
  // 2026-09-06 I05：补 cleanupMenus，msw 也参与（共享 fixture 残留同样会撞 normalize 比对）。
  const targets = selectedTargets();
  for (const t of targets) {
    if (t.inMemory) {
      // msw 无 PG sentinel 行，只跑 users/roles/menus 的 prefix 匹配删除
      try {
        await cleanupUsers(t);
      } catch (e) {
        console.warn(`[cleanup-pg] users ${t.name}(inMemory)`, e);
      }
      try {
        await cleanupRoles(t);
      } catch (e) {
        console.warn(`[cleanup-pg] roles ${t.name}(inMemory)`, e);
      }
      try {
        await cleanupMenus(t);
      } catch (e) {
        console.warn(`[cleanup-pg] menus ${t.name}(inMemory)`, e);
      }
      try {
        await cleanupAdminClients(t);
      } catch (e) {
        console.warn(`[cleanup-pg] admin/clients ${t.name}(inMemory)`, e);
      }
      try {
        await cleanupTenantApplications(t);
      } catch (e) {
        console.warn(`[cleanup-pg] tenant_applications ${t.name}(inMemory)`, e);
      }
      continue;
    }
    try {
      await cleanupUsers(t);
    } catch (e) {
      console.warn(`[cleanup-pg] users ${t.name}`, e);
    }
    try {
      await cleanupRoles(t);
    } catch (e) {
      console.warn(`[cleanup-pg] roles ${t.name}`, e);
    }
    try {
      await cleanupMenus(t);
    } catch (e) {
      console.warn(`[cleanup-pg] menus ${t.name}`, e);
    }
    try {
      await cleanupAdminClients(t);
    } catch (e) {
      console.warn(`[cleanup-pg] admin/clients ${t.name}`, e);
    }
    try {
      await cleanupTenantApplications(t);
    } catch (e) {
      console.warn(`[cleanup-pg] tenant_applications ${t.name}`, e);
    }
  }
}
