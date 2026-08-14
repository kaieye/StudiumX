# 思维导图右侧面板对照 Xmind 26.05 改进清单

> **状态：** 现状审计与产品改进清单（2026-08-12，落地证据与状态表持续同步至 2026-08-14）
> **范围：** StudiumX 思维导图编辑页右侧面板、相关样式模型、命令、渲染、持久化与 XMind 互通  
> **参考实现：** `/Users/chos1nz/Documents/project/StudiumX-project/ref_project/Xmind`，Xmind `26.05.01105`，构建号 `202607290707`  
> **关联文档：** [xmind-ui-refactor-plan.md](xmind-ui-refactor-plan.md)、[studiumx-mind-map-plan.md](studiumx-mind-map-plan.md)、[ADR-0173](../adr/0173-mind-map-schema-v2-and-revisioned-repository.md)

## 0. 执行结论

当前右侧面板的问题**不只是视觉没有对齐 Xmind**，而是同时存在四类差距：

1. **概念和入口错位：** 当前把「配色方案」「Xmind 主题 JSON 转换结果」「导图级样式」混在 `MindMapThemeGallery` 中，并以大面积常驻画廊展示；Xmind 当前产品面是「骨架」与「配色方案」两个紧凑入口，点击后打开小型列表浮层。
2. **已有功能存在正确性缺陷：** 配色方案、彩虹分支、分层主题样式、分支线型和分支线粗细已经进入 TypeScript 类型与 UI，但没有进入 V2 持久化 Schema；自动保存经过 IPC 解析后会剥离这些字段，随后 renderer 采用主进程返回文档，导致设置可能在约 400ms 自动保存后回退。
3. **格式能力覆盖不足：** 当前只有普通主题节点的部分样式控件，没有 Xmind 的动态对象检查器、混合值、多选、继承语义、样式传播、编号、边框线型、填充纹理、箭头、关系/外框/概要/标注独立格式面板等能力。
4. **模型能力与产品面脱节：** StudiumX 已有 relationship、boundary、summary、callout、free-topic 等元素模型和 `element.update` 命令，但画布选择仍以单一 `selectedNodeId` 为中心，右栏无法选择并格式化这些对象；部分 element style 字段也没有真正用于渲染。

因此建议不要继续以「再补几条 CSS」推进，而应按以下顺序处理：

1. **P0：先修持久化、状态判断和作用域错误。**
2. **P1：重做右栏信息架构，建立紧凑的骨架/配色方案浮层。**
3. **P2：补齐导图级和主题级核心格式能力。**
4. **P3：建立按选中对象动态切换的独立格式面板。**
5. **P4：补齐自定义配色、自定义风格、高级布局和 XMind 样式互通。**

最关键的产品纠偏是：

> 当前「主题画廊」应拆成至少三个概念：**骨架、配色方案、自定义风格**。其中用户最常用的右栏入口应命名为「配色方案」，使用当前配色预览按钮打开小窗口列表；背景颜色、全局字体、分支线粗细、彩虹分支等作为紧凑行式控件放在其下方。

---

## 1. 当前 StudiumX 右侧面板现状

### 1.1 当前组成

右栏由 `MindMapAiPanel` 承载，顶层是三个需要用户手动切换的 Tab：

| Tab | 当前组成 | 主要问题 |
| --- | --- | --- |
| 样式 | `MindMapTopicStyleInspector`、`MindMapNotesPanel`、`MindMapMarkersPanel` | 只认识普通主题节点；导图级分支线型被错误放入节点样式区，但实际写入 sheet；笔记/标记与格式属性混杂 |
| 画布 | `MindMapThemeGallery`、`MindMapThemePanel`、`MindMapCanvasOptionsPanel` | 配色方案与 43 个主题卡片常驻铺满；背景、字体、彩虹分支、布局、折叠操作分散在三个组件中 |
| AI | AI 生成与 proposal review | 是 StudiumX 的差异化能力，应保留，但不应决定格式面板的上下文模型 |

关键入口证据：

- `src/renderer/src/views/mindmap/MindMapAiPanel.tsx:412`
- `src/renderer/src/views/mindmap/MindMapAiPanel.tsx:480`
- `src/renderer/src/views/mindmap/MindMapAiPanel.tsx:490`

### 1.2 已存在但不等于已完成的能力

| 能力 | 当前状态 | 结论 |
| --- | --- | --- |
| 多结构布局 | 已有 map / logic / org / tree / brace / timeline / matrix / fishbone 注册表 | 基础不错，但选择器过大，且缺结构专属次级参数与持久化/互通验收 |
| 配色方案 | 6 套颜色数组，常驻一行按钮 | 概念正确、交互不对；缺分类、收藏、变体、自定义、最近使用和小浮层 |
| 43 个内置主题 | 已从 Xmind JSON 转换 | 数量不等于保真；转换器只提取少量颜色、字体、字号、字重和极少形状 |
| 背景颜色 | 原生 `<input type="color">` | 只能选不透明颜色；缺 HEX、透明度、最近颜色、预置色墙和明确作用域 |
| 全局字体 | 文档 theme 上有 `fontFamily`，UI 只有系统/Serif/Monospace | 对内置主题可能被各层 `topicStyles.*.fontFamily` 覆盖；缺真实字体列表和 CJK fallback |
| 彩虹分支 | 有布尔开关和 branch palette | 关闭后没有统一线色选择器；保存链路会剥离相关字段 |
| 分支线粗细 | 0.75 / 1 / 1.5 三档 | 控件选中判断有 bug；档位不足；没有锥形线；保存链路会剥离字段 |
| 分支连接线类型 | curve / elbow / straight | 控件放在节点样式面板中却修改 sheet；缺 Xmind 的更多连接形状和线型 |
| 节点样式 | 形状、填充、描边、文字颜色、字体、字号、字重 | 缺边框线型/粗细、填充纹理、宽度、斜体/下划线/删除线/对齐/大小写等 |
| 元素样式 | model 支持有限 `MindMapElementStyle` | 无对象选择与右栏；renderer 主要只读取 boundary 的 stroke/strokeWidth |
| 多选 | 有独立 selection helper | 主编辑状态和右栏仍使用单一 `selectedNodeId`，没有 mixed/inherited/none 语义 |
| 撤销与 revisioned persistence | 所有现有控件大多走 command | 方向正确，但 Schema 漂移使部分命令结果无法通过 canonical 保存链路保留 |

---

## 2. P0：必须先修的正确性缺陷

这些问题不修，后续新增控件可能继续出现「看起来能用、自动保存后丢失」的假完成。

### P0-01 V2 Schema 剥离已上线的样式字段

**现状：**

- `MindMapTheme` 类型已经声明：
  - `rainbowBranches`
  - `colorSchemeId`
  - `topicStyles.central/main/sub`
- `MindMapLayoutSettings` 类型已经声明：
  - `lineStyle`
  - `lineWidthScale`
- 但 `mindMapThemeSchema` 和 `mindMapLayoutSettingsSchema` 未声明这些字段。
- `parseMindMapUpdatePayload` 使用 `mindMapDocumentV2Schema.safeParse(record.doc)`，随后把 `parsedDoc.data` 交给 store。
- Zod object 默认会剥离未知字段；主进程返回持久化后的文档，renderer 又通过 `replacePresent(saved)` 采用该结果。

**用户可见后果：**

- 切换配色方案后，`colorSchemeId`、`rainbowBranches`、`topicStyles` 可能被剥离。
- 调整分支线型或粗细后，`lineStyle`、`lineWidthScale` 可能被剥离。
- 没有后续编辑竞争时，设置可能在自动保存完成后直接回退；有并发本地编辑时也会在下次读回或重启后丢失。
- 当前主题面板单测 mock 的 `updateMindMap` 直接返回 `payload.doc`，绕过真实 IPC parser，因此没有覆盖该缺陷。

**必须改进：**

- [x] 补齐 `mindMapThemeSchema`、`mindMapLayoutSettingsSchema`。
- [x] 同步补齐 `mindMapThemeProposalSchema`、`mindMapLayoutProposalSchema`、`mindMapSheetLayoutUpdatePatchProposalSchema`。
- [x] 对新增枚举、数值范围和颜色值建立明确校验，不用无限制 `string` 代替稳定合同。
- [x] 增加 renderer payload → IPC parser → store → read 的真实 round-trip 测试。
- [x] fixture 覆盖本批地图级 theme/layout 与 element style 字段；更广的后续格式字段仍须随实现追加重开测试。
- [x] 本批只增加向后兼容 optional 字段，保持 schemaVersion 2；后续若拆分视觉模型仍须新增 ADR 和迁移版本。

**证据：**

- `src/shared/mindmap/domain/types.ts:21`
- `src/shared/mindmap/domain/types.ts:74`
- `src/shared/mindmap/domain/schema.ts:109`
- `src/shared/mindmap/domain/schema.ts:143`
- `src/main/mindmap/mind-map-ipc-commands.ts:131`
- `src/renderer/src/views/mindmap/mind-map-view-store.ts:249`（`replacePresent(saved)` 采用主进程返回文档处；原指针 157 已修正，见 9.4）

### P0-02 分支线粗细选中态计算错误

当前判断：

```ts
Math.round(layout.lineWidthScale ?? 1) === option.value
```

这会导致：

- `0.75` 被 round 为 `1`，UI 会错误高亮「默认」而不是「细」。
- `1.5` 被 round 为 `2`，三个按钮都可能不高亮。

**必须改进：**

- [x] 使用精确受控枚举或 epsilon 比较，不做整数 round。
- [x] 将五档 display token 映射为独立 scale 值（0.5/0.75/1/1.5/2），renderer 继续由 `edgeStrokeWidth` 解析真实宽度。
- [x] 增加五档 UI 数量/选中态/undo/CAS persistence 测试；`edgeStrokeWidth` 已覆盖 scale 到真实宽度的映射。

**证据：** `src/renderer/src/views/mindmap/MindMapCanvasOptionsPanel.tsx:22,337`（`LINE_WIDTH_OPTIONS` 五档 0.5/0.75/1/1.5/2 与精确相等选择；原指针 171 已修正，见 9.4）

### P0-03 「节点分支样式」控件实际修改整个 Sheet

`MindMapTopicStyleInspector` 的「分支」区域看起来属于当前选中主题，但点击 curve/elbow/straight 实际 dispatch `sheet.update-layout`。

**问题：**

- 作用域与文案不一致，用户会误以为只修改当前主题。
- 只有进入「样式」Tab 并选中节点后才容易发现全局线型。
- 「画布」Tab 中反而没有分支线型控件。

**必须改进：**

