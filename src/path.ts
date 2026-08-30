// 路径参数替换 —— 把 `/tenants/{tenantId}/users/{userId}` 变成 `/tenants/<uuid>/users/<uuid>`。
//
// 设计要点：
// - 显式字面量参数表，不允许"我猜你想要什么"：少传 = 抛错（fail-fast）。
//   这是为了把"忘了填 userId"这种沉默漏参暴露在测试入口，而不是在远端 404 才被发现。
// - `encodeURIComponent`：UUID 字母数字不敏感，但万一将来某端点收非 UUID（如 appCode = "lab-management"）也安全。
//
// 已知使用点：tests/<endpoint>.test.ts 里 pathWithParams(PATH, ALICE_PARAMS) 一行调用。

export function pathWithParams(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`pathWithParams: 路径 ${template} 缺参数 ${key}`);
    }
    return encodeURIComponent(value);
  });
}
