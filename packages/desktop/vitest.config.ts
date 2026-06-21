import { defineConfig } from "vitest/config";

// vitest 配置 — 让 pnpm test 不再误把 Playwright e2e 测当 vitest 测跑
//
// 根因:vitest 默认扫描 **\/*.spec.ts,把 e2e/smoke.spec.ts / e2e/llm.spec.ts(Playwright)
// 当 vitest 测试跑,test.describe() 抛 "did not expect test.describe() to be called here"。
//
// 修复:显式 include src/**,exclude e2e/**。
// 本机 e2e 跑法:pnpm test:smoke / pnpm test:llm(走 Playwright,不进 vitest)
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "e2e/**", // Playwright e2e 不是 vitest
      "playwright-report/**",
      "test-results/**",
    ],
  },
});