- [x] 在模型支持节点级 lineClass/linePattern 前，把当前控件移动到画布格式区，并标注作用域为当前 Sheet。
- [ ] 后续节点级分支格式应使用独立字段和独立命令，不能复用 sheet `lineStyle`。
- [x] 本批地图级控件已标注当前 Sheet/整个文档；未来同级/子树传播控件仍须补对应作用域。

**证据：** 连接线控件已移至 `src/renderer/src/views/mindmap/MindMapCanvasOptionsPanel.tsx:314-324` 并标注当前 Sheet；`MindMapTopicStyleInspector.tsx:312` 现仅保留节点 stroke 色 `branchColor`（原指针已修正，见 9.4）

### P0-04 当前「全局字体」对内置主题可能不真正全局

画布把 `theme.fontFamily` 写入 CSS 变量 `--mindmap-theme-font`，但节点渲染会优先把 `theme.topicStyles.central/main/sub.fontFamily` 作为 inline style 写到节点上。内置主题转换器通常会为三层 topicStyles 保留字体，因此用户切换「全局字体」后可能仍看到原主题字体。

**必须改进：**

- [x] 明确并实现字体层级：节点 override > 显式全局字体 > 层级主题默认 > app fallback。
- [x] 导图级全局字体变更影响所有未做节点级显式覆盖的主题。
- [x] 增加 CJK Sans/CJK Serif fallback 字体选项。
- [x] 增加 preset 层字体、全局字体与节点局部字体优先级渲染测试。

**证据：**

