# Mind Map（思维导图）功能设计文档

> 目标：为 StudiumX 增加**原生思维导图编辑**与**AI 辅助生成思维导图**能力，数据模型与交互参考本机安装的 XMind（`/Applications/Xmind.app`），并支持 `.xmind` 导入/导出实现互通。
>
> 本文是设计文档，给出数据模型、持久化、IPC、AI 生成、渲染器 UI 与实施切片的完整方案。架构决策摘要见 [ADR-0172](../adr/0172-mind-map-and-ai-assist.md)。

---

## 1. 背景与产品目标

StudiumX 是本地优先的个人 AI 教学工作区。当前教学内容以 Lesson（课程）/ Notes / Glossary 等 markdown 文档为主，缺少**结构化脑图**这一常见学习与备课工具。

本功能让用户：

1. **原生编辑思维导图**——中心主题向四周发散，节点可编辑标题/备注、增删子节点、折叠/展开分支、多 Sheet，交互与观感对齐 XMind。
2. **AI 辅助生成**——输入主题/提示词，由当前配置的 provider 生成一棵结构化的思维导图，可流式预览，生成后仍可自由编辑。
3. **XMind 互通**——导入/导出 `.xmind` 文件（ZIP 内含 `content.json`），与已安装的 XMind 双向交换。

### 设计原则（对齐产品地板）

- 导图是**用户内容**，**不是教学权威**：不产生 settlement / evidence / outcome / learner-profile 写入，不进入 LearningSession ledger（对齐 [ADR-0167](../adr/0167-teaching-authority-and-syncable-user-state.md)）。
- **本地优先**：文件存于工作区，无远程同步、无默认 telemetry。
- AI 生成是**辅助**，复用现有 provider 路由 / 资源治理 / 错误分类；生成结果以用户后续编辑为准。
- 不引入 FTS / 向量库做产品搜索；不引入 YOLO / 审批旁路。
- 渲染器图表沿用现有**自定义 SVG** 风格（参考 `MorphPieChart` 等），不引入重型图形依赖。

---

## 2. 数据模型

### 2.1 原生文档（`src/shared/mindmap/mind-map-types.ts`）

数据模型**镜像 XMind 的 content 结构**（sheet → rootTopic → 递归 topic 树），使 `.xmind` 互转只需 ZIP 编解码，无需结构映射。

```ts
/** 布局结构类，取值对齐 XMind 的 structureClass（`org.xmind.ui.logic.*`）。 */
export type MindMapStructureClass =
  | 'org.xmind.ui.logic.right'       // 右侧逻辑图（XMind 默认）
  | 'org.xmind.ui.logic.balanced'    // 两侧均衡
  | 'org.xmind.ui.logic.left'        // 左侧逻辑图
  | 'org.xmind.ui.logic.map'         // 思维导图（双向发散）
  | 'org.xmind.ui.logic.down'        // 向下组织图
  | 'org.xmind.ui.logic.up'          // 向上组织图

export type MindMapNode = {
  id: string
  title: string
  /** 备注/说明（可选）。 */
  note?: string
  /** 该分支是否折叠展开子节点。 */
  collapsed?: boolean
  /** 子树局部布局覆盖（可选，默认继承 sheet）。 */
  structureClass?: MindMapStructureClass
  /** 附加（attached）子分支。 */
  children: MindMapNode[]
}

export type MindMapSheet = {
  id: string
  title: string
  structureClass: MindMapStructureClass
  /** 中心主题（rootTopic）。 */
  root: MindMapNode
}

/** 顶层文档：一个 .studiumx-mindmap 文件对应一个文档，可含多 sheet。 */
export type MindMapDocument = {
  schemaVersion: 1
  id: string
  title: string
  createdAt: string   // ISO 8601
  updatedAt: string   // ISO 8601
  sheets: MindMapSheet[]
}
```

- 节点 `id` 使用 `crypto.randomUUID()` 生成，保证删除/折叠/重排等操作稳定引用。
- 所有数组字段默认 `[]`，`title` 可空串（空节点占位）。

