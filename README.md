<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="SpeedWriter Logo">
</p>

<h1 align="center">SpeedWriter<br><sub>跨端小说创作 AI 工作台</sub></h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License: AGPL-3.0"></a>
</p>

---

SpeedWriter 是一个跨端 AI 小说创作工作台。桌面应用、Web 工作台、终端 TUI 三种入口共享同一套创作内核——角色、设定、记忆、审稿、修订状态在任意端打开即用，写到哪存到哪。

## 功能

- **Studio 工作台**：可视化管理书籍、角色、设定、章节和创作状态，所见即所得。
- **跨端共享状态**：桌面应用、Web、TUI 访问同一项目目录，切换设备无缝继续。
- **AI 多 Agent 写作管线**：规划 → 编排 → 写作 → 审计 → 修订，一键推进。
- **角色锁定**：按角色锁定人格与关系，AI 写手、工具层、API 三层联动拒绝修改。
- **生成取消与回滚**：随时中止，自动恢复快照，不残留半成品。
- **37 维审计 + 去 AI 味**：连续性检查、AI 痕迹检测，从源头抑制"LLM 味"。
- **多模型路由**：不同 Agent 可走不同模型和 Provider，按需平衡质量与成本。
- **章节导入**：支持拖拽上传、文件排序，异步分析，导入后直接续写。
- **文风仿写**：分析参考文本提取风格指纹，注入书籍后所有章节自动采用。

## 截图

<p align="center">
  <img src="assets/studio-dashboard.png" width="760" alt="SpeedWriter Studio 工作台">
</p>

## 快速开始

### 桌面应用

```bash
git clone https://github.com/ACCSCI/SpeedWriter.git
cd SpeedWriter
pnpm install
pnpm gui           # 启动桌面应用（Electron + Vite HMR）
```

### Web 工作台

```bash
pnpm install
pnpm dev            # 启动 Studio Web 工作台（默认 localhost:4567）
```

### 初始化一本书

```bash
speedwriter init my-novel
cd my-novel
speedwriter         # 打开 Studio
```

进入 Studio 后在「模型配置」里选服务商、填 API Key、选模型，保存后即可开始写作。

## Agent 架构

每章默认按「规划 → 编排 → 写作 → 审计 → 修订 → 状态同步」运行：

| Agent               | 职责                                                          |
| ------------------- | ----------------------------------------------------------- |
| **规划师 Planner**     | 读取作者意图 + 当前焦点，产出本章目标（must-keep / must-avoid）           |
| **编排师 Composer**    | 从状态、控制文档和投影中编译上下文与规则栈                                 |
| **写手 Writer**       | 基于精简上下文生成正文                                                |
| **审计员 Auditor**    | 37 维连续性与质量检查                                                |
| **修订者 Reviser**     | 修复关键问题，默认最多自动修订一次，其余标记给人工                             |

## 开发

```bash
pnpm install
pnpm dev            # Studio Web 工作台
pnpm gui            # 桌面应用
pnpm test           # 运行测试
pnpm typecheck      # 类型检查
```

## License

[AGPL-3.0](LICENSE)
