// M96.F02 写端点唯一化 —— 共库下避免 UNIQUE(tenant_id, prefix) / 同名碰撞。
//
// 写作 body 字段（如 api-keys.name），让每次跑/target 拿到独立行。
// 长度 cap 80，匹配 nextjs zod validators 上限。

const MAX_LEN = 80;

export function uniqueName(prefix: string): string {
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const raw = `${prefix}-${tag}`;
  return raw.length > MAX_LEN ? raw.slice(0, MAX_LEN) : raw;
}
