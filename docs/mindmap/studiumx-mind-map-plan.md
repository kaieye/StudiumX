# StudiumX 原生思维导图产品与实施规划

- **状态：** Proposed（规划稿，尚未授权直接实施全部阶段）
- **日期：** 2026-08-09
- **适用范围：** `src/shared/mindmap/`、`src/main/mindmap/`、`src/renderer/src/views/mindmap/` 及相关 IPC、导入导出、AI 辅助和工作区集成
- **现有基线：** [ADR-0172](../adr/0172-mind-map-and-ai-assist.md)、[现有设计](design.md)
- **本机参考：** XMind `26.05.01105`（build `2026072907070`，`net.xmind.vana.app`），于 2026-08-09 在本机实际检查

> 本规划不是“把 XMind 搬进 StudiumX”，也不是继续把 `.xmind` 导入当作思维导图功能本身。目标是建立一个可靠、顺手、可扩展的**原生知识画布**：先达到专业脑图编辑器的核心交互质量，再利用 StudiumX 的工作区、课程、笔记、术语表与 AI 教学能力形成差异化。

---

## 1. 为什么需要第二阶段规划

当前版本已经完成了最小闭环：文档 CRUD、多 Sheet、新增/删除/折叠节点、标题编辑、基础 SVG 布局、平移缩放、AI 整图生成以及 `.xmind` 导入导出。但它仍是“树形 JSON 的可视化编辑器”，距离可长期使用的思维导图工具有明显差距。

### 1.1 当前实现盘点

| 领域 | 当前已有 | 主要缺口 |
| --- | --- | --- |
| 数据模型 | `title`、`note`、`collapsed`、`structureClass`、递归 `children` | 无样式、标记、标签、链接、附件、任务状态、关系线、概要、外框、自由主题、来源锚点；schema 仍为 v1 |
| 编辑 | 双击改标题、添加子节点、删除、折叠/展开 | 无撤销/重做、键盘建图、同级/上级插入的完整 UI、剪贴板、多选、拖拽重排/换父节点、复制样式、查找替换 |
| 布局 | 固定尺寸节点、基础左右/上下方向计算 | 文本不参与测量；无稳定增量布局、碰撞处理、手动位置、紧凑布局、布局动画、大图虚拟化 |
| 画布 | SVG、背景拖拽、滚轮缩放 | 缩放不以指针为中心；无适应画布、实际大小、框选、导航面板/小地图、仅显示分支、触控板手势 |
| Sheet | 新建与切换 | 无重命名、复制、删除、排序、从主题生成 Sheet、每 Sheet 独立视口与样式 |
| AI | 输入提示词后生成整张导图 | 无选区级 AI、无变更预览、无接受/拒绝、无工作区来源选择；“取消”目前只改变前端状态，不等于可靠取消 provider 请求 |
| XMind 互通 | 读写 `content.json` 的文本树 | 不支持字段会被忽略；无兼容性报告、附件迁移、样式/标记/关系线保真、导入安全预算与格式版本矩阵 |
| StudiumX 集成 | 独立顶层视图 | 尚未连接 Lesson、Notes、Glossary、工作区文件、复习与学习任务；没有形成 StudiumX 专属价值 |
| 可靠性 | durable JSON 写、Zod 校验、部分单测 | 无文档 revision/冲突处理、命令事务、迁移框架、崩溃恢复、端到端交互测试、性能基线 |

### 1.2 对本机 XMind 的实际观察

本机 XMind 的核心体验不是某一个按钮，而是一组彼此配合的工作流：

