/**
 * IPC handlers - 主进程 ↔ 渲染进程
 * 8 个核心 handler:openExternal / revealProject / openUserData / quit / platform / restartServer / secrets:3 / update:3
 */
import { type IpcMain, shell, app, BrowserWindow } from "electron";
import { join } from "node:path";
import type { ServerHandle } from "./server.js";
import { saveSecrets, isEncryptionAvailable } from "./safe-storage.js";
import { log } from "./logger.js";

export interface IpcContext {
  getMainWindow: () => BrowserWindow | null;
  getServerHandle: () => ServerHandle | null;
  setServerHandle?: (h: ServerHandle) => void;
  getSecrets: () => Record<string, string>;
  onSecretsChanged: (secrets: Record<string, string>) => void;
}

export function registerIpc(ipc: IpcMain, ctx: IpcContext): void {
  // === 系统集成 ===
  ipc.handle("app:open-external", async (_e, url: string) => {
    if (typeof url !== "string") return { ok: false, error: "invalid url" };
    if (!url.startsWith("http://") && !url.startsWith("https://")) return { ok: false, error: "only http(s) allowed" };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipc.handle("app:reveal-project", async () => {
    const win = ctx.getMainWindow();
    const path = join(app.getPath("userData"), "projects", "default");
    shell.showItemInFolder(path);
    win?.focus();
    return { ok: true, path };
  });

  ipc.handle("app:open-userdata", async () => {
    await shell.openPath(app.getPath("userData"));
    return { ok: true };
  });

  ipc.handle("app:quit", async () => {
    app.quit();
    return { ok: true };
  });

  ipc.handle("app:platform", async () => ({
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
  }));

  // === 新版本检测 ===
  ipc.handle("update:check", async (_e, force = false) => {
    const { checkForUpdate } = await import("./update-checker.js");
    return checkForUpdate(force);
  });
  ipc.handle("update:skip", async (_e, version: string) => {
    const { skipVersion } = await import("./update-checker.js");
    skipVersion(version);
    return { ok: true };
  });
  ipc.handle("update:open-release", async (_e, url: string) => {
    if (typeof url !== "string" || !url.startsWith("https://github.com/")) return { ok: false, error: "invalid url" };
    await shell.openExternal(url);
    return { ok: true };
  });

  // === Secrets(主进程加密) ===
  ipc.handle("secrets:get", async () => ({ ok: true, secrets: ctx.getSecrets() }));
  ipc.handle("secrets:set", async (_e, secrets: Record<string, string>) => {
    try {
      if (!isEncryptionAvailable()) return { ok: false, error: "safeStorage unavailable (Linux 需 libsecret-1-0)" };
      await saveSecrets(secrets);
      ctx.onSecretsChanged(secrets);

      // 关键:更新后重启子进程,新 Key 才生效(env 在 spawn 时固化)
      const oldHandle = ctx.getServerHandle();
      if (oldHandle) {
        try {
          const newHandle = await oldHandle.restart();
          ctx.setServerHandle?.(newHandle);
          ctx.getMainWindow()?.reload();
          log("info", "[secrets] server restarted with new keys");
        } catch (e) {
          log("error", `[secrets] restart after set failed: ${e}`);
          return { ok: false, error: `saved but restart failed: ${e}` };
        }
      }
      return { ok: true };
    } catch (e) {
      log("error", `[secrets] save failed: ${e}`);
      return { ok: false, error: String(e) };
    }
  });
  ipc.handle("secrets:available", async () => isEncryptionAvailable());

  // === 重启后端 ===
  ipc.handle("app:restart-server", async () => {
    const handle = ctx.getServerHandle();
    if (!handle) return { ok: false, error: "no server handle" };
    try {
      const newHandle = await handle.restart();
      ctx.setServerHandle?.(newHandle);
      ctx.getMainWindow()?.reload();
      return { ok: true, url: newHandle.url, port: newHandle.port };
    } catch (e) {
      log("error", `[restart-server] failed: ${e}`);
      return { ok: false, error: String(e) };
    }
  });

  // === 窗口控制(Win/Linux 自定义标题栏) ===
  ipc.handle("win:minimize", () => {
    ctx.getMainWindow()?.minimize();
    return { ok: true };
  });
  ipc.handle("win:toggle-maximize", () => {
    const w = ctx.getMainWindow();
    if (!w) return { ok: false };
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
    return { ok: true };
  });
  ipc.handle("win:close", () => {
    ctx.getMainWindow()?.close();
    return { ok: true };
  });
  ipc.handle("win:is-maximized", () => ({
    ok: true,
    value: ctx.getMainWindow()?.isMaximized() ?? false,
  }));
  ipc.handle("win:is-fullscreen", () => ({
    ok: true,
    value: ctx.getMainWindow()?.isFullScreen() ?? false,
  }));
}
