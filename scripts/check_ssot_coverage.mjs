#!/usr/bin/env node
// L5 检查 —— contract-test 是否 100% 覆盖 shared SSOT 端点 + SSOT 是否单向唯一。
//
// 硬规则（CLAUDE.md §2）：
//   本仓端点清单 = 同家族 `<family>-shared/tsp/routes/*.tsp` 全集，auto-derive；
//   禁止手挑；SSOT 有但本仓无测试 = L5 红。
//
// 四节检查（TypeSpec SSOT 清理 Phase D1，2026-09-17）：
//   §1 forward  —— 契约有但没测（原有检查，逻辑不变）：
//      1. 从本仓名解 family → 找同级 `<family>-shared/tsp/routes/`。
//      2. 解析每个 .tsp：namespace @route 前缀 + 每个 op 的 @method + @route override
//         + 上一行的 // M##.F##.I## 注释。
//      3. 解析 tests/*.test.ts：describe.skipIf 标题 "M##.F##.I## METHOD /path" 模式。
//      4. diff：SSOT 有但 tests 无 = gap。
//   §2 reverse —— 消费后端多实现的私生端点（2026-09-17 审计盲区 1+2）：
//      nextjs route.ts / aspnetcore Route 特性 / springboot @*Mapping 注解
//      ↔ shared generated/openapi/openapi.yaml paths 比对，多实现即 FAIL。
//   §3 marker —— 各消费仓 .state/last-gen-shared.json 的 api_synced_sha
//      ↔ shared `git rev-parse HEAD`，过期即 FAIL（生成物过期盲区）。
//   §4 sdk-warn —— 三前端 src/api 下（排除 endpoints/ 生成目录）手写
//      axios 实例 / API_ROUTES 映射表模式，命中 WARN 不 FAIL。
//
// §1 依旧不解析 OpenAPI yaml 打 forward（它是 .tsp 的二次产物，有 normalization 噪音；
// 直接打 .tsp 与「改端点必先改 SSOT」入口一致）。§2 reverse 是另一回事：比对对象是
// 「后端实际实现」而非「测试声明」，此时 openapi.yaml 是 generated 侧的唯一机器可读
// 全集，故最小解析其 paths: 段（行解析器，不引入 yaml 依赖）。
//
// 用法：node scripts/check_ssot_coverage.mjs [--forward-only]
//   默认跑全部四节；--forward-only 只跑 §1（兼容旧调用方）。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename, dirname, relative } from "node:path";
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

// ══════════════════════════════════════════════════════════════════════
// §2 reverse —— 消费后端私生端点扫描（Phase D1）
// ══════════════════════════════════════════════════════════════════════

// --- 家族参数化：lab 与 saas 的差异全部收敛在这里，脚本本体两仓同构 ---
const BACKEND_SUFFIXES = ["nextjs", "aspnetcore", "springboot"];
const FRONTEND_SUFFIXES = ["react", "vue", "nextjs"]; // nextjs 既是前端也是后端
const repoOf = (suffix) => join(ctRoot, "..", `${family}-${suffix}`);

const openapiYaml = join(sharedDir, "generated", "openapi", "openapi.yaml");

// infra 白名单（ADR-0034 §Decision 3「infra 路径前缀自然豁免」；
// lab-shared _exempt.tsp 已废除清单式豁免，此处是算法内置的 infra 前缀）：
//   /health(z)（含 /api、/api/v1 前缀形态）、/actuator/**、/oauth/**
function isInfraWhitelisted(p) {
  const stripped = p.replace(/^\/api(\/v1)?/, "");
  return (
    /^\/healthz?$/.test(stripped) ||
    /^\/actuator(\/|$)/.test(stripped) ||
    /^\/oauth(\/|$)/.test(stripped)
  );
}

/** reverse 专用归一化（不依赖 §1 的 normalize：那条 saas/lab 变体各自演化） */
function normalizeReverse(p) {
  return p
    .replace(/^\/api(\/v1)?/, "")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/{*}")
    .replace(/\{[^}]+\}/g, "{*}");
}

