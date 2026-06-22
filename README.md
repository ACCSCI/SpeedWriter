<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="SpeedWriter Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="SpeedWriter">
</p>

<h1 align="center">Story Creation AI Agent<br><sub>面向长短篇小说、剧本剧作、互动游戏与 IP 内容的创作智能体系统</sub></h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License: AGPL-3.0"></a>
</p>

---

SpeedWriter 是一个面向故事创作的 AI Agent 系统：长篇连载、独立短篇、剧本剧作、仿写续写，都可以从同一个工作台开始。支持 Studio、TUI、CLI 交互形式，共享创意、设定、角色、记忆、审稿、修订和状态管理智能体，让故事能持续生产、持续修改。

## 核心特性

### 角色锁定

每本书的角色都可以独立锁定，防止 AI 在写作过程中修改人格、动机、关系和状态。锁定在三层联动生效：系统提示词告知 AI 尊重锁定、工具层在写入前拒绝锁定角色的修改、Studio API 对 PUT/DELETE 返回 403。角色侧边栏提供可视化管理界面，支持单角色锁定、批量锁定/解锁、防止新增角色和防止删除角色。

### 生成取消与回滚

生成过程中可随时中止。系统在写手动笔前自动创建临时快照；中止时从快照恢复所有状态文件，清理半成品章节，不会留下脏数据。Studio Chat 中发送按钮会在流式生成时变为红色停止按钮，中止后提供"继续"按钮恢复对话。

### Studio Chat + Action Surface

Studio Chat 不再只是问答框。它可以创建长篇、跑短篇、编辑持久化文本文件，并在需要执行重动作前给出确认。普通讨论会直接回答；明确创作动作才进入工具执行。

### 多维度审计 + 去 AI 味

连续性审计员从 37 个维度检查每一章草稿：角色记忆、物资连续性、伏笔回收、大纲偏离、叙事节奏、情感弧线等。内置 AI 痕迹检测维度，自动识别"LLM 味"表达（高频词、句式单调、过度总结）。默认长篇写作链路最多自动修订一次；如果你更看重自动闭环，可以通过 `writing.reviewRetries` 调整修订轮数。

去 AI 味规则内置于写手 agent 的 prompt 层——词汇疲劳词表、禁用句式、文风指纹注入，从源头减少 AI 生成痕迹。`revise --mode anti-detect` 可对已有章节做专门的反检测改写。

### 文风仿写

`speedwriter style analyze` 分析参考文本，提取统计指纹（句长分布、词频特征、节奏模式）和 LLM 风格指南。`speedwriter style import` 将指纹注入指定书籍，后续所有章节自动采用该风格，修订者也会用风格标准做审计。

### 创作简报

`speedwriter book create --brief my-ideas.md` 传入你的脑洞、世界观设定、人设文档。建筑师 agent 会基于简报生成故事设定（`story_bible.md`）和创作规则（`book_rules.md`），而非凭空创作；同时把简报落盘到 `story/author_intent.md`，让这本书的长期创作意图不会只在建书时生效一次。

### 输入治理控制面

每本书都有两份长期可编辑的 Markdown 控制文档：

- `story/author_intent.md`：这本书长期想成为什么
- `story/current_focus.md`：最近 1-3 章要把注意力拉回哪里

写作前可以先跑：

```bash
speedwriter plan chapter 吞天魔帝 --context "本章先把注意力拉回师徒矛盾"
speedwriter compose chapter 吞天魔帝
```

这会生成 `story/runtime/chapter-XXXX.intent.md`、`context.json`、`rule-stack.yaml`、`trace.json`。`plan` 会调用 LLM 生成章节意图；`compose` 只编译本地文档和状态，可在没配好 API Key 前先验证控制输入。

### 字数治理

`draft`、`write next`、`revise` 共享同一套保守型字数治理：

- `--words` 指定的是目标字数，系统会自动推导一个允许区间，不承诺逐字精确命中
- 中文默认按 `zh_chars` 计数，英文默认按 `en_words` 计数
- 如果正文超出允许区间，最多只会追加 1 次纠偏归一化（压缩或补足），不会直接硬截断正文
- 如果 1 次纠偏后仍然超出 hard range，章节照常保存，但会在结果和 chapter index 里留下长度 warning / telemetry

