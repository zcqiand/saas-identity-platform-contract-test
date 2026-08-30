// M96.F03 探针 —— 打一个目标，拿回 (status, body)。
//
// 用 axios + tough-cookie jar，工作在 HTTP 层而非 fetch 的 CookieStore：
// 因此不受 saas-msw「HttpOnly cookie 在 node fetch 被屏蔽」的限制，无需 debug 导出通道（ADR-0015）。
// maxRedirects: 0 —— 302 链要手动走，Location 的 query 参数是 OAuth 流的断言点。

import axios, { type AxiosInstance } from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

import type { Probe } from "./compare.js";
import type { Target } from "./targets.js";

/** V014/V015 seed + msw fixtures 共有的账号。显式字面量，不走 env 兜底。 */
export const SEED_USER = { username: "alice", password: "dev123456" } as const;

export class UnreachableError extends Error {
  constructor(target: string, cause: unknown) {
    super(`目标 ${target} 连不上 —— 声明了就必须可达。原因: ${String(cause)}`);
  }
}

export function client(target: Target): AxiosInstance {
  const jar = new CookieJar();
  return wrapper(
    axios.create({
      baseURL: target.baseUrl,
      jar,
      withCredentials: true,
      maxRedirects: 0,
      timeout: 8000,
      // 任何状态码都返回，不抛 —— 状态码本身是被比对的对象。
      validateStatus: () => true,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** 登录拿 accessToken。走真实登录路径，顺带覆盖 M03.F01 的契约面。 */
export async function login(target: Target): Promise<string> {
  const http = client(target);
  let res;
  try {
    res = await http.post("/api/v1/auth/login", SEED_USER);
  } catch (cause) {
    throw new UnreachableError(target.name, cause);
  }
  if (res.status !== 200) {
    throw new Error(
      `${target.name}: 登录失败 status=${res.status} body=${JSON.stringify(res.data).slice(0, 300)}`,
    );
  }
  const token = (res.data as { accessToken?: string }).accessToken;
  if (!token) {
    throw new Error(`${target.name}: 登录 200 但响应里没有 accessToken`);
  }
  return token;
}

/** 带 Bearer 打一个 GET，返回可比对的探针。 */
export async function probeGet(target: Target, path: string, token: string): Promise<Probe> {
  const http = client(target);
  try {
    const res = await http.get(path, { headers: { authorization: `Bearer ${token}` } });
    return { target: target.name, status: res.status, body: res.data };
  } catch (cause) {
    throw new UnreachableError(target.name, cause);
  }
}

/** 对一组目标跑同一个 GET。登录各自进行（token 不跨后端复用）。 */
export async function probeAll(targets: readonly Target[], path: string): Promise<Probe[]> {
  const out: Probe[] = [];
  for (const t of targets) {
    const token = await login(t);
    out.push(await probeGet(t, path, token));
  }
  return out;
}

/**
 * M96.F02 探针——method-通用包装。第一批（Tier A 只读）只走 GET，留 method 字段
 * 是为了 Phase 2 写端点不用改名。`method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"`
 * 后续在加写支持时一并实现分支。
 */
export type ProbeMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ProbeRequestOptions {
  readonly method: ProbeMethod;
  readonly path: string;
  readonly token?: string;
  readonly body?: unknown;
}

/** 单目标探针（GET 行为与 probeGet 一致；其他 method 留给 Phase 2 实现）。 */
export async function probeRequest(target: Target, opts: ProbeRequestOptions): Promise<Probe> {
  if (opts.method !== "GET") {
    throw new Error(`probeRequest: method=${opts.method} 还未实现（Phase 2 写端点批次）`);
  }
  return probeGet(target, opts.path, opts.token ?? (await login(target)));
}

/** 对一组目标跑同一个请求（method-通用）。登录各自进行。 */
export async function probeAllRequest(
  targets: readonly Target[],
  opts: Omit<ProbeRequestOptions, "token">,
): Promise<Probe[]> {
  if (opts.method !== "GET") {
    throw new Error(`probeAllRequest: method=${opts.method} 还未实现（Phase 2 写端点批次）`);
  }
  const out: Probe[] = [];
  for (const t of targets) {
    const token = await login(t);
    out.push(await probeGet(t, opts.path, token));
  }
  return out;
}
