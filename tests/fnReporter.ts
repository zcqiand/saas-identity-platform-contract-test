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
import type { Reporter } from "vitest/reporters";
import { readFileSync } from "node:fs";

interface TraceEntry {
  test: string;
  fns: string[];
  inert: boolean;
}

const TRACE_FILE = ".state/trace.json";
const FUNCTION_ID_RE = /\bM\d{2}(?:\.F\d{2}(?:\.I\d{2})?)?\b/g;

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
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").map((c: string) => c.trim());
    if (cells.length < 2) continue;
    const m = FUNCTION_ID_RE.exec(cells[0]);
    if (m && m[0]) ns.add(m[0].slice(0, 2));
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
  async onTaskUpdate(packs: any[]) {
    if (process.env.TRACE_MAP !== "1") return;
    for (const pack of packs) {
      collectTests(pack.tasks ?? []).forEach((t) => this.addEntry(t));
    }
    await this.flush();
  }

  async onFinished(_files?: unknown[]) {
    if (process.env.TRACE_MAP !== "1") return;
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