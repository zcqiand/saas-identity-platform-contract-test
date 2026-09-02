#!/usr/bin/env node
// L5 检查 —— contract-test 是否 100% 覆盖 shared SSOT 端点。
//
// 硬规则（CLAUDE.md §2）：
//   本仓端点清单 = 同家族 `<family>-shared/tsp/routes/*.tsp` 全集，auto-derive；
//   禁止手挑；SSOT 有但本仓无测试 = L5 红。
//
// 实现：
//   1. 从本仓名（saas-identity-platform-contract-test）解 family → 找同级 `<family>-shared/tsp/routes/`。
//   2. 解析每个 .tsp：
//      - namespace @route 前缀
//      - 每个 op 的 @get/@post/@put/@patch/@delete + 可选 @route override
//      - 上一行的 // M##.F##.I## 注释
//   3. 解析 tests/*.test.ts：
//      - probeRequest(..., { method, path }) 调用
//      - probeAll(targets|selectedTargets(), path) 调用（GET）
//      - describe 标题里 "M96.F##.I## METHOD /path" 模式（兜底）
//   4. diff：SSOT 有但 tests 无 = gap。
//   5. 输出表格；gap > 0 退出 1。
//
// 不去解析 OpenAPI yaml（它是 .tsp 的二次产物，会有 normalization 噪音；
// 直接打 .tsp 与 CLAUDE.md「改端点必先改 SSOT」的入口一致）。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// === 路径定位 ===
const here = dirname(fileURLToPath(import.meta.url));
const ctRoot = dirname(here);
const projectName = basename(ctRoot);
const familyMatch = projectName.match(/^(.+)-contract-test$/);
if (!familyMatch) {
  console.error(`L5 配置错误：${projectName} 不符合 \`<family>-contract-test\` 命名约定`);
  process.exit(2);
}
const family = familyMatch[1];
const sharedDir = join(ctRoot, "..", `${family}-shared`);
if (!existsSync(sharedDir)) {
  console.error(`L5 配置错误：shared 仓不存在：${sharedDir}`);
  process.exit(2);
}
const tspRoutesDir = join(sharedDir, "tsp", "routes");
if (!existsSync(tspRoutesDir)) {
  console.error(`L5 配置错误：shared 仓 ${tspRoutesDir} 不存在`);
  process.exit(2);
}
const testsDir = join(ctRoot, "tests");

// === 1. 解析 shared SSOT ===
/** @typedef {{ method: string, path: string, sharedId: string, nsRoute: string }} SsotEndpoint */

/**
 * 从 .tsp 文件里抽 (namespace @route, ops with method+route+I##)。
 * 处理嵌套大括号（namespace body 内可能有 model X { ... }，但 op 没有嵌套）。
 * @param {string} content
 * @returns {{ nsRoute: string, ops: SsotEndpoint[] }[]}
 */
