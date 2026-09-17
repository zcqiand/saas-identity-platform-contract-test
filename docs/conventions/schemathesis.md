# Schemathesis 契约模糊测试

> 什么时候读我：要跑/改 `npm run test:schemathesis`，要加检查或逐端点豁免，
> 或想知道 Schemathesis 与 vitest 套件怎么分工时。落点：TSOT 清理 Phase E1
> （suite `docs/superpowers/specs/2026-09-17-tsp-ssot-cleanup-design.md` Phase E）。

## 分工（为什么不取代 vitest）

| 面 | Schemathesis（`schemathesis/`） | vitest（`tests/`） |
|---|---|---|
| 定位 | schema 一致性 / 边界模糊面 | 关键功能语义 |
| 手段 | 属性模糊测试：随机参数打每个 GET，断言 5xx=0、状态码在契约 responses 内、响应符合 response schema | 手写断言：登录/logout/refresh 语义、写路径唯一化+teardown |
| 覆盖 | 大面积、每操作几十个随机 case | 精确、语义级 |
| 跨后端 | **不做** —— 逐目标独立跑 | **核心** —— 四方 normalize 全等比对（`src/normalize.ts` 剔除清单是契约，ADR-0015）。Schemathesis 做不了这条 |

两套并存：Schemathesis 抓「实现 vs openapi.yaml」的漂移面（SSOT 清理的猎物），
vitest 抓「后端之间对前端不可区分」。任何一方都不能冒充另一方。

## 怎么跑

```bash
# 仓库根。Python = 本机 anaconda 3.11（schemathesis 4.27.3 已装，勿 pip 动版本）
npm run test:schemathesis                        # 无 CONTRACT_TARGETS：skip，exit 0

CONTRACT_TARGETS=springboot npm run test:schemathesis
CONTRACT_TARGETS=nextjs,aspnetcore,springboot npm run test:schemathesis
```

`CONTRACT_TARGETS` 语义与 vitest 套件（`src/targets.ts`）一致：声明了就必须可达，
连不上 = 红；`msw` 是 targets.ts 待清尾巴，遇到打 WARN 跳过（仓已删，不算红）。

run.py 每目标先 `POST /api/v1/auth/login`（SEED_USER 镜像 `src/http.ts`，不走
env 兜底）拿 token，`--header Authorization: Bearer ...` 注入；请求超时 30s
（nextjs dev login 实测 7.5-8s）。后端共库 saas_dev PG，GET-only 无写污染。

## 安全边界（Phase 1 只跑 GET）

- **只跑 GET**（run.py `--include-method GET`）：写方法（POST/PUT/PATCH/DELETE）
  的随机体会污染 saas_dev 共库且无法 teardown。Phase 2 再评估专库 + stateful。
- 三个检查：`not_a_server_error` + `status_code_conformance` +
  `response_schema_conformance`（`validate-formats = false`，理由见 config 注释）。

## 配置与豁免纪律

配置在 `schemathesis/config.toml`（**TOML 不是 YAML**：schemathesis 4.27.3 的
`--config-file` 只走 tomli 解析，YAML 不被识别——这是验证过的事实）。

- 加检查 = 在 `[project.checks]` 下显式开一行 + 理由；外层 `enabled = false`
  一刀切是刻意的，防止无意全开
- 逐端点豁免 = `[[project.operations]]` 块（`include-operation-id` 选端点，
  块内 `[project.operations.checks]` 覆写）+ **理由注释，缺一不可**
- **真后端 bug / 未文档化行为不许豁免** —— 那是 SSOT 清理要抓的猎物，写报告
  （或修 shared 契约/后端），不是 config 里的免死金牌
- `[[project.operations]]` 块不裁剪选集（4.x 里选集只认 CLI 过滤），所以
  GET-only 放在 run.py 的 CLI 参数上

## 门禁状态

Phase E1 结束时**未接门禁**（`.harness/stack.json` 不动，设计 E3）：live pilot
证明稳定后再议挂 L4。当前以 npm script + 本文档形态存在。