- `src/renderer/src/views/mindmap/MindMapThemePanel.tsx:71`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:634`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:850`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:999`

### P0-05 关闭彩虹分支后缺少统一线色产品入口

当前 `branchColor()` 在 `rainbowBranches === false` 时使用 `theme.lineColor ?? '#8E8E93'`，但右栏只有彩虹开关，没有统一分支线颜色选择器。

**必须改进：**

- [x] 彩虹分支打开：显示颜色组预览与选择器。
- [x] 彩虹分支关闭：显示统一分支线颜色选择器。
- [x] 切换模式时保留上次 palette 和 single color，不破坏用户设置。
- [x] 每次配色或开关变化均通过单个 `document.apply-theme` command 提交完整 theme。

**证据：**

- `src/renderer/src/views/mindmap/MindMapThemePanel.tsx:87`
- `src/renderer/src/views/mindmap/mind-map-branch-colors.ts:22`

### P0-06 43 个主题卡片造成「保真已完成」错觉

当前 `fromXmindTheme`：

- 只映射少量 fill/text/font/size/weight。
- `mapShape()` 只识别 roundedRect、underline、fishbone。
- 未完整映射 border line pattern/width、branch connection、line pattern、箭头、relationship、boundary、summary、callout 等主题属性。
- `.xmind` 导出明确没有投影 `topicStyles` 和节点级样式。

**必须改进：**

- [x] 将「主题 JSON 数量」与「主题保真等级」分开报告。
- [x] 为每个主题生成 preserved/approximated/dropped 属性报告。
- [x] 没有实现的属性不会只在缩略图中近似后静默丢失：报告按稳定、无值的属性路径记录 dropped/approximated 原因。
- [x] UI 将其定位为带近似提示的紧凑「风格预设」popover，不再常驻展示 43 卡片墙。

**证据：**

- `src/shared/mindmap/themes/from-xmind-theme.ts:58`
- `src/shared/mindmap/themes/from-xmind-theme.ts:67`
- `src/shared/mindmap/xmind-converter.ts:255`
- `src/renderer/src/views/mindmap/MindMapThemeGallery.tsx:119`

### P0-07 element style 模型、渲染和右栏不闭环

当前模型支持 relationship、boundary、summary、callout、free-topic 和有限 `MindMapElementStyle`，但：

- 画布没有 element selection 状态。
- 右栏没有 element inspector。
- relationship/callout/summary 的大部分 style 没有在 renderer 中应用。
- free-topic 在共享模型和命令中存在，但当前画布没有形成完整的渲染、选择、拖拽和格式化产品路径。

**必须改进：**

- [x] 建立 topic / element / canvas selection union；relationship/boundary/summary/callout 已接入，free-topic/asset 的完整画布路径仍待实现。
- [x] relationship/boundary/summary/callout 共用按 element type capability 裁剪的动态 inspector；更高级的对象专属字段仍在 Phase 3。
- [x] 当前有限 `MindMapElementStyle` 字段均有适用 renderer 消费测试；free-topic 明确显示 limited 状态。
- [x] element update 继续走 `element.update`、undo/redo 与 revisioned debounced persistence。

**证据：**

- `src/shared/mindmap/domain/types.ts:172`
- `src/shared/mindmap/domain/types.ts:233`
- `src/shared/mindmap/commands/mind-map-reducer.ts:386`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:703`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:814`

### P0-08 缺少 mixed / inherited / none / default 的状态模型

当前控件普遍把空字符串或 `undefined` 同时用于「系统默认」「继承」「未设置」，且主 UI 使用单一 `selectedNodeId`。

**必须改进：**

- [x] 建立 UI 格式值 adapter：`default`、`inherited`、`none`、`concrete`、`mixed`；当前先接入普通 topic 样式字段。
- [x] 普通 topic 多选值不一致时显示 mixed，不再显示 primary/第一个节点的值。
- [x] adapter 已将显式 `shape: none` 与 inherited 区分；边框等后续 typed `none` 字段仍待 domain 扩充。
- [x] 当前 topic/canvas/element inspector 的每个已呈现字段均经独立 capability registry 计算；不支持字段保留禁用控件和可访问原因，不能整面板一刀切。五态值 adapter 扩展到 element/canvas 仍属后续工作。

---

## 3. Xmind 26.05 右栏的真实信息架构

### 3.1 不是「主题画廊」，而是骨架 + 配色方案

Xmind 当前地图级面板顶部的核心入口是：

1. **骨架（Skeleton）：** 当前骨架预览按钮，点击打开按分类展示缩略图的小浮层。
2. **配色方案（Color Theme）：** 当前配色预览按钮，点击打开小浮层；支持收藏、分类、智能/经典/自定义组、组内变体和当前项高亮。
3. **背景颜色：** 独立行式颜色控件。
4. **全局字体：** 独立行式字体控件，另有 CJK 字体概念。

Xmind 的中文资源明确使用：

- `Color Theme` → 「配色方案」：`ref_project/Xmind/app/static/locales/zh-CN/translation.json:1318`
- `Choose the Color Theme.` → 「选择配色方案。」：同文件 `:1916`
- `Global Font` → 「全局字体」：同文件 `:1585`
- `Background Color` → 「背景颜色」：同文件 `:482`

配色小窗口相关资源：

- `ref_project/Xmind/app/static/assets/images/color-theme-panel/favorite-active.svg`
- `ref_project/Xmind/app/static/assets/images/color-theme-panel/favorite-normal.svg`
- `ref_project/Xmind/app/static/assets/images/color-theme-panel/more.svg`
- `ref_project/Xmind/app/static/assets/images/color-theme-panel/switch.svg`

### 3.2 地图级真实能力

| 分组 | Xmind 能力 |
| --- | --- |
| 骨架 | 分类预览、当前项、最近使用、手绘/受限标识 |
| 配色方案 | 收藏、智能/经典/自定义、颜色组变体、当前高亮、自定义生命周期 |
| 背景 | 颜色、HEX、透明度、最近颜色、预置色 |
| 字体 | 全局字体、字体列表、推荐字体、CJK 字体 |
| 分支线 | 1/2/3/5/8 五档粗细、锥形线、彩虹分支、颜色组、统一线色 |
| 导图样式 | 自动平衡、紧凑布局 |
| 主题显示 | 同级主题宽度统一、全局笔记显示、自由主题自动着色 |
| 联系 | 联系线颜色跟随所指主题 |
| 高级布局 | 分支自由布局、自由主题灵活定位、主题层叠 |
| 自定义风格 | 创建、管理、编辑完整样式层级 |

相关中文资源：

- `Branch Line Width` → 「分支线粗细」：`ref_project/Xmind/app/static/locales/zh-CN/translation.json:1566`
- `Enable Tapered Line` → 「开启线条渐细」：同文件 `:507`
- `Map Style` → 「导图样式」：同文件 `:1571`
- `Auto Balance Map` → 「自动平衡布局」：同文件 `:480`
- `Advanced Layout` → 「高级布局」：同文件 `:471`
- `Uniform Topic Length` → 「统一同级主题长度」：同文件 `:3143`
- `Free Branch Position` → 「分支自由布局」：同文件 `:3144`

### 3.3 普通主题格式面板真实能力

Xmind 会根据选中对象动态切换面板。普通主题面板包含：

- 快速样式：Default / Very Important / Important / Cross Out。
- 文本：字体、字号、字重、粗体、斜体、颜色、下划线、删除线、大小写、对齐。
- 形状：基础形状、引号/括号/箭头/心形/云/星/流程图形状，更多形状通过浮层展示。
- 填充：实色、手绘实色、斜线手绘、横线手绘等 pattern。
- 边框：none/solid/dash/hand-drawn，颜色和 1/2/3/5/8 粗细。
- 节点宽度：固定宽度、自动适应文字。
- 分支连接线形状：rounded elbow、elbow、straight、curve、bight、fold、rounded fold。
- 分支线型：solid、dash、hand-drawn solid、hand-drawn dash。
- 分支线：颜色、粗细、锥形、箭头、follow branch。
- 节点级彩虹分支。
- 编号：数字、大小写字母、罗马数字、分级编号、从当前节点重新开始。
- 结构：主结构、次级结构、三级结构及结构专属参数。
- 样式传播：更新到同级、更新到所有子主题、重设样式。

Xmind 静态资源中可见完整的 branch/border line-pattern 预览和 structure 预览，说明这些不是只存在于翻译文件的残留能力。

### 3.4 其他对象有独立面板

| 对象 | Xmind 独立能力 |
| --- | --- |
| Relationship | 连接形状、起止箭头、线型、粗细、颜色、标题文本 |
| Boundary | 外框形状、填充、透明度、边框线型/粗细/颜色、标题文本 |
| Summary | 概要线形状/线型/粗细/颜色 + 概要主题完整节点样式 |
| Callout | 标注形状、填充、文本、重设 |
| Image | 宽高、锁定比例、边框、阴影、不透明度 |
| Grid Cell | 填充、背景、对齐 |
| Zone/区域 | 宽高、自适应内容、填充、边框、文本 |

### 3.5 底层交互不是简单表单

Xmind 格式适配层对每个字段统一处理：

- 当前值 `value`
- 可选项 `options`
- 是否禁用 `disabled`
- 多选所有值 `values`
- 是否混合 `isMultiple`
- mutation/action capability

这使其能够正确表达：

- 多选混合值。
- 继承、默认、无、具体值之间的差异。
- 不同结构和对象类型可用能力不同。
- 无边框时自动禁用边框颜色和粗细。
- 协作或编辑锁定时只禁用受影响属性。

---

## 4. 推荐的 StudiumX 右栏信息架构

### 4.1 顶层不要继续强迫用户在「样式 / 画布」间切换

推荐顶层只保留：

1. **格式**：根据当前选择自动显示地图、主题或其他对象的格式面板。
2. **AI**：保留 StudiumX 的 AI proposal / review 差异化能力。

可选增加「内容」Tab 承载笔记、标记、链接、来源、任务等，但不要继续把笔记和标记塞在纯样式属性之间。

自动上下文规则：

| 当前选择 | 格式面板 |
| --- | --- |
| 无选择或点击画布背景 | 当前 Sheet/导图格式 |
| 单个普通主题 | 主题格式 |
| 多个普通主题 | 共同可用属性 + mixed state |
| relationship | 联系格式 |
| boundary | 外框格式 |
| summary | 概要格式 |
| callout | 标注格式 |
| free-topic | 自由主题格式 |
| image/asset | 图片格式 |
| 不支持格式化对象 | 明确空状态，不静默显示错误面板 |

### 4.2 地图格式面板建议顺序

1. **骨架**：紧凑预览按钮 → 小型 popover。
2. **配色方案**：紧凑色条预览按钮 → 小型 popover。
3. **背景颜色**：颜色井。
4. **全局字体**：字体选择；高级项内放 CJK fallback。
5. **分支线粗细**：图形化 5 档；同控件支持普通/锥形。
6. **彩虹分支**：开关 + 当前 palette 小预览；关闭时显示统一线色。
7. **导图样式**：自动平衡、紧凑布局。
8. **主题显示**：统一同级宽度、全局笔记显示、自由主题自动着色。
9. **高级布局**：自由定位、层叠等低频项，默认折叠。
10. **自定义风格**：进入独立管理器，不把完整编辑器塞进 280px 侧栏。

### 4.3 配色方案小窗口建议

最小可用版本：

- 顶部显示当前配色名称。
- 两列缩略图或紧凑色条列表。
- 当前项蓝色描边或 check。
- 分类：推荐、经典、自定义。
- 支持滚动，不撑高右栏。
- 支持键盘导航、方向键、Enter、Escape 和焦点归还。

完整版本：

- 收藏。
- 最近使用。
- 智能配色组及组内变体切换。
- 自定义配色新建、编辑、复制、重命名、删除。
- 六色或可扩展 palette 编辑。
- 颜色对比度检查与不可读预警。
- 文档保存 selected id，同时保存 resolved color snapshot，避免自定义配色删除后文档变色。

### 4.4 骨架与配色方案必须解耦

建议定义：

- **骨架：** 结构、默认节点形状、层级布局、基础连接语言。
- **配色方案：** 分支 palette、统一线色、必要的前景/背景候选色。
- **自定义风格：** 中心/一级/子级主题、元素样式、全局分支规则等完整 style profile。
- **节点 override：** 用户对具体节点做的局部覆盖。

切换规则必须由产品明确选择：

- 仅切换骨架时是否保留当前配色。
- 仅切换配色时必须保留结构和节点局部 override。
- 应用完整自定义风格时，是否覆盖局部 override；若支持覆盖，必须弹出明确选项或提供可撤销 transaction。

---

## 5. 全面功能改进清单

状态标记：✅ 已有可用；⚠️ 已有但有缺陷/语义错误；🟡 仅有底层或部分能力；❌ 缺失。

### A. 概念、命名与入口

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| A-01 | P1 | ✅ | 将「主题画廊」主入口改为「配色方案」 | 右栏不再常驻 43 卡片；点击当前色条打开小浮层 |
| A-02 | P1 | ✅ | 新增独立「骨架」入口 | 结构/骨架以当前值触发的分组 popover 独立于配色方案，切换结构不覆盖 theme/palette |
| A-03 | P1 | ❌ | 新增「自定义风格」入口 | 进入独立管理器，不在侧栏平铺全部属性 |
| A-04 | P1 | ✅ | 合并「样式/画布」为上下文式「格式」 | 点击画布、主题、元素时自动切换正确面板 |
| A-05 | P1 | ✅ | 将笔记/标记从纯样式属性中分离 | 格式区只放视觉与布局；内容属性有独立分组或 Tab |
| A-06 | P1 | ✅ | 保留 AI Tab | AI 不绕过 command/revision；不与格式状态混用 |
| A-07 | P2 | 🟡 | 每个控件显示作用域 | 明确当前主题/同级/子树/当前 Sheet/全文档 |
| A-08 | P2 | 🟡 | 统一「重设」语义 | 可区分重设当前字段、当前区、当前对象和当前画布 |

### B. 配色方案与背景

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| B-01 | P0 | ✅ | 修复配色字段持久化 | 保存和重开后 `colorSchemeId/branchColors/rainbowBranches` 不丢失 |
| B-02 | P1 | ✅ | 配色方案改为小浮层列表 | 右栏只显示当前配色预览，浮层可滚动 |
| B-03 | P1 | ✅ | 保留 palette 色条预览 | 缩略预览能区分统一单色与当前分支 palette，并能辨认不同配色方案 |
| B-04 | P2 | ✅ | 配色分类 | 至少推荐/经典/自定义；后续可增加智能配色 |
| B-05 | P2 | ✅ | 收藏与最近使用 | 收藏状态为用户状态，不成为教学 authority |
| B-06 | P2 | ✅ | 自定义配色完整生命周期 | 新建、编辑、复制、重命名、删除均可撤销或确认 |
| B-07 | P1 | ✅ | 升级背景颜色选择器 | 紧凑单行控件：标签右侧一个颜色圆圈，点击弹出浮层面板，面板内调颜色（原生取色）与不透明度；圆圈同步当前背景（含透明度） |
| B-08 | P1 | ✅ | 明确背景作用域 | 决定是当前 Sheet 还是全文档，并在数据模型/UI 中一致表达 |
| B-09 | P2 | ✅ | 配色可读性检查 | 对低对比文字/节点组合给出非阻断预警 |
| B-10 | P3 | ❌ | AI 智能配色 proposal | 只生成可审查 proposal，不静默改图；应用仍走 command |
| B-11 | P4 | ❌ | 配色导入/导出 | 只处理静态颜色数据，不执行外部代码 |
| B-12 | P4 | ❌ | 背景图片/墙纸（StudiumX 增强） | 明确这是自有增强，不宣称 Xmind 26.05 parity；资源走 asset/path 安全边界 |

### C. 全局字体与文本继承

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| C-01 | P0 | ✅ | 修正全局字体优先级 | 内置主题下切换全局字体会影响所有未局部覆盖节点 |
| C-02 | P1 | ✅ | 提供真实字体列表 | 显示系统已安装/内置安全字体，支持搜索和最近使用 |
| C-03 | P1 | ✅ | 增加 CJK fallback 字体 | 中日韩与西文混排可独立选择 fallback |
| C-04 | P2 | 🟡 | 字体缺失降级提示 | 对导入/自定义且不在受管字体列表中的请求字体保留原字体栈并显示「可能回退」提示；不伪称已可靠探测 OS 字体安装状态。 |
| C-05 | P2 | ✅ | 全局字体与局部 override 指示 | 节点面板显示 app fallback / theme layer / document global / local override / mixed 来源，且与 canvas 相同优先级。 |
| C-06 | P2 | ✅ | 字体预览 | 下拉项使用自身字体预览，虚拟化长列表 |
| C-07 | P3 | ❌ | 字体嵌入策略 | 导出 SVG/PNG/XMind 时记录字体降级与兼容性结果 |

### D. 分支线全局设置

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| D-01 | P0 | ✅ | 修复线宽选中态 | 细/默认/粗均正确高亮，自动保存后不回退 |
| D-02 | P1 | ✅ | 扩为 5 档线宽 | 至少映射 1/2/3/5/8 或等价视觉 token |
| D-03 | P1 | ✅ | 增加锥形线 | 每档可选择普通/锥形，组合更新为原子 transaction |
| D-04 | P1 | ✅ | 将全局连接线类型移到地图面板 | 不再伪装成节点级属性 |
| D-05 | P1 | ✅ | 扩充连接线形状 | curve、straight、elbow、rounded elbow、bight、fold、rounded fold |
| D-06 | P1 | ✅ | 增加分支线型 | solid、dash、hand-drawn solid、hand-drawn dash |
| D-07 | P1 | ✅ | 彩虹分支 palette popover | 开关旁显示当前颜色组；支持切换颜色组 |
| D-08 | P1 | ✅ | 统一分支线颜色 | 关闭彩虹分支时可选择 lineColor |
| D-09 | P2 | ✅ | 结构默认与用户 override 分离 | 切换结构不会意外覆盖用户显式线型，或提供明确重设 |
| D-10 | P2 | ✅ | 导图级连接线类型快捷项 | 可作为 StudiumX 易用性增强；标明 Xmind 主要通过层级样式传播实现 |

### E. 结构与布局

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| E-01 | P1 | ✅ | 结构选择改为预览 popover | 右栏只显示当前结构；浮层按 family 分类，支持初始焦点、方向键环绕、Escape/选择后回焦与外部关闭 |
| E-02 | P1 | ✅ | 保留 map/logic/org/tree/brace/timeline/fishbone/matrix | 每类有真实几何和 connector，不回退成普通树 |
| E-03 | P2 | ❌ | 次级/三级结构参数 | `minorStructureClass/subMinorStructureClass` 或等价 typed model |
| E-04 | P1 | ✅ | 自动平衡 | 仅对 Logic Chart structure capability 启用；其他结构禁用并显示原因 |
| E-05 | P1 | ✅ | 紧凑布局 | compact 以独立倍率压缩默认或显式 sibling spacing，保留原 spacing 选择并有几何测试 |
| E-06 | P2 | ❌ | 统一同级主题宽度 | 布局度量和渲染共同支持 |
| E-07 | P2 | ❌ | 分支自由布局 | 手动位置和自动布局规则有明确优先级，可重设 |
| E-08 | P3 | ❌ | 自由主题灵活定位 | 补齐 free-topic 渲染、选择、拖拽、格式化 |
| E-09 | P3 | ❌ | 主题层叠 | 关闭时执行可撤销的重排，不只改布尔值 |
| E-10 | P3 | ❌ | Matrix/Grid 专属参数 | 列数、合并方式、单元格边框进入 typed layout settings |
| E-11 | P2 | ✅ | 布局重设与骨架默认关联 | 重设保留当前 structure family，并回到该 family 的首选 preset，而非永远强制 `logic.right` |
| E-12 | P2 | ✅ | 折叠/展开全部移出格式区 | 放到画布操作或导航区，避免把命令和样式混在一起 |

### F. 普通主题：节点外观

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| F-01 | P1 | ✅ | 扩充主题形状 | 基础形状首屏 + 更多形状 popover；未知 XMind 形状有近似报告 |
| F-02 | P2 | ✅ | 填充 pattern | solid、hand-drawn、diagonal、horizontal 等 typed 枚举 |
| F-03 | P1 | ✅ | 填充颜色 | 已有预置色、原生颜色井、清除继承和 mixed；透明与最近颜色已完成 |
| F-04 | P1 | ✅ | 边框颜色 | 颜色 override 与 typed 线型/粗细共同持久化和渲染；effective `none` 时禁用颜色/粗细但保留原 override，重新启用可恢复 |
| F-05 | P1 | ✅ | 边框线型 | `none/solid/dash/hand-drawn-solid/hand-drawn-dash` 已贯通 schema、proposal、inspector、renderer、undo/persistence；XMind 点线族导入近似为 dash，手绘为本地表现 |
| F-06 | P1 | ✅ | 边框粗细 | 已有 0.5/1/2/3/5 五档、mixed/inherit、renderer、XMind theme import 与 V2 `.xmind` export；有效 stroke/width/none/dash 均映射为 topic style，hand-drawn 仅近似为 XMind solid/dash |
| F-07 | P2 | ✅ | 节点宽度 | topic-local 支持自动适应文字、固定宽度、重设为自动；布局度量、换行高度、画布命中/编辑框共用同一真实尺寸。XMind 节点宽度导入导出仍未宣称完成 |
| F-08 | P2 | ✅ | 快速样式 | 默认、重要、非常重要、划除；作为视觉样式 preset，不修改任务事实 |
| F-09 | P2 | ✅ | 更多形状搜索/分类 | 不在主侧栏一次铺出几十项 |
| F-10 | P2 | ⚠️ | 节点局部结构 override 完整化 | 不只提供 6 个 logic 选项，按当前结构提供有效 options |

### G. 普通主题：文本格式

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| G-01 | P1 | ✅ | 字体家族 | 支持继承、全局、具体字体、mixed |
| G-02 | P1 | ✅ | 字号 | 支持常用 datalist 建议、任意 0–512 范围内合法正数、继承和 mixed；同一次 focus 编辑会话以稳定 mergeKey 合并为一次 undo |
| G-03 | P1 | ✅ | 字重 | 使用稳定 fontWeight token，选项名称由 i18n 提供，不硬编码英文 |
| G-04 | P1 | ✅ | 粗体/斜体 | 独立 Bold/Italic toggle，可组合、继承、显示 mixed，并贯通 schema/proposal/store/renderer |
| G-05 | P1 | ✅ | 文字颜色 | 已有预置色、原生颜色井、清除继承和 mixed；透明与最近颜色已完成 |
| G-06 | P2 | ✅ | 下划线/删除线 | 独立可组合 toggle，支持 inherit/explicit none/mixed、undo、revisioned persistence 和画布渲染；`fo:text-decoration` 以 XMind canonical `none/underline/line-through/line-through underline` 导入导出 |
| G-07 | P2 | ✅ | 大小写转换 | inherit/none/uppercase/lowercase/capitalize 已进入 typed schema/proposal/store/renderer；只改变视觉 `textTransform`，不改原始标题，支持 mixed、undo、revisioned persistence 与 XMind `fo:text-transform` 导入导出 |
| G-08 | P2 | ✅ | 文本对齐 | left/center/right 支持 inherit/mixed、undo/persistence 与 SVG/edit-input 渲染；左右单向结构默认朝分支方向对齐，中心/双向/垂直结构居中，并以 `fo:text-align` 导入导出 |
| G-09 | P2 | ✅ | 多选混合态 | 字体、字号、颜色等不一致时显示 mixed |
| G-10 | P3 | ❌ | 行高/内边距 | 仅在真实需要且有导出映射时增加，避免无边界 CSS 参数 |

### H. 主题分支与编号

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| H-01 | P2 | ❌ | 节点/层级级连接线形状 | 独立于 sheet 全局 lineStyle，可继承/覆盖 |
| H-02 | P2 | ❌ | 节点/层级级线型 | solid/dash/hand-drawn，支持 follow branch |
| H-03 | P2 | ❌ | 节点/层级级线宽和锥形 | default/none/normal/tapered/follow branch/mixed |
| H-04 | P2 | ❌ | 节点/层级级线色 | 可跟随分支或显式颜色 |
| H-05 | P3 | ❌ | 分支箭头 | none/dot/triangle/spearhead/square/diamond 等受控集合 |
| H-06 | P2 | ❌ | 节点级彩虹分支 | 仅在能产生多分支的上下文显示 |
| H-07 | P2 | ✅ | 编号模式 | none、数字、字母、罗马数字 |
| H-08 | P2 | ✅ | 分级编号 | 支持 1、1.1、1.2 等层级模式 |
| H-09 | P2 | ✅ | 从当前主题重新编号 | 作用域明确、可撤销 |
| H-10 | P2 | ✅ | 应用到同级 | 与样式传播框架共用，不写专用旁路 |

### I. 对象专用格式面板

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| I-01 | P2 | ✅ | Relationship inspector | 形状、起止箭头、线型、粗细、颜色、标题文本全部可渲染和持久化 |
| I-02 | P2 | 🟡 | Boundary inspector | 形状、填充、透明度、边框、标题文本 |
| I-03 | P2 | 🟡 | Summary inspector | 概要线与概要主题分成两个区，分别可重设 |
| I-04 | P2 | 🟡 | Callout inspector | 形状、填充、文本、leader line，支持位置重设 |
| I-05 | P3 | 🟡 | Free topic inspector | 普通主题样式 + 自由定位/对齐/自动着色 |
| I-06 | P3 | ❌ | Image/asset inspector | 宽高、锁比例、边框、阴影、不透明度；安全读取 asset 元数据 |
| I-07 | P3 | ❌ | Grid cell inspector | 背景、对齐、边框，只有 grid 结构时可用 |
| I-08 | P4 | ❌ | Zone/区域 inspector | 若 StudiumX 引入 zone，需先定义正式 domain model，不以 boundary 冒充 |
| I-09 | P2 | ✅ | 对象格式 capability registry | 每种对象声明支持字段，避免面板写入 renderer 不消费的属性 |

### J. 多选、继承、传播和样式复用

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| J-01 | P1 | ✅ | 将 selection 接入右栏 | 支持多个 topic 和单个 element；稳定 id，不保存为教学事实 |
| J-02 | P1 | ✅ | mixed state | 不同值显示 mixed；修改后只覆盖所选字段 |
| J-03 | P1 | 🟡 | inherited/default/none 分离 | topic inspector adapter 已分离五态；其他 inspector 与未来 typed none 字段尚未全量接入 |
| J-04 | P2 | ✅ | 更新到当前层级 | 单选 topic 可将完整局部样式通过一个 command transaction 应用到同级，并一次撤销 |
| J-05 | P2 | 🟡 | 更新到所有子主题 | 已有单 transaction 全子树传播、undo 与 persistence；大子树进度/取消边界尚未完成 |
| J-06 | P2 | ✅ | 重设样式 | inspector、topic 菜单与 XMind 对齐的 `Cmd/Ctrl+Alt+0` 均删除所选 topic 的 local style snapshot，恢复主题/结构继承；多选为一次 transaction/undo |
| J-07 | P2 | ✅ | 复制/粘贴样式 | topic 菜单与 XMind 对齐的 `Cmd/Ctrl+Alt+C/V` 快捷键已提供；payload 只保存 schema-compatible local topic style，多选粘贴为一次 transaction/undo，并进入 revisioned persistence |
| J-08 | P2 | ❌ | 样式刷/重复应用 | 可选增强，复用复制样式 payload，不新建第二套格式模型 |
| J-09 | P2 | ✅ | capability disabled | 每字段独立禁用，并说明原因 |
| J-10 | P3 | ❌ | 多类型选择策略 | 只显示交集属性；禁止把 topic 字段写入 relationship |

### K. 自定义配色与自定义风格

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| K-01 | P3 | ✅ | 自定义配色模型 | 用户状态保存 id/name/colors；文档保存 resolved snapshot |
| K-02 | P3 | ✅ | 自定义配色编辑器 | 至少 6 色、预览、对比度提示、保存/取消 |
| K-03 | P3 | ❌ | 自定义风格模型 | 包含 map、central/main/sub、relationship、boundary、summary、callout 等层 |
| K-04 | P3 | ❌ | 自定义风格编辑器 | 独立窗口/页面，实时预览但保存为原子操作 |
| K-05 | P3 | ❌ | 风格应用策略 | 明确保留或覆盖节点局部 override，可撤销 |
| K-06 | P4 | ❌ | 导入/导出自定义风格 | 严格 JSON schema、大小上限、无代码/无脚本 |
| K-07 | P4 | ✅ | 收藏、排序、搜索 | 属于用户偏好，可同步但不成为 teaching authority |

### L. 持久化、互通和测试

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| L-01 | P0 | 🟡 | Schema/类型/command/proposal 同源 | 增加字段时四处不会再次漂移，最好由共享 schema/types 派生 |
| L-02 | P0 | ✅ | IPC parser + repository round-trip 测试 | 不允许 mock 直接回显 payload 掩盖 parser strip；完整 Electron transport/handler integration 可另行补充 |
| L-03 | P1 | ✅ | UI + store 重开测试 | 每个地图级控件保存、关闭、重开保持一致 |
| L-04 | P2 | ✅ | XMind 导入属性报告 | 每个 style 字段标记 preserved/approximated/dropped |
| L-05 | P2 | 🟡 | XMind 导出 round-trip | V2 `.xmind` 已导出有效 topic border 与 textDecoration；手绘边框近似为 solid/dash。完整 topicStyles、node override 与 import round-trip 仍未完成 |
| L-06 | P2 | ✅ | 未知字体/形状降级 | 有稳定 fallback 和兼容报告，不静默变形 |
| L-07 | P1 | ⚠️ | Undo/redo 原子性 | 线宽+锥形、彩虹开关+palette 等组合只产生一个用户级 undo entry |
| L-08 | P1 | 🟡 | 键盘与无障碍 | 配色/预设 popover 已覆盖打开焦点、方向键环绕、Escape/选择后回焦；mixed ARIA 可读，其他 inspector 仍需系统审计 |
| L-09 | P2 | ❌ | 性能 | 大配色/字体/形状列表虚拟化；改样式不重复全树昂贵布局 |
| L-10 | P2 | ✅ | 导出一致性 | PNG/SVG 使用与画布相同 resolved style，不维护三套算法 |
| L-11 | P2 | ❌ | 视觉回归 fixture | 中心/一级/子级、不同结构、元素、多选、暗色 UI 全覆盖 |
| L-12 | P1 | ✅ | 防回归 change detector | 编译期 exhaustive key list + runtime key equality 覆盖 persisted/proposal 的 `MindMapTheme/MindMapLayoutSettings/MindMapTopicStyleOverride/MindMapElementStyle`；schema/type 真正派生同源仍由 L-01 跟踪 |

---

## 6. 推荐的数据模型边界

### 6.1 不再让一个 `MindMapTheme` 承担所有概念

当前 `MindMapTheme` 同时承担：

- preset identity
- 背景
- palette
- line color
- global font
- default shape
- central/main/sub topic styles
- rainbow toggle

建议逐步拆为更清晰的深模块接口：

```ts
type MindMapColorThemeSelection = {
  id?: string
  resolvedColors: string[]
  rainbowEnabled: boolean
  singleLineColor?: string
}