/** 递归收集文件（filter 收 basename；skipDir 跳过目录名） */
function listFiles(rootDir, filter, skipDirs = []) {
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!skipDirs.includes(ent.name)) walk(abs);
      } else if (filter(ent.name)) {
        out.push(abs);
      }
    }
  };
  walk(rootDir);
  return out.sort();
}

// --- openapi.yaml paths: 段的最小行解析器（无 yaml 依赖，见文件头注释） ---
/** @returns {{ method: string, path: string }[]} */
function parseOpenApiPaths(yamlFile) {
  const lines = readFileSync(yamlFile, "utf8").split(/\r?\n/);
  /** @type {{ method: string, path: string }[]} */
  const out = [];
  let inPaths = false;
  let currentPath = "";
  for (const line of lines) {
    if (!inPaths) {
      if (/^paths:\s*$/.test(line)) inPaths = true;
      continue;
    }
    // 顶格 key（components: 等）→ paths 段结束
    if (/^\S/.test(line)) {
      inPaths = false;
      continue;
    }
    // 2 空格缩进的 path key：`  /api/xxx:`
    const pm = line.match(/^ {2}(\/[^:\s]+):\s*$/);
    if (pm) {
      currentPath = pm[1];
      continue;
    }
    // 2 空格缩进的非 path key（理论不该出现在 paths: 内，防御性退出）
    if (/^ {2}\S/.test(line)) {
      inPaths = false;
      continue;
    }
    // 4 空格缩进的 http method key（更深的 operationId/parameters 不会误中）
    const mm = line.match(/^ {4}(get|post|put|patch|delete):\s*$/);
    if (mm && currentPath) out.push({ method: mm[1].toUpperCase(), path: currentPath });
  }
  return out;
}

// --- nextjs：src/app/api/**/route.ts 目录路径 → 端点 ---
/** @returns {{ endpoints: {method:string,path:string,file:string}[], scanned: number }} */
function scanNextjsRoutes(repoDir) {
  const apiRoot = join(repoDir, "src", "app", "api");
  if (!existsSync(apiRoot)) return { endpoints: [], scanned: 0 };
  const files = listFiles(apiRoot, (f) => f === "route.ts");
  /** @type {{ method: string, path: string, file: string }[]} */
  const endpoints = [];
  for (const abs of files) {
    const rel = relative(apiRoot, dirname(abs)).split(/[\\/]/);
    const segs = rel.filter((s) => s && s !== "." && !/^\(.*\)$/.test(s)); // 跳过 route group
    const path =
      "/api/" +
      segs
        .map((s) =>
          s.startsWith("[...") ? "{*}" : s.replace(/^\[(.+)\]$/, "{$1}"), // [id] → {id}
        )
        .join("/");
    const content = readFileSync(abs, "utf8");
    // 只认 HTTP 动词命名的 export（route 文件里的辅助导出如 serviceLogin 不算端点）
    const verbs = new Set();
    for (const m of content.matchAll(
      /^export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/gm,
    )) {
      verbs.add(m[1]);
    }
    for (const v of verbs) endpoints.push({ method: v, path, file: abs });
  }
  return { endpoints, scanned: files.length };
}

