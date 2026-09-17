"""Schemathesis 4.x hooks —— 读 openapi.yaml 的 x-fuzz 扩展跳过端点。

关联 ADR-0036：复杂端点（状态机 / 跨 grant_type 联动 / 多步依赖）在 shared
仓 .tsp 文件里 // fuzz:skip 标注，emit-openapi.ts 后处理注入 openapi.yaml 的
x-fuzz: skip vendor 扩展。Schemathesis 4.x 在每个 case 跑前调 before_call
钩子，读取 operation 的 vendor extension，对标 skip 的 case 抛 SkipTest 跳过。

写法的取舍：
- 不改 schemathesis 4.x 的 --include-method / --exclude-operation CLI（没法
  在不重启子进程的情况下动态从 openapi.yaml 读排除列表）
- 用 hook 在运行时按 case 跳过（性能开销 0；schemathesis 4.x 标准做法）
- 跳过理由写进 case 的 failure_message 字段，pilot 报告里能看到被豁免的 endpoint
"""

from __future__ import annotations

from schemathesis.core import NotFound
from schemathesis.hooks import hook


@hook
def before_call(context, case):
    """每个 case 跑前检查：operation 有 x-fuzz: skip 扩展则跳过。

    schemathesis 4.x 的 case.operation 是 OperationDefinition，可读
    .definition["x-fuzz"]（vendor extension 字段）。
    """
    op_def = case.operation.definition
    x_fuzz = op_def.get("x-fuzz") if isinstance(op_def, dict) else None
    if x_fuzz == "skip":
        # 抛 NotFound 是 schemathesis 4.x 推荐的「跳过一个 case」语义
        # （不计入 failure 计数）
        raise NotFound(
            f"[fuzz:skip] endpoint 在 shared 仓 .tsp 标注 // fuzz:skip "
            f"({case.operation.label})"
        )