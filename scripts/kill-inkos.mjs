#!/usr/bin/env node
/**
 * InkOS Desktop — 杀残留进程 + 清锁
 *
 * 用途:作为 predev / prebuild / prestart 前置钩子,避免反复启动调试时
 *      spawn 出来的 Hono 子进程变孤儿占着 4567 端口,导致下次启动
 *      portfinder 选 4625/4628 等,renderer 拿到旧 URL → 404 → 黑屏。
 *
 * 跨平台:
 *   - Win:PowerShell Get-Process + Stop-Process + Remove-Item
 *   - Mac/Linux:pkill + rm
 *
 * 注意:Win 上不用 cmd / taskkill(会被 Git Bash MSYS 拦截 stdout 导致杀不干净),
 *      也不用 execFileSync 包裹(同理)。PowerShell 是 native Win32 进程,绕过 MSYS。
 *
 * 失败安全:所有 try/catch,任何步骤失败只 log 不抛错(不能因为 kill 失败
 *         阻止 dev/build 启动)。
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import os from "node:os";

const platform = os.platform();
const isWin = platform === "win32";
const productName = "InkOS";   // electron-builder.yml#productName
const userDataSubPath = "@actalk/inkos-desktop";   // app.getName() 默认 = package.json#name

let userData;
let userDataSep;
if (isWin) {
  userData = `${process.env.APPDATA}\\${userDataSubPath}`;
  userDataSep = "\\";
} else if (platform === "darwin") {
  userData = `${process.env.HOME}/Library/Application Support/${userDataSubPath}`;
  userDataSep = "/";
} else {
  userData = `${process.env.HOME}/.config/${userDataSubPath}`;
  userDataSep = "/";
}

const log = (msg) => process.stdout.write(`[kill-inkos] ${msg}\n`);
const fail = (msg) => process.stdout.write(`[kill-inkos] warn: ${msg}\n`);

function safeExec(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 杀指定名字的进程(Win:PowerShell Stop-Process,Mac/Linux:pkill)
 *
 * Win 上 Git Bash MSYS 会拦截 cmd / taskkill 的 stdout/stderr,导致 Node
 * execFileSync 看不到输出或杀不干净。解法:spawn PowerShell(native Win32 进程,
 * 不经过 MSYS 层),用 Get-Process + Stop-Process 原生 cmdlet。
 * 找不到匹配时 SilentlyContinue 不报错。
 */
function killByName(name) {
  if (isWin) {
    return safeExec("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Stop-Process -Force; exit 0`,
    ]);
  }
  safeExec("pkill", ["-9", "-f", name]);
  return true;
}

/** 删文件,不存在不报错 */
function safeUnlink(p) {
  if (isWin) {
    return safeExec("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `try { Remove-Item -Path '${p}' -Force -ErrorAction Stop } catch {}; exit 0`,
    ]);
  }
  return safeExec("rm", ["-f", p]);
}

// === 1) 杀残留 InkOS 主进程 ===
// 真实场景:父进程 InkOS.exe 被强杀,子进程 electron.exe 变孤儿,占着 4567 端口
// → 下次启动 portfinder 选 4625 → 404 → 黑屏
// 所以两层都杀:产品名 + electron(只要命令行含 inkos 路径)
if (isWin) {
  killByName(productName);
  killByName("electron");  // /IM electron.exe 杀掉所有 electron,任务就是"清理"全杀
} else {
  killByName(`${productName}(.app)?/Contents/MacOS/${productName}`);
  killByName(`electron.*${userDataSubPath}`);  // pkill -f 用正则匹配
}

// === 2) 清 SingletonLock + SingletonSocket(防 single-instance 误判) ===
safeUnlink(`${userData}${userDataSep}SingletonLock`) || fail("clear SingletonLock failed");
safeUnlink(`${userData}${userDataSep}SingletonSocket`) || fail("clear SingletonSocket failed");

// === 3) 清 server.port(让 e2e 知道要 polling 重新发现) ===
safeUnlink(`${userData}${userDataSep}server.port`);

log("clean");