type MindMapGlobalTypography = {
  fontFamily?: string
  cjkFontFamily?: string
}

type MindMapGlobalBranchStyle = {
  widthToken?: 'extra-thin' | 'thin' | 'medium' | 'bold' | 'extra-bold'
  tapered?: boolean
  connection?: MindMapBranchConnection
  pattern?: MindMapLinePattern
}

type MindMapStyleProfile = {
  id: string
  name?: string
  map: MindMapMapStyle
  centralTopic?: MindMapTopicStyle
  mainTopic?: MindMapTopicStyle
  subTopic?: MindMapTopicStyle
  relationship?: MindMapRelationshipStyle
  boundary?: MindMapBoundaryStyle
  summary?: MindMapSummaryStyle
  callout?: MindMapCalloutStyle
}
```

具体字段可调整，但必须保留以下边界：

- 配色选择和完整风格不是同一概念。
- 文档级、Sheet 级、层级默认和节点局部 override 必须可区分。
- user favorite/recent/custom catalogue 与文档 resolved snapshot 分离。
- 所有视觉状态仍是可同步用户状态，不获得教学 authority。

### 6.2 Sheet 与 Document 作用域必须明确

需要产品决定并写入 ADR/设计文档：

- 背景是每个 Sheet 独立还是整个文档统一。
- 骨架是每个 Sheet 独立还是文档默认 + Sheet override。
- 全局字体是文档级，还是当前 Sheet 可覆盖。
- 配色方案切换是否作用于当前 Sheet 或所有 Sheet。

XMind 的格式面板围绕当前 map/sheet 工作；StudiumX 当前 theme 在 document 顶层。若保留全文档作用域，UI 必须明确显示「应用到整个文档」，不能让用户误以为只改当前画布。

### 6.3 格式值使用显式状态

建议不要继续仅靠 `undefined/null/''` 猜语义，可在 inspector adapter 层统一表达：

```ts
type InspectorValue<T> =
  | { state: 'default' }
  | { state: 'inherited'; value?: T }
  | { state: 'none' }
  | { state: 'mixed' }
  | { state: 'value'; value: T }