function parseTspFile(content) {
  const namespaces = [];

  // 滑动窗口找 `namespace ... {`
  let i = 0;
  while (i < content.length) {
    const nsStart = content.indexOf("namespace", i);
    if (nsStart === -1) break;

    // namespace 关键字之前 300 字符内找最近的 @route("...") — namespace 的 @route 属性
    const before = content.slice(Math.max(0, nsStart - 300), nsStart);
    const routeMatches = [...before.matchAll(/@route\(\s*"([^"]+)"\s*\)/g)];
    const nsRoute = routeMatches.length > 0 ? routeMatches[routeMatches.length - 1][1] : "";

    // 找 namespace body 起止 `{` `}`
    const braceStart = content.indexOf("{", nsStart);
    if (braceStart === -1) break;
    let depth = 1;
    let j = braceStart + 1;
    while (j < content.length && depth > 0) {
      const ch = content[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    const body = content.slice(braceStart + 1, j - 1);

    namespaces.push({ nsRoute, body });
    i = j;
  }

  // 在每个 namespace body 里找 op 声明 + 跟踪最近的 // M##.F##.I## 注释
  const result = [];
  for (const ns of namespaces) {
    /** @type {SsotEndpoint[]} */
    const ops = [];
    // TypeSpec 的 op 声明可跨多行（@get / @route / op 各占一行）；
    // 按行扫描，用 pendingMethod/pendingRoute 状态机把它们粘合。
    const lines = ns.body.split(/\r?\n/);
    let currentId = "";
    let pendingMethod = "";
    let pendingRoute = "";
    for (const line of lines) {
      // 1. 跟踪最近的功能 ID 注释
      const idMatch = line.match(/\/\/\s*(M\d+\.F\d+\.I\d+)/);
      if (idMatch) {
        currentId = idMatch[1];
        continue;
      }
      // 2. op-level @method
      const methodMatch = line.match(/@(get|post|put|patch|delete)\b/);
      if (methodMatch) {
        pendingMethod = methodMatch[1].toUpperCase();
        pendingRoute = ""; // 新 method 开始，丢弃上一个 op 的 route override
        continue;
      }
      // 3. op-level @route override（仅在 @method 之后才采纳）
      const routeMatch = line.match(/@route\(\s*"([^"]+)"\s*\)/);
      if (routeMatch && pendingMethod) {
        pendingRoute = routeMatch[1];
        continue;
      }
      // 4. op 关键字：合并 + emit
      if (/\bop\s+\w+\s*\(/.test(line) && pendingMethod) {
        ops.push({
          method: pendingMethod,
          path: ns.nsRoute + pendingRoute,
          sharedId: currentId || "(no I## comment)",
          nsRoute: ns.nsRoute,
        });
        pendingMethod = "";
        pendingRoute = "";
        currentId = "";
      }
    }
    result.push({ nsRoute: ns.nsRoute, ops });
  }
  return result;
}

/** @returns {SsotEndpoint[]} */
function parseShared(sharedDir) {
  const files = readdirSync(tspRoutesDir).filter((f) => f.endsWith(".tsp")).sort();
  /** @type {SsotEndpoint[]} */
  const ssot = [];
  for (const file of files) {
    const content = readFileSync(join(tspRoutesDir, file), "utf8");
    const namespaces = parseTspFile(content);
    for (const ns of namespaces) {
      for (const op of ns.ops) {
        ssot.push({ ...op, _file: file });
      }
    }
  }
  return ssot;
}

// === 2. 解析 tests ===
/** @typedef {{ method: string, path: string }} TestEndpoint */

/** 去掉前后引号/反引号与模板占位 `${...}` */
function unquote(raw) {
  let s = raw.replace(/^["'`]|["'`]$/g, "");
  // ${PATH} 这种 template interpolation 在源码里是字面 ${PATH}，
  // 不替换也无妨（与 SSOT 不会字面相等）—— SSOT 端点的 path 通常也不含 ${}。
  return s;
}

/** @returns {TestEndpoint[]} */
function parseTests(testsDir) {
  if (!existsSync(testsDir)) return [];
  const files = readdirSync(testsDir).filter((f) => f.endsWith(".test.ts")).sort();
  /** @type {TestEndpoint[]} */
  const out = [];

  for (const file of files) {
    const content = readFileSync(join(testsDir, file), "utf8");

    // 1. 收集 path 常量（resolve describe 标题里的 ${PATH} / ${BASE_PATH}）
    const constMap = /** @type {Record<string, string>} */ ({});
    let m;
    const strRe = /const\s+(\w+)\s*=\s*"([^"]+)"/g;
    while ((m = strRe.exec(content)) !== null) constMap[m[1]] = m[2];
    const pwRe = /const\s+(\w+)\s*=\s*pathWithParams\(\s*"([^"]+)"/g;
    while ((m = pwRe.exec(content)) !== null) constMap[m[1]] = m[2];

    // 2. describe.skipIf 标题 = 端点的「声明处」。两种形式：
    //    Type 1: M96.F02.I04 GET /api/v1/me 四方比对  （method+path 字面）
    //    Type 2: M96.F02.I03 ${PATH} 四方比对         （仅 path 通过 const 引用，method 缺省 GET）
    const titleRe = /describe\.skipIf\([^)]*\)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
    while ((m = titleRe.exec(content)) !== null) {
      const title = m[1];
      const t1 = title.match(
        /^(?:M\d+\.F\d+\.I\d+|M96\.F\d+\.I\d+)\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+四方比对\s*$/,
      );
      if (t1) {
        out.push({ method: t1[1], path: t1[2] });
        continue;
      }
      const t2 = title.match(
        /^(?:M\d+\.F\d+\.I\d+|M96\.F\d+\.I\d+)\s+\$\{(\w+)\}\s+四方比对\s*$/,
      );
      if (t2) {
        const resolved = constMap[t2[1]];
        if (resolved) out.push({ method: "GET", path: resolved });
      }
    }
  }

  // dedupe
  const seen = new Set();
  return out.filter((t) => {
    const k = `${t.method} ${t.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// === 3. 路径归一化 + 比对 ===

/** 把 `/api/v1/tenants/abc-123/users/def-456` 与 `/api/v1/tenants/{tenantId}/users/{userId}`
 *  归一为 `/tenants/{*}/users/{*}` 这种模板形式（去前缀 + 把 UUID 段也归一为 {*}） */
function normalize(p) {
  return p
    .replace(/^\/api\/v1/, "") // 去 /api/v1 前缀
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/{*}") // UUID 段
    .replace(/\{[^}]+\}/g, "{*}"); // 显式 param 段
}

/** @param {SsotEndpoint} s
 *  @param {TestEndpoint[]} tests */
function isCovered(s, tests) {
  const wantNorm = normalize(s.path);
  return tests.some((t) => t.method === s.method && normalize(t.path) === wantNorm);
}

// === 4. 报告 + 退出码 ===

/** @param {SsotEndpoint[]} ssot
 *  @param {TestEndpoint[]} tests */
function check(ssot, tests) {
  const covered = [];
  const gaps = [];
  for (const s of ssot) {
    (isCovered(s, tests) ? covered : gaps).push(s);
  }
  return { covered, gaps };
}

function printReport(family, ssot, covered, gaps) {
  const W = process.stdout.columns ?? 100;
  const line = (s) => s.padEnd(W).slice(0, W);

  console.log(
    line(
      `L5 SSOT 覆盖检查 — family=${family} | shared SSOT=${ssot.length} | covered=${covered.length} | gaps=${gaps.length}`,
    ),
  );
  console.log(line("─".repeat(W - 1)));

  if (gaps.length === 0) {
    console.log(line("✅ contract-test 100% 覆盖 shared SSOT 全部端点"));
    return;
  }

  console.log(line(`❌ ${gaps.length} 个 SSOT 端点 contract-test 没覆盖：`));
  for (const g of gaps) {
    console.log(
      line(
        `   [${g.method.padEnd(6)}] ${g.path.padEnd(60)} ${g.sharedId}   (${g._file ?? "?"})`,
      ),
    );
  }
  console.log(line(""));
  console.log(
    line(
      "→ 在 tests/ 下补 *.test.ts：参考 me-tenants.test.ts / apps-public.test.ts 模板，",
    ),
  );
  console.log(
    line(
      "  用 probeRequest(probeAll) + compareAll + normalize 把 SSOT 端点接进四方比对。",
    ),
  );
}

const ssot = parseShared(sharedDir);
const tests = parseTests(testsDir);

const { covered, gaps } = check(ssot, tests);

printReport(family, ssot, covered, gaps);

process.exit(gaps.length === 0 ? 0 : 1);