### 2.2 Zod schema（`src/shared/mindmap/mind-map-schema.ts`）

提供与类型一一对应的 Zod schema：

- `mindMapNodeSchema` / `mindMapSheetSchema` / `mindMapDocumentSchema`。
- 递归结构用 `z.lazy(() => z.array(mindMapNodeSchema))`。
- 用于：AI 生成输出校验、IPC payload 校验、`.xmind` 导入校验、单元测试。
- 校验失败给出结构化诊断（`ZodError`），不静默降级。

### 2.3 XMind 互转（`src/shared/mindmap/xmind-converter.ts`）

`.xmind`（XMind 2020+）是 ZIP 归档，内含 `content.json`：

```jsonc
[
  {
    "class": "sheet",
    "id": "<sheet-uuid>",
    "title": "Sheet 1",
    "rootTopic": {
      "class": "topic",
      "id": "<topic-uuid>",
      "title": "中心主题",
      "structureClass": "org.xmind.ui.logic.right",
      "children": {
        "attached": [
          { "class": "topic", "id": "<uuid>", "title": "Branch 1",
            "children": { "attached": [ /* 递归 */ ] } }
        ]
      }
    }
  }
]
```

提供双向转换：

- `xmindContentToDocument(content: unknown): MindMapDocument` — 从 XMind sheet 数组映射到原生文档（忽略 `class`、重建 `id/title/createdAt/updatedAt`，`structureClass` 前向兼容默认 `right`）。
- `documentToXmindContent(doc: MindMapDocument): unknown` — 原生文档转 XMind `content.json` 形状（补 `class: 'sheet'/'topic'`、`children.attached` 包装）。
- 纯函数 + 单元测试覆盖（含空树、深层嵌套、未知字段容忍）。

---

## 3. 持久化

### 3.1 存储位置与格式

- 每个导图一个 JSON 文件，存放于工作区：`<workspace>/mindmaps/<id>.json`。
- 文件内容即 `MindMapDocument`（UTF-8 JSON，`JSON.stringify` 排序键可复现）。
- 不写 SQLite：导图是用户内容，canonical 在工作区文件（对齐 [ADR-0131](../adr/0131-pathname-default-durable-io.md) 默认写模型与 [ADR-0167](../adr/0167-teaching-authority-and-syncable-user-state.md)）。

### 3.2 主进程 store（`src/main/mindmap/mind-map-store.ts`）

- `listMindMaps(): { id; title; updatedAt; sheetCount }[]` — 扫描 `mindmaps/` 目录，读取每个文件头部元数据（可先 list 目录再按需 read）。
- `createMindMap(title): MindMapDocument` — 生成 id，写入默认文档（一个空 sheet + 空 root）。
- `readMindMap(id): MindMapDocument` — 读取 + Zod 校验。
- `updateMindMap(id, doc): MindMapDocument` — 幂等 durable 写（pathname temp+rename，见下）。
- `deleteMindMap(id): void` — 删除文件。
- 校验 `id` 安全（`/^[a-z0-9][a-z0-9-]{0,63}$/`），路径经 `path-access.ts` 保证不能越出工作区。

### 3.3 durable 写（对齐 ADR-0131）

写文件采用 **pathname temp+rename**：先写 `.<id>.json.tmp`，`fsync` 后 `rename` 到目标，避免半写损坏。复用 `src/main/persistence` 既有的 durable 写工具（若存在则以既有工具为准）。

### 3.4 工作区审计（可选增强）

导图文件若纳入 `teaching-workspace-change-history` 的变更审计，仅作文件级记录，不视为教学证据。列为 Phase 2 可选项，不阻塞核心。

---

## 4. IPC 契约

### 4.1 新增 channel（`src/shared/teaching-ipc-contract.ts`）

在 `teachingInvokeChannels` 追加：

