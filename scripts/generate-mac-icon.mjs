#!/usr/bin/env node
/**
 * InkOS Desktop — 生成 macOS .icns 图标
 *
 * 用途:从 assets/logo.svg 渲染多分辨率 PNG,再用 iconutil 打成 icns。
 *      electron-builder --mac 必须有 build/icon.icns(GitHub Actions macos-14 runner 自带 sips + iconutil)。
 *
 * 跨平台:
 *   - macOS:sips 把 SVG → 多个 PNG(16/32/64/128/256/512/1024),iconutil 打成 icns。
 *   - 其他平台:no-op + warn(留给 CI 处理),但仍然退出 0 避免阻塞 verify。
 *
 * 退出码:
 *   - 0  → 成功生成或 no-op
 *   - 1  → 生成失败(SVG 不存在、sips/iconutil 报错等)
 *
 * 用法:
 *   node scripts/generate-mac-icon.mjs
 *   node scripts/generate-mac-icon.mjs --source assets/logo.svg --out packages/desktop/build/icon.icns
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
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

  // === 2) sips 把 SVG 转成各尺寸 PNG ===
  for (const size of ICON_SIZES) {
    const out = `${iconsetDir}/icon_${size}x${size}.png`;
    execFileSync("sips", ["-z", String(size), String(size), SOURCE, "--out", out], { stdio: "pipe" });
  }
  // === 3) @2x 视网膜图标(必备) ===
  execFileSync("sips", ["-z", "32", "32", SOURCE, "--out", `${iconsetDir}/icon_16x16@2x.png`], { stdio: "pipe" });
  execFileSync("sips", ["-z", "64", "64", SOURCE, "--out", `${iconsetDir}/icon_32x32@2x.png`], { stdio: "pipe" });
  execFileSync("sips", ["-z", "256", "256", SOURCE, "--out", `${iconsetDir}/icon_128x128@2x.png`], { stdio: "pipe" });
  execFileSync("sips", ["-z", "512", "512", SOURCE, "--out", `${iconsetDir}/icon_256x256@2x.png`], { stdio: "pipe" });
  execFileSync("sips", ["-z", "1024", "1024", SOURCE, "--out", `${iconsetDir}/icon_512x512@2x.png`], { stdio: "pipe" });

  // === 4) iconutil 打成 icns ===
  execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", OUT], { stdio: "pipe" });

  log(`generated ${OUT} from ${SOURCE}`);
} catch (e) {
  fail(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
} finally {
  // 清理 iconset 中间产物
  rmSync(iconsetDir, { recursive: true, force: true });
}