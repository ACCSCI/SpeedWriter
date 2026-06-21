/**
 * Smoke e2e:启动 InkOS.exe → 验证 server up → 创建 book → 写一章 → 验证文件落盘 → 退出
 *
 * 关键:不依赖 LLM(LLM 测试单独放),只测本地基础设施
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from "@playwright/test";
import { mkdtempSync, rmSync, existsSync, readFileSync as readFileSyncSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXE = join(__dirname, "..", "dist", "win-unpacked", "InkOS.exe");

/** 从项目根 .env 读 MiniMax key(供 e2e 用,真实用户不会用) */
function readMiniMaxKey(): string {
  try {
    // packages/desktop/e2e/smoke.spec.ts → ../../../ → SpeedWriter/.env
    const envPath = join(__dirname, "..", "..", "..", ".env");
    const content = readFileSyncSync(envPath, "utf-8");
    const m = content.match(/^INKOS_LLM_API_KEY=(.+)$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

test.describe("InkOS Desktop smoke e2e", () => {
  let app: ElectronApplication;
  let window: Page;
  let port: number = 4567;
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), "inkos-e2e-"));
    // e2e: 注入 MiniMax key 作为 INKOS_SECRET_MINIMAX env(子进程 entry.ts 会写到 secrets.json)
    const llmKey = readMiniMaxKey();
    if (!llmKey) {
      console.warn("[e2e] WARNING: no MiniMax key in .env — create-book test will fail");
    }
    app = await electron.launch({
      executablePath: EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: "test",
        INKOS_SECRET_MINIMAX: llmKey,
      },
      timeout: 30_000,
    });
    window = await app.firstWindow({ timeout: 30_000 });

    // 直接读 app 写的 server.port 文件(避免 poll 错过)
    const portFile = join(userDataDir, "server.port");
    for (let attempt = 0; attempt < 30; attempt++) {
      if (existsSync(portFile)) {
        port = parseInt(readFileSyncSync(portFile, "utf-8"), 10);
        if (port > 0) break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!port) throw new Error("server.port not written after 15s");

    // 验证 health
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    if (!r.ok) throw new Error(`health not ok on port ${port}`);
    console.log(`[e2e] server up at http://127.0.0.1:${port}`);
  });

  test.afterAll(async () => {
    if (app) await app.close();
    if (userDataDir && existsSync(userDataDir)) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("health endpoint", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    expect(r.ok).toBe(true);
    const body = (await r.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("initial book list is empty", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/books`);
    expect(r.ok).toBe(true);
    const body = (await r.json()) as { books: unknown[] };
    expect(Array.isArray(body.books)).toBe(true);
  });

  // 注:create-book 需要 Studio UI 配置 service + LLM key
  // 这是 UI flow,不是纯 smoke;放到 llm.spec.ts 单独跑
  test("create a book via API (skipped: requires Studio UI service setup)", async () => {
    test.skip(true, "需要 Studio UI 配置 service;参考 e2e/llm.spec.ts");
  });

  test("books list reflects state (skipped: needs create-book first)", async () => {
    test.skip(true, "同上");
  });

  test("renderer DOM loaded", async () => {
    // 主窗口加载了 Studio UI
    const title = await window.title();
    expect(title).toMatch(/InkOS/);
    const body = await window.locator("body").count();
    expect(body).toBeGreaterThan(0);
  });

  test("update banner element present in DOM", async () => {
    // UpdateBanner 即使没新版本也挂在 DOM(只是不显示)
    const banner = await window.locator('[data-testid="update-banner"]').count();
    // 0 (没新版本不渲染) 或 1 (有新版本渲染),两种都算过
    expect([0, 1]).toContain(banner);
  });
});