### 续写已有作品

`speedwriter import chapters` 从已有小说文本导入章节，支持拖拽、文件上传（`.txt` / `.md`）和手动添加章节，可拖拽排序、行内重命名和展开预览。导入异步执行，实时显示基础生成、风格提取和逐章分析进度。支持导入时直接创建新书。自动重建结构化状态、章节摘要、伏笔、角色关系和可读 Markdown 投影，导入后 `speedwriter write next` 可继续创作。

### 多模型路由

不同 Agent 可以走不同模型和 Provider。写手用 Claude（创意强），审计用 GPT-4o（便宜快速）。`speedwriter config set-model` 按 agent 粒度配置，未配置的自动回退全局模型。

### 守护进程 + 通知推送

`speedwriter up` 启动后台循环自动写章。管线会自动推进可处理的非关键问题；需要人工判断的问题会暂停并留下可审结果。通知推送支持 Telegram、飞书、企业微信、Webhook（HMAC-SHA256 签名 + 事件过滤）。日志写入 `speedwriter.log`（JSON Lines），`-q` 静默模式。

### 本地模型兼容

支持任何 OpenAI 兼容接口（Studio 里新增自定义服务，或 CLI 使用 `--provider custom`）。服务测试会尝试不同协议和流式开关组合，并保存或提示可用 transport。Fallback 解析器处理小模型不规范输出，流中断时自动恢复部分内容。

### 可靠性保障

每章自动创建状态快照，`speedwriter write rewrite` 可回滚任意章节。写手动笔前输出自检表（上下文、资源、伏笔、风险），写完输出结算表，审计员交叉验证。文件锁防止并发写入。写后验证器含跨章重复检测和十余条硬规则自动 spot-fix。

---

## 快速开始

### 安装

```bash
npm i -g speedwriter
```

### 配置

#### 方式一：Studio 服务配置（推荐）

```bash
speedwriter init my-novel
cd my-novel
speedwriter
```

打开 Studio 后进入「模型配置」：

1. 选择服务商，例如 Google Gemini、Moonshot、MiniMax、智谱、百炼或自定义端点。
2. 粘贴 API Key，点击「测试连接」。
3. 选择可用模型，保存配置。
4. 回到书籍页面开始写作。

Studio 运行时只使用：

```text
provider bank 默认值
→ speedwriter.json 里的 services / 当前 service / defaultModel
→ .speedwriter/secrets.json 里的 service API Key
```

#### 方式二：CLI / daemon / 部署环境的 env 配置

全局 env：

```bash
speedwriter config set-global \
  --provider <openai|anthropic|custom> \
  --base-url <API 地址> \
  --api-key <你的 API Key> \
  --model <模型名>
```

也可以手动写 `~/.speedwriter/.env` 或项目 `.env`：

```bash
SPEEDWRITER_LLM_PROVIDER=custom
SPEEDWRITER_LLM_BASE_URL=https://api.moonshot.cn/v1
SPEEDWRITER_LLM_API_KEY=sk-...
SPEEDWRITER_LLM_MODEL=kimi-k2.5
```

CLI 合成顺序：

```text
Studio/project service 配置
→ .speedwriter/secrets.json service key
→ global ~/.speedwriter/.env
→ project .env
→ 当前进程环境变量
→ CLI 参数
```

一次性指定服务或模型：

```bash
speedwriter write next --service google --model gemini-2.5-flash
speedwriter write next --service moonshot --model kimi-k2.5 --no-stream
```

#### 方式三：多模型路由（可选）

```bash
speedwriter config set-model writer <model> --provider <provider> --base-url <url> --api-key-env <ENV_VAR>
speedwriter config set-model auditor <model> --provider <provider>
speedwriter config show-models
```

未单独配置的 Agent 自动使用全局模型。

#### 配置排查

```bash
speedwriter doctor
```

`doctor` 会显示当前 effective config mode、service/model/API Key 来源，并尝试 API 连通性。

---

## 工作原理