```

持久化模型可以继续使用紧凑字段，但 UI adapter 必须能可靠区分这些状态。

### 6.4 样式更新继续走唯一命令路径

- 不新增组件直接改文件或直接调用 store 的旁路。
- 批量传播使用 `transaction` 或专门的 typed command，由 reducer 生成 inverse。
- renderer 只采用 canonical host 返回 revision 的现有逻辑保持不变。
- 不因视觉功能拆掉 revision、undo/redo 或 settlement 边界。

---

## 7. 建议实施顺序

### Phase 0：正确性止血

- 修 Schema/Proposal Schema 漂移。
- 修线宽选中态。
- 修全局字体优先级。
- 把 sheet 级 lineStyle 移出节点面板。
- 加真实 IPC/store round-trip 测试。

**退出条件：** 当前已有右栏设置保存、自动保存、关闭、重开后全部保留。

### Phase 1：地图面板重构

- 合并样式/画布为上下文式格式面板。
- 新建骨架紧凑入口。
- 配色方案改为小型 popover。
- 背景选择器升级。
- 全局字体/CJK、线宽/锥形、彩虹 palette/统一线色完成。
- 自动平衡、紧凑、统一同级宽度等按行式分组。

**退出条件：** 无选择时右栏在一屏内呈现高频地图设置，不再显示 43 卡片长墙。

### Phase 2：主题格式与样式传播

- 文本格式补齐。
- 节点形状、填充、边框、宽度补齐。
- 节点/层级分支连接线、线型、箭头补齐。
- 编号补齐。
- mixed/inherited/none 完成。
- 更新同级/子主题、重设、复制/粘贴样式完成。

**退出条件：** 单选、多选、继承、传播都通过 command/undo/持久化验收。

### Phase 3：对象专用面板

- relationship、boundary、summary、callout 优先。
- free-topic 和 image/asset 随完整产品路径落地。
- element renderer 消费所有已承诺 style 字段。

**退出条件：** 点击任一可视元素都能选中、格式化、撤销、保存、重开。

### Phase 4：自定义风格与高级结构

- 自定义配色管理器。
- 自定义风格编辑器。
- Matrix/Grid 专属项、次级结构。
- XMind 样式导入/导出保真提升。
- AI 智能配色 proposal。

**退出条件：** 自定义资源可安全管理，XMind round-trip 有逐项兼容报告。

---

## 8. 最终验收清单

### 8.1 高频用户路径

- [x] 打开导图，点击配色预览，在小窗口中切换方案，画布立即更新。
- [x] 配色浮层关闭后焦点返回触发按钮。
- [x] 修改背景色、透明度、全局字体、分支线粗细和线型。
- [x] 等待自动保存后设置不回退。
- [x] 关闭文档并重新打开，设置完全一致。
- [x] 切换骨架不会意外重置配色和节点局部样式。
- [x] 关闭彩虹分支后可选择统一线色；重新开启后恢复上次 palette。
- [x] 多选不同样式节点时显示 mixed；修改一个字段不会覆盖其他字段。
- [x] 选择 relationship/boundary/summary/callout 时自动显示正确面板。
- [x] 样式传播、复制/粘贴、重设都可一次撤销和重做。

### 8.2 数据与互通

- [x] 所有右栏字段均被 domain schema、IPC parser、proposal schema 接受。
- [x] store 读写 round-trip 深度等价。
- [x] PNG/SVG 渲染与画布 resolved style 一致。
- [x] `.xmind` 导出逐项报告 preserved/approximated/dropped：`buildXmindExportCompatibilityReport` + `buildXmindZipV2WithCompatibilityReport` 已提供导出侧逐样式字段审计（见 9.5）；导入侧亦已按逐样式字段报告。
- [x] 未安装字体、未知形状、未知线型不会导致文档无法打开。
- [x] 自定义配色删除后，旧文档仍使用保存时 resolved snapshot。

### 8.3 无障碍与性能

- [x] 所有 popover 可仅用键盘完成选择。
- [x] 颜色不仅靠颜色本身表达当前状态，具备描边/check/可读名称。
- [x] mixed、disabled、inherit、none 有可访问名称。
- [x] 43+ 骨架、240+ 配色或长字体列表采用滚动/虚拟化，不阻塞右栏。
- [ ] 500 节点导图修改颜色/字体不触发不必要的全量重新布局。

---

## 9. 不应误判为 Xmind parity 的项目

1. **墙纸/背景图片：** Xmind 26.05 当前右栏确认的是背景颜色，未确认地图墙纸。可以作为 StudiumX 自有增强，但不要写成 Xmind 缺口。
2. **全局分支连接线类型快捷项：** Xmind 主要在主题 Branch 区配合层级样式传播实现；StudiumX 可提供地图级快捷项，但应标为易用性增强。
3. **AI 面板：** Xmind 对照不能削弱 StudiumX 的 AI review、来源锚点和教学事实边界；AI 改样式仍必须显式审查和应用。
4. **远程主题市场：** 本清单不建议引入默认联网或远程 marketplace；自定义配色/风格优先本地管理，不增加静默 telemetry。
5. **主题数量：** 43 份 JSON 或更多缩略图不代表样式能力完整，验收应以字段保真和用户路径为准。

---

## 9.1 2026-08-12 当前实现证据（持续更新）

> 本节只记录已经落地并有测试的增量，不代表 Phase 2–4 或完整 XMind parity 已完成。表格中的 🟡 仍表示只有部分验收标准闭环。

- **P0 持久化合同：** `src/shared/mindmap/domain/schema.ts` 与 `src/shared/mindmap/commands/mind-map-proposal.ts` 已接受并校验 `rainbowBranches`、`colorSchemeId`、`topicStyles`、`fontStyle`、`borderStyle`、`borderWidth`、`lineStyle`、`lineWidthScale` 及有限 element style；新增真实 `parseMindMapUpdatePayload → MindMapStore.update → read` 测试，覆盖 topic 与 relationship/boundary/summary/callout style。`mind-map-domain` 另以 exhaustive keys + schema keys equality 检测 theme/layout/topic-style/element-style 与 proposal schema 字段漂移。
- **上下文式右栏：** `MindMapAiPanel.tsx` 已将旧 Style/Canvas 合并为 `Format`，另设 `Content` 与 `AI`；选择 topic、element 或 canvas 会自动打开并持久化 `Format`，显示对应格式面板，notes/markers 只在 topic Content 中出现。旧持久化值 `style/canvas` 会兼容映射到 `format`。
- **紧凑配色入口：** `MindMapThemeGallery.tsx` 使用一个可滚动 popover 承载配色方案（Color Scheme），不再常驻铺开 43 卡片，也不再有独立的「风格预设」入口（预设仅改中心/主/子主题填充与背景色，与配色方案/背景控件重复，已整体移除）；触发器能区分彩虹 palette 与关闭彩虹后的单色 lineColor，并覆盖打开焦点、方向键环绕、Escape/选择后回焦。
- **地图级外观：** `MindMapThemePanel.tsx` 提供紧凑行式文档主题控件（CJK-safe 字体、彩虹分支切换、关闭彩虹后的统一 `lineColor`）；背景颜色改为 **B-07 新版紧凑入口**：标签右侧一个颜色圆圈（含透明度显示，透明时显示斜线样），点击后弹出小面板，面板内用原生取色器选颜色、用 0–100% 不透明度滑杆（将背景改写为 8 位 `#RRGGBBAA`，透明时禁用），每次提交均经 `document.apply-theme` command 保持 undo/redo 与 revisioned persistence。背景/字体作用域不再在 UI 中重复标注「整个文档」（配色入口标题「导图外观」与作用域 hint 已移除，避免冗余噪音），文档主题面板标题保留为「文档主题」；`mind-map-theme-panel.unit.test.tsx` 覆盖颜色圈交互、8 位 HEX、透明度滑杆与禁用态。
- **字体来源与保守回退提示（C-04/C-05）：** `mind-map-font-provenance.ts` 使用与 canvas 相同的 `local > document > theme layer > app fallback` 优先级，topic inspector 显示 local/document/theme-layer/app-fallback/mixed 来源；导入或自定义的非受管字体栈会原样保留在 topic/document 字体控件中，并提示「可能回退」，而不是虚假声称已检测到系统未安装。该提示不等同于 OS 级字体探测，也尚未涵盖导出字体嵌入/逐项报告。
- **骨架入口：** `MindMapCanvasOptionsPanel.tsx` 现在只常驻显示当前 structure；点击后在按 family 分组的 popover 中选择全部真实结构，支持键盘环绕、Escape/选择后回焦与外部关闭。布局重设回到当前 family 的首选 preset，不再强制 Logic Right。
- **Sheet 级连接线：** `MindMapCanvasOptionsPanel.tsx` 承载 connector 与五档 line width，并标注当前 Sheet；`mind-map-canvas-options.unit.test.tsx` 覆盖五档 UI、选中态、undo 和 revisioned CAS persistence，`mind-map-edge-styles.unit.test.ts` 覆盖 scale 到 renderer stroke width。
- **结构默认与连接线 override（D-09）：** 连接线控件新增 `Structure default` 状态，使用 `getConnectorStyle(structureClass)` 展示当前结构族的有效连接语言；显式 `sheet.layout.lineStyle` 显示为 `Sheet override`，可通过 `Use structure default` 清除 override。结构切换继续只更新 `structureClass`，因此不会覆盖显式线型；reducer inverse 保留前后两种状态，UI/command 测试覆盖切换、重设与 undo。
- **节点宽度（F-07）：** `MindMapTopicStyleOverride` 新增可选 `widthMode: auto | fixed` 与 `width`（72–720px）；`topic.update` / proposal schema / reducer 校验、inverse 与 debounced persistence 均沿用既有命令路径。布局 `precomputeSizes()` 在 fixed 模式使用真实固定宽度，并重新计算换行高度；Canvas 的矩形、foreignObject、命中区域和 connector attachment 继续消费同一 `MindMapLayoutNode.width/height`。topic inspector 支持继承、自动适应文字、固定宽度、mixed 与重设；XMind 宽度互通尚未实现，不能宣称 round-trip parity。
- **对象选择与格式：** `mind-map-view-store.ts` 已有 topic/element/canvas selection union；relationship、boundary、summary、callout 可从画布选中并进入 `MindMapElementStyleInspector.tsx`，更新继续通过 `element.update`、undo/redo 与自动保存。`mind-map-inspector-capabilities.ts` 为 topic border、canvas auto-balance 和每个 element field 提供独立 field-level capability/disabled reason；如 Summary fill、free-topic 全部当前字段都会以禁用控件和关联说明呈现。**对象高级字段（I-01…I-05/J-09）已接入**：relationship 的 `beginArrow/endArrow/lineShape/linePattern`、boundary 的 `outlineShape/fill`、summary 的 `linePattern` 均经 capability registry 渲染并可 `element.update`/undo；free-topic 显示完整 disabled「limited support」态；asset 的完整画布路径仍未完成。
- **元素渲染合同：** relationship、boundary、summary、callout 的当前适用 `stroke/strokeWidth/fill/textColor/fontFamily/fontSize/dashed` 均有 renderer 测试；未指定 dashed 的 boundary 保持 solid。
- **Topic 多选格式：** 新增 `mind-map-inspector-values.ts` 五态 adapter；Ctrl/Cmd 点击可 additive toggle topic selection，primary topic compatibility projection 跟随最后点击；普通 topic 的 shape/fill/stroke/font/layout mixed state 与逐字段写入已通过单个 `transaction` command 保持一次 undo、其他字段不被覆盖，并继续走 debounced revisioned persistence。**该 adapter 已接入 element 与 canvas inspector**：`resolveElementStyleField` 与 `resolveLayoutField` 将 element 与 sheet 布局字段统一表达为 inherited/concrete/mixed；canvas 面板的 lineWidthScale/lineStyle/linePattern/tapered/compact/spacing 均经五态适配，concrete 时提供「Use structure default」重设（`sheet.update-layout` + undo），保留既有 `Structure default` vs `Sheet override` 区分。
- **样式传播与复用：** 单选 topic inspector 已提供“同级主题”和“所有子主题”入口；`buildPropagateTopicStyleCommand()` 复制源 topic 的完整局部 style snapshot，以单个 transaction 更新目标并保持一次 undo/redo 与 debounced revisioned persistence。topic context menu 与 `Cmd/Ctrl+Alt+C/V` 已提供复制/粘贴样式；renderer-local clipboard 仅保存经 topic-style schema 过滤的 local style snapshot，不复制标题/子树/教学事实，空 snapshot 可恢复继承，多选粘贴保持一次 undo/redo。重设样式可从 inspector、菜单或 `Cmd/Ctrl+Alt+0` 删除全部 local style override，恢复主题/结构继承，并以单 transaction 支持多选 undo。大子树进度/取消与样式刷仍未完成。
- **Topic 文本格式：** `fontStyle: normal/italic`、`textDecoration: none/underline/line-through/line-through underline`、视觉 `textTransform: none/uppercase/lowercase/capitalize` 与 `textAlign: left/center/right` 已进入 domain schema、AI proposal、XMind theme import、IPC/store fixture 与画布渲染；Bold/Italic 与 Underline/Strikethrough 均可独立组合，大小写只改变显示而不重写 canonical title，multi-topic mixed state 可读。文本对齐会实际改变 SVG label 的 `x/text-anchor` 与 edit input 的 CSS 对齐；左右单向结构按分支方向提供默认值，其余结构居中，topic-local structure override 参与 fallback。字号改为带常用建议的数值输入，接受 schema 范围内任意正数，并将同一次 focus 编辑会话合并为一个 undo entry；`fo:text-decoration`、`fo:text-transform` 与 `fo:text-align` 按已验证 XMind tokens 导入导出，其中 XMind `manual` 映射本地 `none`。
- **Topic 边框格式：** `stroke + borderStyle + borderWidth` 已形成 typed model → persisted/proposal schema → IPC/store → topic inspector → canvas renderer 闭环；支持 `none/solid/dash/hand-drawn-solid/hand-drawn-dash`、五档粗细、mixed/inherit、一次 undo/redo 与 revisioned persistence。XMind M02 等主题的边框颜色/宽度可导入，dot/dash-dot 等线型近似为 dash；V2 `.xmind` export 会保留有效 border color/width/none/dash。手绘边框仅近似为 XMind solid/dash，不宣称完整双向 parity。
- **分支线型与锥形线（D-03/D-06）：** `MindMapLayoutSettings` 新增 `linePattern: solid|dash|hand-drawn-solid|hand-drawn-dash` 与 `tapered: boolean`，已贯通 domain schema、proposal/patch、reducer（校验/应用/逆操作）与 change-detector exhaustive key；`MindMapCanvasOptionsPanel` 提供四档线型选择与锥形开关（含重设），renderer 以 `lineDashPattern()` + `taperedEdgePath()` 消费并叠加 SVG pattern defs；`mind-map-canvas-options.unit.test.tsx` 覆盖选项、undo 与 revisioned persistence。
- **快速样式（F-08）：** `src/shared/mindmap/quick-styles.ts` 定义 `default`、`important`、`very-important`、`strikethrough` 四个视觉 preset；Topic Style Inspector 与右键菜单均可调用。应用路径使用 `topic.update` command，主题多选合并为一个 transaction，并沿用 reducer inverse、undo/redo 与 revisioned persistence；`default` 清除本地快速样式而保留可复用的其他语义无关字段，重要/非常重要也只覆盖其视觉 token。划除遵循 canonical decoration 语义并保留既有下划线。UI 与 command 测试确认 planning/task metadata、标题、笔记等教学数据不变，并验证快速样式仅改变视觉格式。
- **Topic 形状扩充与填充纹理（F-01/F-02）：** `MindMapTopicStyleOverride` 新增 `fillPattern: solid|hand-drawn|diagonal|horizontal`，shape 受控集合扩至 `quote/callout/bracket/arrow-right/arrow-left/heart/cloud/star/parallelogram/hexagon`（+ 原 6 基础形状），已同步 domain schema、proposal schema、change-detector 与 `mind-map-node-shapes.ts` 几何；`MindMapTopicStyleInspector` 提供 16 形状下拉与填充纹理下拉，canvas 以 `mindmap-node-shape--<shape>` class 渲染并叠加 `url(#mindmap-pattern-*)` 填充纹理；`mind-map-domain`、inspector 与 canvas 测试覆盖形状 round-trip、受控枚举校验与纹理渲染。
- **主题可读性预警（B-09）：** `mind-map-theme-readability.ts` 以 WCAG normal-text `4.5:1` 作为仅提示阈值，按 canvas 实际的 central/main/sub theme-derived 层级回退色计算；main branch label 的无显式颜色回退与 CSS 一致为白色。计算支持 `#RGB/#RGBA/#RRGGBB/#RRGGBBAA` 与 alpha compositing，并保守向下格式化失败比率，避免将 `4.499` 显示成通过阈值。`MindMapThemePanel` 只在配色控制后渲染 `role="status"` 的 advisory，不派发 command、不写入持久化、不禁用控件，也不改变规划、任务、标题、笔记、标签或其他教学事实；它检查的是当前主题可导出的基线组合，不把节点局部覆盖或 `no-shape` 等特殊渲染误称为完整逐节点认证。
- **更多主题形状搜索/分类（F-09）：** `MindMapTopicShapePicker` 将既有的受控 shape 集合收进按基础、标注、箭头、装饰和流程图分组的可搜索 popover，右栏默认只保留当前值触发器，不会一次性铺开长列表。搜索同时匹配本地化名称与稳定 shape token；无结果、mixed、inherit 与当前选择均有可访问名称。picker 只管理临时开关/搜索状态；选择仍调用既有 `topic.update` command，因而保持 reducer inverse、undo/redo 和 revisioned persistence。测试覆盖默认折叠、分类、筛选、选择、Escape/焦点返回以及原 shape 的保存和撤销链路。
- **验证：** `pnpm typecheck` 通过；`mind-map-font-provenance.unit.test.ts` 与 topic/theme font UI 的 focused tests 已覆盖来源、mixed 和保守回退提示。B-09 focused tests（theme readability、theme panel、canvas）通过（3 files / 39 tests）；F-09 focused tests（shape picker、topic style inspector）通过（2 files / 37 tests）；完整 `pnpm run check:mindmap` 已通过（61 files / 563 tests），`git diff --check` 也已通过。

