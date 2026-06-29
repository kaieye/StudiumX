# AI 教学系统技术栈规划

## 目标

构建一个个人化 AI 教学系统：用户通过对话输入想学习的知识点、目标、基础和约束，系统让 AI 制定教学方案，并基于 `D:\project\learn\teach` 技能包约定，把课程以可保存、可复习、可打印的 HTML 页面形式输出。

核心产物不是普通聊天记录，而是一套持续演进的学习工作区：

- `MISSION.md`：学习目标和现实动机
- `RESOURCES.md`：可信资源清单
- `learning-records/*.md`：学习记录
- `reference/*.html`：速查资料
- `lessons/*.html`：每节独立 HTML 课程
- `assets/*`：课程共享样式、脚本和交互组件

## 参考应用结论

### Marvis 的启发

Marvis 的界面优势来自：React/Vite 前端产物、Semi Design 风格的设计 token、低对比浅色界面、精细动画和素材、清晰的信息层级。

可借鉴点：

- 用成熟组件体系加自定义主题，而不是从零堆 UI。
- 通过统一设计 token 控制颜色、圆角、阴影、字体和状态。
- 教学页面要有“讲义感”，不是后台管理页面。

不建议照搬：

- 不需要 Qt/C++/CEF。你的系统更需要本地文件读写、AI 调用、HTML 生成和桌面集成，Electron 更合适。

### Kun 的启发

Kun 是 Electron + React + TypeScript + Vite/electron-vite 的桌面应用，主进程负责本地 runtime、设置、IPC、托盘、更新，渲染进程负责 React UI。

可借鉴点：

- Electron 三段式结构清晰：`main`、`preload`、`renderer`。
- 本地 Node runtime 适合处理 AI 调用、文件系统、SQLite、SSE 流。
- React + Tailwind/design tokens 适合快速做高质感工具界面。

## 推荐技术栈

### 应用框架

- **Electron 34+**
- **electron-vite**
- **electron-builder**

理由：

- 需要本地读写 `teach` 工作区文件。
- 需要生成和预览本地 HTML。
- 后续可能需要托盘、自动更新、文件选择器、离线资源管理。
- 与 Kun 的架构接近，工程风险低。

### 前端

- **React 19**
- **TypeScript**
- **Vite**
- **Zustand**
- **lucide-react**
- **i18next / react-i18next**

理由：

- React 生态适合构建对话区、课程预览、学习档案、资源库、设置页。
- Zustand 足够轻，不需要 Redux。
- lucide-react 图标一致、轻量。
- i18n 提前接入，中文为主，后续可扩展英文。

### UI 与设计系统

建议二选一：

1. **Semi Design + 自定义主题 token**
2. **Tailwind CSS + 自研 `--ds-*` 设计 token**

推荐默认选择：**Tailwind CSS + 自研设计 token**。

理由：

- 教学系统需要强定制的讲义、卡片、练习、引用、进度等视觉语言。
- Tailwind + token 更容易做出类似 Kun 的轻量工具界面。
- Semi Design 适合表单、弹窗、菜单等后台控件，但课程页会被组件库风格束缚。

折中方案：

- App 外壳使用 Tailwind + token。
- 复杂表单可以局部引入 Headless UI / Radix UI，而不是整套重组件库。

### AI Runtime

- **Node.js 本地 runtime**
- **SSE 流式响应**
- **Zod 校验 AI 输出**
- Provider adapter 支持：
  - OpenAI-compatible API
  - Anthropic
  - DeepSeek
  - 本地模型接口，后续扩展

关键原则：

- 不让 AI 直接生成最终 HTML。
- AI 输出结构化 JSON。
- 通过 Zod 校验后，再由模板渲染为 HTML。

### 内容生成

- **Markdown 解析**：`react-markdown`、`remark-gfm`
- **代码高亮**：`shiki`
- **HTML 模板**：`Nunjucks` 或 `Handlebars`
- **HTML 安全处理**：`sanitize-html` 或 `rehype-sanitize`

推荐：

- App 内展示用 React。
- `lessons/*.html` 输出用模板引擎生成静态 HTML。
- 每个 lesson 尽量不打包 React，只使用共享 `assets/lesson.css` 和少量原生 JS。

理由：

- `teach` 技能包强调 HTML 文件可长期保存、可打印、可快速复习。
- 独立静态 HTML 比 SPA 页面更耐久。
- 模板渲染比 AI 直接吐 HTML 更可控。

### 本地存储

- **SQLite + better-sqlite3**
- 文件系统仍作为真实教学产物来源

SQLite 存：

- 会话索引
- 生成任务状态
- 用户偏好
- AI provider 设置
- lesson 元数据
- 检索缓存

