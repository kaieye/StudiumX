# ADR-0173：思维导图 schema v2、revisioned repository 与统一命令

- **决策状态：** accepted
- **实施状态：** partial
- **日期：** 2026-08-10
- **范围：** StudiumX 原生思维导图的数据模型 v2、revision / `expectedRevision` 持久化和 IPC 契约、统一命令入口与 undo / redo，以及来源锚点和教学投影边界。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0172](0172-mind-map-and-ai-assist.md)、[ADR-0131](0131-pathname-default-durable-io.md)、[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)、[ADR-0075](0075-module-size-policy-and-giant-peel.md)
- **证据：** `src/shared/mindmap/`、`src/main/mindmap/`、`src/renderer/src/views/mindmap/`、`pnpm run check:mindmap`、`tests/unit/mind-map-*.unit.test.ts*`

## 1. 背景

早期导图文档模型只表达主题树，无法稳定承载样式、关系、概要、标注、资源、视口和多 sheet 编辑状态，也缺少防止并发覆盖的更新契约。v2 将这些能力明确纳入 StudiumX 自有文档模型，同时保持导图是用户内容、而不是教学决策事实。

## 2. 决策

### 2.1 v2 是原生文档模型

`MindMapDocumentV2` 使用 `schemaVersion: 2`，包含 sheet、主题树、原生元素、主题与画布样式、主题、资源引用和视口信息。布局标识为 `studiumx.layout.*`。原生元素通过受限的判别联合表达；不接受可执行内容或未验证的渲染数据。

`migratedFrom.schemaVersion` 仅记录 StudiumX 文档从旧 schema 升级到 v2 的来源版本。它不是外部格式适配层，也不承诺保留外部字段。

### 2.2 Repository 是 revisioned 单写入口

每份文档有递增 `revision`。更新请求必须携带 `expectedRevision`，不匹配时返回冲突，而不是 last-write-wins。主进程 repository 负责解析、迁移、校验、atomic durable write 与摘要投影；渲染器不得绕过该边界直接落盘。

### 2.3 命令是编辑状态变化的唯一模型

所有编辑经 `MindMapCommand` reducer 处理，并在命令上下文中显式携带 active sheet。undo / redo 基于命令历史与 revision 语义组织，避免组件各自修改嵌套文档。任何新元素类型都必须先定义其 schema、reducer 行为、渲染和可访问性契约。

### 2.4 导入导出只使用开放或原生边界

支持 Markdown 与 OPML 的导入导出，并支持 SVG 与 PNG 图像导出。导入在主进程执行，遵守路径围栏、文件大小上限、解析深度和结构校验；失败以结构化错误反馈。专有导图格式不在产品边界中，也不提供转换器、兼容性报告或相关 IPC。

### 2.5 来源锚点是只读教学投影

导图可保存对工作区学习材料的来源锚点，供用户跳转和理解上下文。这些锚点是只读投影，不能反向写入 LearningSession ledger、evidence、outcome 或 learner profile。AI 生成或编辑导图同样不会改变教学权威。

## 3. 安全与一致性约束

- 解析与文件访问在主进程完成，并经过 workspace、路径和大小围栏。
- SVG / PNG 导出是受控的本地文件效果，沿用工具 effect 与审批边界。
- 资源以受验证的工作区引用保存，不能把任意本地路径或不可信可执行内容带入渲染器。
- 迁移必须可重复；旧 schema 不可解析时返回诊断，不能伪造成功。
- 不引入默认远程 telemetry、向量搜索或导图对教学事实的写入。

## 4. 验收

- 单测覆盖 schema、迁移可重复性、repository durable write、revision 冲突、命令 undo / redo、元素不变量、来源锚点和原生导入导出。
- `pnpm typecheck` 与 `pnpm run check:mindmap` 通过。
- 手测多 sheet、关系连线、撤销重做、并发冲突提示、Markdown / OPML 导入导出以及 SVG / PNG 导出。
