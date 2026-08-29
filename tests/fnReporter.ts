// Vitest reporter: collects function IDs from test names and writes .state/trace.json.
//
// 2026-08-29 修复：原版只读 `it()` 的名字（`collectTests` 只收 type==="test" 的任务，
// `addEntry` 用 `t.name`），而本家族 TS 仓的惯例是把功能 ID 写在 `describe()` 上。
// 结果 trace.json 恒为空 —— L5 的「测试引用」检查对这些仓一直是空转的，
// 而 L5 的软告警不阻断，所以没人发现。saas-msw 也中了同一个坑。
//
// 现在沿 suite 链累积祖先名，describe 级与 it 级的 ID 都能抓到。
import type { Reporter } from "vitest/reporters";

interface TraceEntry {
  test: string;
  fns: string[];
  inert: boolean;
}

const TRACE_FILE = ".state/trace.json";

export default class FnReporter implements Partial<Reporter> {
  private entries: TraceEntry[] = [];

  // 必须在 onFinished 收集，不能在 onCollected：收集阶段 task.result 还不存在，
  // `result?.state ?? "pass"` 会把 skip 的测试当成 pass，于是 skip 掉的用例
  // 反而被记成「已覆盖某功能 ID」—— 正是 trace 契约要防的假覆盖。
  async onFinished(files?: any[]) {
    if (process.env.TRACE_MAP !== "1") return;
    this.entries = [];
    for (const file of files ?? []) {
      collectTests(file.tasks || []).forEach((t) => this.addEntry(t));
    }
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(".state", { recursive: true });
    fs.writeFileSync(
      path.resolve(TRACE_FILE),
      JSON.stringify({ schema: 1, tests: this.entries }, null, 2) + "\n",
      "utf-8",
    );
  }

  private addEntry(t: { fullName: string; task: any }) {
    // 祖先 describe 名 + 自身 it 名，一起参与 ID 抽取。
    const fns = extractFns(t.fullName);
    const state = t.task.result?.state;
    const mode = t.task.mode;
    const isInert = state === "skip" || state === "todo" || mode === "skip" || mode === "todo";
    if (fns.length === 0 && !isInert) return;
    // skip/xfail 的测试不许挂功能 ID —— 它没验证任何东西（suite CLAUDE.md 硬规则）。
    this.entries.push({ test: t.fullName, fns: isInert ? [] : fns.sort(), inert: isInert });
  }
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

function extractFns(text: string): string[] {
  if (!text) return [];
  const ids: string[] = [];
  const re = /\bM\d{2}(?:\.F\d{2}(?:\.I\d{2})?)?\b/g;
  let m;
  while ((m = re.exec(text)) !== null) if (!ids.includes(m[0])) ids.push(m[0]);
  return ids;
}
