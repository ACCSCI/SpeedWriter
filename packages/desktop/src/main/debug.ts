/**
 * Debug 监控框架 — 仅当 INKOS_DESKTOP_DEBUG=1 时激活。
 *
 * 输出到 <userData>/debug/:
 *   - screenshot-<ts>-{0s,2s,5s,12s}.png   主窗口截图
 *   - console-<ts>.log                    renderer console 全部消息
 *   - dom-<ts>.html                       renderer document.outerHTML
 *   - network-<ts>.log                    所有 HTTP 响应(含 statusCode)
 *   - state-<ts>.json                     窗口 bounds/title/url + 截图路径
 *
 * 触发方式(任一):
 *   Windows PowerShell:
 *     $env:INKOS_DESKTOP_DEBUG="1"; & "D:\...\InkOS.exe"
 *   Git Bash / WSL:
 *     INKOS_DESKTOP_DEBUG=1 "/d/Projects/.../InkOS.exe"
 *
 * 注意:此模块只在主进程加载;renderer 侧的 console.log 通过
 *       webContents.on("console-message") 桥接,无需改动 preload。
 */
import { app, BrowserWindow, session } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SCREENSHOT_DELAYS_MS = [0, 2000, 5000, 12000];

function isDebugMode(): boolean {
  return process.env.INKOS_DESKTOP_DEBUG === "1";
}

export async function attachDebugMonitor(win: BrowserWindow): Promise<void> {
  if (!isDebugMode()) return;

  const debugDir = join(app.getPath("userData"), "debug");
  await mkdir(debugDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const consoleLogPath = join(debugDir, `console-${ts}.log`);
  const networkLogPath = join(debugDir, `network-${ts}.log`);
  const stateLogPath = join(debugDir, `state-${ts}.json`);
  const domLogPath = join(debugDir, `dom-${ts}.html`);

  const consoleLines: string[] = [];
  const networkLines: string[] = [];
  const screenshotPaths: string[] = [];

  const consoleHandler = (
    _e: unknown,
    level: number,
    message: string,
    line: number,
    sourceId: string,
  ) => {
    const levelName = ["verbose", "info", "warning", "error"][level] ?? `L${level}`;
    const line_ = `[${new Date().toISOString()}] [${levelName}] ${sourceId}:${line} ${message}`;
    consoleLines.push(line_);
    // 同步写一行到主进程日志,方便 tail -f
    console.log(`[debug:console] ${line_}`);
  };
  win.webContents.on("console-message", consoleHandler);

  // 监听所有 HTTP 响应;记录 method/statusCode/url
  const webRequest = win.webContents.session.webRequest;
  webRequest.onResponseStarted((details) => {
    const line_ = `[${new Date().toISOString()}] ${details.statusCode} ${details.method} ${details.url}`;
    networkLines.push(line_);
    if (details.statusCode >= 400) {
      console.log(`[debug:network:ERR] ${line_}`);
    }
  });
  webRequest.onErrorOccurred((details) => {
    const line_ = `[${new Date().toISOString()}] NETWORK_ERROR ${details.error} ${details.method ?? "?"} ${details.url}`;
    networkLines.push(line_);
    console.log(`[debug:network:ERR] ${line_}`);
  });

  // did-fail-load / render-process-gone 写到 consoleLines
  const failHandler = (
    _e: unknown,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
  ) => {
    const line_ = `[${new Date().toISOString()}] [FAIL] code=${errorCode} desc=${errorDescription} url=${validatedURL}`;
    consoleLines.push(line_);
    console.log(`[debug:fail] ${line_}`);
  };
  win.webContents.on("did-fail-load", failHandler);

  const goneHandler = (_e: unknown, details: { reason: string; exitCode: number }) => {
    const line_ = `[${new Date().toISOString()}] [RENDERER_GONE] reason=${details.reason} exitCode=${details.exitCode}`;
    consoleLines.push(line_);
    console.log(`[debug:gone] ${line_}`);
  };
  win.webContents.on("render-process-gone", goneHandler);

  // 截屏
  const captureScreenshot = async (label: string) => {
    try {
      const image = await win.webContents.capturePage();
      const path = join(debugDir, `screenshot-${ts}-${label}.png`);
      await writeFile(path, image.toPNG());
      screenshotPaths.push(path);
      console.log(`[debug:screenshot] saved ${path} (${image.getSize().width}x${image.getSize().height})`);
    } catch (e) {
      console.log(`[debug:screenshot] ${label} failed: ${(e as Error).message}`);
    }
  };

  const timers: NodeJS.Timeout[] = [];
  for (const delay of SCREENSHOT_DELAYS_MS) {
    const label = `${Math.round(delay / 1000)}s`;
    timers.push(setTimeout(() => void captureScreenshot(label), delay));
  }

  // 最终落盘 — 12s 后写 console/network/state/dom
  const finalTimer = setTimeout(async () => {
    try {
      let domHtml = "";
      try {
        domHtml = await win.webContents.executeJavaScript(
          "document.documentElement ? document.documentElement.outerHTML : '<no document>'",
          true,
        );
      } catch (e) {
        domHtml = `<executeJavaScript failed: ${(e as Error).message}>`;
      }

      const state = {
        ts,
        userData: app.getPath("userData"),
        window: {
          bounds: win.getBounds(),
          isVisible: win.isVisible(),
          isMinimized: win.isMinimized(),
          isFullScreen: win.isFullScreen(),
          isMaximized: win.isMaximized(),
          title: win.getTitle(),
        },
        webContents: {
          url: win.webContents.getURL(),
          isCrashed: win.webContents.isCrashed(),
          isLoading: win.webContents.isLoading(),
        },
        screenshots: screenshotPaths,
        consoleCount: consoleLines.length,
        networkCount: networkLines.length,
      };

      await writeFile(consoleLogPath, consoleLines.join("\n"), "utf-8");
      await writeFile(networkLogPath, networkLines.join("\n"), "utf-8");
      await writeFile(stateLogPath, JSON.stringify(state, null, 2), "utf-8");
      await writeFile(domLogPath, domHtml, "utf-8");

      console.log(`[debug] flushed to ${debugDir}`);
      console.log(`[debug]   console: ${consoleLogPath} (${consoleLines.length} lines)`);
      console.log(`[debug]   network: ${networkLogPath} (${networkLines.length} lines)`);
      console.log(`[debug]   state:   ${stateLogPath}`);
      console.log(`[debug]   dom:     ${domLogPath} (${domHtml.length} bytes)`);
      console.log(`[debug]   shots:   ${screenshotPaths.join(", ")}`);
    } catch (e) {
      console.log(`[debug] flush failed: ${(e as Error).message}`);
    }
  }, 14000);

  // 进程退出兜底再写一次
  const flushSync = () => {
    try {
      writeFileSync(consoleLogPath, consoleLines.join("\n"), "utf-8");
      writeFileSync(networkLogPath, networkLines.join("\n"), "utf-8");
      console.log(`[debug] emergency flush on exit`);
    } catch {
      // ignore
    }
  };
  process.once("exit", flushSync);

  // 把 session 引用保留(避免被 GC),同时把 timer 暴露给开发者控制台方便手动 clear
  (win as unknown as { __debugTimers?: NodeJS.Timeout[] }).__debugTimers = [...timers, finalTimer];
  // 抑制 lint:session 是默认 session,这里仅用于引用
  void session;
}
