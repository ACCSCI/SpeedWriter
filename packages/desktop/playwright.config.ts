/**
 * Playwright e2e 配置 - 启动真实 InkOS.exe,验证完整流程
 *
 * 关键点:
 * - 启动 electron 跑 InkOS.exe(用 dist/win-unpacked 路径)
 * - 等 server ready(poll /api/v1/health)
 * - 走完核心 happy path
 * - 自动截图供 review
 */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXE_PATH = path.join(__dirname, "dist", "win-unpacked", "InkOS.exe");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,                       // 串行,避免端口/userData 冲突
  workers: 1,
  retries: 0,
  timeout: 90_000,                            // 长:启动 + 写一章
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    baseURL: "http://127.0.0.1:4567",
  },
  projects: [
    {
      name: "inkos-electron",
      use: {
        ...devices["Desktop Chrome"],
        // Playwright Electron 模式:直接拉起 .exe
        launchOptions: { executablePath: EXE_PATH },
      },
    },
  ],
});
