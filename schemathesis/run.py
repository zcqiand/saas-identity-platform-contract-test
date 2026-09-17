#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Schemathesis 契约模糊测试入口 —— TSOT 清理 Phase E1（2026-09-17）+ ADR-0036 全 method。

语义与现有 vitest 套件（src/targets.ts）对齐：
  - CONTRACT_TARGETS 未设置/为空 -> 打印 skip，退出 0（不跑不算红）
  - 设置了的目标（msw 除外，仓已删）逐个真跑；连不上 -> 退出非零
    （「声明即必须可达」铁律）
  - msw 在 targets.ts 里是待清尾巴：遇到打 WARN 跳过，不算红也不算声明不可达

每目标先 POST /api/v1/auth/login（SEED_USER 镜像 src/http.ts，不走 env 兜底）
拿 accessToken，再以 --header Authorization 注入 schemathesis 子进程。

用法（仓库根）：
  npm run test:schemathesis
  CONTRACT_TARGETS=springboot python schemathesis/run.py

ADR-0036 §5：默认全 method 跑（GET/POST/PUT/PATCH/DELETE）；复杂端点（状态机 /
跨 grant 联动 / 多步依赖）在 shared 仓 .tsp 里 // fuzz:skip 标注，emit-openapi.ts
注入 openapi.yaml 的 x-fuzz: skip 扩展。hooks.py 通过 SCHEMATHESIS_HOOKS 环境
变量注册到 schemathesis（CLI 没有 --hooks；4.27.3 唯一注册路径就是
[SCHEMATHESIS_HOOKS] 或 config.toml 的 hooks = "..."），按 case 跳过标过的端点。
teardown 由 config.toml [phases.stateful] enabled=true 自动跟踪 response.id 并
cleanup（不是 CLI --stateful=links，4.x stateful testing 默认模式就是 links）。

v0.1 起点；v0.2 加 invariant 差集兜底。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

# Windows 控制台 UTF-8（失败摘要里带后端响应片段）
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parent.parent
SPEC = REPO_ROOT.parent / "saas-identity-platform-shared" / "generated" / "openapi" / "openapi.yaml"
CONFIG_FILE = Path(__file__).resolve().parent / "config.toml"

# 与 src/targets.ts TARGETS 同源（conventions §6 端口表）。改一处必须同步另一处。
TARGETS = {
    # msw 仓已删（TSOT Phase 2 剔除）：targets.ts 残留条目，这里只 WARN 跳过。
    "msw": "http://localhost:5100",
    "nextjs": "http://localhost:5101",
    "aspnetcore": "http://localhost:5104",
    "springboot": "http://localhost:5105",
}
DELETED_TARGETS = {"msw"}

# src/http.ts SEED_USER 的镜像（alice / V016 seed）。显式字面量，禁止 env 兜底。
SEED_USER = {
    "username": "alice",
    "password": "dev123456",
    "clientId": "lab-management",
}

LOGIN_TIMEOUT = 30.0  # nextjs dev login 实测 7.5-8s（首访路由编译），给足
SCHEMATHESIS_TIMEOUT = 1800  # 单目标子进程上限（秒）


def login(base_url: str, name: str) -> str:
    """真实登录路径拿 accessToken。连接失败 = 目标不可达 = 红。"""
    body = json.dumps(SEED_USER).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/api/v1/auth/login",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=LOGIN_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(
            f"[{name}] 登录失败 status={exc.code} body={exc.read().decode('utf-8', 'replace')[:300]}"
        )
    except Exception as exc:  # URLError / timeout / 连接拒绝
        raise SystemExit(
            f"[{name}] 连不上（{exc}）—— 声明了就必须可达，这是红不是跳过。"
            f"先确认后端在跑，或从 CONTRACT_TARGETS 里去掉它。"
        )
    token = data.get("accessToken")
    if not token:
        raise SystemExit(f"[{name}] 登录 200 但响应里没有 accessToken: {str(data)[:300]}")
    return token


