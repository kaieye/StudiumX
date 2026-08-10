# ADR-0173：思维导图 schema v2、revisioned repository 与互通保真承诺

- **状态：** 已采纳（M0 基线契约；实施分 M1 起步）
- **日期：** 2026-08-09
- **范围：** StudiumX 原生思维导图的**数据模型 v2**、**revision/expectedRevision 持久化与 IPC 契约**、**统一 command 入口与 undo/redo**、**XMind 互通保真承诺与兼容性报告**，以及**来源锚点/教学投影边界**。
- **前置基线：** [ADR-0172](0172-mind-map-and-ai-assist.md)（v1 数据模型与初版互通）、[docs/mindmap/design.md](../mindmap/design.md)（S1–S6 切片）、[docs/mindmap/studiumx-mind-map-plan.md](../mindmap/studiumx-mind-map-plan.md)（第二阶段规划，M0–M6）。
- **相关：** [ADR-0131](0131-pathname-default-durable-io.md)（durable 写）、[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)（教学权威边界）、[ADR-0075](0075-module-size-policy-and-giant-peel.md)（模块尺寸）、[ADR-0044](0044-teaching-prompt-cache-contract.md)（AI prompt 契约）。

## 1. 为什么需要新 ADR（而非只改 ADR-0172）

ADR-0172 记录的是**已批准的 v1 基线**：数据模型镜像 XMind `content.json` 文本树、`updateMindMap` 无条件覆盖、`.xmind` 导入静默忽略不支持字段。规划 [§6](../mindmap/studiumx-mind-map-plan.md#6-数据模型-v2-草案)明确要求 v2 需要**新 ADR 或对 ADR-0172 做明确修订**。

本 ADR 选择**新增 0173** 并维持 ADR-0172 作为 v1 批准记录，理由：

1. v2 是一次**契约升级**（schemaVersion、revision 语义、冲突策略、互通报废），不是 ADR-0172 的增量修补；
2. 保留 v1 历史便于迁移审计与回退；ADR-0172 的「明确不包含 / 非声明」中关于**静默丢字段**的条目在本 ADR 中被正式 supersede，而不改动 v1 记录本身；
3. 与规划 §13「M0 首先产出 schema v2/revision/interop 的 ADR 变更，并链入 `docs/adr/README.md`」一致。

若后续发现 v2 与 v1 的过渡需要更小步，可再以独立 design gate 修订本 ADR，但**不得**回到「无 revision 覆盖写 + 静默丢字段」的 v1 语义。

## 2. 决策

### 2.1 schema v2 模型

按规划 §6 草图，原生文档升级为 `MindMapDocumentV2`。核心形状：

```ts
type MindMapDocumentV2 = {
  schemaVersion: 2
  id: string
  revision: number            // 每次成功 durable 写入单调递增
  title: string
  createdAt: string
  updatedAt: string
  theme: MindMapTheme
  sheets: MindMapSheetV2[]
  assets: MindMapAssetRef[]
  interop?: MindMapInteropMetadata
}

type MindMapSheetV2 = {
  id: string
  title: string
  root: MindMapTopicV2
  elements: MindMapElement[]   // relationship / boundary / summary / callout / freeTopic
  layout: MindMapLayoutSettings
  viewport?: MindMapViewport
}

type MindMapTopicV2 = {
  id: string
  title: string
  note?: string
  collapsed?: boolean
  children: MindMapTopicV2[]
  labels?: string[]
  markers?: MindMapMarker[]
  links?: MindMapLink[]
  sourceRefs?: MindMapSourceRef[]
  planning?: MindMapPlanningMetadata
  style?: MindMapTopicStyleOverride
  manualPosition?: { x: number; y: number }
}

type MindMapElement =
  | MindMapRelationship
  | MindMapBoundary
  | MindMapSummary
  | MindMapCallout
  | MindMapFreeTopic
```

- `MindMapElement` 的每个具体子类型、`MindMapTheme`、`MindMapLayoutSettings`、`MindMapViewport`、`MindMapSourceRef`、`MindMapPlanningMetadata` 等在 `src/shared/mindmap/domain/` 的 v2 schema 模块中定义，随对应里程碑（M1–M4）逐步落地；本 ADR 只冻结**结构形状与引用稳定性**，不冻结尚未实现的视觉细节。
- 结构元素（relationship/boundary/summary/callout/freeTopic）**不**塞进 `children`，而是作为 sheet 级独立 element 集合，以稳定 `node id` 引用目标主题（规划 §5.2）。
- `assets` 使用工作区相对引用，不在文档 JSON 中内嵌大体积 base64；相对 target 的写入必须经过现有 path-access 围栏与路径校验。

### 2.2 revision / expectedRevision 持久化与 IPC 契约

- 每个持久化文档带 `revision: number`；**每次成功 durable 写入递增**（v1 文档无该字段，迁移时从 0 或 1 起算）。
- 主进程 repository 是 `revision` 的唯一拥有人：renderer 只在主进程确认写入后推进自己持有的 durable revision。
- `updateMindMap` IPC payload 增加 `expectedRevision`（compare-and-swap 语义）：仅当 `expectedRevision === 当前 on-disk revision` 时写入，否则返回结构化冲突结果。
- 冲突结果**不静默覆盖**，向 renderer 暴露分类：
  - `stale`：当前文件的 revision 与客户端期望不一致；
  - 产品侧提供「重载 / 保存副本 / 查看差异」三个入口，禁止自动 last-write-wins。
- 新增/变更的 IPC 契约（在 `src/shared/teaching-types/mindmap.ts` 与 `src/shared/teaching-types/system-api.ts` 中落地）：
  - `readMindMap` 返回完整文档（含 `revision`）；
  - `updateMindMap(payload: { workspaceId; id; expectedRevision; doc })` 返回写入后的文档（含新 `revision`）或冲突错误；
  - `importMindMapXmind` / `exportMindMapXmind` 返回兼容性报告（见 §2.4）；
  - `generateMindMap` 返回新文档（含 `revision`），并支持可传播到主进程/provider 的取消意图（规划 §5.7）。
- 自动保存采用短 debounce；**切换文档、关闭窗口、导出前必须强制 flush**，且 flush 必须携带最新 `expectedRevision`。
- 崩溃恢复使用受限 journal 或最近一次合法 snapshot 恢复 `revision` 与文档；**undo 栈不是 canonical**，不得作为崩溃恢复依据。

### 2.3 统一 command 入口与 undo/redo

所有编辑入口（键盘、工具栏、右键菜单、拖拽、AI 接受、导入粘贴、批量样式）必须**只通过统一 command reducer** 修改文档，禁止「直接 set zustand 后异步保存」的旁路。

- 定义窄而完整的 `MindMapCommand` 联合类型（规划 §7.3）：
  - `topic.insert` / `topic.update` / `topic.move` / `topic.remove`；
  - `selection.set-style`；
  - `element.create` / `element.update` / `element.remove`；
  - `sheet.create` / `sheet.rename` / `sheet.reorder` / `sheet.remove`；
  - `document.apply-theme`；
  - `transaction`。
- reducer 必须是**纯函数**，执行后验证树 invariant 与元素引用有效性；失败则不产生文档变更。
- 每个 command 必须携带可逆 patch 或显式 inverse；连续输入可合并为一个撤销单元（如连续键入标题）。
- 批量操作（AI 接受、导入粘贴、批量样式）必须使用 `transaction`，全成或全不成。
- **active sheet 显式进入 command 上下文**：任何 topic/element 命令都必须声明目标 sheet id，只作用于该 sheet，修复「多 Sheet 操作只看第一张 / 跨 sheet 误改」的耦合（见 `docs/mindmap/m0-baseline.md`）。
- undo/redo 栈保存在 session 内存；每次命令执行后经 revisioned repository 落盘，undo 栈不产生独立持久化事实。

### 2.4 XMind 互通保真承诺与兼容性报告

- 内部模型**不再完整镜像 XMind**；XMind 通过 adapter 转换，`structureClass` 等 XMind 值在 adapter 中翻译为 v2 等价表达（规划 §6.3）。
- 每次**导入与导出**必须返回兼容性报告，类别固定为：
  - `preserved`：完整保留；
  - `approximated`：转换为 StudiumX 等价能力（如结构/样式翻译）；
  - `dropped`：无法表达，**逐项列出字段/元素数量与原因**；
  - `warnings`：损坏附件、未知结构、超限内容。
- **禁止静默丢字段**：任何无法保留的字段都必须计入 `dropped` 并在报告中可见；「不报错忽略」不再是合法行为（supersede ADR-0172 §3 与 design.md §11 的静默忽略声明）。
- 未知但安全的 JSON 元数据可限量保存在 `interop.xmind.extensions`（有大小限制、无可执行语义的 extension bag）；**禁止**把不可信 HTML/脚本带入渲染器。
- 导入安全预算（规划 §5.6）：
  - 防 ZIP slip、ZIP bomb、路径穿越、异常文件数与异常解压体积；
  - `content.json`、附件、缩略图分别设置独立、可审计的技术上限；
  - MIME/扩展名双重校验；
  - 导入在临时目录完成，校验通过后再 durable commit，失败不留半成品；
  - 附件迁移与导出前 flush 必须覆盖「导出内容与用户最后确认状态一致」。

### 2.5 来源锚点只读、导图不是教学权威

- `MindMapSourceRef` 与 `sourceRefs` 是**用户可编辑的链接元数据**，建议保存：工作区相对路径、标题 breadcrumb、可选块 id/content hash、最后确认时间；行号仅作提示，不作为唯一身份（规划 §6.2）。
- 导图及其 AI 建议、节点状态**不得**直接写入 settlement / evidence / outcome / learner-profile，也不得替代 LearningSession ledger（对齐 [ADR-0167](0167-teaching-authority-and-syncable-user-state.md)）。
- 若导图展示课程掌握度、复习到期等教学状态，必须从 canonical 教学来源**实时或按明确刷新动作只读投影**并显示来源；导图副本不得反向成为事实源。
- 跨域动作（从节点创建复习卡片草稿、测验草稿、学习任务）必须走既有 coordinator/教学入口，保持 teaching authority 与 settlement sole-writer 边界不变。

## 3. 迁移与兼容

- 提供 v1 → v2 **单向、幂等、可重复**迁移；迁移失败保留原文件并返回结构化错误，不原地破坏。
- v1 文件写失败时保留 `.bak` 或同目录快照，禁止把 undo 栈或迁移中间态当作 canonical。
- 旧 v1 文档仍可读：读取时按需迁移并落盘 v2；迁移完成前不修改原文件。
- 迁移后 `revision` 从持久化基线起算；不依赖前端上传的 `updatedAt` 判断新旧（改为 `revision` CAS）。

## 4. 边界与非声明

- **不**产生教学权威 / settlement / evidence / learner-profile 写入。
- **不**实现 XMind 全量保真；不承诺未报告字段的保真，但**所有**未保真项必须进入兼容性报告。
- **不**引入远程同步、默认 telemetry、FTS/向量产品搜索。
- **不**新增第二套 provider 通道；AI 生成继续复用现有 provider 路由、资源治理与取消通道。
- **不**推倒 EventBus/timeline、不重写 AgentRun 状态机、不拆 LearningSessionLedger 权威。
- 本 ADR 冻结的是 M0/M1 契约与互通报废；样式/结构元素的完整视觉行为留待 M2–M4 各自切片与单元/E2E 验证。

## 5. 测试与验收入口

- Domain unit：command/inverse、树 invariant、元素引用、Sheet 操作、`expectedRevision` CAS、迁移幂等。
- Property test：随机命令序列、undo/redo 往返、迁移可重复、XMind 转换不崩溃。
- Fixture/golden：多版本 XMind、样式、关系、概要、附件、未知字段、损坏 ZIP（矩阵见 [`docs/mindmap/benchmarks.md`](../mindmap/benchmarks.md)）。
- Integration：IPC 精确 envelope、`revision` 冲突、导入 commit、附件围栏、取消传播。
- 门禁：按触达范围运行 `pnpm typecheck`、`check:mindmap`、`check:security`、`check:teaching-evidence`、`check:provider-privacy`、`check:tool-contract`（新增工具/effect 时）。
