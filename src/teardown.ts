// M96.F02 写端点 teardown —— 共库下避免「下次跑撞上次跑」。
//
// 测试体里 registerCleanup(name, fn)，afterAll 调 runCleanups()。
//
// 2026-09-01 修正（session.json #8）：同名 key 改为数组追加。
// 原因：M96.F02 写测试 I19 用 `for (const target of targets)` 调 4 次 registerCleanup
// 4 个同名 key (`delete-user:msw` 等),Map.set 之前只保留最后一个,本轮 4 个
// I19 user 创了只清 1 个,残留 3 个(本次跑 PG 查 2 个 shape-user-...)。
//
// 2026-09-10 修正（用户提的 FK 23503 残留）：teardown 按「child → parent」顺序跑。
// shared/nextjs schema 里 cascade 已声明（sys_menu.onDelete cascade 等），
// 但 PG 真库部分 FK 因 scaffold entity 与 drizzle→PG 迁移差异没建 CASCADE 约束。
// 残留清理时若 parent 行（oauth_client/sys_user/tenant/role）被先删，后续
// child（sys_menu/role_menu/member/oauth_access_token/tenant_application）引用
// 残骸 → 下次 INSERT 23503。
//
// 修法：registerCleanup 第二参支持「依赖表」前缀分类。约定：
//   - 「child」: sys_role_menu / sys_menu / oauth_access_token / oauth_code /
//               oauth_refresh_token / tenant_member_role / tenant_member /
//               tenant_application
//   - 「parent」: oauth_client / sys_user / tenant / sys_role
// 不传默认 parent（保持向后兼容）。
//
// runCleanups 先跑全部 child，再跑 parent —— PG FK 阻时 parent 在最后被删，
// child 早已 cascade（或子资源根本没被创建，本条就不跑）。

export type CleanupKind = "child" | "parent";

const cleanups: Array<{
  name: string;
  kind: CleanupKind;
  fn: () => Promise<void>;
}> = [];

export interface CleanupOptions {
  /** "child" 先跑（FK 从表），"parent" 后跑（FK 主表）。默认 "parent"。 */
  kind?: CleanupKind;
}

export function registerCleanup(
  name: string,
  fn: () => Promise<void>,
  opts: CleanupOptions = {},
): void {
  // 同名 key 允许重复（多 target 时 4 个同名 delete-app:msw 都注册）—— 保留全部
  cleanups.push({ name, kind: opts.kind ?? "parent", fn });
}

export function clearCleanups(): void {
  cleanups.length = 0;
}

export async function runCleanups(): Promise<void> {
  // 倒序跑：child 先，parent 后
  const childs = cleanups.filter((c) => c.kind === "child");
  const parents = cleanups.filter((c) => c.kind === "parent");

  for (const c of [...childs, ...parents]) {
    try {
      await c.fn();
    } catch (cause) {
      // 不抛 —— 让调用方知道「这条 cleanup 失败了」但不阻塞后续 cleanup。
      console.warn(`[teardown] ${c.name} failed:`, cause);
    }
  }
  clearCleanups();
}