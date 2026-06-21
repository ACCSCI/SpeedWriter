/**
 * Hono server 子进程 spawn
 * - portfinder 自动找空闲端口
 * - env 注入解密后的 LLM Key
 * - ELECTRON_RUN_AS_NODE=1 让 Electron 二进制当纯 Node 跑
 * - waitForReady 探活 /api/v1/health
 * - stop() SIGTERM + tree-kill 兜底
 * - restart() stop + 重新 spawn(供 secrets:set 用)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import portfinder from "portfinder";
import { log } from "./logger.js";
import { secretsToEnv } from "./safe-storage.js";

portfinder.setBasePort(4567);

export interface ServerHandle {
  url: string;
  port: number;
  process: ChildProcess;
  killed: boolean;
  stop(): Promise<void>;
  restart(): Promise<ServerHandle>;
}

export interface StartServerOptions {
  projectRoot: string;
  staticDir: string;
  secrets: Record<string, string>;
  preferredPort?: number;
}

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const entry = resolveServerEntry();

  const port = await portfinder.getPortPromise({ port: opts.preferredPort ?? 4567 });
  if (port !== (opts.preferredPort ?? 4567)) {
    log("warn", `[server] preferred port ${opts.preferredPort ?? 4567} taken, using ${port}`);
  }

  const secretEnv = secretsToEnv(opts.secrets);

  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      INKOS_STUDIO_PORT: String(port),
      INKOS_PROJECT_ROOT: opts.projectRoot,
      INKOS_STATIC_DIR: opts.staticDir,
      NODE_ENV: process.env.NODE_ENV ?? "production",
      ...secretEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (b) => log("info", `[server] ${b.toString().trim()}`));
  child.stderr?.on("data", (b) => log("error", `[server] ${b.toString().trim()}`));
  child.on("exit", (code, signal) => log("warn", `[server] exited code=${code} signal=${signal}`));

  const url = `http://127.0.0.1:${port}`;
  await waitForReady(url);
  log("info", `Server up at ${url}`);

  // e2e:把 port 写到 userData/server.port(测试可直接读)
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { app } = await import("electron");
    const portFile = path.join(app.getPath("userData"), "server.port");
    await fs.writeFile(portFile, String(port), "utf-8");
  } catch (e) {
    log("warn", `[server] failed to write server.port: ${e}`);
  }

  const handle: ServerHandle = {
    url,
    port,
    process: child,
    killed: false,
    async stop() {
      if (handle.killed) return;
      handle.killed = true;
      log("info", "[server] stopping (SIGTERM → tree-kill fallback)");
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1500));
      if (!child.killed) {
        try {
          // 用 process.kill 而非 treeKill 的 promisify(后者只支持 1 参数)
          process.kill(child.pid!, "SIGKILL");
          await new Promise((r) => setTimeout(r, 300));
        } catch (e) {
          log("error", `[server] SIGKILL failed: ${e}`);
        }
      }
    },
    async restart() {
      log("info", "[server] restarting");
      await handle.stop();
      return startServer(opts);
    },
  };
  return handle;
}

function resolveServerEntry(): string {
  // 生产:app.asar.unpacked/dist/main/server/entry.js(asarUnpack 拆出来后落地)
  const prod = join(process.resourcesPath ?? "", "app.asar.unpacked", "dist", "main", "server", "entry.js");
  if (existsSync(prod)) return prod;
  // 开发:dist/main/index.js 同级的 server/entry.js(tsc + esbuild 产物)
  const dev = join(import.meta.dirname, "server", "entry.js");
  if (existsSync(dev)) return dev;
  throw new Error("server entry not found — run `pnpm --filter @actalk/inkos-desktop build`");
}

async function waitForReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  const health = `${url}/api/v1/health`;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(health);
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
        if (body.ok === true) return;
      }
    } catch {
      // server 还没起,等
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server failed to start within ${timeoutMs}ms (${health})`);
}