长篇每一章默认按"规划 → 编排 → 写作 → 审计 → 必要修订 → 状态同步"运行：

| Agent               | 职责                                                                |
| ------------------- | ----------------------------------------------------------------- |
| **规划师 Planner**     | 读取作者意图 + 当前焦点 + 记忆检索结果，产出本章意图（must-keep / must-avoid）             |
| **编排师 Composer**    | 从结构化状态、控制文档和 Markdown 投影中按任务选择上下文，编译规则栈和运行时产物                     |
| **建筑师 Architect**   | 建书、导入或番外初始化时生成基础设定：故事框架、规则、角色与长期控制文件                              |
| **写手 Writer**       | 基于编排后的精简上下文生成正文（字数治理 + 对话引导）                                      |
| **观察者 Observer**    | 从正文中提取 9 类事实（角色、位置、资源、关系、情感、信息、伏笔、时间、物理状态）                      |
| **反射器 Reflector**   | 输出 JSON delta（而非全量 markdown），由代码层做 Zod schema 校验后 immutable 写入    |
| **归一化器 Normalizer** | 仅在正文明显偏离 hard range 时单 pass 压缩/扩展                                 |
| **连续性审计员 Auditor**  | 对照结构化状态、控制文档和章节上下文验证草稿，执行连续性与质量检查                                 |
| **修订者 Reviser**     | 修复审计发现的关键问题；默认最多自动修订一次，可通过 `writing.reviewRetries` 调整，其他问题标记给人工审核 |

### 长期记忆

每本书的权威记忆由三层组成：

| 层                    | 用途                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `story/state/*.json` | 权威结构化状态：当前状态、伏笔、章节摘要等，经过 Zod schema 校验                                                      |
| `story/*.md`         | 人类可读投影：`current_state.md`、`pending_hooks.md`、`chapter_summaries.md`、`character_matrix.md` 等 |
| `story/memory.db`    | Node 22+ 自动启用的 SQLite 时序记忆库，用于相关事实、伏笔和摘要检索                                                  |

### 控制面与运行时产物

- `story/author_intent.md`：长期作者意图
- `story/current_focus.md`：当前阶段的关注点
- `story/runtime/chapter-XXXX.intent.md`：本章目标、保留项、避免项、冲突处理
- `story/runtime/chapter-XXXX.context.json`：本章实际选入的上下文
- `story/runtime/chapter-XXXX.rule-stack.yaml`：本章的优先级层和覆盖关系
- `story/runtime/chapter-XXXX.trace.json`：本章输入编译轨迹

---

## 使用模式

### 1. 完整管线（一键式）

```bash
speedwriter write next 吞天魔帝          # 写草稿 → 审计 → 按配置自动修订
speedwriter write next 吞天魔帝 --count 5 # 连续写 5 章
```

### 2. 原子命令（可组合，适合外部 Agent 调用）

```bash
speedwriter plan chapter 吞天魔帝 --context "本章重点写师徒矛盾" --json
speedwriter compose chapter 吞天魔帝 --json
speedwriter draft 吞天魔帝 --context "本章重点写师徒矛盾" --json
speedwriter audit 吞天魔帝 31 --json
speedwriter revise 吞天魔帝 31 --json
```

### 3. 自然语言 Agent 模式

```bash
speedwriter agent "帮我写一本都市修仙，主角是个程序员"
speedwriter agent "写下一章，重点写师徒矛盾"
```

---

## 命令参考

