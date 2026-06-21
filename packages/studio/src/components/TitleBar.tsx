import { useEffect, useState } from "react";
import { Minus, Copy, X, Maximize2, ChevronRight, Sun, Moon } from "lucide-react";
import { useHashRoute, type HashRoute } from "../hooks/use-hash-route";
import { useApi, putApi } from "../hooks/use-api";
import { useTheme } from "../hooks/use-theme";
import { useI18n } from "../hooks/use-i18n";
import { InkosLogo } from "./InkosLogo";

interface BookSummary {
  id: string;
  title: string;
}

/** 把 HashRoute 拆成面包屑节点数组,根节点永远是 InkOS / Studio */
function breadcrumbFor(
  route: HashRoute,
  books: ReadonlyArray<BookSummary> | undefined,
  tAny: (k: string) => string,
): Array<{ label: string; onClick?: () => void }> {
  const items: Array<{ label: string; onClick?: () => void }> = [
    { label: "InkOS", onClick: () => { location.hash = "#/dashboard"; } },
    { label: tAny("breadcrumb.studio") },
  ];

  const pushBook = (id: string) => {
    const b = books?.find((x) => x.id === id);
    items.push(
      b
        ? { label: b.title, onClick: () => { location.hash = `#/book/${id}`; } }
        : { label: id },
    );
  };

  // route.page 是 kebab-case(book-create 等),面包屑 key 是 camelCase,这里显式映射
  const PAGE_TO_KEY: Partial<Record<HashRoute["page"], string>> = {
    dashboard: "",  // 不追加第三段
    chat: "chat",
    "book-create": "bookCreate",
    "book-settings": "bookSettings",
    book: "book",
    analytics: "analytics",
    services: "services",
    "service-detail": "serviceDetail",
    "project-settings": "projectSettings",
    truth: "truth",
    daemon: "daemon",
    logs: "logs",
    genres: "genres",
    style: "style",
    import: "import",
    radar: "radar",
    doctor: "doctor",
  };

  switch (route.page) {
    case "chapter":
      pushBook(route.bookId);
      items.push({
        label: tAny("breadcrumb.chapterN").replace("{n}", String(route.chapterNumber)),
      });
      break;
    case "book":
    case "book-settings":
    case "truth":
    case "analytics":
      pushBook(route.bookId);
      break;
    default: {
      const key = PAGE_TO_KEY[route.page] ?? "";
      if (key) items.push({ label: tAny(`breadcrumb.${key}`) });
    }
  }

  return items;
}

export function TitleBar() {
  const { route } = useHashRoute();
  const { theme, setTheme } = useTheme();
  const { t, lang: currentLang } = useI18n();
  const { data: booksResp } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");

  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.inkos) return;
    const api = window.inkos;
    let mounted = true;
    api.getMaximized().then((r) => {
      if (mounted) setMaximized(r.value);
    });
    api.getFullscreen().then((r) => {
      if (mounted) setFullscreen(r.value);
    });
    const offM = api.onMaximizedChanged(setMaximized);
    const offF = api.onFullscreenChanged(setFullscreen);
    return () => {
      mounted = false;
      offM();
      offF();
    };
  }, []);

  const crumbs = breadcrumbFor(route, booksResp?.books, t as unknown as (k: string) => string);
  const isDark = theme === "dark";
  // i18n 动态 key 不在 StringKey 联合里,用宽口径调用
  const tAny = t as unknown as (k: string) => string;
  // 这个组件只在 Electron(chrome === "custom")下渲染,window.inkos 一定存在;
  // 但 TS 类型仍是可选的,所以局部捕获一下让事件处理器清爽
  const api = window.inkos;
  // 内联样式:WebkitAppRegion 不是标准 CSS,放 style 比 className 更稳
  const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
  const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

  return (
    <header
      className="h-10 shrink-0 flex items-center justify-between pl-4 pr-0 border-b border-border/40 bg-background/95 backdrop-blur-sm select-none relative z-50"
      style={drag}
      onDoubleClick={() => {
        if (!fullscreen && api) void api.toggleMaximize();
      }}
    >
      {/* Left: brand */}
      <div className="flex items-center gap-2" style={noDrag}>
        <InkosLogo className="h-5 w-5" />
        <span className="text-[15px] font-semibold tracking-tight text-foreground">InkOS</span>
      </div>

      {/* Center: breadcrumb */}
      <nav className="flex-1 flex items-center justify-center gap-1.5 min-w-0 px-6 text-[14px] text-muted-foreground">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <ChevronRight size={14} className="text-muted-foreground/50 shrink-0" />}
            {c.onClick ? (
              <button
                onClick={c.onClick}
                style={noDrag}
                className="truncate max-w-[28ch] hover:text-foreground transition-colors"
              >
                {c.label}
              </button>
            ) : (
              <span className="truncate max-w-[28ch]">{c.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Right cluster: lang + theme + window controls */}
      <div className="flex items-center gap-2" style={noDrag}>
        {/* 语言切换 */}
        <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5">
          {(["zh", "en"] as const).map((code) => (
            <button
              key={code}
              onClick={() => { void putApi("/project", { language: code }); }}
              className={`px-2 py-0.5 text-[13px] font-medium rounded transition-colors ${
                currentLang === code
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={tAny(`language.${code}`)}
            >
              {code === "zh" ? "中" : "EN"}
            </button>
          ))}
        </div>

        {/* 主题切换 */}
        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          title={tAny("theme.toggle")}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="w-px h-5 bg-border/60 mx-1" />

        {/* 窗口控制 */}
        <button
          onClick={() => { if (api) void api.minimize(); }}
          className="h-10 w-10 inline-flex items-center justify-center text-muted-foreground hover:bg-secondary/60 transition-colors"
          title={tAny("window.minimize")}
          style={noDrag}
        >
          <Minus size={16} />
        </button>
        <button
          onClick={() => { if (api) void api.toggleMaximize(); }}
          className="h-10 w-10 inline-flex items-center justify-center text-muted-foreground hover:bg-secondary/60 transition-colors"
          title={maximized ? tAny("window.restore") : tAny("window.maximize")}
          style={noDrag}
        >
          {maximized ? <Copy size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={() => { if (api) void api.close(); }}
          className="h-10 w-10 inline-flex items-center justify-center text-muted-foreground hover:bg-red-500/90 hover:text-white transition-colors"
          title={tAny("window.close")}
          style={noDrag}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}