1. **键盘优先建图：** `Tab` 新增细分主题、`Enter` 新增同级主题，撤销/重做、缩进/减少缩进、复制/粘贴与删除均可连续操作。
2. **结构元素丰富：** 联系、概要、外框、标注、自由主题、笔记、标签、待办事项、任务、链接、附件、图片、方程、标记等围绕主题组织。
3. **画布与检查器分工：** 中央画布负责结构编辑，右侧“样式 / 演说 / 画布”面板负责当前选择和全局设置；底部承载画布切换、缩放与导航。
4. **视图与聚焦：** 思维导图/大纲切换、适应画布、实际大小、仅显示该分支、ZEN 模式、导航面板、查找替换。
5. **样式系统：** 配色方案、分支颜色、字体、线条、主题形状、背景与结构模板是文档能力，而非写死的 CSS。
6. **多格式流转：** 除原生文件外，还能导出 PNG/JPEG/SVG/PDF/Markdown/OPML 等，并支持从 Markdown/OPML 等格式导入。

StudiumX 应借鉴这些经过验证的交互范式，但不复制其品牌、素材、付费分层或所有外围能力。

---

## 2. 产品愿景与边界

### 2.1 产品愿景

将思维导图升级为 StudiumX 的**知识组织与学习行动入口**：

- 用户可以像在专业脑图软件中一样，快速、连续、可逆地组织结构；
- 用户可以把课程、笔记、术语和工作区资料显式转换或链接到导图；
- AI 围绕“选中的分支”和“用户明确选择的资料”进行扩展、压缩、重组、对比与解释；
- 导图能辅助发起笔记、复习卡片、测验草稿和学习任务，但不冒充教学证据或学习结论；
- `.xmind` 是互通格式之一，不是内部产品模型的上限。

### 2.2 不可突破的产品地板

1. **导图不是教学权威。** 导图内容、AI 建议、节点状态不得直接写入 settlement / evidence / outcome / learner-profile，也不得替代 LearningSession ledger。
2. **来源投影只读。** 若展示课程掌握度、复习到期等信息，必须从 canonical 教学来源实时或按明确刷新动作投影，并显示来源；导图副本不得反向成为事实源。
3. **所有 AI 改动可见、可撤销。** 不静默覆盖整张图，不自动把推断写成 learner fact。
4. **本地优先。** 不增加默认远程 telemetry，不引入 FTS5/向量库作为产品搜索面。
5. **不新增 provider 旁路。** AI 继续复用现有 provider 路由、取消、错误分类、资源治理与隐私边界。
6. **文件与导入受路径围栏保护。** 附件、导入包和导出路径必须经过现有 path-access、安全校验和 durable I/O。
7. **不承诺 XMind 全量保真。** 每次导入/导出应给出明确兼容性报告，禁止“静默丢字段但声称完整支持”。

### 2.3 明确暂不追求

- 复制 XMind 的演说模式、甘特图、语音备注、贴纸商店和 Office 全格式导出；
- 实时多人协作或默认云同步；
- 自由手绘/白板、通用流程图或无限画布应用；
- 在 PR CI 中调用真实模型 API；
- 为追求大而全而一次性重写现有工作台、EventBus 或 AgentRun 状态机。

---

## 3. StudiumX 专属使用场景

### 3.1 课程结构图

从 Lesson 或课程目录中选择标题层级，显式生成一张结构图。节点保留来源锚点，用户可打开原文、查看来源摘要，并在源内容变化后手动执行“检查更新”。更新以 diff 呈现，不自动覆盖用户已编辑的分支。

### 3.2 概念依赖图

用户用“前置知识”“例子”“反例”“易混淆点”等关系组织概念。关系是用户内容；若 AI 建议某个依赖，必须先显示建议和理由，接受后才成为导图关系。

### 3.3 论文/章节精读图

从用户明确选中的文件或段落生成“问题—方法—证据—结论—局限”模板。每个来源节点可跳回原文件位置；AI 输出标记为草稿，不伪造引用。

### 3.4 考前复习图

在导图上叠加只读的复习状态投影，帮助用户发现未覆盖分支。用户可从节点显式创建复习卡片或测验草稿；真正的学习结果仍通过原有教学流程结算。

### 3.5 解题与错因图

提供“题目—已知—目标—方法—步骤—错误原因—变式”模板。导图负责组织用户思路，不把“已掌握/未掌握”直接写回 learner-profile。

---

## 4. 目标信息架构

采用“**左导航 + 中央画布 + 右检查器 + 底部 Sheet/导航条**”的稳定布局：

