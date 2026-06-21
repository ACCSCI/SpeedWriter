/**
 * 新版本横幅
 * - 启动 5s 后调 window.inkos.checkUpdate()
 * - 有新版本时顶部弹黄条
 * - 点 [下载] → window.inkos.openRelease() 跳 GitHub
 * - 点 [忽略] → 写 store,不再提示该版本
 */
import { useEffect, useState } from "react";
import { X, Download, Bell, ExternalLink } from "lucide-react";

interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  assets: { macDmg: string | null; macZip: string | null; winExe: string | null; linuxAppImage: string | null };
}

interface InkOSApi {
  // 更新检测
  checkUpdate(force?: boolean): Promise<UpdateInfo>;
  skipVersion(v: string): Promise<{ ok: boolean }>;
  openRelease(url: string): Promise<{ ok: boolean }>;
  // 系统
  platform(): Promise<{ platform: NodeJS.Platform; arch: string; versions: NodeJS.ProcessVersions }>;
  // 窗口控制(Win/Linux 自定义标题栏)
  minimize(): Promise<{ ok: boolean }>;
  toggleMaximize(): Promise<{ ok: boolean }>;
  close(): Promise<{ ok: boolean }>;
  getMaximized(): Promise<{ ok: boolean; value: boolean }>;
  getFullscreen(): Promise<{ ok: boolean; value: boolean }>;
  onMaximizedChanged(cb: (v: boolean) => void): () => void;
  onFullscreenChanged(cb: (v: boolean) => void): () => void;
}

declare global {
  interface Window {
    inkos?: InkOSApi;
  }
}

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.inkos) return;

    let cancelled = false;
    const check = async () => {
      await new Promise((r) => setTimeout(r, 5000));
      if (cancelled) return;
      try {
        const result = await window.inkos!.checkUpdate(false);
        if (!cancelled && result.available) setInfo(result);
      } catch (e) {
        console.warn("Update check failed:", e);
      }
    };
    void check();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!info?.available || dismissed || !info.latestVersion) return null;

  const handleDownload = async () => {
    await window.inkos?.openRelease(info.releaseUrl);
  };

  const handleSkip = async () => {
    await window.inkos?.skipVersion(info.latestVersion!);
    setDismissed(true);
  };

  const releaseDate = info.publishedAt ? new Date(info.publishedAt).toLocaleDateString() : "";

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="flex items-center gap-3 border-b border-amber-500/30 bg-gradient-to-r from-amber-500/15 to-amber-500/5 px-4 py-2.5 text-sm"
    >
      <Bell className="h-4 w-4 shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0">
        <strong className="font-semibold">InkOS {info.latestVersion}</strong>
        <span className="text-muted-foreground"> 已发布</span>
        <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">
          (当前 {info.currentVersion}
          {releaseDate && ` · ${releaseDate}`})
        </span>
      </div>
      <button
        onClick={handleDownload}
        data-testid="update-download"
        className="shrink-0 rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-black hover:bg-amber-400 inline-flex items-center gap-1"
      >
        <Download className="h-3 w-3" /> 下载
        <ExternalLink className="h-2.5 w-2.5" />
      </button>
      <button
        onClick={handleSkip}
        data-testid="update-skip"
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
      >
        忽略
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="关闭"
        data-testid="update-dismiss"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
