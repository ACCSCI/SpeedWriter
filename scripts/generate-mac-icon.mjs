#!/usr/bin/env node
/**
 * InkOS Desktop — 生成 macOS .icns 图标
 *
 * 用途:从 assets/logo.svg 渲染多分辨率 PNG,再用 iconutil 打成 icns。
 *      electron-builder --mac 必须有 build/icon.icns(GitHub Actions macos-14 runner 自带 qlmanage + sips + iconutil)。
 *
 * 跨平台:
 *   - macOS:qlmanage 把 SVG → base PNG(支持 SVG),sips 缩放到各尺寸,iconutil 打成 icns。
 *   - 其他平台:no-op + warn(留给 CI 处理),但仍然退出 0 避免阻塞 verify。
 *
 * 退出码:
 *   - 0  → 成功生成或 no-op
 *   - 1  → 生成失败(SVG 不存在、qlmanage/sips/iconutil 报错等)
 *
 * 用法:
 *   node scripts/generate-mac-icon.mjs
 *   node scripts/generate-mac-icon.mjs --source assets/logo.svg --out packages/desktop/build/icon.icns
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// === 参数解析 ===
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1] ?? fallback;
}
const SOURCE = resolve(ROOT, arg("--source", "assets/logo.svg"));
const OUT = resolve(ROOT, arg("--out", "packages/desktop/build/icon.icns"));
const ICON_SIZES = [16, 32, 64, 128, 256, 512, 1024];

const log = (m) => process.stdout.write(`[generate-mac-icon] ${m}\n`);
const warn = (m) => process.stdout.write(`[generate-mac-icon] warn: ${m}\n`);
const fail = (m) => process.stdout.write(`[generate-mac-icon] error: ${m}\n`);

// === 非 macOS:no-op,CI 才真跑 ===
if (os.platform() !== "darwin") {
  if (existsSync(OUT) && statSync(OUT).size > 0) {
    log(`skip (non-darwin) — icon already exists at ${OUT}`);
    process.exit(0);
  }
  warn(`non-darwin platform + no existing ${OUT} — skipping. Generate on macOS or via CI before packaging.`);
  process.exit(0);
}

// === 源文件存在性 ===
if (!existsSync(SOURCE)) {
  fail(`source SVG not found: ${SOURCE}`);
  process.exit(1);
}

const iconsetDir = `${OUT}.iconset`;
const outDir = dirname(OUT);
mkdirSync(outDir, { recursive: true });

try {
  // === 1) 清空旧 iconset ===
  rmSync(iconsetDir, { recursive: true, force: true });
  mkdirSync(iconsetDir, { recursive: true });

  // === 2) qlmanage 把 SVG 转成 base PNG(1024x1024 起步,足够 retina) ===
  // macOS sips 不支持 SVG 输入,但 qlmanage(Quick Look)支持 — 用它先转成 PNG
  // 输出:iconsetDir/{原文件名}.png(qlmanage 自动加 .png 后缀)
  execFileSync("qlmanage", ["-t", "-s", "1024", "-o", iconsetDir, SOURCE], { stdio: "pipe" });
  const qlOutput = `${iconsetDir}/${basename(SOURCE)}.png`;
  const basePng = `${iconsetDir}/base_1024.png`;
  if (!existsSync(qlOutput)) {
    fail(`qlmanage didn't produce ${qlOutput}`);
    process.exit(1);
  }
  renameSync(qlOutput, basePng);

  // === 3) sips 把 base PNG 缩放到各尺寸 PNG(sips 支持 PNG,不支持 SVG) ===
  for (const size of ICON_SIZES) {
    execFileSync("sips", ["-z", String(size), String(size), basePng, "--out", `${iconsetDir}/icon_${size}x${size}.png`], { stdio: "pipe" });
  }
  // === 4) @2x 视网膜图标(必备) ===
  execFileSync("sips", ["-z", "32", "32", basePng, "--out", `${iconsetDir}/icon_16x16@2x.png`], { stdio: "pipe" });
  execFileSync("sips", ["-z", "64", "64", basePng, "--out", `${iconsetDir}/icon_32x32@2x.png`], { stdio: "pipe" });
  execFileSync("sips", ["-z", "256", "256", basePng, "--out", `${iconsetDir}/icon_128x128@2x.png`], { stdio: "pipe" });
  execFileSync("sips", ["-z", "512", "512", basePng, "--out", `${iconsetDir}/icon_256x256@2x.png`], { stdio: "pipe" });
  execFileSync("sips", ["-z", "1024", "1024", basePng, "--out", `${iconsetDir}/icon_512x512@2x.png`], { stdio: "pipe" });

  // === 5) iconutil 打成 icns ===
  execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", OUT], { stdio: "pipe" });

  log(`generated ${OUT} from ${SOURCE}`);
} catch (e) {
  fail(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
} finally {
  // 清理 iconset 中间产物
  rmSync(iconsetDir, { recursive: true, force: true });
}