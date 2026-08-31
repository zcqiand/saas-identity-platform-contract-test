// Vitest reporter: collects function IDs from test names and writes .state/trace.json.
//
// 2026-08-29 修复历史：
//   v1 — 只读 it() 名，丢 describe() 级 ID → trace 恒空
//   v2 — onCollected 阶段取 result.state（还不存在），把 skip 当 pass → 假覆盖
//   v3 — describe 链累积 + onFinished 收集 + 按列取状态（skip/inert 正确）
//   v4 — filter 到「本仓命名空间」。命名空间 = 该仓 function-tree 中出现过的
//        所有 top-level module（`M00` / `M99` 等）。其他 ID 当作描述性引用
//        （如 mock 仓测试名里说「M04.F03 对应 OAuth server mock」），不进 trace，
//        不参与 L5 引用检查 —— 这正是 conventions §7「mock 不镜像业务模块」的
//        测试侧落地。
//   v5 — 完全放弃 onTaskUpdate，改用 onFinished(files: File[]) 走完整任务树。
//        vitest 2.x 的 onTaskUpdate 下发的是 `[id, result, meta]` tuple（不是
//        `{tasks: []}` 对象），且注释明确说「Usually reported after the task
//        finishes」—— `describe.skipIf(!live)` 过滤掉的 inner test 永远收不到。
//        onFinished(files) 的 `files: File[]` 里 `File extends Suite extends TaskBase`，
//        每个 File 自带 `tasks: Task[]`，是 inert 测试的唯二可达路径（另一条是
//        自己从子 worker 拉，对单仓没必要）。这次改彻底切断「收不到 inert」复发路径。
//   v6 — 写 mode + contract_targets 顶层字段，供 harness.load_trace 配合 require_live
//        做 unit 模式硬防御。unit = describe.skipIf(!live) 全跳、trace 全 inert、矩阵空
//        = 假绿；v6 让这一假绿暴露给 harness（ADR-0016）。
//   v7 — A1.5: vitest describe.skipIf(!live) 仅信 env,但 vitest 2.x 在 beforeAll
//        抛 ECONNREFUSED 时会把内层 it() 标 skip（不是 fail）,fnReporter 拿到全 inert
//        但 env 有 CONTRACT_TARGETS → 仍写 mode="live" → A1 防御被绕过。
//        修法: flush 前主动 fetch 4 后端 healthz 并行探测,4 个全活才写 mode="live"。
//        这与 .github/workflows/ci.yml 的 healthcheck 串行探测是同一份真相。
import type { Reporter } from "vitest/reporters";
import type { File } from "@vitest/runner";
import { readFileSync } from "node:fs";

import { TARGETS } from "../src/targets.js";

interface TraceEntry {
  test: string;
  fns: string[];
  inert: boolean;
}

interface TraceFile {
  schema: 1;
  mode: "live" | "unit";
  contract_targets: string[];
  tests: TraceEntry[];
}

