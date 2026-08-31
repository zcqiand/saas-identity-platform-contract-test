// M96.F02 写端点 teardown —— 共库下避免「下次跑撞上次跑」。
//
// 测试体里 registerCleanup(name, fn)，afterAll 调 runCleanups()。
// 后注册同名 = 覆盖（vitest 同一进程跑多次 describe 时取最后一次的 cleanup）。
// 失败不抛 —— teardown 失败不应掩盖测试断言的失败；记日志由调用方决定。

const cleanups = new Map<string, () => Promise<void>>();

export function registerCleanup(name: string, fn: () => Promise<void>): void {
  cleanups.set(name, fn);
}

export function clearCleanups(): void {
  cleanups.clear();
}

export async function runCleanups(): Promise<void> {
  for (const [name, fn] of cleanups) {
    try {
      await fn();
    } catch (cause) {
      // 不抛 —— 让调用方知道「这条 cleanup 失败了」但不阻塞后续 cleanup。
      console.warn(`[teardown] ${name} failed:`, cause);
    }
  }
}
