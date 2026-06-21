/**
 * InkOS Desktop - Main Process Entry
 *
 * Architecture:
 * 1. Single-instance lock (requestSingleInstanceLock)
 * 2. initLogger (用 temp 目录,等 whenReady 后切到 userData)
 * 3. whenReady:
 *    a. setupUserData (路径 + 数据迁移)
 *    b. redirectLoggerToUserData
 *    c. loadSecrets (主进程 safeStorage 解密)
 *    d. startServer (spawn Hono 子进程,env 注入 secrets)
 *    e. createMainWindow (BrowserWindow 加载 http://127.0.0.1:<port>)
 *    f. registerIpc (handler 集合)
 *    g. buildMenu
 *    h. startPeriodicCheck (5s 首次 + 12h 周期检查 GitHub Releases)
 *
 * Shutdown:
 * - before-quit 防重入(isQuitting flag)
 * - try/finally 兜底,stop() 失败也 exit
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { startServer, type ServerHandle } from "./server.js";
import { createMainWindow } from "./window.js";
import { registerIpc, type IpcContext } from "./ipc.js";
import { setupSingleInstance } from "./single-instance.js";
import { buildMenu } from "./menu.js";
import { startPeriodicCheck } from "./update-checker.js";
import { setupUserData, getUserDataPaths } from "./user-data.js";
import { initLogger, log, redirectLoggerToUserData } from "./logger.js";
import { loadSecrets } from "./safe-storage.js";

// === 必须在最前 ===
setupSingleInstance();

// === logger 启动(temp 目录,等 whenReady 后切到 userData) ===
await initLogger();
log("info", `InkOS Desktop starting (electron ${process.versions.electron}, node ${process.versions.node})`);

// === 状态变量 ===
let mainWindow: BrowserWindow | null = null;
let serverHandle: ServerHandle | null = null;
let cachedSecrets: Record<string, string> = {};

// 防 before-quit 重入
let isQuitting = false;

const ipcCtx: IpcContext = {
  getMainWindow: () => mainWindow,
  getServerHandle: () => serverHandle,
  setServerHandle: (h) => {
    serverHandle = h;
  },
  getSecrets: () => cachedSecrets,
  onSecretsChanged: (s) => {
    cachedSecrets = s;
  },
};

app.whenReady().then(async () => {
  try {
    // 1) userData 路径 + 数据迁移
    await setupUserData();
    await redirectLoggerToUserData();

    // 2) 解密 secrets
    cachedSecrets = await loadSecrets();
    log("info", `[secrets] loaded ${Object.keys(cachedSecrets).length} encrypted keys`);

    // 3) 启动本地 Hono server
    const paths = getUserDataPaths();
    serverHandle = await startServer({
      projectRoot: paths.defaultProjectRoot,
      staticDir: paths.studioStaticDir,
      secrets: cachedSecrets,
    });
    log("info", `Local server ready at ${serverHandle.url}`);

    // 4) 创建窗口
    mainWindow = createMainWindow(serverHandle.url);

    // 5) IPC
    registerIpc(ipcMain, ipcCtx);

    // 6) 菜单
    buildMenu(mainWindow);

    // 7) 新版本检测
    startPeriodicCheck();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (serverHandle) {
          mainWindow = createMainWindow(serverHandle.url);
        }
      } else {
        mainWindow?.show();
      }
    });
  } catch (e) {
    log("error", `[startup] failed: ${e}`);
    app.exit(1);
  }
});

app.on("window-all-closed", () => {
  // Mac 习惯:窗口关掉 app 不退
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  if (isQuitting) return;
  isQuitting = true;
  if (serverHandle && !serverHandle.killed) {
    e.preventDefault();
    try {
      await serverHandle.stop();
    } catch (err) {
      log("error", `[shutdown] server stop failed: ${err}`);
    } finally {
      app.exit(0);
    }
  }
});
