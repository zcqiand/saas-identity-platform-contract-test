// 池项 5.12（2026-09-19 用户裁定）：探活重试原语。
//
// 背景（Task 2.3 实证 + ledger L115）：45% 丢包窗口里 live gate 连续 4 轮假红——
// fnReporter probeLive 单发 fetch 3s 硬超时，一抖就判死 → trace 写歪 mode=unit。
// 裁定：**重试 + 自适应超时**——N 次尝试（2-3 次）+ 指数退避 + 单次超时 10s 封顶，
// **全部尝试失败才判死**；判死时逐次留痕耗时与失败原因（可诊断性是裁定的一半）。
//
// 仓内两处同根调用方（DRY 统一走本原语）：
//   - tests/fnReporter.ts probeLive（mode 判定前的 live 探活）
//   - src/prewarm.ts waitHealthy（live 冷启动预热轮询）
// 两者调用形状不同（一个「3 次 + 退避」定长；一个「预算内轮询」变长），故 prewarm
// 只复用 probeOnce 单针原语，定长重试用 probeWithRetry —— 薄分层，不过度抽象。
//
// 实现注记：
//   - 超时用 setTimeout + AbortController 双保险：真 fetch 收 abort 即断；但注入的
//     假 fetch / 半开后端黑洞 socket 可能无视 signal，Promise.race 的 guard 侧保证
//     probeOnce 必然落定（prewarm 的 deadline 语义才盖得住）。
//   - 不用 AbortSignal.timeout(3s)（原实现）：它走原生定时器，假定时器测试推不动，
//     且单发不可重试。
//   - 全部 setTimeout 走虚拟时钟 → 单测用 vi.useFakeTimers 秒级快进，无需真等待。

export interface ProbeAttempt {
  /** HTTP 2xx = true；超时/网络错/非 2xx 一律 false。 */
  ok: boolean;
  /** 本次尝试耗时（ms，含超时上限内的全部等待）。 */
  durationMs: number;
  /** 成功为空串；失败为「HTTP <status> / timeout>Nms / 网络 or 注入错误首行」。 */
  reason: string;
}

export interface ProbeResult {
  ok: boolean;
  /** 全部尝试逐次留痕（裁定要求的证据链）。 */
  attempts: ProbeAttempt[];
  /** 成功为空串；判死为带尝试计数 + 各次耗时与原因的汇总串。 */
  reason: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_ATTEMPTS = 3;
/** 单次超时上限（裁定：从 3s 提到 10s 封顶）。 */
const DEFAULT_TIMEOUT_MS = 10_000;
/** 指数退避（裁定建议 1s/2s；第 i 次重试前等 backoffMs[min(i-1, len-1)]）。 */
const DEFAULT_BACKOFF_MS: readonly number[] = [1_000, 2_000];

/** 运行时取全局 fetch（间接一层：vi.stubGlobal 的注入在调用时才生效）。 */
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

function failReason(cause: unknown): string {
  return cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
}

/** 单次探针：永不 throw，失败转成 ok=false + reason（调用方零 try/catch）。 */
export async function probeOnce(
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike = defaultFetch,
): Promise<ProbeAttempt> {
  const startedAt = Date.now();
  let timedOut = false;
  let rejectGuard!: (cause: Error) => void;
  const guard = new Promise<never>((_, reject) => {
    rejectGuard = reject;
  });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectGuard(new Error(`timeout>${timeoutMs}ms`));
  }, timeoutMs);
  try {
    const pending = fetchImpl(url, { signal: controller.signal });
    pending.catch(() => {}); // 超时侧胜出后，慢输家的 rejection 不做 unhandled
    const res = await Promise.race([pending, guard]);
    // 判活 = HTTP 2xx（status 区间；与 prewarm 原语义一致，真实 Response 与 res.ok 等价）
    const status = Number(res.status);
    const ok = Number.isFinite(status) && status >= 200 && status < 300;
    return { ok, durationMs: Date.now() - startedAt, reason: ok ? "" : `HTTP ${res.status}` };
  } catch (cause) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      reason: timedOut ? `timeout>${timeoutMs}ms` : failReason(cause),
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface ProbeWithRetryOptions {
  url: string;
  /** 总尝试次数（含首次），默认 3。 */
  attempts?: number;
  /** 单次超时，默认 10s 封顶。 */
  timeoutMs?: number;
  /** 重试前等待序列，默认 [1s, 2s] 指数退避。 */
  backoffMs?: readonly number[];
  fetchImpl?: FetchLike;
}

/** 定长重试探活：任一次成功即判活；全部尝试失败才判死并携带逐次证据。 */
export async function probeWithRetry(opts: ProbeWithRetryOptions): Promise<ProbeResult> {
  const total = opts.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const attempts: ProbeAttempt[] = [];
  for (let i = 0; i < total; i++) {
    if (i > 0) {
      const wait = backoff[Math.min(i - 1, backoff.length - 1)];
      await new Promise((r) => setTimeout(r, wait));
    }
    const attempt = await probeOnce(opts.url, timeoutMs, fetchImpl);
    attempts.push(attempt);
    if (attempt.ok) return { ok: true, attempts, reason: "" };
  }
  return {
    ok: false,
    attempts,
    reason:
      `${total}/${total} 次探针失败: ` +
      attempts.map((a, i) => `#${i + 1} ${a.durationMs}ms ${a.reason}`).join("; "),
  };
}
