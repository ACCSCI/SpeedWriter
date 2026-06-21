import { app, BrowserWindow } from "electron";
import { log } from "./logger.js";

export function setupSingleInstance(): void {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    log("warn", "Another instance already running — quitting");
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    // 用户开第二个 — 聚焦已有窗口
    const all = BrowserWindow.getAllWindows();
    const main = all[0];
    if (!main) return;
    if (main.isMinimized()) main.restore();
    main.focus();
  });
}