### 4.1 左侧：文档、搜索与大纲

- 导图列表：新建、重命名、复制、删除、最近打开；
- 当前 Sheet 大纲：树形浏览、拖拽重排、键盘操作；
- 本图搜索：标题、备注、标签和链接文本的内存扫描；
- 来源面板：显示本图关联的工作区文件，不做 FTS/向量产品搜索。

### 4.2 中央：画布

- 节点、分支线、关系线、概要、外框、标注；
- 单选、多选、框选、拖拽、内联编辑；
- 指针中心缩放、空格拖动画布、触控板平移；
- 适应画布、100%、仅显示分支、返回中心主题；
- 所有编辑动作均进入统一命令系统。

### 4.3 右侧：上下文检查器

建议分为四个页签：

1. **内容：** 标题、备注、标签、链接、来源、学习动作；
2. **样式：** 字体、颜色、形状、边框、分支线、图标/标记；
3. **布局：** Sheet 结构、紧凑度、分支方向、自动/手动位置；
4. **AI：** 作用范围、资料来源、操作类型、diff 预览、接受/拒绝。

### 4.4 底部：Sheet 与导航

- Sheet 新建、重命名、复制、删除、排序；
- 缩放百分比、适应画布、实际大小；
- 可选导航缩略图；
- 保存状态、导入兼容性警告和只读/冲突状态。

---

## 5. 核心能力规划

### 5.1 专业编辑闭环（最高优先级）

必须先让“连续建图”成立：

- `Tab`：新增子主题；
- `Enter`：新增同级主题；
- `Shift+Tab`：减少缩进；
- `Cmd/Ctrl+Enter`：新增上级或按平台约定执行等价操作；
- 方向键：在可见树中进行空间导航；
- `F2` 或直接输入：编辑主题；
- `Space`：折叠/展开；
- `Delete/Backspace`：删除并提供可撤销恢复；
- `Cmd/Ctrl+C/X/V/D`：复制、剪切、粘贴、复制分支；
- `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z`：撤销/重做；
- 拖拽主题：同级排序、改变父节点、左右分支切换；
- 多选与框选：批量移动、删除、设样式、折叠。

所有入口（键盘、工具栏、右键菜单、拖拽、AI 接受）必须调用同一组 domain command，避免行为漂移。

### 5.2 结构元素

首批支持：

- **关系线（Relationship）：** 任意两个主题之间的带标签连线；
- **外框（Boundary）：** 包围一个子树，可有标题和样式；
- **概要（Summary）：** 对连续同级主题做括号式总结并生成概要主题；
- **标注（Callout）：** 附着在主题上的强调说明；
- **自由主题（Free topic）：** 作为受控增强，仅在布局和互通稳定后开放。

这些元素不应硬塞入 `children`；应以独立 element 集合引用稳定 node id。

### 5.3 内容与学习元数据

节点内容逐步支持：

- 富文本之前先做可靠的纯文本标题与多行备注；
- 标签、网页链接、工作区文件/标题锚点；
- 优先级、待办状态、截止日期作为**用户规划状态**；
- 图标/标记使用 StudiumX 自有、可访问的有限集合；
- 图片/附件使用工作区相对 asset 引用，不在 JSON 中内嵌大体积 base64；
- 只读教学投影与用户元数据分层展示，类型上不可混写。

### 5.4 布局与样式

布局至少覆盖：

- 思维导图（双向）、向右/向左逻辑图；
- 向下/向上组织图；
- 树状图（后续）；
- 同一 Sheet 的自动布局与局部分支布局覆盖。

样式系统至少包含：

- 文档主题 token、分支色板、背景；
- 节点字体、字号、强调、文本色、填充、边框、圆角；
- 分支线颜色、粗细、实线/虚线、曲线类型；
- “继承主题 + 局部覆盖”两级模型；
- 复制样式、粘贴样式、重置样式；
- 浅色/深色主题下均满足可读性，不直接写死 XMind 的视觉资产。

### 5.5 导航、聚焦与大图体验