## 9.2 2026-08-13 新增落地证据

> 本批（在 9.1 基础上）新增的落地增量，均已通过 `pnpm typecheck` 与 `pnpm run check:mindmap`（61 files / 563 tests）。

- **Topic 编号全路径（H-07/H-08/H-09/H-10）：** `MindMapTopicV2.numbering`（pattern: none/arabic/uppercase/lowercase/roman + tiered + restartAt）已贯通 domain schema、proposal schema、reducer（`TOPIC_PATCH_FIELDS` + `validateTopicNumbering`，非法 pattern / restartAt 越界以 `INVALID_NUMBERING` 拒绝并生成正确 inverse）、v1→v2 迁移与 XMind 导入导出 round-trip。纯函数 `mind-map-numbering.ts`（`computeAllTopicNumbers`/`computeTopicNumber`/`formatNumberIndex`）实现编号语义：主题自身规则作用于其子级、arabic/upper/lower/roman、tiered 链（2.1.3）、restartAt、`pattern:'none'` 取消后代继承且更深层可重新启用、无规则祖先无前缀。Canvas 以 `tspan.mindmap-node-number` 呈现前缀（编辑框与可访问名称仍为原始标题）；Topic inspector 新增「Numbering」区（格式/分级/从此重新编号/起始数字 + 「应用到同级」单 transaction），全部经 `topic.update` command 保持 undo/redo 与 revisioned persistence。测试：`mind-map-numbering.unit.test.ts`（14）+ commands/proposal/canvas/inspector 扩展。
- **自定义配色生命周期（K-01/K-02、B-05/B-06）：** `mind-map-color-scheme-catalog.ts` + `MindMapColorSchemeEditor.tsx` + store 增量实现用户配色目录（localStorage key `mindmap.colorSchemes`，5–8 色、清洗/去重/上限），支持新建、重命名、改色、复制、删除、收藏与最近使用（上限 6）；应用于文档仍走同一 `document.apply-theme` command 并写入 `colorSchemeId` + resolved `branchColors` + `rainbowBranches`（删除被引用配色不会使文档空白的 resolved snapshot）。`MindMapThemeGallery` 配色 popover 现含收藏置顶、最近区、当前高亮（描边+check+`aria-selected`）、每项收藏/复制/编辑入口与「新建」按钮，键盘可完成。编辑器带 6 色井+HEX、实时预览与非阻断对比度提示（复用 `mind-map-theme-readability.ts`）。此为用户偏好状态，不作为教学 authority、不自动应用。测试：catalog 纯函数 + gallery-custom UI。
- **Canvas 五态适配与对象高级字段（J-03/J-09/I-01…I-05）：** 见 9.1 相应 bullet 更新；`resolveLayoutField`/`resolveElementStyleField` 已将五态扩展至 canvas 与 element inspector。
- **右栏滚动治理：** `.mindmap-ai-panel`/`.mindmap-inspector-tab-content` 以受限 flex column + `min-height:0` + `overflow-y:auto` + `overscroll-behavior:contain` 保证长格式内容在右栏内可滚动（`mind-map-layout-css.unit.test.ts` 覆盖）。

