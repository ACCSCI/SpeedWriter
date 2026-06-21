/**
 * Preload 脚本(渲染进程 ↔ 主进程的安全桥)
 * - contextIsolation + sandbox + 禁用 nodeIntegration
 * - 暴露 window.inkos API 集合
 */
import { contextBridge, ipcRenderer } from "electron";

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  assets: { macDmg: string | null; macZip: string | null; winExe: string | null; linuxAppImage: string | null };
}

const api = {
  // 系统集成
  openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url),
  revealProject: () => ipcRenderer.invoke("app:reveal-project"),
  openUserData: () => ipcRenderer.invoke("app:open-userdata"),
  quit: () => ipcRenderer.invoke("app:quit"),
  restartServer: () => ipcRenderer.invoke("app:restart-server"),
  platform: () =>
    ipcRenderer.invoke("app:platform") as Promise<{
      platform: NodeJS.Platform;
      arch: string;
      versions: NodeJS.ProcessVersions;
    }>,
  onMenuCommand: (cb: (cmd: string) => void) => {
    ipcRenderer.on("menu:open-project", () => cb("open-project"));
  },

  // 新版本检测
  checkUpdate: (force = false) => ipcRenderer.invoke("update:check", force) as Promise<UpdateInfo>,
  skipVersion: (version: string) => ipcRenderer.invoke("update:skip", version),
  openRelease: (url: string) => ipcRenderer.invoke("update:open-release", url),

  // Secrets
  getSecrets: () => ipcRenderer.invoke("secrets:get") as Promise<{ ok: boolean; secrets: Record<string, string> }>,
  setSecrets: (secrets: Record<string, string>) => ipcRenderer.invoke("secrets:set", secrets) as Promise<{ ok: boolean; error?: string }>,
  secretsAvailable: () => ipcRenderer.invoke("secrets:available") as Promise<boolean>,

  // 窗口控制(Win/Linux 自定义标题栏)
  minimize:       () => ipcRenderer.invoke("win:minimize")        as Promise<{ ok: boolean }>,
  toggleMaximize: () => ipcRenderer.invoke("win:toggle-maximize") as Promise<{ ok: boolean }>,
  close:          () => ipcRenderer.invoke("win:close")           as Promise<{ ok: boolean }>,
  getMaximized:   () => ipcRenderer.invoke("win:is-maximized")    as Promise<{ ok: boolean; value: boolean }>,
  getFullscreen:  () => ipcRenderer.invoke("win:is-fullscreen")   as Promise<{ ok: boolean; value: boolean }>,

  onMaximizedChanged: (cb: (v: boolean) => void) => {
    const handler = (_e: unknown, v: boolean) => cb(v);
    ipcRenderer.on("win:maximized-changed", handler);
    return () => {
      ipcRenderer.removeListener("win:maximized-changed", handler);
    };
  },
  onFullscreenChanged: (cb: (v: boolean) => void) => {
    const handler = (_e: unknown, v: boolean) => cb(v);
    ipcRenderer.on("win:fullscreen-changed", handler);
    return () => {
      ipcRenderer.removeListener("win:fullscreen-changed", handler);
    };
  },
};

contextBridge.exposeInMainWorld("inkos", api);

export type InkOSApi = typeof api;
