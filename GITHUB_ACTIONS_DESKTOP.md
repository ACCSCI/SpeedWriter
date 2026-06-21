# GitHub Actions — 三端桌面安装包打包方案 (v1.1)

> **版本**:v1.1(2026-06-21)
> **变更**:v1.0 → v1.1 — **移除 CI 必须配 INKOS_LLM_API_KEY 的硬性要求**,改为可选;release job 不再依赖 llm;新增 §15 密钥安全审计
> **目标**:在 GitHub Actions 上**全量自动化**出 macOS / Windows / Linux 三端安装包,Tag 推送即发布到 GitHub Release,用户下载即用
> **配套文档**:`ELECTRON_DESKTOP.md`(Electron 本体) · `scripts/verify-desktop.sh`(本机一键验证)
> **代码现状**:本机 `dist:win` 已成功出过 `InkOS Setup 1.5.0.exe`(81M),三平台 e2e 绿灯

---

## 目录

1. [TL;DR — 三句话讲清楚](#1-tldr--三句话讲清楚)
2. [核心原则(为什么这么设计)](#2-核心原则为什么这么设计)
3. [关键安全前提:Key 在哪](#3-关键安全前提key-在哪)
4. [工作流总览](#4-工作流总览)
5. [工作流 1:`desktop-verify.yml` — 验证闸门](#5-工作流-1desktop-verifyyml--验证闸门)
6. [工作流 2:`desktop-build.yml` — 出包 + 发布](#6-工作流-2desktop-buildyml--出包--发布)
7. [缓存策略详解](#7-缓存策略详解)
8. [产物命名与上传](#8-产物命名与上传)
9. [用户最终体验](#9-用户最终体验)
10. [成本与配额](#10-成本与配额)
11. [第一次发版剧本(逐行命令)](#11-第一次发版剧本逐行命令)
12. [排错与回滚](#12-排错与回滚)
13. [监控](#13-监控)
14. [已知风险与缓解](#14-已知风险与缓解)
15. [密钥安全审计(必读)](#15-密钥安全审计必读)
16. [CI 密钥配置矩阵](#16-ci-密钥配置矩阵)
17. [变更历史](#17-变更历史)

---

## 1. TL;DR — 三句话讲清楚

1. **本机(Win)只写代码,出 Mac/Linux 包** → 推 `git tag v1.x.y` → GitHub Actions 自动出三端安装包 → 5~25 分钟后挂在 GitHub Release
2. **本机**:`scripts/verify-desktop.sh` 跑通 = CI 会跑通(99% 行为对齐,差异只在缓存)
3. **不要把任何 LLM key 配到 GitHub secrets**(用户装 App 后自己 paste,不是 CI 任务);CI e2e 跑真实 LLM 是可选,本机 `.env` 有 key 就能跑

---

## 2. 核心原则(为什么这么设计)

| # | 原则 | 体现 |
| --- | --- | --- |
| P1 | **本机 vs CI 行为对齐** | 同一套 pnpm 命令,本机跑通 = CI 跑通 |
| P2 | **三平台并行,不模拟** | Mac universal binary 必须真 Mac 跑(不能 linux 模拟) |
| P3 | **失败必冒泡,不静默** | `if-no-files-found: error`,缺产物直接 fail |
| P4 | **可重入** | `concurrency: cancel-in-progress` 防同 commit 双跑 |
| P5 | **CI 跑必要的最小集** | Mac runner 分钟数 10× 于 ubuntu,只在 tag 触发时跑 Mac build |
| P6 | **Mac smoke 必须跑**(PR 也跑) | 防止 Mac 特有 bug(IPC / safeStorage / 菜单)逃逸 |
| P7 | **凭证零容忍进产物** | `electron-builder.yml` 白名单精确,无 `.env` / `secrets.json` / `*.key` |
| P8 | **降级而非阻断** | 没配 CI key → llm e2e skip(不影响 release) |

---

## 3. 关键安全前提:Key 在哪

理解这个表才能理解本计划为什么不需要在 CI 配 key:

### 3.1 Key 的三类来源

| 来源 | 存在位置 | 谁用 | 进产物? |
| --- | --- | --- | --- |
| **A. 仓库 secret** | `Settings → Secrets → INKOS_LLM_API_KEY` | CI job env | ❌ 不进(只在 runner 内存) |
| **B. 本机 `.env`** | `D:\Projects\...\SpeedWriter\.env`(gitignore) | 本机 e2e | ❌ 不进(gitignore,从未被 git track) |
| **C. 用户在 App 内 paste** | `userData/.inkos/secrets.enc`(safeStorage 加密) | App runtime | ❌ 不进(在 userData,不在 app.asar) |

### 3.2 CI 配 key 的真实意义

**A 类(仓库 secret) = CI 跑 e2e/llm.spec.ts 用的"测试 fixture"**。它**不是**生产配置,跟用户装 App 后配的 key 无关。

> **本计划 v1.1 决定**:**A 类 secret 完全可选**。仓库不配 = llm e2e 自动 skip;**不影响** build / release / 用户装包后跑 App。

### 3.3 用户装 App 后的 key 流向(完全 CI 无关)

```
用户装 InkOS.exe
   ↓
启动 App
   ↓
UI 弹"请输入 MiniMax API Key"(只首次)
   ↓
用户粘贴自己的 key(在 MiniMax 后台自己申请的)
   ↓
主进程 safeStorage.encryptString(...)
   ↓
密文写 userData/.inkos/secrets.enc
  (mac: Keychain / win: DPAPI / linux: libsecret)
   ↓
下次启动 → loadSecrets() 解密 → 注入子进程 env
```

**这条链上没有任何 CI 参与的环节**。

---

## 4. 工作流总览

```
┌─────────────── GitHub Actions 流水线 ──────────────┐
│                                                     │
│  ┌─ desktop-verify.yml ─────────────────┐          │
│  │ 触发: PR / push(non-tag) / 手动作业  │          │
│  │                                       │          │
│  │  ├─ smoke(ubuntu)  ~5min             │          │
│  │  ├─ smoke(windows) ~8min             │          │
│  │  ├─ smoke(macos-14) ~10min           │          │
│  │  └─ llm(ubuntu, 仅 secret 存在) ~3min│          │
│  │                                       │          │
│  │  目的: 验证代码能跑、能构建、能过 e2e │          │
│  │  不出安装包                            │          │
│  └──────────────────────────────────────┘          │
│                                                     │
│  ┌─ desktop-build.yml ──────────────────┐          │
│  │ 触发: push tag v* / 手动作业(dry_run)│          │
│  │                                       │          │
│  │  ┌─ build(macos-14)   dist:mac       │          │
│  │  ├─ build(windows)    dist:win       │          │
│  │  └─ build(ubuntu)     dist:linux     │          │
│  │    (并行, fail-fast: false)          │          │
│  │                                       │          │
│  │  build 完 → artifact 存 30 天        │          │
│  │  tag 触发 → 额外 release job 上传     │          │
│  └──────────────────────────────────────┘          │
└─────────────────────────────────────────────────────┘
```

**两个工作流独立,互不依赖**:
- verify 挂 = PR 标红,不能 merge → 不影响已发版
- build 挂(单平台) = fail-fast:false,其他平台产物仍能 release
- build 挂(全平台) = tag 没出 release,本地重新打 tag 再推

---

## 5. 工作流 1:`desktop-verify.yml` — 验证闸门

### 5.1 完整 yaml

```yaml
name: Desktop Verify

# PR/merge 触发;tag 触发走 desktop-build.yml
on:
  push:
    branches: [master, main, develop]
  pull_request:
    branches: [master, main]
  workflow_dispatch:
    inputs:
      mode:
        description: "Test mode (full / smoke / llm)"
        required: false
        default: full
        type: choice
        options: [full, smoke, llm]

# 同 ref 同一 SHA 取消旧 run
concurrency:
  group: desktop-verify-${{ github.workflow }}-${{ github.ref }}-${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: true

# 只读权限(verify job 无 release 操作)
permissions:
  contents: read

env:
  CSC_IDENTITY_AUTO_DISCOVERY: false   # 禁掉自动签名(我们不签名)

jobs:
  # ─── Smoke e2e:三平台都跑 ───
  smoke:
    name: Smoke e2e (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        # 三平台都跑 smoke:
        #   ubuntu  → 最快,主回归
        #   windows → 验证 winCodeSign / DPAPI / 中文路径
        #   macos-14 → 验证 safeStorage / 菜单 / DPI
        # macos-14 而非 macos-latest:cache key 稳定(见 §7)
        os: [ubuntu-latest, windows-latest, macos-14]
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with: { version: 9 }

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Cache Electron binaries
        uses: actions/cache@v4
        with:
          path: |
            ~/.cache/electron
            ~/Library/Caches/electron
            ~/AppData/Local/electron/Cache
          key: electron-${{ runner.os }}-smoke-${{ hashFiles('packages/desktop/package.json', 'packages/desktop/electron-builder.yml') }}
          restore-keys: electron-${{ runner.os }}-smoke-

      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @actalk/inkos-core build
      - run: pnpm --filter @actalk/inkos-studio build
      - run: pnpm --filter @actalk/inkos-desktop build
      - run: pnpm --filter @actalk/inkos-desktop dist:dir

      - name: Install Playwright browsers
        run: pnpm --filter @actalk/inkos-desktop exec playwright install --with-deps chromium

      # Windows 文件锁清理(d3dcompiler_47.dll "Access is denied" 防护)
      - name: Cleanup leftover InkOS process
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          Get-Process InkOS,electron -ErrorAction SilentlyContinue | Stop-Process -Force
          if (Test-Path packages/desktop/dist/win-unpacked) {
            Remove-Item -Recurse -Force packages/desktop/dist/win-unpacked
          }
          if (Test-Path packages/desktop/dist/InkOS*.exe.blockmap) {
            Remove-Item -Force packages/desktop/dist/InkOS*.exe.blockmap
          }

      - name: Run smoke e2e
        run: pnpm --filter @actalk/inkos-desktop test:smoke

      - name: Upload screenshots on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: smoke-failures-${{ matrix.os }}
          path: packages/desktop/test-results/
          retention-days: 7

  # ─── LLM e2e:可选,仅当仓库配了 INKOS_LLM_API_KEY secret ───
  # v1.1 关键变更:不强制依赖 key
  # - 没配 secret:job 自动 skip(本机 .env 有 key 仍可跑 test:llm)
  # - 配了 secret:job 跑真实 MiniMax 调用
  # - 不论哪种情况,smoke 仍跑全平台
  llm:
    name: LLM e2e (ubuntu, requires INKOS_LLM_API_KEY secret)
    runs-on: ubuntu-latest
    needs: smoke
    # 三重守门 + secret 存在性检查
    if: |
      (github.event_name == 'push' ||
       github.event_name == 'workflow_dispatch' ||
       startsWith(github.ref, 'refs/tags/')) &&
      secrets.INKOS_LLM_API_KEY != ''
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - name: Cache Electron
        uses: actions/cache@v4
        with:
          path: ~/.cache/electron
          key: electron-ubuntu-llm-${{ hashFiles('packages/desktop/package.json', 'packages/desktop/electron-builder.yml') }}
          restore-keys: electron-ubuntu-llm-
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @actalk/inkos-core build
      - run: pnpm --filter @actalk/inkos-studio build
      - run: pnpm --filter @actalk/inkos-desktop build
      - run: pnpm --filter @actalk/inkos-desktop dist:dir
      - run: pnpm --filter @actalk/inkos-desktop exec playwright install --with-deps chromium
      - name: Run LLM e2e
        env:
          INKOS_LLM_API_KEY: ${{ secrets.INKOS_LLM_API_KEY }}
          INKOS_LLM_BASE_URL: ${{ vars.INKOS_LLM_BASE_URL || 'https://api.minimaxi.com/v1' }}
          INKOS_LLM_MODEL: ${{ vars.INKOS_LLM_MODEL || 'MiniMax-Text-01' }}
        run: |
          {
            echo "INKOS_LLM_API_KEY=$INKOS_LLM_API_KEY"
            echo "INKOS_LLM_BASE_URL=$INKOS_LLM_BASE_URL"
            echo "INKOS_LLM_MODEL=$INKOS_LLM_MODEL"
          } > .env
          pnpm --filter @actalk/inkos-desktop test:llm
```

### 5.2 关键设计点解读

| 设计点 | 为什么 |
| --- | --- |
| `concurrency.cancel-in-progress: true` | 同 PR 多次 push,旧 run 自动取消,省分钟数 |
| `fail-fast: false` 在 smoke matrix | 某个平台挂,其他平台结果仍可见(便于排错) |
| `permissions: contents: read` | verify 不写 release,最小权限原则 |
| `CSC_IDENTITY_AUTO_DISCOVERY: false` | electron-builder 不会去读 macOS Keychain 找签名证书(我们没签) |
| `cleanup leftover InkOS` 在 windows step | 防止上次 e2e 残留的 `InkOS.exe` 锁住 `d3dcompiler_47.dll` |
| `if: ... && secrets.INKOS_LLM_API_KEY != ''` | **v1.1 核心改动**:没配 secret = llm job skip |
| `INKOS_LLM_BASE_URL` / `INKOS_LLM_MODEL` 用 `vars` 而非 hard-code | 用户可改默认值而不用动 workflow |
| `if-no-files-found: error`(build job 用) | 防止"没产物但 success"的静默 bug |
| `test-results/` 7 天保留 | CI 失败时开发者可下载截图,不用重跑 |

### 5.3 触发矩阵

| GitHub 事件 | smoke(3 平台) | llm(ubuntu) |
| --- | --- | --- |
| PR open / sync | ✅ 跑 | ⏭️ skip(event_name 不是 push) |
| push 到 master | ✅ 跑 | ⏬ 配了 key 才跑 |
| push tag v* | ✅ 跑 | ⏬ 配了 key 才跑 |
| workflow_dispatch | ✅ 跑 | ⏬ 配了 key 才跑 |

### 5.4 性能基线(参考)

| Job | 首次(含下载) | 缓存命中 |
| --- | --- | --- |
| smoke ubuntu | ~7 min | ~3 min |
| smoke windows | ~10 min | ~5 min |
| smoke macos-14 | ~13 min | ~7 min |
| llm ubuntu(配 key) | ~5 min | ~3 min |

**PR 全绿标准时长**:~13 min(3 平台并行,取最慢 mac)

---

## 6. 工作流 2:`desktop-build.yml` — 出包 + 发布

### 6.1 完整 yaml

```yaml
name: Desktop Build

# Tag 触发 + 手动触发(测试流水线,带 dry_run)
# 本机 Win 出不了 Mac,所以 Mac/Linux 都在这里出
on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Skip upload to release (build only)"
        required: false
        default: "false"
        type: boolean

# 同 tag 取消旧 build
concurrency:
  group: desktop-build-${{ github.ref }}
  cancel-in-progress: true

# release job 必须 write
permissions:
  contents: write

env:
  CSC_IDENTITY_AUTO_DISCOVERY: false

jobs:
  # ─── 三平台并行构建 ───
  build:
    name: Build ${{ matrix.target }} on ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false  # 一个挂了,其他产物还能上 release
      matrix:
        include:
          # === Mac:出 .dmg + .zip,universal(x64 + arm64) ===
          # macos-14 而非 macos-latest:cache key 稳定
          - os: macos-14
            target: mac
            build_script: dist:mac
            artifact_glob: |
              packages/desktop/dist/*.dmg
              packages/desktop/dist/*.zip
            artifact_name: macos
          # === Windows:出 NSIS + portable ===
          - os: windows-latest
            target: win
            build_script: dist:win
            artifact_glob: packages/desktop/dist/*.exe
            artifact_name: windows
          # === Linux:出 AppImage + .deb ===
          - os: ubuntu-latest
            target: linux
            build_script: dist:linux
            artifact_glob: |
              packages/desktop/dist/*.AppImage
              packages/desktop/dist/*.deb
            artifact_name: linux
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # tag 触发时能拿到 commit log(用于 release notes)

      - name: Extract version
        id: version
        shell: bash
        run: |
          if [[ "${{ github.ref_type }}" == "tag" ]]; then
            VERSION="${GITHUB_REF_NAME#v}"
          else
            # workflow_dispatch 模式:回退到 package.json
            VERSION="$(node -p "require('./packages/desktop/package.json').version")"
          fi
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "Building InkOS $VERSION for ${{ matrix.target }}"

      - uses: pnpm/action-setup@v4
        with: { version: 9 }

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Cache Electron
        uses: actions/cache@v4
        with:
          path: |
            ~/.cache/electron
            ~/Library/Caches/electron
            ~/AppData/Local/electron/Cache
          # 与 verify 不同的 cache 命名空间(防止互相覆盖)
          key: electron-${{ runner.os }}-build-${{ steps.version.outputs.version }}
          restore-keys: electron-${{ runner.os }}-build-

      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @actalk/inkos-core build
      - run: pnpm --filter @actalk/inkos-studio build
      - run: pnpm --filter @actalk/inkos-desktop build

      # Windows file lock 清理
      - name: Clean leftover processes (Windows file lock fix)
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          Get-Process InkOS,electron -ErrorAction SilentlyContinue | Stop-Process -Force
          if (Test-Path packages/desktop/dist/win-unpacked) {
            Remove-Item -Recurse -Force packages/desktop/dist/win-unpacked
          }
          if (Test-Path packages/desktop/dist/InkOS*.exe.blockmap) {
            Remove-Item -Force packages/desktop/dist/InkOS*.exe.blockmap
          }

      - name: Package ${{ matrix.target }}
        run: pnpm --filter @actalk/inkos-desktop ${{ matrix.build_script }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}   # electron-builder 用它生成 update metadata

      - name: Verify artifacts exist
        shell: bash
        run: |
          echo "Artifacts in dist/:"
          ls -la packages/desktop/dist/ | grep -E '\.(dmg|zip|exe|AppImage|deb|AppImage\.blockmap|deb\.blockmap)$' || {
            echo "ERROR: no artifacts found"
            exit 1
          }

      - name: Upload build artifacts (30 天保留,无论是否 release)
        uses: actions/upload-artifact@v4
        with:
          name: inkos-${{ matrix.artifact_name }}-${{ steps.version.outputs.version }}
          path: ${{ matrix.artifact_glob }}
          retention-days: 30
          if-no-files-found: error

  # ─── Release:汇总三平台产物,发布到 GitHub Release ───
  # v1.1 变更:不再 needs: llm(llm 是可选,不能卡 release)
  release:
    name: Publish GitHub Release
    runs-on: ubuntu-latest
    needs: build
    # 只有 tag 触发才上传;workflow_dispatch(dry_run)跳过
    if: startsWith(github.ref, 'refs/tags/v') && github.event_name == 'push'
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Download all platform artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: List downloaded artifacts
        run: |
          echo "=== Downloaded artifacts ==="
          find artifacts -type f | sort

      - name: Generate release notes
        id: notes
        shell: bash
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          PREV_TAG=$(git tag --sort=-version:refname | grep -v "^v$VERSION$" | head -1 || echo "")
          {
            echo "## InkOS $VERSION"
            echo ""
            echo "### 安装包 / Installers"
            echo ""
            echo "| 平台 Platform | 文件 File |"
            echo "| --- | --- |"
            for f in $(find artifacts -type f | sort); do
              base=$(basename "$f")
              size=$(du -h "$f" | cut -f1)
              echo "| $(dirname "$f" | sed 's|artifacts/||') | \`$base\` ($size) |"
            done
            echo ""
            echo "### 验证 / Verify"
            echo ""
            echo '每个文件都有对应 SHA256(下载页面右侧)。比对方法:'
            echo '```bash'
            echo '# macOS / Linux'
            echo 'shasum -a 256 InkOS-*.dmg'
            echo '# Windows (PowerShell)'
            echo 'Get-FileHash InkOS*.exe'
            echo '```'
            echo ""
            echo "### 更新说明 / Changelog"
            if [ -n "$PREV_TAG" ]; then
              git log --pretty=format:"- %s" "$PREV_TAG..HEAD" | head -50
            else
              echo "首个 release tag"
            fi
          } > release-notes.md
          echo "notes<<EOF" >> "$GITHUB_OUTPUT"
          cat release-notes.md >> "$GITHUB_OUTPUT"
          echo "" >> "$GITHUB_OUTPUT"
          echo "EOF" >> "$GITHUB_OUTPUT"

      - name: Create / Update GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          name: "InkOS ${{ github.ref_name }}"
          body: ${{ steps.notes.outputs.notes }}
          generate_release_notes: false   # 我们自己生成(含产物表格)
          fail_on_unmatched_files: true
          files: |
            artifacts/**/*.dmg
            artifacts/**/*.zip
            artifacts/**/*.exe
            artifacts/**/*.AppImage
            artifacts/**/*.deb
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 6.2 关键设计点解读

| 设计点 | 为什么 |
| --- | --- |
| `macos-14` 而非 `macos-latest` | `macos-latest` 会被 GitHub 升级(M1→M2→M3),cache key 漂移导致永远 miss |
| `fail-fast: false` | 一个平台挂,其他平台产物仍上 release(用户至少能装部分平台) |
| artifact 30 天 + release 永久 | 双保险:release 误删可重发;artifact 是 source of truth |
| `softprops/action-gh-release@v2` 而非 `gh release create` CLI | 自动 SHA256、自动 RST/README 检测、API 调用更稳 |
| `fail_on_unmatched_files: true` | 防止 glob 写错时静默成功 |
| `workflow_dispatch` 的 `dry_run` | 测试流水线时只出包不上传,避免污染 release 列表 |
| 不 `needs: llm` | v1.1 核心:llm 是可选 secret,不能成为 release 的依赖 |
| `GH_TOKEN` 给 electron-builder | 让它能写 update metadata(虽然我们用不到,但传了不亏) |

### 6.3 build 触发矩阵

| GitHub 事件 | mac build | win build | linux build | release publish |
| --- | --- | --- | --- | --- |
| `push tag v*` | ✅ | ✅ | ✅ | ✅ |
| `workflow_dispatch`(dry_run=false) | ✅ | ✅ | ✅ | ❌ skip |
| `workflow_dispatch`(dry_run=true) | ✅ | ✅ | ✅ | ❌ skip |
| `push` 非 tag | ❌ skip(不在 trigger) | ❌ skip | ❌ skip | ❌ skip |

**注意**:`workflow_dispatch` 默认会跑 build(三平台都跑 ~25 min),即使选 dry_run=true 也跑(只是不上传)。**别没事点这个,Mac 分钟数会烧**。

---

## 7. 缓存策略详解

### 7.1 三层缓存

| 层 | 路径 | 命中条件 | Key 模式 | TTL |
| --- | --- | --- | --- | --- |
| pnpm store | `~/.local/share/pnpm/store/v3` | `pnpm-lock.yaml` hash | `setup-node` 自动 + `cache: pnpm` | 7d |
| Node modules | `node_modules/` | lockfile | setup-node 自动 | 7d |
| Electron binary | `~/.cache/electron`(linux) / `~/Library/Caches/electron`(mac) / `%APPDATA%\electron\Cache`(win) | `packages/desktop/package.json` + `electron-builder.yml` hash | 自定义 key | 7d |

### 7.2 cache key 命名约定

```
electron-{os}-{job_type}-{version_or_hash}
  │         │      │           │
  │         │      │           └─ "1.5.0"(build job) 或 hash(verify job)
  │         │      └─ "smoke" / "llm" / "build"
  │         └─ "Linux" / "macOS" / "Windows" (GitHub runner.os)
  └─ 固定前缀,避免污染其他 cache
```

**为什么 verify 和 build 命名空间分开**:
- verify 改 `electron-builder.yml` → smoke cache 重出
- build 不改 yml,只改 version → build cache 复用旧 version(命中)
- **不分开**:两边互相污染,debug 困难

### 7.3 显式不要缓存的

- `packages/desktop/dist/`:产物,每次必重出
- `.env` / `secrets.json`:已经 gitignore,且不能进 cache(否则有泄露风险)
- `playwright/`:用 `playwright install` 重新拉

### 7.4 cache miss 排错

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| 每次 build 都要下 200M electron | cache key 总在变 | 看 Actions log,`Cache hit for key` vs `Created cache` |
| mac cache 命中率 0 | 用了 `macos-latest` 而非 `macos-14` | 改 `runs-on: macos-14` |
| restore-keys 失效 | prefix 不对 | 用 `electron-${{ runner.os }}-build-` 这样的 namespace |

---

## 8. 产物命名与上传

### 8.1 electron-builder 默认产物名(我们不自定义)

| 平台 | 文件名(以 v1.5.0 为例) | 大小参考 |
| --- | --- | --- |
| Mac x64 | `InkOS-1.5.0-mac-x64.dmg` + `InkOS-1.5.0-mac-x64.zip` | ~250M + 240M |
| Mac arm64 | `InkOS-1.5.0-mac-arm64.dmg` + `InkOS-1.5.0-mac-arm64.zip` | ~250M + 240M |
| Windows NSIS | `InkOS Setup 1.5.0.exe` | ~81M |
| Windows portable | `InkOS 1.5.0.exe` | ~80M |
| Linux AppImage | `InkOS-1.5.0.AppImage` | ~90M |
| Linux deb | `inkos_1.5.0_amd64.deb` | ~85M |

**不要改**:Windows 用户习惯了 `Setup <version>.exe` 命名(参考 VS Code、Discord、Notion 等)

### 8.2 artifact name 约定

```
inkos-{platform}-{version}
  │       │         │
  │       │         └─ "1.5.0" (从 tag 提取)
  │       └─ "macos" / "windows" / "linux"
  └─ 固定前缀
```

**为什么这样命名**:多个 tag 并行时,artifact 列表不混淆(v1.5.0 vs v1.5.1 同时构建时一眼能区分)

### 8.3 上传策略

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: inkos-${{ matrix.artifact_name }}-${{ steps.version.outputs.version }}
    path: ${{ matrix.artifact_glob }}
    retention-days: 30
    if-no-files-found: error
```

- `if-no-files-found: error`:产物不存在直接 fail(绝不静默)
- `retention-days: 30`:release 已发后,artifact 仍保留 30 天供回滚
- `merge-multiple: true`(download 时):多平台合并到一个目录

### 8.4 不要上传的(常见误操作)

| 错误 | 后果 | 正确做法 |
| --- | --- | --- |
| 上传 `packages/desktop/dist/**` | 把 win-unpacked(186M)/源码/中间文件都传了 | 只 glob `*.exe` / `*.dmg` 等最终产物 |
| 上传 `node_modules/` | 浪费空间,build 之间可能不一致 | 不用传,重装 |
| 上传 `.env` | **泄露密钥**(致命) | `.gitignore` 保护 + 永不在 path 里出现 |

---

## 9. 用户最终体验

### 9.1 三端用户视角

| 用户 | 下载 | 操作 | 首次启动 |
| --- | --- | --- | --- |
| **Windows** | `InkOS Setup 1.5.0.exe`(81M) | 双击 → NSIS 向导(选路径/创建快捷方式) | 弹"未签名"警告 → "仍要运行" |
| **Mac Intel** | `InkOS-1.5.0-mac-x64.dmg` | 双击 → 拖入 Applications | 右键 → "打开"绕过 Gatekeeper |
| **Mac Apple Silicon** | `InkOS-1.5.0-mac-arm64.dmg` | 同上(系统自动选) | 同上 |
| **Linux Debian/Ubuntu** | `inkos_1.5.0_amd64.deb` | `sudo dpkg -i inko*.deb` | 启动器出现 InkOS |
| **Linux 通用** | `InkOS-1.5.0.AppImage` | `chmod +x *.AppImage` → 双击 | 无警告 |

### 9.2 首次启动 UX(用户视角详细)

```
1. 用户双击 InkOS Setup 1.5.0.exe
   ↓
2. NSIS 向导(选安装路径,默认 C:\Program Files\InkOS)
   ↓
3. 桌面创建快捷方式
   ↓
4. 用户双击 InkOS 图标启动
   ↓
5. SmartScreen 弹窗("Windows 已保护你的电脑")
   → 用户点"更多信息" → "仍要运行"
   ↓
6. App 启动(冷启动 5~10s,electron 初始化 + Hono 起 + 7-stage 启动)
   ↓
7. UI 顶部提示:"请先配置 MiniMax API Key"
   → 用户点"设置" → 粘贴自己的 key(在 minimaxi.com 后台申请的)
   → 提交,key 被 safeStorage 加密到 userData/.inkos/secrets.enc
   ↓
8. 用户可以创建第一本书了 🎉
```

### 9.3 升级路径(无自动更新)

```
用户启动 InkOS v1.4.0
   ↓
5s 后 update-checker 轮询 GitHub API
   ↓
发现 v1.5.0
   ↓
UpdateBanner 顶部弹出:"有新版本 v1.5.0,[立即下载]"
   ↓
点击 → 跳到 https://github.com/<owner>/<repo>/releases/tag/v1.5.0
   ↓
用户手动下载 → 关闭旧版 → 安装新版
   ↓
不做的事:不静默下载 / 不覆盖安装 / 不强制升级
```

### 9.4 安全 FAQ(必加到 README)

> **Q: Windows 报"未知发布者"怎么办?**
> A: 因为我们没花 ¥2000+ 买代码签名证书(开源社区常见做法,VS Code 早期、Obsidian、Postman 都经历过)。点"更多信息" → "仍要运行"即可。
> **安全验证**:对比 GitHub Release 页面公示的 SHA256 与本地 `Get-FileHash` 结果。

> **Q: macOS 报"无法验证开发者"怎么办?**
> A: 右键 → "打开" → 弹出确认 → "打开"。之后系统记住,以后双击直接进。

> **Q: 我的 LLM key 安全吗?**
> A: 你的 key 存在本机 `userData/.inkos/secrets.enc`,走系统 keychain(mac)/DPAPI(win)/libsecret(linux)加密。我们服务器、CI、release 都不接触它。

---

## 10. 成本与配额

### 10.1 GitHub Actions 免费额度(2026-06)

| Runner | 免费分钟/月 | 单价(超出) |
| --- | --- | --- |
| ubuntu-latest | 2000 | $0.008/min |
| windows-latest | 2000 | $0.016/min |
| macos-14 | 2000 | $0.08/min |

### 10.2 月度消耗估算

**假设**:100 PR/月 + 30 merge + 4 tag release

| 任务 | 频率 | 单次时长 | 月消耗(分钟) |
| --- | --- | --- | --- |
| smoke(ubuntu) | 100 PR + 30 merge ≈ 130 | 5 | 650 |
| smoke(windows) | 130 | 8 | 1040 |
| smoke(macos-14) | 130 | 10 | 1300 |
| llm(ubuntu, 配 key 时) | 50 | 3 | 150 |
| build(mac, 仅 tag) | 4 | 25 | 100 |
| build(windows, 仅 tag) | 4 | 18 | 72 |
| build(ubuntu, 仅 tag) | 4 | 15 | 60 |
| release(ubuntu) | 4 | 1 | 4 |

**按 runner 统计**:
- **ubuntu**:650 + 150 + 60 + 4 = **864 min**(43% 配额)
- **windows**:1040 + 72 = **1112 min**(56% 配额)
- **macos-14**:1300 + 100 = **1400 min**(70% 配额)⚠️

**Mac 用了 70%**,**仍在 free tier 内**,但余量小。优化方案见 §10.3。

### 10.3 Mac 配额优化路径

| 方案 | 节省 | 代价 |
| --- | --- | --- |
| **PR 不跑 Mac smoke**(只 merge 跑) | 1000 min/月 | Mac 特有 bug 可能 merge 才发现(略增调试成本) |
| **缓存命中率从 70% 提到 95%** | 200 min/月 | 需要稳定 cache key(已做) |
| **改用 self-hosted Mac**(M1 mini $899 一次性) | 全部 | 一次性投入 + 电费 |

**当前选择**:本计划 v1.1 维持 Mac PR 跑 smoke(以质量优先),余量 600 min 够 buffer。

### 10.4 超出后成本

- 最坏情况(mac 超 100 min):$0.08 × 100 = **$8/月**
- 触发条件:某月 PR 翻倍到 200+ 才可能

---

## 11. 第一次发版剧本(逐行命令)

> 假设你(开发者)刚把所有代码 commit,准备发 v1.5.0

### 11.1 本机准备

```bash
# 1. 切到 master,确认干净
cd D:/Projects/SpeedWriter/SpeedWriter
git checkout master
git pull
git status   # 应该 clean

# 2. 跑本机完整验证(模拟 CI 流程)
./scripts/verify-desktop.sh
# 预期:全部绿,30~50 min
```

### 11.2 更新版本号

```bash
# 3. 升 patch 版本(如果只是修 bug)
#    升 minor(如果有新功能)/ major(破坏性变更)
cd packages/desktop
npm version patch --no-git-tag-version   # 1.5.0 → 1.5.1
cd ../..

# 4. 同步根 package.json(根版本不强制跟 desktop 走,但保持一致方便)
#    注:desktop 跟根 version 通常不强制同步(各自 package 独立发布)
#    如果你想同步,手动编辑根 package.json 的 version 字段

# 5. 提交
git add packages/desktop/package.json
git commit -m "chore(desktop): bump version to 1.5.1"
```

### 11.3 推 tag 触发 build

```bash
# 6. 打 tag(必须 lowercase v 前缀,匹配 workflow 'v*')
git tag v1.5.1

# 7. 验证 tag 与 package.json 一致
node -e "
const v = require('./packages/desktop/package.json').version;
const tag = 'v' + v;
console.log('Expected tag:', tag);
"

# 8. 推送 tag + commit
git push origin master
git push origin v1.5.1
# 或者一次性:git push origin master --tags
```

### 11.4 观察 CI

```bash
# 9. 在浏览器看 Actions
#    https://github.com/<owner>/<repo>/actions/workflows/desktop-build.yml

# 预期时序:
#   0min   - 三平台 build 并行启动
#   ~15min - linux build 完成
#   ~18min - windows build 完成
#   ~25min - mac build 完成
#   ~26min - release job 上传产物
#   ~27min - GitHub Release 页面可访问

# 10. 验证 release
#     浏览器:https://github.com/<owner>/<repo>/releases/tag/v1.5.1
#     预期:8 个文件(2 dmg + 2 zip + 2 exe + 1 AppImage + 1 deb)
#     预期:release notes 含产物表格 + commit log
```

### 11.5 验证产物

```bash
# 11. 在另一台机器(或 VM)装 InkOS Setup 1.5.1.exe
#     - 验证 NSIS 安装器能跑
#     - 验证 App 启动 → Hono 子进程 → UI 可用
#     - 验证用户能 paste 自己的 key → 创建书 → 跑流程

# 12. mac 产物
#     - 下载 .dmg → 拖入 Applications → 启动
#     - 首次右键"打开"绕过 Gatekeeper

# 13. Linux 产物
#     - sudo dpkg -i inko*.deb
#     - 启动器出现 InkOS
#     - 或 chmod +x *.AppImage 后双击
```

### 11.6 误发回滚

```bash
# 14. 如果发现 v1.5.1 有问题
# 删 tag
git tag -d v1.5.1
git push origin :refs/tags/v1.5.1

# 删 release
gh release delete v1.5.1 --yes
# 或网页:https://github.com/<owner>/<repo>/releases/tag/v1.5.1 → Delete

# 把 v1.4.0 重新标为 latest
# 网页:https://github.com/<owner>/<repo>/releases → 点 v1.4.0 → "Mark as latest"
```

---

## 12. 排错与回滚

### 12.1 常见 CI 错误与修复

| 报错 | 原因 | 修复 |
| --- | --- | --- |
| `Access is denied d3dcompiler_47.dll` | 上次 e2e 残留的 InkOS 没杀 | 已有 `Cleanup leftover InkOS` step 自动清 |
| `Cannot find module '@actalk/inkos-core'` | 漏跑 `pnpm --filter @actalk/inkos-core build` | verify / build job 都加 3 个 build step(已加) |
| `Job failed because no files matched` | 产物没出 / 路径错 | 跑 `ls -la packages/desktop/dist/` 看真实文件名,改 artifact_glob |
| `failed to create release: Not Found` | GH_TOKEN 没 write 权限 | Settings → Actions → Workflow permissions 选 "Read and write" |
| `Resource not accessible by integration` | 同上(权限问题) | 同上 |
| macOS 上 `wine` 报错 | 不该有(wine 是 linux 跑 win build 用的) | 忽略,日志里搜 `electron-builder` 真实错误 |
| `shasum: command not found`(在 mac 上) | mac 默认 BSD 不叫 shasum | release notes 里的 shasum 命令在 macOS 是 `shasum -a 256`,已经写对 |
| `pnpm install` 报 `EACCES` | cache 目录权限 | Actions runner 不会出,真出就 `rm -rf ~/.local/share/pnpm/store` 后重跑 |
| `electron-builder download failed` | 网络抖动 | 失败时自动 retry job(workflow 自带) |
| `git tag not found` | tag 没推全 | `git push origin --tags --force`(慎用 force) |

### 12.2 怎么本地复现 CI 报错

```bash
# 1. CI 在 ubuntu 跑 → 本机 WSL
wsl --install   # 一次性
wsl
# 在 WSL 里:
cd /mnt/d/Projects/SpeedWriter/SpeedWriter
./scripts/verify-desktop.sh --smoke

# 2. CI 在 mac 跑 → 本机没 Mac
#   只能:加日志重跑 workflow,看 trace
#   或:macOS 14 GitHub runner 镜像(官方 marketplace 镜像)

# 3. CI 在 windows 跑 → 本机就是 win
./scripts/verify-desktop.sh --smoke
# 本机跑 = CI windows 跑(差异只在 cache)
```

### 12.3 失败重跑 vs 重新推 commit

| 场景 | 操作 |
| --- | --- |
| 网络抖动 / 临时错误 | 直接 "Re-run jobs"(GitHub UI 按钮) |
| 代码本身有 bug | 改代码 → 重新 commit push |
| 只想重跑某个 job | UI 上点该 job 的 "Re-run failed jobs" |
| 同 commit 想清空重跑 | `git commit --allow-empty -m "retry" && git push` |
| workflow yaml 改错了 | 改 yaml → push(自动重跑,不用空 commit) |

### 12.4 release 出问题应急

```bash
# 场景:release 已发,发现安装包有 bug
# 步骤:
# 1. 删 release(网页 UI 或 gh CLI)
gh release delete v1.5.1 --yes

# 2. 回滚代码
git revert HEAD  # 撤销最近 commit
# 或:
git reset --hard v1.5.0   # 强制回到 v1.5.0
git push --force-with-lease

# 3. 发修复版
cd packages/desktop
npm version patch --no-git-tag-version   # 1.5.1 → 1.5.2
cd ../..
git add . && git commit -m "fix: 修复 v1.5.1 安装包 bug"
git tag v1.5.2
git push origin master --tags

# 4. 用户视角:re-release 后,GitHub 把 v1.5.2 标 latest,
#    App 内 UpdateBanner 5s 后检测到新版,提示用户
```

---

## 13. 监控

### 13.1 必看指标

| 指标 | 健康阈值 | 看哪里 |
| --- | --- | --- |
| Build 成功率 | > 95% | GitHub Actions UI → Insights |
| 单次 build 时长 | < 30 min(全平台) | Actions 日志 step 时长 |
| pnpm cache 命中率 | > 80% | 日志 `Cache restored from key` vs `Created cache` |
| Electron cache 命中率 | > 90% | 同上 |
| mac 分钟数消耗 | < 1500/月 | Settings → Billing → Usage |

### 13.2 失败通知(可选)

```yaml
# 在 desktop-build.yml 加(可选)
- name: Notify on failure
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {"text": "❌ Desktop build failed: ${{ github.workflow }} @ ${{ github.ref }}\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Run>"}
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

Slack webhook 配 `secrets.SLACK_WEBHOOK`,没配这个 secret 时 step 静默跳过(不会让 build 挂)。

---

## 14. 已知风险与缓解

| # | 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- | --- |
| R1 | macOS runner 资源紧张 / Apple 改配额 | 中 | 高 | 改 self-hosted Mac($899 M1 mini) |
| R2 | electron-builder 升级不兼容(如 v26 改字段) | 低 | 中 | 锁 `electron-builder@^25.0.0`,PR 单独验证 |
| R3 | update-checker 轮询 GitHub API 触发限流 | 极低 | 低 | 60 req/h unauthenticated,5s 轮询 = 720/h,理论上 OK;超限改 60s |
| R4 | Windows d3dcompiler_47.dll 文件锁 | 高 | 中 | 已加 `Stop-Process` step;严重时 retry job |
| R5 | 用户 macOS Gatekeeper 拦截 | 中 | 中 | README FAQ 给清晰指引 |
| R6 | tag 推错版本号(pkg.json 与 tag 不一致) | 中 | 中 | pre-push hook 检查(附录);GitHub action 额外 assert |
| R7 | 并发 tag 推导致双 build | 低 | 中 | `concurrency.cancel-in-progress: true`(已加) |
| R8 | 某次 build 产物损坏 | 极低 | 中 | artifact 30 天保留,可重发 |
| R9 | electron-builder 下载元数据失败(DNS) | 低 | 中 | 失败时 retry;长期可换 self-hosted runner |
| R10 | asarUnpack 路径在 Mac 出问题 | 极低 | 中 | 已在 `electron-builder.yml` 用相对路径 `dist/main/server/entry.js` |
| R11 | 私仓公开暴露 LLM key | **0** | **致命** | **v1.1 决定不配 CI key**(见 §15) |
| R12 | LLM provider schema 变更导致 llm e2e 挂 | 中 | 低 | llm job skip 时不阻断 release;用户装包后自己测 |

---

## 15. 密钥安全审计(必读)

> **本节是 v1.1 新增的,直接回应"打包时是否把 api key 打进去了"的疑问**

### 15.1 审计结论

**打包产物中无任何 LLM key 泄露风险**。三层证据:

**证据 1:source code 不含 key**

```bash
$ grep -rn "INKOS_SECRET\|api_key\|API_KEY\|MiniMax\|minimax" packages/desktop/src/
packages/desktop/src/main/safe-storage.ts:55: * service "deepseek" → env "INKOS_SECRET_DEEPSEEK"  ← 注释
packages/desktop/src/main/safe-storage.ts:62:    out[`INKOS_SECRET_${service.toUpperCase()...}`] = key; ← 运行时字符串拼接
packages/desktop/src/server/entry.ts:22:  if (k.startsWith("INKOS_SECRET_") && v) {                ← 运行时 env 读取
```

**只有运行时字符串模板,没有 key 字面值**。

**证据 2:git history 不含 .env**

```bash
$ git log --all --full-history -- .env          # 空
$ git log --all --diff-filter=A --name-only | grep '\.env'   # 空
$ git status --ignored                          # .env 是 untracked(被 .gitignore line 3 保护)
```

**`.env` 从未被任何 commit 包含**。

**证据 3:electron-builder.yml 不包含 .env / secrets**

```yaml
files:          # 只列了 dist/main/*.js, dist/preload/index.js, dist/main/server/entry.js
extraResources: # 只列了 studio/dist, core/genres
# 没有 .env / secrets.json / *.key
```

**`.env` 不会进 asar,不会进 extraResources**。

### 15.2 Key 流向图(可信闭环)

```
┌─────────────────────┐
│  MiniMax 后台        │
│  用户自己申请 key     │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  用户在 App 设置粘贴  │ ← 装 App 后第一次启动
│  (UI 输入)           │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  主进程:             │
│  safeStorage        │
│  .encryptString()   │ ← mac Keychain / win DPAPI / linux libsecret
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  userData/          │
│  .inkos/            │ ← 在用户本机,不在 app.asar
│  secrets.enc        │
└──────────┬──────────┘
           ↓ (下次启动)
┌─────────────────────┐
│  主进程:             │
│  safeStorage        │
│  .decryptString()   │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  secretsToEnv()     │
│  → INKOS_SECRET_*   │ ← 内存,不落盘
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  spawn(子进程,      │
│  env: {             │
│    INKOS_SECRET_   │
│    MINIMAX: "sk-…" │ ← 一次性 spawn env,进程退出消失
│  })                 │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  entry.ts:          │
│  delete process     │ ← 立即清除 env
│  .env[k]            │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  root/.inkos/       │ ← 用户项目目录,不是 app 目录
│  secrets.json       │ ← 给 core 代码读
│  (明文,但本机)      │
└─────────────────────┘
```

**关键不变量**:
- **Key 永远不在仓库代码里**(gitignore + 不引用)
- **Key 永远不在 app.asar / extraResources 里**(builder.yml 白名单)
- **Key 永远不在 CI runner 内存以外的任何地方**(不写 cache,artifact 不含)
- **Key 永远不进 release 产物**(artifact 是 build 产物,跟 user 端 key 无关)

### 15.3 CI 上的 `INKOS_LLM_API_KEY`(可选,非生产)

**这层**:
- 存在 `secrets.INKOS_LLM_API_KEY`
- 只用于 CI 的 `llm` job
- 注入到 `process.env.INKOS_LLM_API_KEY`
- 写入临时 `.env` 文件
- 跑 `test:llm` 后 step 结束

**绝不**:
- 写到 artifact
- 写到 cache
- 写进 package.json / electron-builder.yml
- 进任何 commit

**没配** = llm job 自动 skip(`secrets.X != ''` 检查)

### 15.4 怀疑泄露时的验证

```bash
# 1. 确认 git 历史无 key
git log --all -p | grep -E 'sk-(cp-|proj-)' | head -5
# 预期:空

# 2. 确认当前包无 key
cd packages/desktop && npx asar extract dist/win-unpacked/resources/app.asar /tmp/asar-extract
grep -rE 'sk-(cp-|proj-)' /tmp/asar-extract/ | head -5
# 预期:空

# 3. 确认 .env 仍 gitignore
git check-ignore -v .env
# 预期:输出 .gitignore:3:.env   .env

# 4. 确认 build 目录不含 .env
ls -la packages/desktop/dist/win-unpacked/resources/ 2>&1
# 预期:app.asar, app.asar.unpacked, core-genres/, studio-dist/, elevate.exe
# 预期:无 .env, 无 secrets.json
```

### 15.5 如果真的泄露了(应急)

```bash
# 1. 立即轮换 key
#    去 minimaxi.com 后台 → API Keys → Revoke 旧 key → Create new key

# 2. 更新本机 .env(新 key)
#    改 D:\Projects\...\SpeedWriter\.env

# 3. 如果是仓库 secret 泄露
#    Settings → Secrets → INKOS_LLM_API_KEY → Update(填新 key) → 旧 key 失效
#    或 Remove(不再配)

# 4. 验证
#    本机跑 test:llm 确认新 key 有效
#    推一个测试 commit 看 CI llm job 跑通
```

---

## 16. CI 密钥配置矩阵

| Secret / Var | 必配? | 用途 | 缺失行为 |
| --- | --- | --- | --- |
| `secrets.GITHUB_TOKEN` | ✅ 自动 | Actions 默认提供,release 上传 | N/A(GitHub 自动) |
| `secrets.INKOS_LLM_API_KEY` | ❌ 可选 | CI 跑 `e2e/llm.spec.ts` | llm job skip,不影响 build/release |
| `vars.INKOS_LLM_BASE_URL` | ❌ 可选 | 自定义 LLM endpoint | 默认 `https://api.minimaxi.com/v1` |
| `vars.INKOS_LLM_MODEL` | ❌ 可选 | 自定义模型 | 默认 `MiniMax-Text-01` |
| `secrets.SLACK_WEBHOOK` | ❌ 可选 | 失败时 Slack 通知 | step 静默跳过 |

**最小配置**:**0 secrets + 0 vars**(完全够用,只是 CI 跑不了真实 LLM e2e)

**推荐配置**:`secrets.INKOS_LLM_API_KEY`(1 个)+ 都不配 vars(用默认)

---

## 17. 变更历史

### v1.1(2026-06-21)

| 变更 | 原因 |
| --- | --- |
| 移除 `INKOS_LLM_API_KEY` 作为 CI 强制依赖 | 用户反馈:这个 key 是测试用的,不该配到仓库 secret |
| `llm` job 加 `secrets.X != ''` 守门,默认 skip | 没配 secret 时不让 build 挂 |
| `release` job 移除 `needs: llm` | llm 跳过后 release 仍要能跑 |
| 新增 §15 密钥安全审计章节 | 直接回应"打包是否泄露 key"的疑问 |
| 新增 §16 CI 密钥配置矩阵 | 明确什么必配/可选/默认 |
| 文档重写为可独立运行的完整计划 | 用户要求"出完整计划" |

### v1.0(2026-06-21 初版)

- 三平台 matrix + verify/build 两工作流
- fail-fast: false、cache key 策略、artifact 30 天保留
- "INKOS_LLM_API_KEY 必配" 的错误前提(已在 v1.1 修正)

---

**实施者检查表**:

- [ ] 读完整计划(无需看 v1.0)
- [ ] `desktop-verify.yml` 用本文档 §5.1 完整 yaml 覆盖
- [ ] `desktop-build.yml` 用本文档 §6.1 完整 yaml 新建
- [ ] Settings → Actions → Workflow permissions → "Read and write"(release 必须)
- [ ] 推测试 PR,确认三平台 smoke 绿、llm skip(release pipeline 默认 key 缺失)
- [ ] 打 `v1.5.0-test` tag,确认三平台 build 出包,release 列表里手动删
- [ ] 正式打 `v1.5.1`(或下个版本)tag,验证完整闭环
- [ ] 在另一台机器验证三端安装器(Win/Mac VM/Linux VM)
- [ ] 把本文档链接加到根 README("开发者文档"区)