// 模块顶层求值 env —— vitest 启动后稳定。
// DECLARED_TARGETS 仅是「声明值」；flush 时 EFFECTIVE_* 由 probeLive() 异步探测决定。
// 与 tests/*.test.ts 里 `describe.skipIf(!live)` 的 `targets.length >= 2` 判定一致，
// 即便 4 后端未起,describe 仍会尝试跑 (beforeAll 抛错 → vitest 内层 skip) —— 这是
// 为什么必须主动探测,不能信 env。
const DECLARED_TARGETS = (process.env.CONTRACT_TARGETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
let EFFECTIVE_MODE: "live" | "unit" = DECLARED_TARGETS.length >= 2 ? "live" : "unit";
let EFFECTIVE_TARGETS: string[] = [...DECLARED_TARGETS];

// 与 .github/workflows/ci.yml 的 healthcheck 路径对齐 —— 真源是 ci.yml,
// 这里镜像,改一处必须同步另一处 (后端自己改 healthz 路径会同时断两边)。
// 注意: 各后端 health endpoint 是后端自己定的, 不是 contract-test 仓能改的:
//   msw        express MapGet("/healthz", ...)
//   aspnetcore ASP.NET Core Minimal API MapGet("/health", ...) (标准约定)
//   springboot Spring Boot Actuator /actuator/health
//   nextjs     ⚠️ 当前未实现 health endpoint (留缺; probe 跳过 nextjs)
const HEALTH_PATHS: Record<string, string> = {
  msw: "/healthz",
  aspnetcore: "/health",
  springboot: "/actuator/health",
  // nextjs: 未实现, 不进 dict — probe 时不探, 跳过
};
const DEFAULT_HEALTH = "/healthz";

const TRACE_FILE = ".state/trace.json";
const FUNCTION_ID_RE = /\bM\d{2}(?:\.F\d{2}(?:\.I\d{2})?)?\b/g;

// 镜像 suite scripts/checks/_alignment.py:44 的 ROW_RE 锚定策略（第一列是 ID）。
// 只取 module 维度（slice(0, 2)），不需要捕获行尾余下 cell——fnReporter 只关心命名空间。
//
// 严禁换成 split('|').map(trim) + cells[N]：
//   "| M96 | ..." split('|') → ["", " M96 ", ...]，cells[0] 必空。cells[N] 任何 N
//   都脆——不同仓的 template ID 列位置可能变。锚定第一列才抗模板漂移。
const ROW_RE = /^\|\s*(M\d{2}(?:\.F\d{2}(?:\.I\d{2})?)?)\s*\|/;

/** 该仓允许的命名空间集合 = 本仓树里出现过的 top-level module。 */
function loadNamespaces(): Set<string> {
  let text: string;
  try {
    text = readFileSync("docs/functions/function-tree.md", "utf-8");
  } catch {
    return new Set(); // 无树 = 仓刚 init，跳过命名空间过滤
  }
  const ns = new Set<string>();
  for (const line of text.split("\n")) {
    const m = ROW_RE.exec(line);
    if (m) ns.add(m[1].slice(0, 2));
  }
  return ns;
}

/** 递归收集测试，沿途累积 describe 链。 */
function collectTests(
  tasks: any[],
  prefix = "",
  out: { fullName: string; task: any }[] = [],
): { fullName: string; task: any }[] {
  for (const t of tasks) {
    if (!t) continue;
    const name = t.name || "";
    const fullName = prefix ? `${prefix} > ${name}` : name;
    if (t.type === "test") out.push({ fullName, task: t });
    else if (t.type === "suite" && t.tasks) collectTests(t.tasks, fullName, out);
  }
  return out;
}

/** A1.5 探活：并行 fetch 4 后端 healthcheck;任一挂 → mode=unit + 清空 contract_targets。 */
async function probeLive(): Promise<void> {
  if (DECLARED_TARGETS.length < 2) {
    EFFECTIVE_MODE = "unit";
    EFFECTIVE_TARGETS = [];
    return;
  }
  const checks = await Promise.all(
    DECLARED_TARGETS.map(async (name) => {
      const target = TARGETS[name];
      if (!target) return { name, ok: false, reason: "unknown target" };
      const path = HEALTH_PATHS[name] ?? DEFAULT_HEALTH;
      const url = `${target.baseUrl}${path}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return { name, ok: res.ok, reason: res.ok ? "" : `HTTP ${res.status}` };
      } catch (cause) {
        return {
          name,
          ok: false,
          reason: cause instanceof Error ? cause.message.split("\n")[0] : String(cause),
        };
      }
    }),
  );
  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    EFFECTIVE_MODE = "live";
    EFFECTIVE_TARGETS = [...DECLARED_TARGETS];
  } else {
    EFFECTIVE_MODE = "unit";
    EFFECTIVE_TARGETS = [];
    // stderr 提示哪个后端挂;harness.load_trace 仍会 raise,但开发者立刻看到原因。
    console.warn(
      `[contract-test] live mode 失效: ${failed.length}/${checks.length} 个 backend healthcheck 失败`,
    );
    for (const f of failed) {
      console.warn(`  - ${f.name}: ${f.reason}`);
    }
  }
}

export default class FnReporter implements Partial<Reporter> {
  private entries: TraceEntry[] = [];
  private namespaces: Set<string> | null = null;

  private addEntry(t: { fullName: string; task: any }) {
    if (!this.namespaces) this.namespaces = loadNamespaces();
    const state = t.task.result?.state;
    const mode = t.task.mode;
    const isInert = state === "skip" || state === "todo" || mode === "skip" || mode === "todo";

    // 仅本仓命名空间的 ID 算 trace。跨命名空间当描述性引用，丢弃。
    const all = extractFns(t.fullName);
    const fns =
      this.namespaces.size === 0 ? [] : all.filter((id) => this.namespaces!.has(id.slice(0, 2)));

    if (fns.length === 0 && !isInert) return;
    this.entries.push({ test: t.fullName, fns: isInert ? [] : fns.sort(), inert: isInert });
  }

  /** 用原型方法定义钩子（vitest 2.x 的 instanceof 检查不接受实例属性箭头函数）。 */
  async onFinished(files: File[], _errors?: unknown[], _coverage?: unknown) {
    if (process.env.TRACE_MAP !== "1") return;
    if (!this.namespaces) this.namespaces = loadNamespaces();
    this.entries = [];
    for (const file of files ?? []) {
      for (const t of collectTests(file.tasks ?? [])) this.addEntry(t);
    }
    await this.flush();
  }

  private async flush() {
    // A1.5: 先探活再写 — DECLARED vs EFFECTIVE 分离就是为了这一步。
    // 4 后端都连得上 → mode="live";否则 mode="unit" + 清空 contract_targets。
    await probeLive();

    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(".state", { recursive: true });
    const out: TraceFile = {
      schema: 1,
      mode: EFFECTIVE_MODE,
      contract_targets: EFFECTIVE_TARGETS,
      tests: this.entries,
    };
    fs.writeFileSync(
      path.resolve(TRACE_FILE),
      JSON.stringify(out, null, 2) + "\n",
      "utf-8",
    );
  }
}

function extractFns(text: string): string[] {
  if (!text) return [];
  const ids: string[] = [];
  const re = new RegExp(FUNCTION_ID_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) if (!ids.includes(m[0])) ids.push(m[0]);
  return ids;
}