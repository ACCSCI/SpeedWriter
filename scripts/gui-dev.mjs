#!/usr/bin/env node
/**
 * One-command launcher for InkOS Studio GUI (API + Vite dev server).
 * Works on Windows PowerShell, macOS, and Linux.
 *
 * Usage:  pnpm gui
 */
import { exec, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const studioDir = resolve(rootDir, "packages", "studio");

const API_PORT = process.env.INKOS_STUDIO_PORT ?? "3001";
const VITE_PORT = process.env.INKOS_VITE_PORT ?? "3000";

// ── resolve project root (needs inkos.json) ─────────────────────────────────

let projectRoot = process.env.INKOS_PROJECT_ROOT ?? "";
if (!projectRoot) {
  // Check common locations for inkos.json
  const candidates = [
    resolve(rootDir, "test-project"),
    resolve(rootDir, ".."),
    rootDir,
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "inkos.json"))) {
      projectRoot = dir;
      break;
    }
  }
}
if (!projectRoot || !existsSync(resolve(projectRoot, "inkos.json"))) {
  console.error(
    "\n  \x1b[31m[error]\x1b[0m inkos.json not found.\n" +
    "  Set INKOS_PROJECT_ROOT to your InkOS project directory, e.g.:\n" +
    '  $env:INKOS_PROJECT_ROOT="path/to/project"; pnpm gui\n'
  );
  process.exit(1);
}

console.log(`  Project → ${projectRoot}`);

// ── helpers ──────────────────────────────────────────────────────────────────

const colors = {
  api: "\x1b[36m",    // cyan
  vite: "\x1b[35m",   // magenta
  reset: "\x1b[0m",
};

function prefix(tag) {
  return (data) => {
    for (const line of data.toString().split("\n")) {
      if (line.trim()) console.log(`${colors[tag]}[${tag}]${colors.reset} ${line}`);
    }
  };
}

function launch(tag, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: studioDir,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: { ...process.env, ...env },
  });

  child.stdout.on("data", prefix(tag));
  child.stderr.on("data", prefix(tag));

  child.on("exit", (code) => {
    if (code !== 0) {
      console.log(`${colors[tag]}[${tag}]${colors.reset} exited with code ${code}`);
    }
  });

  return child;
}

// ── kill a port on Windows (netstat + taskkill) ─────────────────────────────

function killPort(port) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve();
    exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
      if (!stdout) return resolve();
      const pids = new Set();
      for (const line of stdout.split("\n")) {
        const cols = line.trim().split(/\s+/);
        const pid = cols[cols.length - 1];
        if (pid && pid !== "0" && !isNaN(pid)) pids.add(pid);
      }
      if (pids.size === 0) return resolve();
      const cmd = [...pids].map((p) => `taskkill /F /PID ${p}`).join(" & ");
      exec(cmd, () => resolve());
    });
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log(`\n  InkOS Studio dev servers`);
console.log(`  API   → http://localhost:${API_PORT}`);
console.log(`  GUI   → http://localhost:${VITE_PORT}\n`);

// Free up ports before launching
await killPort(VITE_PORT);

const api = launch("api", "npx", ["tsx", "watch", "--clear-screen=false", "src/api/index.ts"], {
  INKOS_STUDIO_PORT: API_PORT,
  INKOS_PROJECT_ROOT: projectRoot,
});

const vite = launch("vite", "npx", ["vite", "--host", "--port", VITE_PORT], {
  INKOS_STUDIO_PORT: API_PORT,
});

// ── graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
  console.log("\n  Shutting down…");
  api.kill();
  vite.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  try { api.kill(); } catch {}
  try { vite.kill(); } catch {}
});
