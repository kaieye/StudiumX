# ADR-0172：思维导图与 AI 辅助生成

- **状态：** 已批准（Proposed → Approved；设计见 [docs/mindmap/design.md](../mindmap/design.md)）
- **日期：** 2026-08-09
- **范围：** 在 StudiumX 增加**原生思维导图编辑**与 **AI 辅助生成思维导图**，数据模型与交互参考本机安装的 XMind（`/Applications/Xmind.app`），并支持 `.xmind` 导入/导出实现互通。
- **相关：** [ADR-0131](0131-pathname-default-durable-io.md)（durable 写）、[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)（教学权威边界）、[ADR-0075](0075-module-size-policy-and-giant-peel.md)（模块尺寸）、[ADR-0044](0044-teaching-prompt-cache-contract.md)（prompt-cache 纪律）。

## 1. 背景与问题边界

StudiumX 以 markdown 的 Lesson / Notes / Glossary 承载教学内容，缺少**结构化脑图**这一常见学习与备课工具。用户希望：

1. 在应用内直接编辑思维导图（中心主题发散、节点增删改、折叠/展开、多 sheet），交互对齐 XMind。
2. 通过 AI 从主题/提示词一键生成结构化导图，生成后可继续自由编辑。
3. 与已安装的 XMind 互通（`.xmind` 导入/导出）。

**非目标**：不实现 XMind 全部功能；导图是用户内容，**不**成为教学权威；不引入第二套 provider 通道。

## 2. 决策

### 2.1 数据模型镜像 XMind content 结构

原生导图文档（`MindMapDocument`）由 1..n 个 `MindMapSheet` 组成，每个 sheet 含一个 `root`（rootTopic）递归树（`MindMapNode`：id/title/note/collapsed/structureClass/children）。`structureClass` 取值对齐 XMind 的 `org.xmind.ui.logic.*`。

**为什么**：与 XMind 完全同构，使 `.xmind` 互转只需 ZIP 编解码而非结构映射，降低互通成本与回归面。

### 2.2 导图是用户内容，不是教学权威

导图文件 canonical 于工作区 `<workspace>/mindmaps/<id>.json`，**不**产生 settlement / evidence / outcome / learner-profile 写入，不进入 LearningSession ledger（对齐 ADR-0167）。AI 生成结果只是草稿，落盘后与用户手动编辑无身份差异。

**为什么**：保持「文件是教学真相源」边界不被导图工具污染；导图是辅助工具而非教学证据。

### 2.3 durable 工作区写

写文件采用 pathname temp+rename（对齐 ADR-0131），id 经严格校验、路径经 `path-access.ts` 围栏，杜绝半写损坏与越界。

### 2.4 IPC 走既有精确 envelope 解析

新增 `listMindMaps` / `createMindMap` / `readMindMap` / `updateMindMap` / `deleteMindMap` / `generateMindMap` / `importMindMapXmind` / `exportMindMapXmind` 命令与 `mindMapStreamChunk` / `mindMapStreamStatus` 事件，加入 `TeachingSystemApi` 与 `teachingInvokeChannels`。handler 复用精确 parser 模式（严格 key 集合、拒绝多余字段、失败返回结构化错误）。

### 2.5 AI 生成复用现有 provider 基建

`generateMindMap` 复用 `resolveActiveProvider` / `provider-adapter`（`callProvider`/`streamProvider`）、`AgentRunResourceGovernor`、`classifyProviderError` 与取消通道。提示词要求**只返回 JSON**，Zod 下游校验，失败返回结构化错误而非静默降级。输出是草稿文档，不写任何教学事实。

### 2.6 渲染器自绘 SVG 画布

不引入 react-flow / d3 等重型图形依赖，用自定义 SVG 实现布局、连线、平移缩放、节点编辑（与现有 `MorphPieChart` 等自定义 SVG 风格一致），颜色走 CSS 变量以兼容深色主题。新增 `mindmap` 顶层视图（`WorkspaceView` + nav item + `MainArea` 分支 + `PRIMARY_SHELL_VIEWS` + i18n）。

### 2.7 `.xmind` 互通用 fflate

`.xmind` 是 ZIP 归档。选用小型纯 JS 库 **`fflate`**（~8KB gzip、无原生依赖）做压缩/解压，`content.json` 经 `xmind-converter` 与原生文档互转。忽略 image/marker/ext 附件字段，保留文本结构。

## 3. 明确不包含 / 非声明

- 不产生教学权威 / settlement / evidence / learner-profile 写入。
- 不引入远程同步、默认 telemetry、FTS/向量搜索。
- 不新增第二套 provider 通道；AI 生成复用既有基建。
- 不做 XMind 全部功能（自由手绘、LaTeX 节点、Marker 库、迷你图、演示模式）。
- `.xmind` 导入忽略不支持的附件字段，不报错。

## 4. 实施切片

设计文档 §10 定义 S1–S6 六个切片（共享类型 / 主进程持久化 / IPC / AI 生成 / 渲染器 UI / 导入导出打磨），依赖链 S2←S1、S3←S2、S4←S1、S5←S1+S3、S6←S1+S5。每个切片独立单测与 `check:mindmap-*` 门禁，触达生产路径即过 `pnpm typecheck`。

## 5. 测试与验收

- 单测：schema 校验、XMind 互转、store CRUD + durable 写 + 路径围栏、IPC envelope 解析、AI 输出解析。
- 验收：`pnpm typecheck` 通过；`check:mindmap-*` 通过；`pnpm dev` 手测新建/编辑/AI 生成/导入导出。