| channel | 请求 payload | 返回 |
| --- | --- | --- |
| `listMindMaps` | — | `{ id; title; updatedAt; sheetCount }[]` |
| `createMindMap` | `{ title }` | `MindMapDocument` |
| `readMindMap` | `{ id }` | `MindMapDocument` |
| `updateMindMap` | `{ id; doc }` | `MindMapDocument` |
| `deleteMindMap` | `{ id }` | void |
| `generateMindMap` | `{ title; prompt; workspaceContext? }` | `MindMapDocument` |
| `importMindMapXmind` | `{ sourcePath }` | `MindMapDocument` |
| `exportMindMapXmind` | `{ id; destinationDirectory }` | `{ path }` |

事件 channel 追加：

- `mindMapStreamChunk` — AI 生成流式中间文本（`{ id; text }`）。
- `mindMapStreamStatus` — AI 生成状态（`{ id; status; error? }`）。

### 4.2 `TeachingSystemApi` 方法（`src/shared/teaching-types/system-api.ts`）

为上面每个 channel 增加同名方法，签名与上表一致。preload 暴露 `window.teachingSystem` 后，渲染器直接调用。

### 4.3 主进程 handler（`src/main/teaching-ipc-commands.ts` + 独立模块）

遵循项目**精确 envelope 解析**模式（参考 `parseCommitLearningOutcomeRequest` 等）：

- 每个命令一个严格 parser：校验 key 集合、`id` 格式、payload 形状，拒绝多余字段。
- 解析失败返回 `null` → 调用方给出结构化错误，不静默落盘。
- 采用独立模块 `src/main/mindmap/mind-map-ipc.ts` 承载 handler，`teaching-ipc-commands.ts` 只做装配与转发，避免巨石文件再膨胀（模块尺寸政策 [ADR-0075](../adr/0075-module-size-policy-and-giant-peel.md)）。

---

## 5. AI 辅助生成

复用现有 AI 基建（provider 路由、资源治理、错误分类、流式），不新增第二套 provider 通道。

### 5.1 提示词（`src/main/mindmap/mind-map-prompts.ts`）

- `buildMindMapSystemPrompt(opts)`：给出 `MindMapDocument` 的 JSON 结构说明，要求**只返回 JSON**、禁止 HTML、禁止 markdown 代码块包裹；Zod 下游校验。
- 注入：用户 `prompt`、可选工作区上下文（mission / notes / glossary 摘录，经 `memory-sanitize` 脱敏）、可选同意门控的 memory 摘录。
- 对齐 prompt-prefix / cache 约定（[ADR-0044](../adr/0044-teaching-prompt-cache-contract.md)）。

### 5.2 生成执行（`src/main/mindmap/mind-map-generation.ts`）

- 解析当前主 provider（`resolveActiveProvider`），经 `provider-adapter` 的 `callProvider` / `streamProvider` 调用。
- 流式：`streamProvider` 逐块 emit `mindMapStreamChunk`；结束后对完整输出 `mindMapDocumentSchema.parse`，成功则持久化并返回，失败则返回结构化错误（`MindMapGenerationError`），**不静默降级**。
- 资源治理：接入 `AgentRunResourceGovernor`，触发 `resource_limit` / `suspended` 时返回终端错误，不伪装成生成成功。
- 取消：复用现有 cancel 通道传播取消。
- 错误分类：复用 `classifyProviderError` / `providerErrorReason` 统一文案。

### 5.3 非教学事实

生成结果只是草稿文档，落盘后与用户手动编辑**无身份差异**；不写 LearningSession ledger、不产生 evidence、不改 learner-profile。

---

## 6. 渲染器 UI

### 6.1 视图注册

- `src/shared/teaching-types/workspace.ts`：`WorkspaceView` 追加 `'mindmap'`。
- `src/renderer/src/App.tsx`：`navItems` 追加 `{ id: 'mindmap', icon: <MindMap lucide icon> }`；`MainArea` 增加 `view === 'mindmap'` 分支渲染 `<MindMapView />`（懒加载）。
- `src/renderer/src/app-shell/contextTransitions.ts`：`PRIMARY_SHELL_VIEWS` 加入 `'mindmap'`（独占 chrome，清空侧栏选择态）。
- `src/renderer/src/study-space/domain.ts`：`initialWorkspaceViewFromUrl` 支持 `mindmap` 参数。
- i18n：`zh-CN.json` / `en-US.json` 增加 `mindmap.*` 键。

