/**
 * Hono server 子进程入口
 * - 由 esbuild --bundle 打成单文件 dist/main/server/entry.js
 * - 消费 INKOS_SECRET_* env(主进程注入的解密 LLM Key),写到 root/.inkos/secrets.json
 * - 调 startStudioServer(root, port, { staticDir })
 */
import { resolve } from "node:path";
import { startStudioServer } from "@actalk/inkos-studio/api";

const root = process.env.INKOS_PROJECT_ROOT ?? process.cwd();
const port = parseInt(process.env.INKOS_STUDIO_PORT ?? "4567", 10);
const staticDir = process.env.INKOS_STATIC_DIR;

if (!staticDir) {
  console.error("[server] INKOS_STATIC_DIR is required in Electron mode");
  process.exit(1);
}

// 消费 INKOS_SECRET_<SERVICE> env,写到 core 期望的 secrets.json
const envSecrets: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith("INKOS_SECRET_") && v) {
    const service = k.slice("INKOS_SECRET_".length).toLowerCase().replace(/_/g, "-");
    envSecrets[service] = v;
    delete process.env[k]; // 立即清除,避免泄露
  }
}
if (Object.keys(envSecrets).length > 0) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const secretsDir = path.join(root, ".inkos");
  await fs.mkdir(secretsDir, { recursive: true });
  await fs.writeFile(
    path.join(secretsDir, "secrets.json"),
    JSON.stringify({ version: 1, secrets: envSecrets }, null, 2),
    { mode: 0o600 },
  );
  console.log(`[server] injected ${Object.keys(envSecrets).length} secrets from env`);
}

console.log(`[server] starting at port=${port} root=${root} static=${staticDir}`);
startStudioServer(resolve(root), port, { staticDir }).catch((e) => {
  console.error("[server] fatal:", e);
  process.exit(1);
});
