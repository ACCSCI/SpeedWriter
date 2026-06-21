/**
 * LLM Key 加密/解密(safeStorage 包装)
 *
 * 关键约束:
 * - 只能在主进程跑(ELECTRON_RUN_AS_NODE=1 下不可靠,userData 路径错)
 * - macOS → Keychain / Windows → DPAPI / Linux → libsecret(需 libsecret-1-0)
 * - 密文写 userData/.inkos/secrets.enc,子进程通过 env 消费(在 entry.ts 转写)
 */
import { safeStorage, app } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SECRETS_PATH = (): string => join(app.getPath("userData"), ".inkos", "secrets.enc");

interface EncryptedSecrets {
  version: 1;
  secrets: Record<string, string>;
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export async function loadSecrets(): Promise<Record<string, string>> {
  if (!isEncryptionAvailable()) {
    console.warn("[secrets] safeStorage unavailable — using empty secrets (Linux 需 libsecret-1-0)");
    return {};
  }
  const path = SECRETS_PATH();
  if (!existsSync(path)) return {};
  try {
    const buf = await readFile(path);
    const decoded = JSON.parse(safeStorage.decryptString(buf)) as EncryptedSecrets;
    return decoded.secrets ?? {};
  } catch (e) {
    console.error(`[secrets] decrypt failed: ${e}`);
    return {};
  }
}

export async function saveSecrets(secrets: Record<string, string>): Promise<void> {
  if (!isEncryptionAvailable()) {
    throw new Error("safeStorage unavailable — cannot save secrets (Linux 需 libsecret-1-0)");
  }
  const path = SECRETS_PATH();
  await mkdir(join(path, ".."), { recursive: true });
  const enc: EncryptedSecrets = { version: 1, secrets };
  const ciphertext = safeStorage.encryptString(JSON.stringify(enc));
  await writeFile(path, ciphertext, { mode: 0o600 });
  console.log(`[secrets] saved ${Object.keys(secrets).length} encrypted keys to ${path}`);
}

/**
 * service "deepseek" → env "INKOS_SECRET_DEEPSEEK"
 * 子进程 entry.ts 把 INKOS_SECRET_* 写到 root/.inkos/secrets.json
 */
export function secretsToEnv(secrets: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [service, key] of Object.entries(secrets)) {
    if (!key) continue;
    out[`INKOS_SECRET_${service.toUpperCase().replace(/-/g, "_")}`] = key;
  }
  return out;
}