文件系统存：

- `MISSION.md`
- `RESOURCES.md`
- `learning-records/*.md`
- `reference/*.html`
- `lessons/*.html`
- `assets/*`

原则：

- 文件是可迁移、可读、可版本化的长期资产。
- SQLite 是索引和运行状态，不做唯一真相来源。

### 交互课程组件

首批放在 `assets/`：

- `lesson.css`：统一讲义样式
- `quiz.js`：单选、多选、判断、填空反馈
- `progress.js`：本地进度记录
- `diagram.css`：流程图、对照图、概念图样式

后续再加：

- 间隔复习卡片
- 代码运行沙盒
- 知识图谱
- 学习路径时间线

## 推荐架构

```txt
app/
  main/
    ai-runtime/
      providers/
      lesson-planner.ts
      lesson-generator.ts
    workspace/
      teach-workspace.ts
      markdown-files.ts
      html-writer.ts
    db/
      schema.ts
      migrations/
    ipc/
  preload/
    index.ts
  renderer/
    src/
      components/
      store/
      pages/
      styles/
teach-workspaces/
  {topic}/
    MISSION.md
    RESOURCES.md
    lessons/
    reference/
    learning-records/
    assets/
```

## AI 生成流程

1. 用户输入：想学的知识点、目标、基础、时间约束。
2. 系统检查是否已有 `MISSION.md`。
3. 如果 mission 不清楚，AI 先追问。
4. AI 生成教学计划 JSON。
5. Zod 校验结构。
6. 生成 lesson draft。
7. 用户确认或要求调整。
8. 渲染为 `lessons/0001-xxx.html`。
9. 同步更新 `RESOURCES.md`、`learning-records/*.md` 或 `reference/*.html`。
10. App 内打开预览。

## MVP 范围

第一版只做这些：

- 创建/选择教学工作区
- 对话式确认学习目标
- 自动生成 `MISSION.md`
- 生成第一节 `lessons/*.html`
- 统一 `assets/lesson.css`
- App 内 HTML 预览
- 保存会话和 lesson 索引

暂缓：

- 多用户系统
- 云同步
- 复杂权限系统
- 在线社区功能
- 代码沙盒
- 大规模知识库/RAG

## 评估视角：优化建议

### 1. 不建议一开始做 Web SaaS

纯 Web 方案看起来简单，但会立刻遇到本地文件读写、HTML 文件管理、离线资产、用户隐私和 API Key 管理问题。你的核心场景是个人学习工作区，Electron 更贴合。

### 2. 不建议每节课做成 React SPA

React lesson 交互能力强，但长期保存和打印不稳定，产物也更重。`teach` 技能包明确偏向自包含 HTML 讲义，所以 lesson 应该是静态 HTML + 轻量 JS。

### 3. 不建议 AI 直接生成 HTML

AI 直接写 HTML 会导致样式不一致、结构难验证、安全风险高、后续难批量改版。更好的方式是：

```txt
AI -> structured JSON -> validator -> template renderer -> HTML
```

### 4. UI 库选择要克制

如果目标是 Marvis 那种精致感，组件库不是核心，设计 token 才是核心。建议先建立：

- 色彩 token
- 字体 token
- 间距 token
- 阴影 token
- lesson block 规范

再考虑引入组件库。

### 5. 数据源要“文件优先”

学习资产应该能脱离 App 存在。即使 App 坏了，用户也应该能直接打开 `lessons/*.html` 和 `MISSION.md`。SQLite 不应该成为唯一数据源。

### 6. RAG 可以晚点做

早期不要先做复杂向量库。先用 `RESOURCES.md` 人工精选可信资源，再让 AI 基于资源摘要生成课程。等 lesson 数量和 reference 数量多了，再考虑：

- SQLite FTS
- LanceDB
- 本地 embedding

### 7. 安全边界必须提前设计

需要默认禁止 lesson HTML 执行危险脚本。App 预览本地 HTML 时，应使用隔离 webview 或安全 iframe，并限制：

- Node integration
- 任意文件读取
- 远程脚本加载
- 未授权外链跳转

## 最终建议

采用：

```txt
Electron + electron-vite + React + TypeScript
+ Tailwind CSS + 自研设计 token
+ Zustand
+ Node AI runtime + SSE
+ Zod structured output
+ SQLite/better-sqlite3
+ static HTML lesson generator
+ shared lesson assets
```

这个方案同时满足：

- Marvis 式漂亮界面
- Kun 式本地桌面能力
- `teach` 技能包的 HTML 教学产物约定
- 后续扩展到课程库、复习系统、知识图谱和本地模型的空间
