# REQ-2026-010 live 门控断言执行面塌缩降级信号（lab REQ-2026-014 的 saas 镜像）

| 项 | 值 |
|---|---|
| 提出人 | suite-operator（REQ-2026-014 §8.2 范围外项 / ADR-0040） |
| 提出日期 | 2026-09-22 |
| 优先级 | P1 |
| 状态 | 已实现（随 ADR-0040 T-3 与 lab 批同波落地，2026-09-22） |
| 关联 ADR | ADR-0040（三问裁决，本仓不另裁） |

## 1. 需求

与 lab-ct REQ-2026-014 同款洞：本仓 fnReporter/探针层存在同一 live 执行面塌缩
不可见问题。ADR-0040 已裁决信号来源（探针层实测）、红绿边界（WARNING 全档 +
full 档红）、AC-1 锚点（真洞场景），本仓按裁决镜像实现，不另立决策。

## 2. 实现

同 lab 批：src/live-floor.ts side channel + fnReporter live_floor 三值 +
suite gate L5 消费。fnReporter 无漂移差异——5.12 探活加固与
DEFAULT_HEALTH=/health 已随 8500edd（2026-09-22）收敛，两仓本批高度同构。

## 3. 验收

随 ADR-0040 T-3 批验收（spec 2026-09-22 §5）：本仓 fnReporter-live-floor
单测 4 用例 + live 端到端 live_floor 三值=声明值。
