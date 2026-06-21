# InkOS Desktop

Electron wrapper for InkOS Studio. 把 InkOS 桌面化,非技术用户双击即用。

## 架构

```
主进程 (Node)              子进程 (Node, ELECTRON_RUN_AS_NODE=1)
├─ initLogger             ├─ startStudioServer (Hono)
├─ setupUserData            ├─  + staticDir (studio/dist)
├─ loadSecrets (safeStorage)├─  + env INKOS_SECRET_* (LLM key)
├─ startServer (portfinder)  └─  GET /api/v1/health
├─ createMainWindow (4567)             ▲
└─ registerIpc (8 handlers)            │
        ▲                                │
        │ IPC (preload)                  │
        ▼                                │
渲染进程 (Chromium) ────────── http://127.0.0.1:4567
└─ Studio UI + UpdateBanner
```

## 开发

```bash
# 一次性
pnpm install
pnpm exec playwright install --with-deps chromium

# 开发模式(`predev` 钩子自动杀残留进程 + 清 SingletonLock,避免反复调试时
# Hono 子进程变孤儿占着 4567 端口,导致下次启动 portfinder 选 4625 → 404 → 黑屏)
pnpm --filter @actalk/inkos-desktop dev

# 快速 smoke 测试(不依赖 LLM,~30s)
./scripts/verify-desktop.sh --smoke

# 完整 e2e(包含 LLM 真实调用,需要 .env INKOS_LLM_API_KEY)
./scripts/verify-desktop.sh

# 自治循环(失败自动重试,直到绿)
./scripts/verify-desktop.sh --loop
```

## 打 release

```bash
# Windows .exe(本机)
pnpm --filter @actalk/inkos-desktop dist:win

# Mac .dmg(需要 Mac,或在 GitHub Actions 的 macos-14 runner)
pnpm --filter @actalk/inkos-desktop dist:mac
```

## e2e 测试

- `e2e/smoke.spec.ts`:核心 smoke(6 个,无需 LLM)
- `e2e/llm.spec.ts`:LLM 真实调用(2 个,需要 MiniMax key)

```bash
pnpm test:smoke  # 只跑 smoke,~10s
pnpm test:llm    # 只跑 llm,~10s + 真实 LLM 延迟
pnpm test:e2e    # 跑全部
```

## 文件结构

```
packages/desktop/
├── src/
│   ├── main/                # 主进程(11 个文件)
│   │   ├── index.ts        # 入口:生命周期 + IPC
│   │   ├── window.ts       # BrowserWindow 创建
│   │   ├── server.ts       # Hono 子进程 spawn
│   │   ├── safe-storage.ts # LLM Key 加密(主进程专用)
│   │   ├── ipc.ts          # 8 个 IPC handler
│   │   ├── update-checker.ts # GitHub Releases 轮询
│   │   ├── menu.ts         # Mac 习惯菜单
│   │   ├── single-instance.ts
│   │   ├── user-data.ts    # userData 路径 + 数据迁移
│   │   └── logger.ts       # 日志(7 天滚动)
│   ├── preload/
│   │   └── index.ts         # contextBridge 暴露 8 个 API
│   └── server/
│       └── entry.ts         # 子进程入口(消费 INKOS_SECRET_* env)
├── e2e/                    # Playwright e2e
├── playwright.config.ts
├── electron-builder.yml    # 三平台打包配置(无签名,无公证)
└── dist/
    ├── main/               # tsc 产物
    └── main/server/entry.js # esbuild 打包(5MB,含 core + studio)
```

## 已知限制

- **首次启动 5~10s**(electron cold start + Hono init + 7 stage startup)
- **不签名**(macOS 首次打开需右键"打开";Windows 首次需"仍要运行")
- **不公证**(macOS 打开有警告,签了就消失)
- **不自动更新**(App 启动后 5s 检查 GitHub,有新版本顶部弹横幅,用户手动下载)

## 月成本

- Apple Developer ID:**不做**(¥0)
- Win 代码签名:**不做**(¥0)
- GitHub Actions(macos-14):**免费**(公开仓库 2000 分钟/月)
- LLM API:用户自配 Key,平台不掏钱
- **总:¥0/月**
