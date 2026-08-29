# CLAUDE.md — SaaS身份平台契约一致性验证仓

> 家族第 6 角色仓（ADR-0015）。入口，不是手册。L0 门强制上限 60 行。

## 1. 项目定位

黑盒 HTTP 打 4 个后端（`msw`:5174 / `nextjs`:3000 / `aspnetcore`:5000 / `springboot`:8080），
验证它们**对前端不可区分**。保留命名空间 `M96`，不镜像 BASE 业务模块。

**它不是什么**：不是后端的单元测试搬家（两个后端测的层根本不同——aspnetcore 测 Controller、
springboot 测 Service）；不是 E2E（不开浏览器）。它回答「哪里不一致」，
后端自己的测试回答「为什么」。

## 2. 铁律

- **「同输出」= 前端不可区分**，不是逐字节相同。UUID/时间戳/token 天生不同，那个目标不可达。
  判定 = status 全等 + schema 校验 + `normalize()` 后全等
- **`normalize` 的剔除清单是契约**：它显式声明「前端不许依赖这些字段」。增删走 ADR
- **默认不剔 ID**：`nextjs`/`aspnetcore`/`springboot` 共用同一个 PG，UUID 本来就该相等，
  剔掉等于丢信号。**只有比对含 `msw`（内存 fixture，不共库）时才传 `ID_KEYS`**
- **msw 是 oracle**：打 `:5174` 必须绿。红了先怀疑套件写错，而不是后端错
- **声明即必须可达**：`CONTRACT_TARGETS` 里列了却连不上 = 红，不是 skip
- **不给未真正运行的比对挂功能 ID**：四方比对未运行时那条提示测试的描述里不写 `M96.*`
- **写操作用唯一化前缀 + teardown**：共库上跑写比对会撞唯一约束、顺序决定结果、不可重跑
- **禁止把后端业务逻辑测试搬进来**——那会让本仓变味成「API 单测容器」

## 3. 技术栈

TypeScript + vitest + axios + tough-cookie jar（工作在 HTTP 层，不受 fetch 屏蔽 HttpOnly 的限制）。
契约从 `../saas-identity-platform-shared/generated/openapi/openapi.yaml` 消费，走 `scripts/gen-shared.ts`。

门禁命令见 `.harness/stack.json`。**不要改它来让门变松。**

## 4. 验收

- suite 根目录跑 `python scripts/gate.py -p saas-identity-platform-contract-test`
- 四方比对：`CONTRACT_TARGETS=msw,aspnetcore,springboot,nextjs npx vitest run`

## 5. 指向别处

- 功能清单（唯一锚点） → `docs/functions/function-tree.md`；改它走 `/tree-change`
- 决策 → suite `docs/adr/0015-contract-test-repo.md`（本仓为什么存在、normalize 契约）
- 对齐两个方向 → suite `docs/adr/0013-alignment-has-two-directions.md`
- 家族拓扑与端口表 → suite `docs/conventions/multi-repo-family.md`

## 6. 工作循环

1. 改 `src/` 或 `tests/` → `npx vitest run`
2. gate exit 1 修；exit 2 停下问人
3. `/handoff` 更新 `.state/session.json`