// --- aspnetcore：src/Controllers/**/*.cs 的 Route/Http 特性 ---
// 生成物形态（NSwag split 产物，两家族一致）：
//   [Microsoft.AspNetCore.Mvc.HttpGet, Microsoft.AspNetCore.Mvc.Route("api/xxx")]
// 兼容短形式 [HttpGet("tpl")] / [Route] 在邻近行（类级前缀）的组合。
/** @returns {{ endpoints: {...}[], scanned: number, unparsed: string[] }} */
function scanAspnetRoutes(repoDir) {
  const ctrlRoot = join(repoDir, "src", "Controllers");
  if (!existsSync(ctrlRoot)) return { endpoints: [], scanned: 0, unparsed: [] };
  const files = listFiles(ctrlRoot, (f) => f.endsWith(".cs"));
  /** @type {{ method: string, path: string, file: string }[]} */
  const endpoints = [];
  /** @type {string[]} */
  const unparsed = [];
  for (const abs of files) {
    const lines = readFileSync(abs, "utf8").split(/\r?\n/);
    let lastRoute = "";
    let lastRouteLine = -10;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 不锚定 '['：生成物是组合特性 `[HttpGet, Route("...")]`，Route 前面是 ", " 不是 '['
      const r = line.match(/(?:Microsoft\.AspNetCore\.Mvc\.)?Route\(\s*"([^"]*)"\s*\)/);
      if (r) {
        lastRoute = r[1];
        lastRouteLine = i;
      }
      const h = line.match(
        /(?:\[\s*)?(?:Microsoft\.AspNetCore\.Mvc\.)?Http(Get|Post|Put|Delete|Patch)\b(?:\(\s*"([^"]*)"\s*\))?/,
      );
      if (!h) continue;
      // 模板优先级：Http 特性内联 > 同行 Route > 邻近 3 行内 Route（类级前缀场景）
      let tpl = h[2] ?? "";
      if (!tpl && (lastRouteLine === i || i - lastRouteLine <= 3)) tpl = lastRoute;
      if (!tpl || tpl.includes("[")) {
        // 空/含 [controller] 类 token：不猜，报 unparsed（避免漏报也不误报）
        unparsed.push(`${relative(repoDir, abs)}:${i + 1} [Http${h[1]}] tpl="${tpl}"`);
        continue;
      }
      const path = tpl.startsWith("/") || tpl.startsWith("~") ? tpl.replace(/^~/, "") : `/${tpl}`;
      endpoints.push({ method: h[1].toUpperCase(), path, file: abs });
    }
  }
  return { endpoints, scanned: files.length, unparsed };
}

