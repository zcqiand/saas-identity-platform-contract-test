// V016 种子镜像 —— 契约测试用来构造带参路径，不向任何后端写入。
//
// **唯一真源**：saas-identity-platform-shared/sql/migrations/V016__seed_family_fixtures.sql
// 与 saas-identity-platform-msw/src/seeds/{users,tenants,roles,apps}.json 逐字同源。
//
// 改 V016 → 先改这里 + msw fixtures，三方一致；漏一处 = 4 后端 ID 分叉 = L5 假红。
// 不向这里补家族没用过的 UUID —— 这是「家族共识」不是「contract-test 自留地」。
//
// alice 路径：/api/v1/tenants/{acme}/users/{alice}，role=acme admin。
// 这是所有 Tier A 只读端点共用的固定 fixture。

export const SEED = {
  userId: "00000000-0000-0000-0000-b00000000001", // alice
  tenants: {
    acme: "00000000-0000-0000-0000-000000000001",
    globex: "00000000-0000-0000-0000-000000000002",
    initech: "00000000-0000-0000-0000-000000000003",
  },
  roles: {
    acmeAdmin: "00000000-0000-0000-0000-a00000000001",
    acmeMember: "00000000-0000-0000-0000-a00000000002",
    globexAdmin: "00000000-0000-0000-0000-a00000000003",
    initechAdmin: "00000000-0000-0000-0000-a00000000004",
  },
  apps: {
    labManagement: "11111111-1111-1111-1111-111111111111",
    erp: "11111111-1111-1111-1111-111111111112",
    crm: "11111111-1111-1111-1111-111111111113",
  },
  appCodes: {
    labManagement: "lab-management",
    erp: "erp",
    crm: "crm",
  },
} as const;

/** alice 的固定路径参数：/tenants/{t}/users/{u}。Tier A 大多数端点的「主路径」。 */
export const ALICE_PARAMS = {
  tenantId: SEED.tenants.acme,
  userId: SEED.userId,
  roleId: SEED.roles.acmeAdmin,
  appId: SEED.apps.labManagement,
  appCode: SEED.appCodes.labManagement,
} as const;