| 命令                                          | 说明                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `speedwriter init [name]`                         | 初始化项目（省略 name 在当前目录初始化）                                                                    |
| `speedwriter book create`                         | 创建新书（`--genre`、`--platform`、`--chapter-words`、`--target-chapters`、`--brief <file>` 传入创作简报） |
| `speedwriter book update [id]`                    | 修改书设置（`--chapter-words`、`--target-chapters`、`--status`）                                    |
| `speedwriter book list`                           | 列出所有书籍                                                                                     |
| `speedwriter book delete <id>`                    | 删除书籍及全部数据（`--force` 跳过确认）                                                                  |
| `speedwriter genre list/show/copy/create`         | 查看、复制、创建题材                                                                                 |
| `speedwriter plan chapter [id]`                   | 生成下一章的 `intent.md`（`--context` / `--context-file` 传入当前指令）                                  |
| `speedwriter compose chapter [id]`                | 生成下一章的 `context.json`、`rule-stack.yaml`、`trace.json`                                       |
| `speedwriter write next [id]`                     | 完整管线写下一章（`--words` 覆盖字数，`--count` 连写，`-q` 静默模式）                                            |
| `speedwriter write rewrite [id] <n>`              | 重写第 N 章（恢复状态快照，`--force` 跳过确认，`--words` 覆盖字数）                                              |
| `speedwriter draft [id]`                          | 只写草稿（`--words` 覆盖字数，`-q` 静默模式）                                                             |
| `speedwriter audit [id] [n]`                      | 审计指定章节                                                                                     |
| `speedwriter revise [id] [n]`                     | 修订指定章节                                                                                     |
| `speedwriter agent <instruction>`                 | 自然语言 Agent 模式                                                                              |
| `speedwriter review list [id]`                    | 审阅草稿                                                                                       |
| `speedwriter review approve-all [id]`             | 批量通过                                                                                       |
| `speedwriter status [id]`                         | 项目状态                                                                                       |
| `speedwriter export [id]`                         | 导出书籍（`--format txt/md/epub`、`--output <path>`、`--approved-only`）                           |
| `speedwriter import chapters [id] --from <path>`  | 导入已有章节续写（`--split`、`--resume-from`）                                                        |
| `speedwriter eval [id]`                           | 生成质量评估报告（支持 `--json`、章节范围）                                                                 |
| `speedwriter consolidate [id]`                    | 归并长篇章节摘要，降低长书上下文压力                                                                         |
| `speedwriter config set-global`                   | 设置全局 LLM env（`~/.speedwriter/.env`）                                         |
| `speedwriter config show-global`                  | 查看全局配置                                                                                     |
| `speedwriter config set/show`                     | 查看/更新项目配置                                                                                  |
| `speedwriter config set-model <agent> <model>`    | 为指定 agent 设置模型覆盖（`--base-url`、`--provider`、`--api-key-env` 支持多 Provider 路由）                |
| `speedwriter config remove-model <agent>`         | 移除 agent 模型覆盖（回退到默认）                                                                       |
| `speedwriter config show-models`                  | 查看当前模型路由                                                                                   |
| `speedwriter doctor`                              | 诊断配置问题                                                                                       |
| `speedwriter style analyze <file>`                | 分析参考文本提取文风指纹                                                                               |
| `speedwriter style import <file> [id]`            | 导入文风指纹到指定书                                                                                 |
| `speedwriter import chapters [id] --from <path>`  | 导入已有章节续写（`--split`、`--resume-from`）                                                        |
| `speedwriter analytics [id]`                      | 书籍数据分析（审计通过率、高频问题、章节排名、token 用量）                                                           |
| `speedwriter studio` / `speedwriter`              | 启动 Web 工作台（`-p` 指定端口，默认 4567）                                    |
| `speedwriter tui`                                 | 启动终端全屏 TUI                                                                                 |
| `speedwriter up / down`                           | 启动/停止守护进程（`-q` 静默模式，自动写入 `speedwriter.log`）                                                      |

`[id]` 参数在项目只有一本书时可省略，自动检测。所有命令支持 `--json` 输出结构化数据。`draft` / `write next` / `plan chapter` / `compose chapter` 支持 `--context` 传入创作指导，`--words` 覆盖每章目标字数。`book create` 支持 `--brief <file>` 传入创作简报。

---

## 路线图

- ~~Web UI 工作台（Vite + React + Hono）~~ — 已发布
- 局部干预（重写半章 + 级联更新后续 truth 文件）
- 自定义 agent 插件系统
- 平台格式导出（起点、番茄等）

## 参与贡献

欢迎贡献代码。提 issue 或 PR。

```bash
pnpm install
pnpm dev          # 监听模式
pnpm test         # 运行测试
pnpm typecheck    # 类型检查
```

## License

[AGPL-3.0](LICENSE)