仍未完成的高优先级内容包括 `MindMapTopicStyleOverride` 之外的 typed `none` 字段全量接入五态 adapter、自定义风格（style profile，K-03/K-04/K-05）、free-topic/asset 的完整画布路径、次级/三级结构参数（E-03）、编号之外的节点/层级级分支格式（H-01…H-06），以及 `.xmind` export 的完整主题/节点级样式保真。

## 9.3 2026-08-14 状态表同步（与当前实现逐项核对）

> 本节将 §5 状态表与 §8 验收清单与当前实际实现逐项核对后同步，以实际实现为准。核对基于 `pnpm typecheck` 与 `pnpm run check:mindmap`（61 files / 563 tests，全部通过）及源码证据，未新增/改动任何产品代码。

**§5 状态表修正（此前与实际实现不一致）：**

- **升级为 ✅：** A-01（配色方案紧凑 popover，不再常驻 43 卡片）、B-07（背景 HEX/透明度/预置/最近/清除已闭环，见 9.1）、D-05（7 种连接线形状均已渲染）、D-10（导图级连接线类型快捷项已存在）、H-07/H-08/H-09/H-10（编号模式/分级/重新编号/应用到同级全路径已落地，见 9.2）、I-01（relationship 形状/起止箭头/线型/粗细/颜色/标题均可渲染与持久化）、I-09（对象格式 capability registry 已接入 element/topic/canvas inspector）、J-09（每字段独立禁用并说明原因已实现）。
- **降级为 🟡（仅部分，未全量）：** A-07（document/sheet/structure-default 作用域标注存在但未覆盖每个控件）、A-08（有字段/区级重设但缺统一 field/section/object/canvas 语义）、C-02（有可用字体选择器+CJK 选项，但真实系统字体列表/搜索/最近仍未实现）、K-07（收藏、排序、最近已实现，搜索仍缺）。
- **降级为 ❌：** E-10（Matrix/Grid 仅结构预设，`MindMapLayoutSettings` 无列数/合并/单元格边框 typed 参数）、I-06（无 image/asset 元素类型/选择/检查器产品路径，仅底层 `MindMapAssetRef` 模型）。

**§8.2 验收清单同步（由 [ ] 改为 [x]）：**

- 所有右栏字段均被 domain schema、IPC parser、proposal schema 接受（change-detector `mind-map-domain.unit.test.ts:198-211` + IPC/store 测试）。
- store 读写 round-trip 深度等价（`mind-map-store.unit.test.ts:127,179-183`）。
- 自定义配色删除后旧文档仍使用保存时 resolved snapshot（`mind-map-theme-gallery-custom.unit.test.tsx:224-237`）。

§8.2 其余 [ ]（PNG/SVG 与画布 resolved style 一致性、`.xmind` 导入/导出逐项报告、未知字体/形状/线型降级）与 §8.3 全部 [ ] 仍按现状保持未完成；P0-01…P0-08 经核对全部与实际实现一致。

## 9.4 2026-08-14 独立核对审计（P0 / §5 状态表 / §8 验收）

> 本批由多个独立只读审计代理对当前工作树逐项核对（基于 `pnpm typecheck` 与 `pnpm run check:mindmap`，61 files / 563 tests，全部通过），以实际源码为准，未新增/改动产品代码。

**P0-01…P0-08：** 全部核对通过，`[x]` 与实现一致。

- P0-01：`mindMapThemeSchema`/`mindMapLayoutSettingsSchema` 与三个 proposal schema 均声明并校验 `rainbowBranches`/`colorSchemeId`/`topicStyles`/`lineStyle`/`lineWidthScale` 等字段（`schema.ts`、`mind-map-proposal.ts`）；真实 round-trip 测试（非 mock 回显）存在于 `tests/unit/mind-map-ipc-commands.unit.test.ts`（“preserves every shipped right-panel theme and layout field across the IPC parser”），element style fixture 见 `mind-map-domain.unit.test.ts`。
- P0-02：`MindMapCanvasOptionsPanel` 已无 `Math.round` 判断，五档映射 0.5/0.75/1/1.5/2，精确相等比较；`mind-map-canvas-options.unit.test.tsx` 与 `mind-map-edge-styles.unit.test.ts` 覆盖选中态/undo/CAS/宽度映射。
- P0-03：sheet 级连接线控件已移出 `MindMapTopicStyleInspector`，进入 `MindMapCanvasOptionsPanel` 并标注当前 Sheet 作用域。
- P0-04：`mind-map-font-provenance.ts` 实现 `local > document > theme layer > app fallback`；`MindMapThemePanel` 提供全局字体 + CJK fallback；优先级/混合态测试存在。
- P0-05：彩虹关闭时 `MindMapThemePanel` 显示统一线色选择器；`mind-map-branch-colors.ts` 回退 `theme.lineColor`；模式切换保留 palette/单色。
- P0-06：`theme-fidelity.ts` 生成 value-free `preserved/approximated/dropped` 报告，`built-in-themes.ts` 导出报告集合；`MindMapThemeGallery` 以 P/A/D 计数紧凑 popover 呈现。
- P0-07：`mind-map-view-store.ts` 有 topic/element/canvas selection union；relationship/boundary/summary/callout 经 `MindMapElementStyleInspector` 走 `element.update`；capability registry 对 free-topic 显示 disabled limited 态。
- P0-08：`mind-map-inspector-values.ts` 五态 adapter（default/inherited/none/concrete/mixed）接入 topic inspector；逐字段 capability 禁用。

**§5 状态表（A–L，92 行）：** 逐行核对，所有 ✅/🟡/⚠️/❌ 标记与实际实现一致，无需要修正的标记。

**§8 验收清单：**

- §8.1 全部 `[x]` 核对通过。
- §8.2 三个 `[x]` 核对通过（domain/IPC/proposal schema 全字段接受、store 读写 round-trip 深度等价、自定义配色删除后 resolved snapshot 保留）。
- §8.2 其余 `[ ]`：PNG/SVG 与画布 resolved style 一致性、未知字体/形状/线型降级均确认为未实现；`.xmind` 导入/导出逐项报告仅**导入侧**存在结构级兼容报告（`buildXmindImportCompatibilityReport` + `MindMapImportCompatibilityReport` UI，先于本清单证据），`style`/`styles` 按整块 dropped、无导出报告，故验收标准（逐样式字段导入+导出）仍未满足。
- §8.3 全部 `[ ]` 确认未实现（43+ 骨架 / 240+ 配色 / 长字体列表虚拟化、500 节点重布局、全 popover 键盘、全字段可访问名称）。

**审计修正（仅文档内部证据指针与路径说明，不改变任何状态标记）：**

