/**
 * userData 路径 + 一次性数据迁移
 * - getUserDataPaths:返回所有标准路径
 * - setupUserData:mkdir + 从 ~/inkos.json 等位置迁移旧数据
 */
import { app } from "electron";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export interface UserDataPaths {
  userData: string;
  defaultProjectRoot: string;
  studioStaticDir: string;
  logsDir: string;
}

export function getUserDataPaths(): UserDataPaths {
  const userData = app.getPath("userData");
  const defaultProjectRoot = join(userData, "projects", "default");
  // 静态文件:生产在 resources/studio-dist/(extraResources),开发在 packages/studio/dist/
  const studioStaticDir =
    process.env.INKOS_STUDIO_STATIC_DIR ??
    join(process.resourcesPath ?? "", "studio-dist") ??
    join(import.meta.dirname, "..", "..", "..", "studio", "dist");
  return {
    userData,
    defaultProjectRoot,
    studioStaticDir,
    logsDir: join(userData, "logs"),
  };
}

export async function setupUserData(): Promise<void> {
  const paths = getUserDataPaths();
  mkdirSync(paths.userData, { recursive: true });
  mkdirSync(paths.defaultProjectRoot, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });

  // 首次启动:seed 一个默认 inkos.json(让 server 能起来)
  const inkosJson = join(paths.defaultProjectRoot, "inkos.json");
  if (!existsSync(inkosJson)) {
    const defaultConfig = {
      name: "inkos-default",
      version: "0.1.0",
      language: "zh",
      notify: [],
      daemon: {
        schedule: { radarCron: "0 */6 * * *", writeCron: "*/15 * * * *" },
        maxConcurrentBooks: 3,
      },
    };
    await import("node:fs/promises").then((m) =>
      m.writeFile(inkosJson, JSON.stringify(defaultConfig, null, 2), "utf-8"),
    );
    console.log(`[user-data] seeded default inkos.json at ${inkosJson}`);
  }

  const marker = join(paths.userData, ".migration-v1-done");
  if (existsSync(marker)) return;

  const home = app.getPath("home");
  const candidates = [join(home, "inkos.json"), join(home, "books"), join(home, "worlds"), join(home, ".inkos")];

  let migrated = 0;
  const { rename, cp, rm } = await import("node:fs/promises");
  for (const src of candidates) {
    if (!existsSync(src)) continue;
    const dst = join(paths.defaultProjectRoot, src.split(/[\\/]/).pop()!);
    try {
      if (existsSync(dst)) continue;
      try {
        await rename(src, dst);
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code === "EXDEV") {
          // 跨卷:用 cp(recursive 支持目录)+ rm
          await cp(src, dst, { recursive: true });
          await rm(src, { recursive: true, force: true });
          console.log(`[user-data] Migrated ${src} → ${dst} (cross-device copy)`);
        } else {
          throw e;
        }
      }
      migrated++;
    } catch (e) {
      console.warn(`[user-data] Migration of ${src} failed: ${e}`);
    }
  }

  // 写 marker,下次启动不再尝试
  await import("node:fs/promises").then((m) =>
    m.writeFile(marker, JSON.stringify({ migrated, ts: Date.now() }), "utf-8"),
  );
}
