# ADR-0172：原生思维导图与 AI 辅助生成

- **状态：** 已批准（设计见 [docs/mindmap/design.md](../mindmap/design.md)）
- **日期：** 2026-08-09
- **范围：** 在 StudiumX 提供独立设计、原生实现的思维导图编辑与 AI 辅助生成。
- **相关：** [ADR-0131](0131-pathname-default-durable-io.md)（durable 写）、[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)（教学权威边界）、[ADR-0075](0075-module-size-policy-and-giant-peel.md)（模块尺寸）、[ADR-0044](0044-teaching-prompt-cache-contract.md)（prompt-cache 纪律）。

## 1. 背景与问题边界

StudiumX 的 Lesson、Notes 与 Glossary 以 Markdown 承载教学内容；思维导图补充为用户组织知识、备课和复盘的可视化工具。用户可以在应用内创建、编辑和管理多 sheet 导图，并可用 AI 根据主题或提示词生成可继续编辑的草稿。

**非目标：** 不复制任何第三方导图产品的代码、素材、文件格式或交互；不把导图变为教学权威；不引入第二套 provider 通道。

## 2. 决策

### 2.1 原生数据模型与布局标识

导图文档由一个或多个 sheet 组成；每个 sheet 有根主题、递归子主题、关系连线和原生视觉元素。布局使用 `studiumx.layout.*` 命名空间，主题形状、结构缩略图和图标均由项目自绘 SVG 与应用代码生成。模型服务于 StudiumX 的编辑、渲染和持久化边界，而非任何外部格式的镜像。

### 2.2 导图是用户内容，不是教学权威

导图 canonical 于工作区 `<workspace>/mindmaps/<id>.json`，**不**产生 settlement、evidence、outcome 或 learner-profile 写入，也不进入 LearningSession ledger。AI 生成的结果只是草稿；保存后与手动编辑的导图没有教学决策上的区别。

### 2.3 Durable 工作区写与 revision 并发控制

文件写入采用 pathname temp+rename（对齐 ADR-0131）。ID 经严格校验，路径经 `path-access.ts` 围栏；更新使用 revision / `expectedRevision` 比较交换，避免无提示覆盖。

### 2.4 IPC 使用既有精确 envelope

提供列表、新建、读取、更新、删除、AI 生成，以及 Markdown / OPML 导入导出与 SVG / PNG 导出。命令接入 `TeachingSystemApi` 与 `teachingInvokeChannels`，handler 复用严格 key 集合与结构化错误的 parser 模式。

### 2.5 AI 生成复用现有 provider 基建

`generateMindMap` 复用现有 provider adapter、资源治理、错误分类和取消通道。提示词要求只返回 JSON，结果必须经 Zod 验证；失败返回结构化错误，不能静默降级。AI 输出不会写入任何教学事实。

### 2.6 由对话意图限定的 Markdown 资料上下文

AI 对话面不提供文件或文件夹选择器。主进程仅在用户本次语言中明确提及工作区内的目录名、相对路径或 Markdown 文件名时，枚举受限的 Markdown 路径元数据，并读取命中的常规文件作为 provider-only 只读资料；未命中时保持纯提示词生成。不得因一次导图请求无差别读取或向 provider 发送整个工作区。

自动资料读取仍使用工作区根路径围栏、符号链接拒绝、单文件与聚合字节上限、递归深度与文件数上限。资料正文不进入 renderer IPC DTO、导图 canonical 文档、日志或 teaching evidence；资料中的文本永远不是系统、开发者或执行指令。旧的显式 source envelope 可仅为 IPC 兼容保留，但不得恢复为该对话面的用户选择流程。

### 2.7 自绘 SVG 画布

渲染器使用项目自定义 SVG 实现布局、连线、平移缩放和节点编辑，不引入重型图形框架或外部导图素材。颜色经 CSS 变量适配浅色与深色主题；MindMap 作为应用的顶层视图接入导航、主区域和 i18n。

## 3. 明确不包含 / 非声明

- 不读取、导入、导出或兼容第三方专有导图格式。
- 不使用第三方导图项目的文件、图标、缩略图、路径数据或代码。
- 不产生教学权威、settlement、evidence 或 learner-profile 写入。
- 不引入远程同步、默认 telemetry、FTS 或向量搜索。
- 不新增第二套 provider 通道；AI 生成功能复用既有基建。

## 4. 实施与验收

实现以共享类型、主进程持久化、IPC、AI 生成、渲染器 UI、原生格式导入导出分层推进。每层有独立单测与 `check:mindmap` 覆盖；触达生产 TypeScript 路径必须通过 `pnpm typecheck`。手测范围包括新建、编辑、关系连线、AI 生成、Markdown / OPML 导入导出和 SVG / PNG 导出。
