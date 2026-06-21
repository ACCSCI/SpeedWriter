/**
 * GitHub Releases API 轮询 + 横幅通知
 * - 启动 5s 后首次检查
 * - 每 12 小时检查一次
 * - 用户点"忽略"写 electron-store,不再提示该版本
 * - 草稿/预发布版本跳过
 */
import { app, net } from "electron";
import Store from "electron-store";
import { log } from "./logger.js";

const CHECK_INTERVAL = 12 * 60 * 60 * 1000;
const MIN_CHECK_GAP = 60 * 1000;
const GITHUB_API = "https://api.github.com/repos/Narcooo/inkos/releases/latest";

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  assets: { macDmg: string | null; macZip: string | null; winExe: string | null; linuxAppImage: string | null };
}

interface UpdateState {
  skippedVersions: string[];
  lastCheckedAt: number;
}

const store = new Store<UpdateState>({
  name: "update-state",
  defaults: { skippedVersions: [], lastCheckedAt: 0 },
});

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const currentVersion = app.getVersion();
  const empty: UpdateInfo = {
    available: false,
    currentVersion,
    latestVersion: null,
    releaseUrl: "",
    releaseNotes: "",
    publishedAt: "",
    assets: { macDmg: null, macZip: null, winExe: null, linuxAppImage: null },
  };

  const now = Date.now();
  if (!force && now - store.get("lastCheckedAt") < MIN_CHECK_GAP) return empty;
  if (!net.isOnline()) {
    log("info", "[update] offline, skip");
    return empty;
  }

  try {
    const res = await fetch(GITHUB_API, { headers: { "User-Agent": `InkOS/${currentVersion}` } });
    if (!res.ok) {
      log("warn", `[update] GitHub API ${res.status}`);
      return empty;
    }
    const data = (await res.json()) as {
      tag_name: string;
      html_url: string;
      body: string;
      published_at: string;
      assets: Array<{ name: string; browser_download_url: string }>;
      draft: boolean;
      prerelease: boolean;
    };

    if (data.draft || data.prerelease) {
      log("info", "[update] latest is draft/prerelease, skip");
      return empty;
    }

    const latestVersion = data.tag_name.replace(/^v/, "");
    const skipped = store.get("skippedVersions");
    const isSkipped = skipped.includes(latestVersion);
    const isNewer = compareVersions(latestVersion, currentVersion) > 0;

    const info: UpdateInfo = {
      available: isNewer && !isSkipped,
      currentVersion,
      latestVersion,
      releaseUrl: data.html_url,
      releaseNotes: (data.body ?? "").slice(0, 1000),
      publishedAt: data.published_at,
      assets: { macDmg: null, macZip: null, winExe: null, linuxAppImage: null },
    };

    for (const a of data.assets) {
      if (a.name.endsWith(".dmg") && a.name.includes("mac")) info.assets.macDmg = a.browser_download_url;
      else if (a.name.endsWith(".zip") && a.name.includes("mac")) info.assets.macZip = a.browser_download_url;
      else if (a.name.endsWith(".exe") && a.name.includes("Setup")) info.assets.winExe = a.browser_download_url;
      else if (a.name.endsWith(".AppImage")) info.assets.linuxAppImage = a.browser_download_url;
    }

    store.set("lastCheckedAt", now);
    log("info", `[update] current=${currentVersion} latest=${latestVersion} available=${info.available} skipped=${isSkipped}`);
    return info;
  } catch (e) {
    log("error", `[update] check failed: ${e}`);
    return empty;
  }
}

export function skipVersion(version: string): void {
  const skipped = store.get("skippedVersions");
  if (!skipped.includes(version)) {
    skipped.push(version);
    store.set("skippedVersions", skipped);
  }
  log("info", `[update] user skipped version ${version}`);
}

export function clearSkippedVersions(): void {
  store.set("skippedVersions", []);
}

let timer: NodeJS.Timeout | null = null;
export function startPeriodicCheck(): void {
  if (timer) return;
  setTimeout(() => {
    checkForUpdate().catch(() => {});
  }, 5000);
  timer = setInterval(() => {
    checkForUpdate().catch(() => {});
  }, CHECK_INTERVAL);
}

export function stopPeriodicCheck(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
