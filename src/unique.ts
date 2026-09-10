// M96.F02 写端点唯一化 —— 共库下避免 UNIQUE(tenant_id, prefix) / 同名碰撞。
//
// 写作 body 字段（如 api-keys.name），让每次跑/target 拿到独立行。
// 长度 cap 80，匹配 nextjs zod validators 上限。
//
// 2026-09-10 修复：原 `${Date.now()}-${Math.random().slice(2,8)}` 在同毫秒并发
// Promise.all(targets.map(probeRequest)) 时 4 后端拿同一 timestamp 段
// （Promise.all 同步发起 HTTP 时间差 <1ms），Math.random 又被某两次同进位，
// 4 后端创出相同 clientId 撞 oauth_client_client_id_key unique 23505。
// 改 Date.now 用 `performance.now()` 微秒精度 + Math.random 8 字符 → tag
// 维度足够散列，4 target 同步发也几乎不重。

const MAX_LEN = 80;

export function uniqueName(prefix: string): string {
  const ms = Math.floor(performance.now() * 1000).toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  const tag = `${ms}-${rand}`;
  const raw = `${prefix}-${tag}`;
  return raw.length > MAX_LEN ? raw.slice(0, MAX_LEN) : raw;
}