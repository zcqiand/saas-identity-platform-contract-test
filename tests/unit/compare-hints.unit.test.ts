// 四方比对「未运行提示」——纯单测性质用例，Task 5.85(a) 从 16 个 live 契约文件迁出。
//
// 为什么迁：这些提示在 live（CONTRACT_TARGETS 声明 ≥2 目标）下结构性不成立——比对必然
// 在跑，`expect(targets.length).toBeLessThan(2)` 恒假。原实现用 `describe.runIf(!live)`
// 隔离，但 require_live 仓的 skip=0 硬门（harness.load_trace spec §3.5）把 live trace
// 里任何 inert 条目判红（5.54 saas full-tier EXIT=2 的根因之一）。迁到 tests/unit/ 后
// live 档 vitest 配置 exclude 本目录 → trace 天然 0 inert；unit 档照常真跑。
//
// 刻意不写任何功能 ID（含标题与 describe 链）——这些用例不打任何后端，不构成覆盖。
// 每条 it 保留原文件的控制台提示原文，it 名前缀标来源文件，迁移清单见
// .superpowers/sdd/2026-09-18-family-leftovers-remediation/task-585-report.md。
import { describe, expect, it } from "vitest";

import { selectedTargets } from "../../src/targets.js";

const targets = selectedTargets();

describe("四方比对未运行（提示，不覆盖任何功能 ID）", () => {
  it("admin-clients-write: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] admin-clients 比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run tests/admin-clients-write.test.ts\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("admin-tenants: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run tests/admin-tenants.test.ts\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("apps-public: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("auth: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("client-menus-write: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] client-menus 比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run tests/client-menus-write.test.ts\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("me: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("me-tenants: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("me-switch: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("oauth: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("tenant-applications: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] tenant-applications 比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run tests/tenant-applications.test.ts\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("tenant-members-read: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("tenant-members-write: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] M96.F02.I19 写端点比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run tests/tenant-members-write.test.ts\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("tenant-members-write-2: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] users 写端点第二组比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run tests/tenant-members-write-2.test.ts\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("tenant-role-menus-write: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] M96.F02.I20 写端点比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run tests/tenant-role-menus-write.test.ts\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("tenant-roles-write: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] roles 写端点比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run tests/tenant-roles-write.test.ts\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });

  it("tenant-roles-read: 打印启用方式", () => {
    expect(targets.length).toBeLessThan(2);
    console.info(
      "[contract-test] 四方比对未运行。启用：\n" +
        "  CONTRACT_TARGETS=aspnetcore,springboot,nextjs npx vitest run\n" +
        "  前置：3 个后端分别跑在 5104 / 5105 / 5101",
    );
  });
});
