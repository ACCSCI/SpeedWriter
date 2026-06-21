import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Chrome = "custom" | "native";

const Ctx = createContext<{ chrome: Chrome }>({ chrome: "custom" });

/**
 * 平台 Provider:根据 Electron 主进程 platform() 返回值决定用自定义标题栏(custom)
 * 还是继续用原生 macOS 交通灯 + 现有 header(native)。
 *
 * - 默认值是 "custom" —— 乐观假设 Win/Linux,避免一帧 mac 风格闪现。
 * - macOS 上 platform() 返回 darwin 后降级为 "native",整段 TitleBar 都不会渲染。
 * - 纯 web 预览(没有 window.inkos)fallback 到 "custom"(不过没有 IPC,按钮点了也没用)。
 */
export function PlatformProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<Chrome>("custom");

  useEffect(() => {
    if (typeof window === "undefined" || !window.inkos) return;
    window.inkos.platform().then((p) => {
      if (p.platform === "darwin") setChrome("native");
    }).catch(() => {
      // 非 Electron 环境保持默认
    });
  }, []);

  return <Ctx.Provider value={{ chrome }}>{children}</Ctx.Provider>;
}

export function useChrome(): { chrome: Chrome } {
  return useContext(Ctx);
}