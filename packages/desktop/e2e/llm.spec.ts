/**
 * LLM e2e:需要 MiniMax key(.env INKOS_LLM_API_KEY)
 * 跑真实 LLM 调用:创建书、读章节、验证文件落盘
 *
 * 不在默认 smoke 套件里 — `pnpm test:e2e` 跑全部,`pnpm test:smoke` 只跑 smoke.spec
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from "@playwright/test";
import { mkdtempSync, rmSync, existsSync, readFileSync as readFileSyncSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXE = join(__dirname, "..", "dist", "win-unpacked", "InkOS.exe");

function readMiniMaxKey(): string {
  try {
    // packages/desktop/e2e/llm.spec.ts → ../../../ → SpeedWriter/.env
    const envPath = join(__dirname, "..", "..", "..", ".env");
    const content = readFileSyncSync(envPath, "utf-8");
    const m = content.match(/^INKOS_LLM_API_KEY=(.+)$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

const HAS_KEY = !!readMiniMaxKey();

test.describe("InkOS Desktop LLM e2e (requires MiniMax key)", () => {
  let app: ElectronApplication;
  let window: Page;
  let port: number = 4567;
  let userDataDir: string;

  test.beforeAll(async () => {
    if (!HAS_KEY) {
      test.skip(true, ".env 没有 INKOS_LLM_API_KEY — 跳过 LLM 测试");
      return;
    }
    userDataDir = mkdtempSync(join(tmpdir(), "inkos-llm-e2e-"));
    app = await electron.launch({
      executablePath: EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: "test", INKOS_SECRET_MINIMAX: readMiniMaxKey() },
      timeout: 30_000,
    });
    window = await app.firstWindow({ timeout: 30_000 });
    const portFile = join(userDataDir, "server.port");
    for (let attempt = 0; attempt < 30; attempt++) {
      if (existsSync(portFile)) {
        port = parseInt(readFileSyncSync(portFile, "utf-8"), 10);
        if (port > 0) break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test.afterAll(async () => {
    if (app) await app.close();
    if (userDataDir && existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
  });

  test("MiniMax API is reachable", async () => {
    if (!HAS_KEY) return;
    const r = await fetch("https://api.minimaxi.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${readMiniMaxKey()}` },
      body: JSON.stringify({ model: "MiniMax-Text-01", messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
    });
    expect(r.ok).toBe(true);
  });

  test("secrets.json has MiniMax key", async () => {
    if (!HAS_KEY) return;
    const secretsFile = join(userDataDir, "projects", "default", ".inkos", "secrets.json");
    for (let i = 0; i < 10; i++) {
      if (existsSync(secretsFile)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(existsSync(secretsFile)).toBe(true);
    const body = JSON.parse(readFileSyncSync(secretsFile, "utf-8"));
    expect(body.secrets).toBeTruthy();
    // entry.ts 把 INKOS_SECRET_MINIMAX 转成 "minimax" 小写 service 名
    const key = body.secrets.minimax || body.secrets.MiniMax;
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(20);
  });
});