### 6.2 布局（`MindMapView.tsx`）

```
┌─────────────┬──────────────────────────────┬──────────────────┐
│ 导图列表     │      思维导图画布              │  AI 生成面板      │
│ + 新建       │  (center topic + branches)   │  主题输入         │
│ · 导图 A     │   toolbar: 新建sheet/布局/     │  [生成] 按钮       │
│ · 导图 B     │   导入/导出/折叠全部            │  流式预览         │
│             │                              │  错误/重试        │
└─────────────┴──────────────────────────────┴──────────────────┘
```

- 左侧列表：列出 `listMindMaps` 结果，新建/删除；选中打开对应导图。
- 中间画布：`MindMapCanvas`。
- 右侧 AI 面板：`MindMapAiPanel`。

### 6.3 画布（`MindMapCanvas.tsx`）— 自定义 SVG

不引入 react-flow / d3 等重型依赖，用**自定义 SVG** 实现（与现有图表风格一致）：

- **布局算法**：自中心主题向两侧/单侧递归布局。按 `structureClass` 决定方向（`right` 单侧、`balanced`/`map` 双侧）。子树高度 = max(子级高度求和, 自身高度)，重叠后按层分配 x 间距。复杂度 O(n)。
- **交互**：节点点击选中；双击进入标题行内编辑；`+` 按钮加子节点；`Enter` 加同级/`Tab` 缩进（对齐 XMind 直觉）；`Delete`/`⌫` 删除；分支折叠/展开（`collapsed`）。
- **平移缩放**：SVG `viewBox` + 滚轮缩放 / 拖拽平移（自实现，轻量）。
- **连线**：贝塞尔曲线（central→child 平滑弧线），节点为圆角矩形 + 标题文本。
- 深色主题：颜色/边框走 CSS 变量，暗色中性（对齐 `office-workbench.css` / 暗色主题门禁）。

### 6.4 节点编辑（`MindMapNodeEditor` / 内联）

- 标题编辑：`contentEditable` 或受控 input，失焦/回车提交，空标题允许（占位）。
- 备注：选中节点后面板可编辑 `note`（文本域）。
- 折叠状态：`collapsed` 切换。

### 6.5 AI 面板（`MindMapAiPanel.tsx`）

- 输入主题 + 可选提示词，点「生成」→ 调 `generateMindMap`。
- 显示流式 `mindMapStreamChunk`（草稿预览）。
- 完成后自动打开生成文档并渲染；失败显示结构化错误 + 重试。
- 生成过程中可取消。

### 6.6 渲染器状态

- 轻量 zustand store（`src/renderer/src/views/mindmap/mind-map-view-store.ts`）：`documents` 列表、当前 `document`、`selectedNodeId`、`generating`、`streamText`、`error`。
- 或局部 state + 直接调 IPC。倾向 zustand store 以复用 appStore 模式。

---

## 7. `.xmind` 导入/导出

- `.xmind` 是 ZIP 归档。需要一个小型 ZIP 库：选用 **`fflate`**（纯 JS、~8KB gzip、无原生依赖），加入 `dependencies`。
- **导出**：`documentToXmindContent` 生成 `content.json`，可选生成 `metadata.json` / `manifest.json` / `Thumbnails/thumbnail.svg`，用 fflate 压缩为 `<title>.xmind`。
- **导入**：fflate read 解压，取 `content.json`，`xmindContentToDocument` 映射 → 校验 → 落盘为新导图。
- Bitmap 缩略图（SVG 转 PNG）列为可选增强，不阻塞。

---

## 8. i18n 键（草案）

`zh-CN.json` / `en-US.json` 增加命名空间 `mindmap.*`：