- 适应画布、适应选择、实际大小、回到中心；
- 仅显示当前分支，退出后恢复原视口；
- 大纲视图与画布共享选择和命令；
- 查找/替换、结果跳转、全部展开到命中节点；
- 折叠层级（仅显示 1/2/3… 层）；
- 画布缩略图在大图性能达标后启用；
- 视口裁剪和节点虚拟化必须由性能数据驱动，不为了“架构先进”提前引入复杂渲染栈。

### 5.6 导入导出

**导入优先级：** XMind → Markdown → OPML。

**导出优先级：** XMind → SVG/PNG → Markdown/OPML → PDF。

每次 XMind 导入返回报告：

- `preserved`：完整保留；
- `approximated`：转换为 StudiumX 等价能力；
- `dropped`：无法表达，列出字段/元素数量和原因；
- `warnings`：损坏附件、未知结构、超限内容。

安全要求：

- 防 ZIP slip、ZIP bomb、路径穿越、异常文件数和异常解压体积；
- `content.json`、附件和缩略图设置独立的可审计技术上限；
- MIME/扩展名双重校验；
- 导入在临时目录完成，校验通过后再 durable commit；
- 未知字段只在有大小限制、无可执行语义的 extension bag 中保留，禁止把不可信 HTML/脚本带入渲染器。

### 5.7 AI 辅助：从“整图生成”升级为“可审阅的局部操作”

AI 操作应面向用户当前任务：

- 扩展所选分支；
- 压缩/总结分支；
- 重组层级但保留原节点映射；
- 生成例子、反例、易混淆点、前置知识；
- 比较两个分支；
- 从明确选择的 Lesson/Notes/Glossary/文件生成导图；
- 为所选节点生成复习卡片或测验**草稿**。

统一交互：

1. 用户选择作用范围与允许使用的来源；
2. provider 输出结构化 command proposal，而不是直接写最终文档；
3. renderer 展示新增、移动、改名、删除的 diff；
4. 用户可逐项或整体接受/拒绝；
5. 接受后作为一个可撤销事务进入命令历史；
6. 取消必须真正传播到主进程/provider，不只是隐藏 loading；
7. 失败保留原图，不制造伪成功文档。

---

## 6. 数据模型 v2 草案

> v2 需要新 ADR 或对 ADR-0172 做明确修订；必须提供 v1 → v2 单向迁移和旧文件备份策略。

```ts
type MindMapDocumentV2 = {
  schemaVersion: 2
  id: string
  revision: number
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
  elements: MindMapElement[]
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

### 6.1 持久化与并发

- `revision` 每次成功写入递增；`updateMindMap` 增加 `expectedRevision`；
- renderer 只在主进程确认后推进 durable revision；
- 冲突时不做 last-write-wins，显示“重载 / 保存副本 / 查看差异”；
- 自动保存采用短 debounce，但在切换文档、关闭窗口和导出前强制 flush；
- 崩溃恢复使用受限 journal 或最近一次合法 snapshot，不把 undo 栈当 canonical；
- 迁移失败保留原文件并返回结构化错误，不原地破坏。

### 6.2 来源锚点

`MindMapSourceRef` 建议保存：工作区相对路径、标题 breadcrumb、可选块 id/content hash、最后确认时间。行号只能作为提示，不作为唯一身份。源变化后仅标记 stale，由用户触发重定位或刷新 diff。

### 6.3 互通元数据

内部模型不再完全镜像 XMind；通过 adapter 保持边界清晰：

- 原生 domain 以 StudiumX 能力为准；
- XMind `structureClass` 等值在 adapter 中转换；
- 对未知但安全的 JSON 元数据，可限量保存在 `interop.xmind.extensions`；
- 导出时给出兼容性报告，不允许业务代码直接依赖 XMind 私有字段。

---

## 7. 技术架构与模块边界

### 7.1 建议模块

```text
src/shared/mindmap/
  domain/                 # v2 类型、schema、invariant、查询
  commands/               # 命令、事务、inverse/undo、clipboard payload
  migrations/             # v1 -> v2 及后续迁移
  interop/xmind/           # XMind adapter + compatibility report
  interop/markdown/
  interop/opml/

