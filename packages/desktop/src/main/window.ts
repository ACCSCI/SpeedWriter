/**
 * BrowserWindow 创建 + 防御
 * - show: false + ready-to-show 避免白屏
 * - titleBarStyle: hiddenInset(Mac 红绿灯嵌入)
 * - 外链走系统浏览器(setWindowOpenHandler + will-navigate)
 * - did-fail-load 兜底(server 没起时显示可读错误)
 * - render-process-gone 兜底
 * - macOS 28px CSS padding 适配红绿灯
 */
import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { log } from "./logger.js";
import { attachDebugMonitor } from "./debug.js";

// DevTools:默认允许打开(Ctrl+Shift+I / View > Toggle Developer Tools);
// 用 INKOS_DESKTOP_DISABLE_DEVTOOLS=1 显式禁用(用于生产渠道/商店分发,完全锁死)。
// 注意:这里只控制 webPreferences.devTools 开关,不会自动打开 DevTools ——
//        想自动打开可在 ready-to-show 里加 openDevTools(),或在 .env 设专用开关。
const devToolsEnabled = process.env.INKOS_DESKTOP_DISABLE_DEVTOOLS !== "1";
const isMac = process.platform === "darwin";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createMainWindow(serverUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "InkOS",
    show: false,
    backgroundColor: "#0a0a0a",
    // macOS 保留系统交通灯 + 自定义标题栏(28px padding hack 在下方注入);
    // Win/Linux 完全自定义,无原生标题栏。
    frame: isMac,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: join(import.meta.dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: devToolsEnabled,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(serverUrl)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    log("error", `[window] did-fail-load: ${errorCode} ${errorDescription} url=${validatedURL}`);
    if (errorCode === -102 || errorCode === -105) {
      const safeUrl = escapeHtml(serverUrl);
      win.webContents.executeJavaScript(`
        document.body.innerHTML = '<div style="font-family:-apple-system,sans-serif;padding:40px;background:#1a1a1a;color:#eee;height:100vh"><h2>Server failed to start</h2><p>InkOS local server did not respond on ${safeUrl}.</p><p>Check logs at: ~/Library/Application Support/InkOS/logs/</p><p>Or run <code>inkos doctor</code> from the terminal.</p></div>';
      `);
    }
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    log("error", `[window] render-process-gone: ${JSON.stringify(details)}`);
  });

  // macOS 红绿灯嵌入标题栏 → 注入 28px padding(Win/Linux 自绘,无需此 hack)
  if (isMac) {
    win.webContents.on("did-finish-load", () => {
      win.webContents.insertCSS(`
        body, #root, .app-shell { padding-top: 28px !important; }
        @media (max-width: 800px) { body { padding-top: 0 !important; } }
      `);
    });
  }

  // 推送 maximize/fullscreen 状态供 TitleBar 翻转按钮图标 + 控制全屏时卸载
  win.on("maximize", () => {
    if (!win.isDestroyed()) win.webContents.send("win:maximized-changed", true);
  });
  win.on("unmaximize", () => {
    if (!win.isDestroyed()) win.webContents.send("win:maximized-changed", false);
  });
  win.on("enter-full-screen", () => {
    if (!win.isDestroyed()) win.webContents.send("win:fullscreen-changed", true);
  });
  win.on("leave-full-screen", () => {
    if (!win.isDestroyed()) win.webContents.send("win:fullscreen-changed", false);
  });
  win.webContents.once("did-finish-load", () => {
    if (win.isDestroyed()) return;
    win.webContents.send("win:maximized-changed", win.isMaximized());
    win.webContents.send("win:fullscreen-changed", win.isFullScreen());
  });

  win.once("ready-to-show", () => {
    win.show();
    // DevTools 默认不自动打开;按 Ctrl+Shift+I / View > Toggle Developer Tools 手动启用
  });

  win.loadURL(serverUrl);
  // 调试模式(INKOS_DESKTOP_DEBUG=1)下挂载监控:截屏 + console + 网络 + DOM。
  // 不 await,失败也不影响主流程。
  void attachDebugMonitor(win).catch((e) => log("warn", `[debug] attach failed: ${(e as Error).message}`));
  return win;
}