// --- springboot：@*Mapping 注解（shared/api 生成接口 + 手写 @RestController） ---
// 生成物形态（openapi-generator SpringCodegen，两家族一致）：
//   String PATH_RECEIPTS_CREATE_RECEIPT = "/api/receipts";   ← 常量表
//   @RequestMapping(method = RequestMethod.POST, value = ReceiptsApi.PATH_RECEIPTS_CREATE_RECEIPT, ...)
// 手写控制器实现生成接口时注解在接口上，自有私生端点必然自带 @*Mapping —— 两处都扫。
/** @returns {{ endpoints: {...}[], scanned: number, unparsed: string[] }} */
function scanSpringRoutes(repoDir) {
  const javaRoot = join(repoDir, "src", "main", "java");
  if (!existsSync(javaRoot)) return { endpoints: [], scanned: 0, unparsed: [] };
  const files = listFiles(javaRoot, (f) => f.endsWith(".java"));
  /** @type {{ method: string, path: string, file: string }[]} */
  const endpoints = [];
  /** @type {string[]} */
  const unparsed = [];
  let scanned = 0;
  for (const abs of files) {
    const content = readFileSync(abs, "utf8");
    const isGenApi = /[\\/]shared[\\/]api[\\/]/.test(abs);
    const isController = /@(?:RestController|Controller)\b/.test(content); // \b 不吃 @ControllerAdvice
    if (!isGenApi && !isController) continue;
    scanned++;

    // 常量表：String PATH_Xxx = "/api/..."
    /** @type {Record<string, string>} */
    const consts = {};
    for (const m of content.matchAll(/String\s+([A-Z0-9_]+)\s*=\s*"([^"]+)"/g)) consts[m[1]] = m[2];

    // 类级 @RequestMapping 前缀（生成接口目前没有；手写控制器若有则拼接）
    const classDecl = content.search(/public\s+(?:interface|class)\s/);
    let classPrefix = "";
    if (classDecl > 0) {
      const head = content.slice(0, classDecl);
      const cm = head.match(/@RequestMapping\s*\(([^)]*)\)/);
      if (cm) {
        const v = cm[1].match(/(?:value|path)\s*=\s*("[^"]*"|\w+)/) ?? [];
        if (v[1]) classPrefix = v[1].replace(/^"|"$/g, "");
      }
    }

    // 解析注解实参里的路径表达式（字面量 / 常量引用 / 数组）
    const resolveTpl = (expr) => {
      let e = expr.trim();
      if (e.startsWith("{")) e = e.slice(1, -1).split(",")[0].trim(); // 数组取首元素
      if (!e) return "";
      const lit = e.match(/^"([^"]*)"$/);
      if (lit) return lit[1];
      const name = e.split(".").pop() ?? ""; // ReceiptsApi.PATH_X → PATH_X
      return consts[name] ?? "";
    };

    // 读出 startIdx（指向 '('）的平衡括号实参文本
    const readBalancedArgs = (startIdx) => {
      let depth = 0;
      let end = startIdx;
      for (; end < content.length; end++) {
        if (content[end] === "(") depth++;
        else if (content[end] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      return content.slice(startIdx + 1, end);
    };

    for (const m of content.matchAll(/@(Get|Post|Put|Delete|Patch)Mapping\b\s*\(/g)) {
      const method = m[1].toUpperCase();
      const args = readBalancedArgs(m.index + m[0].length - 1);
      const direct = args.match(/^\s*("[^"]*"|\w+(?:\.\w+)*)\s*[,)]/); // @GetMapping("/x") 简写
      const kv = args.match(/(?:value|path)\s*=\s*("[^"]*"|\w+(?:\.\w+)*)/);
      const tpl = resolveTpl(direct?.[1] ?? kv?.[1] ?? "");
      if (!tpl) {
        unparsed.push(`${relative(repoDir, abs)} @${m[1]}Mapping tpl=""`);
        continue;
      }
      const path = tpl.startsWith("/")
        ? tpl
        : classPrefix
          ? `${classPrefix.replace(/\/$/, "")}/${tpl}`
          : "";
      if (!path) {
        unparsed.push(`${relative(repoDir, abs)} @${m[1]}Mapping 相对路径且无类级前缀 "${tpl}"`);
        continue;
      }
      endpoints.push({ method, path, file: abs });
    }

    // @RequestMapping(method = RequestMethod.X, value = ...) 形式（生成接口用的就是这个）
    for (const m of content.matchAll(/@RequestMapping\s*\(/g)) {
      const start = m.index + m[0].length - 1; // 指向 '('
      let depth = 0;
      let end = start;
      for (; end < content.length; end++) {
        if (content[end] === "(") depth++;
        else if (content[end] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      const args = content.slice(start + 1, end);
      const mm = args.match(/RequestMethod\.(\w+)/);
      if (!mm) continue; // 无 method 的（类级）已在上面处理
      const method = mm[1].toUpperCase();
      const kv = args.match(/(?:value|path)\s*=\s*("[^"]*"|\w+(?:\.\w+)*)/);
      const tpl = resolveTpl(kv?.[1] ?? "");
      if (!tpl) {
        unparsed.push(`${relative(repoDir, abs)} @RequestMapping ${method} tpl=""`);
        continue;
      }
      const path = tpl.startsWith("/")
        ? tpl
        : classPrefix
          ? `${classPrefix.replace(/\/$/, "")}/${tpl}`
          : "";
      if (!path) {
        unparsed.push(`${relative(repoDir, abs)} @RequestMapping ${method} 相对路径且无类级前缀 "${tpl}"`);
        continue;
      }
      endpoints.push({ method, path, file: abs });
    }
  }
  return { endpoints, scanned, unparsed };
}

// --- reverse 主流程 ---
function runReverse() {
  if (!existsSync(openapiYaml)) {
    console.error(`L5 配置错误：shared openapi.yaml 不存在：${openapiYaml}（先 npm run emit:openapi）`);
    process.exit(2);
  }
  const contract = parseOpenApiPaths(openapiYaml);
  const contractKeys = new Set(contract.map((c) => `${c.method} ${normalizeReverse(c.path)}`));

  console.log("");
  console.log(`── §2 reverse 端点扫描（私生端点 = 后端实现但 shared openapi.yaml 无）──`);
  console.log(`   契约基准：generated/openapi/openapi.yaml paths=${contract.length} (method×path=${contractKeys.size})`);

  /** @type {{ repo: string, method: string, path: string, file: string }[]} */
  const extras = [];
  for (const suffix of BACKEND_SUFFIXES) {
    const repoDir = repoOf(suffix);
    if (!existsSync(repoDir)) {
      console.log(`   [${suffix.padEnd(11)}] 仓不存在，跳过`);
      continue;
    }
    const r =
      suffix === "nextjs"
        ? scanNextjsRoutes(repoDir)
        : suffix === "aspnetcore"
          ? scanAspnetRoutes(repoDir)
          : scanSpringRoutes(repoDir);
    let whitelisted = 0;
    for (const ep of r.endpoints) {
      if (isInfraWhitelisted(ep.path)) {
        whitelisted++;
        continue;
      }
      if (!contractKeys.has(`${ep.method} ${normalizeReverse(ep.path)}`)) {
        extras.push({ repo: suffix, ...ep });
      }
    }
    const unparsedNote = r.unparsed?.length ? `，unparsed=${r.unparsed.length}` : "";
    console.log(
      `   [${suffix.padEnd(11)}] 扫描 ${r.scanned} 文件 / ${r.endpoints.length} 端点，白名单豁免 ${whitelisted}${unparsedNote}`,
    );
    for (const u of r.unparsed ?? []) console.log(`      ⚠ 未解析（人工确认）：${u}`);
  }

  if (extras.length === 0) {
    console.log(`✅ 消费后端无私生端点（nextjs/aspnetcore/springboot ↔ openapi.yaml 全对齐）`);
  } else {
    console.log(`❌ ${extras.length} 个私生端点（后端实现但契约无）：`);
    for (const e of extras) {
      console.log(`   [${e.method.padEnd(6)}] ${e.path.padEnd(60)} ${e.repo} ${relative(repoOf(e.repo), e.file)}`);
    }
    console.log(`   → 端点必须先落 shared .tsp（SSOT），再 regen 消费仓；禁止消费仓私生 /api/** 端点。`);
  }
  return { extras };
}

// ══════════════════════════════════════════════════════════════════════
// §3 marker —— 生成物新鲜度（.state/last-gen-shared.json ↔ shared HEAD）
// ══════════════════════════════════════════════════════════════════════

function runMarker() {
  console.log("");
  console.log(`── §3 gen-shared marker 新鲜度（api_synced_sha ↔ shared HEAD）──`);

  let sharedHead = "";
  try {
    sharedHead = execSync(`git -C "${sharedDir}" rev-parse HEAD`, { encoding: "utf8" }).trim();
  } catch {
    console.error(`L5 配置错误：git rev-parse 失败（shared 仓不是 git 仓？）：${sharedDir}`);
    process.exit(2);
  }
  console.log(`   shared HEAD = ${sharedHead.slice(0, 12)}`);

  /** @type {{ repo: string, problem: string }[]} */
  const failures = [];
  for (const suffix of [...new Set([...BACKEND_SUFFIXES, ...FRONTEND_SUFFIXES])]) {
    const repoDir = repoOf(suffix);
    const markerFile = join(repoDir, ".state", "last-gen-shared.json");
    if (!existsSync(repoDir) || !existsSync(markerFile)) {
      failures.push({ repo: suffix, problem: "marker 缺失（未跑过 gen-shared）" });
      console.log(`   [${suffix.padEnd(11)}] ❌ marker 缺失`);
      continue;
    }
    let sha = "";
    try {
      const j = JSON.parse(readFileSync(markerFile, "utf8"));
      sha = j.api_synced_sha ?? j.api_synced ?? "";
    } catch {
      failures.push({ repo: suffix, problem: "marker JSON 解析失败" });
      continue;
    }
    if (sha === sharedHead) {
      console.log(`   [${suffix.padEnd(11)}] ✓ ${sha.slice(0, 12)}`);
    } else {
      let behind = "";
      if (sha) {
        try {
          behind = execSync(`git -C "${sharedDir}" rev-list --count ${sha}..HEAD`, {
            encoding: "utf8",
          }).trim();
          behind = `，落后 HEAD ${behind} commit`;
        } catch {
          behind = "（sha 不在当前分支历史内）";
        }
      }
      failures.push({ repo: suffix, problem: `api_synced_sha=${sha || "(空)"}${behind}` });
      console.log(`   [${suffix.padEnd(11)}] ❌ ${sha || "(空)"}${behind}`);
    }
  }

  if (failures.length > 0) {
    console.log(`   → 在过期仓重跑 gen-shared（orval/NSwag/openapi-generator 任一）刷 marker 到 shared HEAD。`);
  } else {
    console.log(`✅ 五个消费仓 marker 全部刷到 shared HEAD`);
  }
  return { failures };
}

// ══════════════════════════════════════════════════════════════════════
// §4 sdk-warn —— 手写 SDK 层告警（WARN 不 FAIL）
// ══════════════════════════════════════════════════════════════════════

function runSdkWarn() {
  console.log("");
  console.log(`── §4 手写 SDK 层告警（WARN 不阻断；SDK/类型应全部走生成物）──`);
  /** @type {{ repo: string, file: string }[]} */
  const warnings = [];
  for (const suffix of FRONTEND_SUFFIXES) {
    const apiDir = join(repoOf(suffix), "src", "api");
    if (!existsSync(apiDir)) continue;
    // 排除 endpoints/ 生成目录；mutator/ 是 orval 定制点（无 axios 实例 + 映射表组合，不排除也命中不了）
    const files = listFiles(apiDir, (f) => /\.(ts|tsx|js)$/.test(f), ["endpoints"]);
    for (const abs of files) {
      const content = readFileSync(abs, "utf8");
      const hasAxiosInstance = /axios\.create\s*\(/.test(content);
      const hasRouteMap =
        /(?:const|let|var)\s+\w*ROUTES\w*\s*=\s*\{/.test(content) &&
        // 对象体里至少 3 条 "...": "/..." 字面量（排除只有一个字段的巧合命中）
        (content.match(/["'`][^"'`\n]+["'`]\s*:\s*["']\/[^"'\n]+["']/g) ?? []).length >= 3;
      // 两个信号独立告警：vue 的 legacy-client 不 axios.create（用默认实例 + 拦截器），
      // 只有映射表；endpoints/ 生成目录已排除，生成物不会定义 ROUTES 对象。
      if (hasAxiosInstance || hasRouteMap) {
        const why = [hasAxiosInstance && "手写 axios 实例", hasRouteMap && "路由映射表"]
          .filter(Boolean)
          .join(" + ");
        warnings.push({ repo: suffix, file: relative(repoOf(suffix), abs), why });
      }
    }
  }
  if (warnings.length === 0) {
    console.log(`✅ 三前端 src/api 无手写 axios 实例 / API_ROUTES 映射表模式`);
  } else {
    for (const w of warnings) {
      console.log(`   ⚠ [${w.repo.padEnd(11)}] ${w.file} — ${w.why}（应迁 orval 生成 hooks）`);
    }
    console.log(`   → WARN 不阻断；迁移计划见 docs/superpowers/specs/2026-09-17-tsp-ssot-cleanup-design.md Phase C。`);
  }
  return { warnings };
}

// ══════════════════════════════════════════════════════════════════════
// 汇总 + 退出码
// ══════════════════════════════════════════════════════════════════════

const forwardOnly = process.argv.includes("--forward-only");
let failed = gaps.length > 0;
if (!forwardOnly) {
  const { extras } = runReverse();
  const { failures } = runMarker();
  runSdkWarn();
  failed = failed || extras.length > 0 || failures.length > 0;
}

process.exit(failed ? 1 : 0);
