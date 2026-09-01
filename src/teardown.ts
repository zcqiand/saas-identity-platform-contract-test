// M96.F02 写端点 teardown —— 共库下避免「下次跑撞上次跑」。
//
// 测试体里 registerCleanup(name, fn)，afterAll 调 runCleanups()。
// 2026-09-01 修正（session.json #8）：同名 key 改为数组追加。
// 原因：M96.F02 写测试 I19 用 `for (const target of targets)` 调 4 次 registerCleanup
// 4 个同名 key (`delete-user:msw` 等),Map.set 之前只保留最后一个,本轮 4 个
// I19 user 创了只清 1 个,残留 3 个(本次跑 PG 查 2 个 shape-user-...)。
// 失败不抛 —— teardown 失败不应掩盖测试断言的失败；记日志由调用方决定。

const cleanups = new Map<string, Array<() => Promise<void>>>();

export function registerCleanup(name: string, fn: () => Promise<void>): void {
  const list = cleanups.get(name) ?? [];
  list.push(fn);
  cleanups.set(name, list);
}

export function clearCleanups(): void {
  cleanups.clear();
}

export async function runCleanups(): Promise<void> {
  for (const [name, fns] of cleanups) {
    for (const fn of fns) {
      try {
        await fn();
      } catch (cause) {
        // 不抛 —— 让调用方知道「这条 cleanup 失败了」但不阻塞后续 cleanup。
        console.warn(`[teardown] ${name} failed:`, cause);
      }
    }
  }
}
