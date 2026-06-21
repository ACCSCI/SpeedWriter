/**
 * 日志模块
 * - initLogger:用 temp 目录(app.getPath("userData") 在 ready 前不安全)
 * - redirectLoggerToUserData:whenReady + setupUserData 后切到 userData
 * - log:同步写 console + 异步 appendFile(失败也不抛)
 */
import { app } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

let logFile: string | null = null;
let logDir: string | null = null;

export async function initLogger(): Promise<void> {
  // temp 目录在 ready 前安全可用(macOS 是 /var/folders/..., Windows 是 %TEMP%)
  const dir = join(app.getPath("temp"), "inkos-desktop", "logs");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  logDir = dir;
  logFile = join(dir, `${new Date().toISOString().slice(0, 10)}.log`);
}

export async function redirectLoggerToUserData(): Promise<void> {
  const realDir = join(app.getPath("userData"), "logs");
  if (!existsSync(realDir)) await mkdir(realDir, { recursive: true });
  logDir = realDir;
  logFile = join(realDir, `${new Date().toISOString().slice(0, 10)}.log`);
  log("info", `[logger] redirected to ${realDir}`);
}

export function log(level: "info" | "warn" | "error", msg: string): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
  // 同步 console(开发/调试友好)
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  // 异步追加文件(失败静默)
  if (logFile) {
    appendFile(logFile, line + "\n").catch(() => {});
  }
}

/** 清理 N 天前的日志(7 天) */
export async function cleanOldLogs(maxAgeDays = 7): Promise<void> {
  if (!logDir) return;
  const { readdir, stat, unlink } = await import("node:fs/promises");
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  try {
    const files = await readdir(logDir);
    for (const f of files) {
      if (!f.endsWith(".log")) continue;
      const p = join(logDir, f);
      const s = await stat(p);
      if (s.mtimeMs < cutoff) {
        await unlink(p);
      }
    }
  } catch (e) {
    log("warn", `[logger] clean old logs failed: ${e}`);
  }
}