```
mindmap.viewTitle        思维导图 / Mind Map
mindmap.newDocument      新建导图 / New mind map
mindmap.importXmind      导入 XMind / Import XMind
mindmap.exportXmind      导出 XMind / Export XMind
mindmap.aiTitle          AI 生成 / AI Generate
mindmap.aiPromptLabel    主题或提示词 / Topic or prompt
mindmap.aiGenerate       生成导图 / Generate
mindmap.aiCancel         取消 / Cancel
mindmap.aiStreaming      正在生成… / Generating…
mindmap.aiError          生成失败 / Generation failed
mindmap.retry            重试 / Retry
mindmap.addChild         添加子主题 / Add child
mindmap.addSibling       添加同级主题 / Add sibling
mindmap.deleteNode       删除主题 / Delete topic
mindmap.collapseAll      全部折叠 / Collapse all
mindmap.expandAll        全部展开 / Expand all
mindmap.layout           布局 / Layout
mindmap.note             备注 / Note
mindmap.emptyState       尚无导图，点击「新建导图」开始 / No mind maps yet
```

---

## 9. 测试

| 领域 | 测试入口 |
| --- | --- |
| Zod schema 校验（合法/非法/递归） | `tests/unit/mind-map-schema.unit.test.ts` |
| XMind 互转（空树/深层/未知字段容忍） | `tests/unit/xmind-converter.unit.test.ts` |
| store CRUD + durable 写 + 路径围栏 | `tests/unit/mind-map-store.unit.test.ts` |
| IPC envelope 解析（严格 key） | `tests/unit/mind-map-ipc.unit.test.ts` |
| AI 输出解析（合法 JSON→doc；非法→错误） | `tests/unit/mind-map-generation.unit.test.ts` |
| 渲染器 store / 布局算法 | `tests/unit/mind-map-canvas-layout.unit.test.ts` |

新增 `package.json` check 脚本（项目惯例）：`check:mindmap-*`。

---

## 10. 实施切片与子代理分工

> 在 ADR 批准该设计后，按以下切片分派子代理实现。切片间依赖：S2←S1，S3←S2，S4←S1，S5←S1+S3，S6←S1+S5。

| 切片 | 交付物 | 说明 |
| --- | --- | --- |
| **S1 共享类型** | `mind-map-types.ts`、`mind-map-schema.ts`、`xmind-converter.ts` + 单测 | 数据模型地基，无 I/O |
| **S2 主进程持久化** | `mind-map-store.ts` + durable 写 + 单测 | 工作区文件 CRUD、路径围栏 |
| **S3 IPC** | `system-api.ts` 方法、channel、`mind-map-ipc.ts` handler + 单测 | 渲染器↔主进程契约 |
| **S4 AI 生成** | `mind-map-prompts.ts`、`mind-map-generation.ts` + 单测 | provider 调用、流式、Zod、资源治理 |
| **S5 渲染器 UI** | 视图注册 + `MindMapView`/`MindMapCanvas`/`MindMapNodeEditor`/`MindMapAiPanel` + store + i18n | 画布、编辑、AI 面板 |
| **S6 导入导出 + 打磨** | fflate 依赖、`.xmind` 导入/导出、深色主题、a11y、i18n 完整 | 互通与体验完成 |

每个切片：
- 触达任意 TS 生产路径 → `pnpm typecheck`。
- 文档/ADR → 交叉链接自检。
- 遵守模块尺寸（<500–800 行）、不塞巨石文件、保留既有 sole-writer 与审计。

---

## 11. 边界与非声明

- **不**产生教学权威 / settlement / evidence。
- **不**引入远程同步、默认 telemetry、FTS/向量搜索。
- **不**新增第二套 provider 通道；AI 生成复用现有基建。
- **不做** XMind 全部功能（自由手绘、LaTeX 节点、Marker 库、迷你图、演示模式）——仅实现核心编辑 + AI 生成 + `.xmind` 互通。
- `.xmind` 导入忽略不支持的字段（image/marker/ext 附件），不报错，保留文本结构。