def fuzz_skip_args() -> list[str]:
    """读 openapi.yaml 的 x-fuzz: skip 扩展，转 schemathesis 4.x 的 --exclude-path +
    --exclude-method CLI 参数对（每个 (path, method) 一对）。

    ADR-0036 §5：复杂端点（状态机/多步依赖）走 shared 仓 .tsp // fuzz:skip 标注
    → emit-openapi.ts 后处理注入 openapi.yaml 的 x-fuzz: "skip" vendor 扩展。
    本函数是唯一读取点：单源 = openapi.yaml，避免与 shared .tsp 双源漂移。

    x-fuzz 出现位置（OpenAPI 3.x 规范都合法）：
      - PathItem 级（emit-openapi.ts 当前实现）→ 该 path 下所有 method 跳过
      - Operation 级（method 子对象）        → 单 method 跳过
    两者同时存在时：path 级优先（整个 path 跳过），operation 级不重复加。

    schemathesis 4.x 的官方排除机制是 --exclude-path + --exclude-method（path+method
    组合 AND 排除）；4.x 的 before_call hook 抛异常 = phase ERROR 不是 skip；
    4.x CLI 无 --hooks / --stateful。
    """
    if not SPEC.is_file():
        return []  # 上游 main() 已 exit 2；这里兜底返回空
    spec = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
    args: list[str] = []
    paths = spec.get("paths", {}) if isinstance(spec, dict) else {}
    for path, ops in paths.items():
        if not isinstance(ops, dict):
            continue
        # OpenAPI 3.x PathItem 标准字段：summary/description/parameters + 7 个 HTTP method
        # x-* vendor extension 也可能出现在 PathItem 级（emit-openapi.ts 当前做法）
        standard_path_keys = {
            "summary", "description", "parameters",
            "get", "post", "put", "patch", "delete", "head", "options", "trace",
        }
        # PathItem 级 x-fuzz: skip → 该 path 下所有 standard method 全跳过
        if ops.get("x-fuzz") == "skip":
            for method_key in ops:
                if method_key in standard_path_keys:
                    args.extend(["--exclude-path", path, "--exclude-method", method_key.upper()])
                    print(
                        f"[schemathesis] fuzz:skip → --exclude-path {path} "
                        f"--exclude-method {method_key.upper()} (path-level)",
                        flush=True,
                    )
            continue  # path 级已处理，不再扫 operation 级
        # Operation 级 x-fuzz: skip → 单 method 跳过
        for method, op in ops.items():
            if not isinstance(op, dict):
                continue
            if method not in standard_path_keys:
                continue
            if op.get("x-fuzz") == "skip":
                args.extend(["--exclude-path", path, "--exclude-method", method.upper()])
                print(
                    f"[schemathesis] fuzz:skip → --exclude-path {path} "
                    f"--exclude-method {method.upper()}",
                    flush=True,
                )
    return args


def run_target(name: str, base_url: str) -> int:
    token = login(base_url, name)
    cmd = [
        sys.executable,
        "-m",
        "schemathesis.cli",
        "--no-color",
        "--config-file",
        str(CONFIG_FILE),
        "run",
        str(SPEC),
        "--url",
        base_url,
        "--header",
        f"Authorization: Bearer {token}",
        # ADR-0036 §5 范围扩：默认全 method 跑（GET/POST/PUT/PATCH/DELETE）。
        # 复杂端点（状态机/多步依赖）由 fuzz_skip_args() 按 openapi.yaml 的
        # x-fuzz: skip 扩展生成 --exclude-path + --exclude-method 对跳过。
        # stateful teardown 走 config.toml [phases.stateful] enabled=true。
        *fuzz_skip_args(),
    ]
    print(f"\n=== [{name}] {base_url} schemathesis run ===", flush=True)
    env = dict(os.environ)
    # localhost 请求不许走公司代理（curl 同款 --noproxy 语义；httpx 读 NO_PROXY）
    no_proxy = env.get("NO_PROXY", env.get("no_proxy", ""))
    env["NO_PROXY"] = env["no_proxy"] = ",".join(
        p for p in (no_proxy, "localhost", "127.0.0.1") if p
    )
    try:
        return subprocess.call(cmd, env=env, timeout=SCHEMATHESIS_TIMEOUT)
    except subprocess.TimeoutExpired:
        print(f"[{name}] schemathesis 超过 {SCHEMATHESIS_TIMEOUT}s 被终止", file=sys.stderr)
        return 1


def main() -> int:
    raw = os.environ.get("CONTRACT_TARGETS", "")
    if not raw.strip():
        print(
            "CONTRACT_TARGETS 未设置 —— Schemathesis 不跑（与 vitest 同语义："
            "不跑不算红）。live 用法：CONTRACT_TARGETS=nextjs,aspnetcore,springboot "
            "npm run test:schemathesis"
        )
        return 0

    names = [n.strip() for n in raw.split(",") if n.strip()]
    unknown = [n for n in names if n not in TARGETS]
    if unknown:
        print(
            f"CONTRACT_TARGETS 里有不认识的目标: {', '.join(unknown)}。"
            f"可选: {', '.join(TARGETS)}"
        )
        return 2

    skipped = [n for n in names if n in DELETED_TARGETS]
    for n in skipped:
        print(f"[{n}] WARN: msw 仓已删（TSOT Phase 2 剔除），跳过不跑、不算红。"
              f"targets.ts 残留条目属待清尾巴，另行收口。")
    live = [n for n in names if n not in DELETED_TARGETS]
    if not live:
        print("没有可跑的目标（全部为已删仓），退出 0。")
        return 0

    if not SPEC.exists():
        print(f"契约 spec 不存在: {SPEC} —— 先在 shared 仓跑 npm run emit:openapi")
        return 2

    failed = []
    for name in live:
        code = run_target(name, TARGETS[name])
        if code != 0:
            failed.append((name, code))
    if failed:
        print(f"\n失败目标: {', '.join(f'{n}(exit {c})' for n, c in failed)}", file=sys.stderr)
        return 1
    print(f"\n全部目标通过: {', '.join(live)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