src/main/mindmap/
  mind-map-repository.ts   # durable store、revision、recovery
  mind-map-assets.ts       # 附件围栏、复制、清理
  mind-map-import.ts       # 受限解压、校验、commit
  mind-map-export.ts
  mind-map-ai.ts           # proposal 生成与取消
  mind-map-ipc-commands.ts

src/renderer/src/views/mindmap/
  workbench/               # 页面组合，不承载 domain 逻辑
  canvas/                  # scene、render、hit-test、viewport
  input/                   # keyboard/pointer/drag controller
  inspector/
  outline/
  ai/
  store/                   # UI session state + command dispatch
```

触达现有 300–400 行模块时按能力 peel，避免把新功能继续堆入 `MindMapCanvas.tsx`、`MindMapView.tsx` 或单一 zustand store；新/触达 TS 模块尽量保持在 500–800 行以内。

### 7.2 渲染管线

建议形成四层深模块：

1. **Domain tree/elements**：无坐标、可序列化；
2. **Layout engine**：输入内容测量与布局设置，输出稳定 scene；
3. **Interaction controller**：命中测试、选择、拖拽、快捷键，输出 domain command；
4. **Renderer**：只绘制 scene，不直接修改文档。

先优化现有 SVG，并增加文本测量、视口裁剪和稳定 key。只有基准证明 SVG 在目标规模下无法达标，才通过独立 ADR 评估 Canvas/WebGL；不得无数据重写。

### 7.3 命令与撤销模型

定义窄而完整的 `MindMapCommand` 联合类型，例如：

- `topic.insert`、`topic.update`、`topic.move`、`topic.remove`；
- `selection.set-style`；
- `element.create/update/remove`；
- `sheet.create/rename/reorder/remove`；
- `document.apply-theme`；
- `transaction`。

命令 reducer 必须是纯函数并验证 invariant。每个命令产生 inverse 或可逆 patch；连续输入可合并为一个撤销单元。AI 接受、导入粘贴和批量样式必须使用 transaction，保证全成或全不成。

---

## 8. 分阶段实施路线图

### M0：基线、规格与风险收口

**目标：** 在扩功能前固定真实现状和产品契约。

交付物：

- 将本规划评审为可实施版本；
- 为 schema v2、revision IPC、XMind 保真策略新增/修订 ADR；
- 建立 10/100/500/2,000 节点基准文档与 XMind fixture 矩阵；
- 记录现有交互缺陷和导入丢失项；
- 将当前“AI 取消仅改 UI 状态”列为明确修复项。

**退出条件：** 数据模型、命令边界、互通承诺和性能基线均有可测试定义。

### M1：可靠编辑地基

**目标：** 让核心编辑可逆、可保存、可迁移。

交付物：

- schema v2 + v1 迁移；
- revision/`expectedRevision`、冲突 UI、自动保存 flush；
- command reducer、transaction、undo/redo；
- 键盘插入/删除/导航、剪贴板；
- Sheet 重命名/复制/删除/排序；
- 修复多 Sheet 操作只看第一张 Sheet 等当前状态耦合问题。

**退出条件：** 仅用键盘可完成一张 100 节点导图；任意编辑可撤销/重做；崩溃/冲突测试不丢已确认写入。

### M2：专业画布交互

**目标：** 达到日常使用所需的编辑流畅度。

交付物：

- 指针中心缩放、适应画布/选择、100%、回中心；
- 拖拽排序/换父、左右分支切换；
- 多选、框选、上下文菜单；
- 内容测量、换行、自适应节点尺寸、稳定布局动画；
- 大纲视图、查找替换、仅显示分支；
- 500/2,000 节点性能优化与可取消布局计算。

**退出条件：** 鼠标与键盘操作均无明显断点；大图中选择、缩放和折叠不会造成长时间主线程冻结。

### M3：结构元素与样式系统

**目标：** 从“树”升级为真正的思维导图文档。

交付物：

- 关系线、外框、概要、标注；
- 文档主题与局部样式覆盖；
- 分支配色、节点形状、线条样式；
- 内容/样式/布局检查器；
- 标签、链接、有限标记、附件基础能力；
- 深色主题与高对比度校验。

**退出条件：** 用户无需修改 JSON 即可完成结构表达和视觉分组；样式操作可批量、可撤销。

### M4：StudiumX 知识连接

**目标：** 建立区别于通用脑图软件的学习工作流。

交付物：

- 从 Lesson/Notes/Glossary/选中文件显式生成导图；
- 来源锚点、打开来源、stale 检测、手动刷新 diff；
- 课程结构图、概念依赖图、精读图、复习图、解题图模板；
- 只读复习/掌握度投影；
- 从节点显式创建 Note、复习卡片草稿、测验草稿、学习任务。

**退出条件：** 所有跨模块动作都有来源、预览和用户确认；teaching authority 与 settlement 门禁无回归。

### M5：AI 局部协作

**目标：** AI 成为可控的结构编辑助手，而非一次性整图生成器。

交付物：

- selection/sheet/source scope；
- command proposal schema；
- 结构 diff 与逐项接受/拒绝；
- 扩展、总结、重组、比较、例子/反例、前置知识等操作；
- 真正的主进程/provider 取消；
- prompt-cache 形状评审、隐私提示、结构化错误和重试。

**退出条件：** AI 永不绕过命令系统直接覆盖文档；接受结果可单步撤销；取消后不再继续落盘。

### M6：互通、导出与发布质量

**目标：** 让导图可安全流入、流出并长期维护。

交付物：

- XMind 样式/关系/概要/外框/附件兼容矩阵；
- 导入兼容性报告；
- Markdown/OPML 导入导出；
- SVG/PNG/PDF 导出；
- ZIP/附件安全门禁、损坏恢复；
- a11y、国际化、文档、示例模板与发布审计。

**退出条件：** 官方 fixture 和真实样本 round-trip 结果可解释；任何不保真项都被报告；发布检查全部通过。

---

## 9. 优先级与首个可发布版本

### P0：必须完成

- M0 + M1；
- M2 中的键盘、拖拽、适应画布、大纲、查找；
- M3 中的样式基础与关系线/外框/概要；
- M4 中的来源锚点与“从 Lesson/Notes 生成”；
- M5 中的 AI 局部扩展 + diff + 真取消；
- M6 中的 XMind 兼容性报告和 SVG/PNG 导出。

### P1：随后完成

- 标注、附件、有限标记；
- OPML/Markdown、PDF；
- 只读学习状态投影；
- 复习卡片/测验草稿动作；
- 小地图和更大规模虚拟化。

### P2：候选增强

- 自由主题、树状图等更多结构；
- 图片高级编辑、公式；
- 演示/专注模式；
- 用户显式开启同步后的冲突合并体验。

---

## 10. 验收指标

### 10.1 功能

- 100 节点导图可仅用键盘创建、编辑、移动、折叠和删除；
- 所有文档修改入口都可撤销/重做；
- Sheet 全生命周期完整；
- XMind 导入不再静默丢失，结果有兼容性报告；
- AI 局部操作有范围、来源、diff、接受/拒绝和真实取消；
- 从 StudiumX 内容生成的节点可以稳定跳回来源。

### 10.2 可靠性

- v1 文件批量迁移可重复、幂等，失败不破坏原文件；
- revision 冲突不会静默覆盖；
- 导入恶意/损坏 ZIP 不越界、不执行内容、不留下半成品；
- 导出前会 flush，导出的内容与用户看到的最后确认状态一致；
- provider 失败、resource limit、suspended、cancelled 均保持原图不变。

### 10.3 性能基线

具体数值在 M0 用基准机确认，默认目标：

- 500 节点常规图：打开和自动布局无可感知长阻塞，平移缩放接近 60fps；
- 2,000 节点压力图：可完成打开、搜索、折叠和定位，不崩溃；
- 单个结构命令不遍历无关 Sheet；
- 布局和导出可取消，超大输入使用明确的局部技术边界与错误，不伪装成 provider quota。

### 10.4 可访问性

- 核心命令均有键盘入口；
- 大纲视图提供可被辅助技术操作的等价树结构；
- 选择、保存、冲突、AI 生成状态有可读提示；
- 颜色不作为唯一编码，文本和线条满足主题对比要求。

---

## 11. 测试与门禁

### 11.1 测试层次

| 层次 | 必测内容 |
| --- | --- |
| Domain unit | command/inverse、树 invariant、元素引用、Sheet 操作、selection 查询 |
| Property test | 随机命令序列、undo/redo 往返、迁移幂等、XMind 转换不崩溃 |
| Fixture/golden | 多版本 XMind、样式、关系、概要、附件、未知字段、损坏 ZIP |
| Renderer unit | layout、文本测量、空间导航、hit-test、viewport 变换 |
| Integration | IPC 精确 envelope、revision 冲突、导入 commit、附件围栏、取消传播 |
| E2E | 键盘建图、拖拽、Sheet、AI diff、导入报告、导出前 flush |
| A11y | 大纲树、焦点顺序、快捷键冲突、状态播报 |

### 11.2 最低命令

按触达范围至少运行：

```bash
pnpm typecheck
pnpm run check:mindmap
pnpm run check:security          # 导入、附件、路径、provider 隐私相关改动
pnpm run check:teaching-evidence # 触及 Lesson/复习/测验/教学投影时
pnpm run check:provider-privacy  # AI 来源与 provider payload 改动时
```

如新增工具或 effect，额外运行 `pnpm run check:tool-contract`；不得用泛型覆盖率替代 teaching/privacy/security 门禁。

---

## 12. 风险与缓解

| 风险 | 缓解策略 |
| --- | --- |
| 为追赶 XMind 造成范围爆炸 | 以“专业编辑闭环 + StudiumX 学习连接”为 P0，其余按 P1/P2 延后 |
| v2 模型一次性过度设计 | 先用真实场景和 XMind fixture 驱动；每种 element 都要有 UI 与 round-trip 测试 |
| SVG 在大图下性能不足 | M0 建基准，先裁剪/测量缓存/增量布局；达不到再 ADR 评估渲染替换 |
| AI 重组破坏用户内容 | proposal + diff + transaction + undo；默认不允许无预览整图覆盖 |
| 来源锚点随 Markdown 编辑漂移 | breadcrumb + block/content hash + stale 状态 + 用户确认重定位 |
| XMind 私有字段变化 | adapter 隔离、版本 fixture、兼容性报告、受限 extension bag |
| 多 Sheet/并发保存丢数据 | active sheet 显式入命令上下文；revision + expectedRevision + flush |
| 学习状态被导图反向污染 | 只读投影；跨域动作走现有 coordinator/教学入口；新增 teaching-evidence 测试 |
| 模块继续膨胀 | 按 domain/layout/input/render/inspector 拆深模块，触达即 peel |

---

## 13. 实施纪律与下一步

1. **先评审本规划，不直接并行铺开 M1–M6。**
2. M0 首先产出 schema v2/revision/interop 的 ADR 变更，并链入 `docs/adr/README.md`。
3. 每个里程碑拆成可独立验收的垂直切片；同一切片必须包含 domain、UI、持久化和测试闭环，避免只堆按钮。
4. 优先修复现有浅层实现的可靠性问题，再扩展样式和 AI。
5. 所有新交互以统一 command 为入口；任何“直接 set zustand 后异步保存”的旁路都应逐步收口。
6. 每个里程碑结束后用真实学习任务手测，而不是只验证能否导入 `.xmind`。

**建议立即启动的第一个工程切片：** `schema v2 + revisioned repository + command reducer + undo/redo + Tab/Enter 键盘建图`。这一切片能同时解决数据模型、保存可靠性和核心编辑体验，是后续拖拽、样式、结构元素、AI diff 与 StudiumX 来源连接的共同地基。
