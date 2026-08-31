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
import type { Reporter } from "vitest/reporters";
import type { File } from "@vitest/runner";
import { readFileSync } from "node:fs";

interface TraceEntry {
  test: string;
  fns: string[];
  inert: boolean;
}

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
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(".state", { recursive: true });
    fs.writeFileSync(
      path.resolve(TRACE_FILE),
      JSON.stringify({ schema: 1, tests: this.entries }, null, 2) + "\n",
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