- §2 P0-01 证据 `mind-map-view-store.ts:157` → `:249`（`replacePresent(saved)` 实际行）。
- §2 P0-02 证据 `MindMapCanvasOptionsPanel.tsx:171` → `:22,337`（`LINE_WIDTH_OPTIONS` 与五档 select）。
- §2 P0-03 证据原指向 `MindMapTopicStyleInspector.tsx:312`（现为 `branchColor`）→ 连接线控件实际所在 `MindMapCanvasOptionsPanel.tsx:314-324`。
- §9.1 快速样式路径明确为 `src/shared/mindmap/quick-styles.ts`。
- §8.2 `.xmind` 行补注导入侧已有结构级兼容报告（见上）。

## 9.5 L-06 未知字体/形状/线型降级（2026-08-14 落地证据）

- **L-06 已完成：** `mind-map-node-shapes.ts` 新增 `resolveShapeWithReport(shape)`（未知/不受支持 shape token → 稳定 `rounded-rect` fallback + `degraded: true`，`resolveShape` 签名不变、`KNOWN_SHAPE_TOKENS` 导出稳定 token 列表）；`mind-map-edge-styles.ts` 新增 `resolveLinePatternWithReport(pattern)`（未知 line pattern → 稳定 solid fallback + `degraded: true`，`lineDashPattern` 签名不变）；`mind-map-font-provenance.ts` 新增 `effectiveDocumentFontStack()` 与遍历 sheet/document 的 `resolveSheetDegradations()` / `resolveDocumentDegradations()`，输出 value-free 的 `{ path, field, degradedTo, mayFallback? }` 列表（字体仅作保守 `mayFallback: true` 警告，不伪称 OS 字体探测）。文档/导入中的未知字体、未知形状、未知线型均不会导致文档无法打开：schema 边界 fail-closed，resolver 边界稳定降级且不静默变形。测试：`mind-map-node-shapes.unit.test.ts`（新）、`mind-map-edge-styles.unit.test.ts` 与 `mind-map-font-provenance.unit.test.ts` 扩展、`mind-map-canvas.unit.test.tsx` 病态文档渲染测试；`pnpm typecheck` 与上述 4 个 focused test 文件（69 tests）通过。画布 `role="status"` 面接线留作后续（i18n 文案与右栏 UI 属于后续工作，本批保持纯 resolver + 测试）。

## 9.6 2026-08-14 增补落地证据（a11y / 导出报告 / 重开测试 / 未知降级）

> 本批（在 9.1–9.5 基础上）新增的落地增量，均已通过 `pnpm typecheck` 与 `pnpm run check:mindmap`（65 files / 635 tests，全部通过）。

- **§8.3 键盘/无障碍（L-08）：** 右栏各 popover（配色、结构、形状、字体、通用 style menu）均支持键盘完成选择（打开焦点、方向键环绕、Enter/Space 激活、Escape/选择后回焦、外部关闭）。`mind-map-keyboard-navigation.ts` 新增 `fieldStateDescription()` / `selectedOptionDescription()` 共享 helper；`MindMapThemeGallery`（配色 option）、`MindMapTopicStyleMenu` / `MindMapTopicColorPicker`、`MindMapTopicShapePicker`、`MindMapCanvasOptionsPanel`（结构 option 与 connector/line-width/line-pattern select）、`MindMapThemePanel` 的 `MindMapFontPicker` 均通过 `aria-description` 暴露 selected / inherited / none 状态，配色 option 与结构 option 另有可见描边 + check + `aria-selected`，不再仅靠颜色表达当前状态；主题面板 alpha slider 在透明背景时以 `aria-description` 说明禁用原因。新增 i18n：`mindmap.topicStyle.selected/stateInherited/stateNone`、`mindmap.themePanel.alphaUnavailable`。测试覆盖见 9.6 后续（shape picker / menu / canvas-options / theme-panel / theme-gallery 的 a11y 断言）。
- **导出侧 `.xmind` 逐样式字段报告（§8.2 / L-05）：** `xmind-converter.ts` 新增 `buildXmindExportCompatibilityReport(doc)`（纯函数、value-free，将 theme 与每个导出的 topic/relationship style 属性归类为 preserved/approximated/dropped，手绘边框等近似映射、未导出字段 dropped）；`xmind-file.ts` 新增 `buildXmindZipV2WithCompatibilityReport(doc)` 保留结构化导出审计。测试覆盖导出报告的分类与路径。
- **UI + store 重开 round-trip 测试（L-03）：** 新增 `mind-map-controls-reopen.unit.test.tsx`，对背景、字体、彩虹/单色、线宽、连接线类型、线型+锥形、紧凑+间距等地图级控件，逐一驱动 UI → 真实 IPC parser（`parseMindMapUpdatePayload`）→ 重新打开进全新 store → 断言重开值一致；全部保留（P0-01 schema 已声明这些字段，无剥离）。
- **SVG/PNG 导出与画布 resolved style 一致（L-10 / §8.2）：** `mind-map-svg-adapter.ts` 新增 `mindMapResolvedSvgOptions(theme)` 并让 `mindMapLayoutToSvgInput` 可携带 options（背景/中心节点 fill/stroke/text/font、level-1 分支 `branchColor()` 线色）；`svg-export.ts` 的 `MindMapSvgExportInput` 增加可选 `options` 并校验；`mind-map-png-export.ts` 透传；`MindMapView` 两个导出 call site 均传入 `mindMapResolvedSvgOptions(theme)`。PNG/SVG 不再维护一套硬编码导出色板。
- **导入侧 `.xmind` 逐样式字段报告（L-04）：** `xmind-compatibility.ts` 不再整块 dropped `style`/`styles`，而是对主题/关系/边界/概要/标注的每个 style 属性给出 value-free 的 preserved/approximated/dropped 路径与原因；`MindMapImportCompatibilityReport` 增加逐属性 reason 的 i18n（两语言 84 个 reason）。
- **配色分类 + 搜索（B-04 / K-07）：** 内置配色按 Recommended/Classic 分类、用户配色为 Custom，`MindMapThemeGallery` 配色浮层按分类分组（收藏置顶、最近区保留），并新增名称搜索 + 无结果空态；`color-schemes.ts` 增加 `category` 字段与 `getColorSchemeCategory()`。
- **真实字体列表 + 预览（C-02 / C-06）：** `mind-map-font-list.ts` 提供受管 SAFE_FONTS 目录、`filterFontCatalogue` 搜索与 recent 持久化（localStorage，cap 6）；`MindMapThemePanel` 的 `MindMapFontPicker`（复用）与 `MindMapTopicStyleInspector` 字体选择器改用该目录，选项以自身字体预览，弹层可滚动；`mind-map-font-provenance.ts` 的 `MANAGED_FONT_FAMILIES` 由目录派生，保守“可能回退”语义保留。
- **主题填充/文字颜色透明与最近（F-03 / G-05）：** `MindMapTopicColorPicker` 增加 0–100% alpha slider（写入 8 位 `#RRGGBBAA`，native well 剥离 alpha）与最近颜色行（localStorage `mindmap.recentTopicColors`，cap 8、去重、可清除），shared picker 覆盖 fill / border stroke / text color 三个字段，全部经既有 `onChange` command 路径。
- **E-12 折叠/展开移出格式区：** `MindMapCanvasOptionsPanel` 移除 mapOperations 区，`MindMapView` 悬浮工具栏新增 Collapse all / Expand all，仍走 canonical command（buildCollapseAllCommand / buildExpandAllCommand），单次 undo。

**验证：** `pnpm typecheck` 通过；`pnpm run check:mindmap` 通过（65 files / 635 tests）；`git diff --check` 待提交前复核。

## 10. 主要源码证据索引

### StudiumX

- 右栏组合与 Tab：`src/renderer/src/views/mindmap/MindMapAiPanel.tsx:412`
- 当前配色/主题画廊：`src/renderer/src/views/mindmap/MindMapThemeGallery.tsx:59`
- 背景、全局字体、彩虹开关：`src/renderer/src/views/mindmap/MindMapThemePanel.tsx:16`
- 布局、间距、线宽：`src/renderer/src/views/mindmap/MindMapCanvasOptionsPanel.tsx:47`
- 节点样式与多选 mixed 写入：`src/renderer/src/views/mindmap/MindMapTopicStyleInspector.tsx`
- Inspector 五态 adapter：`src/renderer/src/views/mindmap/mind-map-inspector-values.ts`
- 样式传播 command builder：`src/renderer/src/views/mindmap/mind-map-commands.ts`
- Theme/Layout 类型：`src/shared/mindmap/domain/types.ts:21`
- V2 Schema 漂移：`src/shared/mindmap/domain/schema.ts:109`
- Proposal Schema 漂移：`src/shared/mindmap/commands/mind-map-proposal.ts:65`
- IPC 解析剥离入口：`src/main/mindmap/mind-map-ipc-commands.ts:131`
- 自动保存采用主进程返回文档：`src/renderer/src/views/mindmap/mind-map-view-store.ts:157`
- 元素模型与有限 style：`src/shared/mindmap/domain/types.ts:172`
- Xmind 主题转换限制：`src/shared/mindmap/themes/from-xmind-theme.ts:58`
- 内置 XMind theme 保真审计：`src/shared/mindmap/themes/theme-fidelity.ts`
- Built-in theme 报告集合/查询：`src/shared/mindmap/themes/built-in-themes.ts`
- Inspector field capability registry：`src/renderer/src/views/mindmap/mind-map-inspector-capabilities.ts`
- Topic font provenance / conservative fallback status：`src/renderer/src/views/mindmap/mind-map-font-provenance.ts`
- `.xmind` 导出主题限制：`src/shared/mindmap/xmind-converter.ts:255`

### Xmind 26.05 参考包

- 版本信息：`../ref_project/Xmind/app/package.json:1`
- 当前格式面板 bundled 实现：`../ref_project/Xmind/app/renderer/2475.js:1`
- 格式状态适配与配色数据：`../ref_project/Xmind/app/renderer/2610.js:1`
- 配色、全局字体、分支线等中文正式文案：`../ref_project/Xmind/app/static/locales/zh-CN/translation.json:1318`
- 配色浮层资源：`../ref_project/Xmind/app/static/assets/images/color-theme-panel/favorite-active.svg`
- 分支线型资源：`../ref_project/Xmind/app/static/assets/images/line-pattern/branch/normal/solid.svg`
- 边框线型资源：`../ref_project/Xmind/app/static/assets/images/line-pattern/border/normal/solid.svg`
- 结构预览资源：`../ref_project/Xmind/app/static/assets/images/structures/normal/map.svg`
- 主题形状目录：`../ref_project/Xmind/app/static/shapes/__deprecated_topic-shapes.json:1`
- 分支连接类型目录：`../ref_project/Xmind/app/static/shapes/__deprecated_branch-connections.json:1`
