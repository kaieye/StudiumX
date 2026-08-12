# 思维导图右侧面板对照 Xmind 26.05 改进清单

> **状态：** 现状审计与产品改进清单（2026-08-12）  
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

- [ ] 补齐 `mindMapThemeSchema`、`mindMapLayoutSettingsSchema`。
- [ ] 同步补齐 `mindMapThemeProposalSchema`、`mindMapLayoutProposalSchema`、`mindMapSheetLayoutUpdatePatchProposalSchema`。
- [ ] 对新增枚举、数值范围和颜色值建立明确校验，不用无限制 `string` 代替稳定合同。
- [ ] 增加 renderer → IPC parser → store → read 的真实 round-trip 测试。
- [ ] fixture 必须覆盖所有右栏样式字段，确保保存、关闭、重开后等价。
- [ ] 若只增加向后兼容 optional 字段，可评估保持 schemaVersion 2；若按本文建议拆分视觉模型，则应新增 ADR 和迁移版本。

**证据：**

- `src/shared/mindmap/domain/types.ts:21`
- `src/shared/mindmap/domain/types.ts:74`
- `src/shared/mindmap/domain/schema.ts:109`
- `src/shared/mindmap/domain/schema.ts:143`
- `src/main/mindmap/mind-map-ipc-commands.ts:131`
- `src/renderer/src/views/mindmap/mind-map-view-store.ts:157`

### P0-02 分支线粗细选中态计算错误

当前判断：

```ts
Math.round(layout.lineWidthScale ?? 1) === option.value
```

这会导致：

- `0.75` 被 round 为 `1`，UI 会错误高亮「默认」而不是「细」。
- `1.5` 被 round 为 `2`，三个按钮都可能不高亮。

**必须改进：**

- [ ] 使用精确受控枚举或 epsilon 比较，不做整数 round。
- [ ] 将 display token 与真实 stroke width 解耦，例如 `extra-thin/thin/medium/bold/extra-bold`。
- [ ] 为每个档位增加 UI 选中态与 renderer strokeWidth 测试。

**证据：** `src/renderer/src/views/mindmap/MindMapCanvasOptionsPanel.tsx:171`

### P0-03 「节点分支样式」控件实际修改整个 Sheet

`MindMapTopicStyleInspector` 的「分支」区域看起来属于当前选中主题，但点击 curve/elbow/straight 实际 dispatch `sheet.update-layout`。

**问题：**

- 作用域与文案不一致，用户会误以为只修改当前主题。
- 只有进入「样式」Tab 并选中节点后才容易发现全局线型。
- 「画布」Tab 中反而没有分支线型控件。

**必须改进：**

- [ ] 在模型支持节点级 lineClass/linePattern 前，把当前控件移动到导图/画布级区域并明确标注「全局分支连接线」。
- [ ] 后续节点级分支格式应使用独立字段和独立命令，不能复用 sheet `lineStyle`。
- [ ] UI 必须展示作用域：当前主题、同级、子树、当前画布或整个文档。

**证据：** `src/renderer/src/views/mindmap/MindMapTopicStyleInspector.tsx:312`

### P0-04 当前「全局字体」对内置主题可能不真正全局

画布把 `theme.fontFamily` 写入 CSS 变量 `--mindmap-theme-font`，但节点渲染会优先把 `theme.topicStyles.central/main/sub.fontFamily` 作为 inline style 写到节点上。内置主题转换器通常会为三层 topicStyles 保留字体，因此用户切换「全局字体」后可能仍看到原主题字体。

**必须改进：**

- [ ] 明确字体层级：节点 override > 显式全局字体 > 层级主题默认 > app fallback，或提供「覆盖主题字体」开关。
- [ ] 导图级全局字体变更应影响所有未做节点级显式覆盖的主题。
- [ ] 增加中日韩字体 fallback，不要只提供 Serif/Monospace 粗粒度类别。
- [ ] 增加 built-in theme 下切换全局字体的渲染测试。

**证据：**

- `src/renderer/src/views/mindmap/MindMapThemePanel.tsx:71`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:634`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:850`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:999`

### P0-05 关闭彩虹分支后缺少统一线色产品入口

当前 `branchColor()` 在 `rainbowBranches === false` 时使用 `theme.lineColor ?? '#8E8E93'`，但右栏只有彩虹开关，没有统一分支线颜色选择器。

**必须改进：**

- [ ] 彩虹分支打开：显示颜色组预览与选择器。
- [ ] 彩虹分支关闭：显示统一分支线颜色选择器。
- [ ] 切换模式时保留上次 palette 和 single color，不破坏用户设置。
- [ ] 配色变化与开关变化采用一个原子 command/transaction，避免半更新。

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

- [ ] 将「主题 JSON 数量」与「主题保真等级」分开报告。
- [ ] 为每个主题生成 preserved/approximated/dropped 属性报告。
- [ ] 没有实现的属性不能只在缩略图中近似后静默丢失。
- [ ] 在 UI 上将这批预设定位为「骨架/风格预设」或内部兼容资源，不再作为主入口的大画廊。

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

- [ ] 建立统一 selection union：topic / relationship / boundary / summary / callout / free-topic / asset。
- [ ] 每种元素提供能力清单与独立 inspector，不适用字段明确隐藏或禁用。
- [ ] 所有已持久化 style 字段必须有 renderer 消费测试；不消费的字段应删除、延后或标记 unsupported，不能形成假合同。
- [ ] element update 继续走现有 command、undo/redo 和 revisioned persistence，不另开直接写 store 的旁路。

**证据：**

- `src/shared/mindmap/domain/types.ts:172`
- `src/shared/mindmap/domain/types.ts:233`
- `src/shared/mindmap/commands/mind-map-reducer.ts:386`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:703`
- `src/renderer/src/views/mindmap/MindMapCanvas.tsx:814`

### P0-08 缺少 mixed / inherited / none / default 的状态模型

当前控件普遍把空字符串或 `undefined` 同时用于「系统默认」「继承」「未设置」，且主 UI 使用单一 `selectedNodeId`。

**必须改进：**

- [ ] 建立格式值状态：`default`、`inherited`、`none`、`concrete`、`mixed`。
- [ ] 多选值不一致时显示 mixed，不得显示第一个节点的值。
- [ ] `none` 必须与 inherited 区分，例如「无边框」不是「继承父级边框」。
- [ ] 每个字段独立计算 capability 和 disabled，不能整面板一刀切。

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
| A-01 | P1 | ⚠️ | 将「主题画廊」主入口改为「配色方案」 | 右栏不再常驻 43 卡片；点击当前色条打开小浮层 |
| A-02 | P1 | 🟡 | 新增独立「骨架」入口 | 结构/骨架与配色可独立切换，互不覆盖 |
| A-03 | P1 | ❌ | 新增「自定义风格」入口 | 进入独立管理器，不在侧栏平铺全部属性 |
| A-04 | P1 | ⚠️ | 合并「样式/画布」为上下文式「格式」 | 点击画布、主题、元素时自动切换正确面板 |
| A-05 | P1 | ⚠️ | 将笔记/标记从纯样式属性中分离 | 格式区只放视觉与布局；内容属性有独立分组或 Tab |
| A-06 | P1 | ✅ | 保留 AI Tab | AI 不绕过 command/revision；不与格式状态混用 |
| A-07 | P2 | ❌ | 每个控件显示作用域 | 明确当前主题/同级/子树/当前 Sheet/全文档 |
| A-08 | P2 | ❌ | 统一「重设」语义 | 可区分重设当前字段、当前区、当前对象和当前画布 |

### B. 配色方案与背景

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| B-01 | P0 | ⚠️ | 修复配色字段持久化 | 保存和重开后 `colorSchemeId/branchColors/rainbowBranches` 不丢失 |
| B-02 | P1 | ⚠️ | 配色方案改为小浮层列表 | 右栏只显示当前配色预览，浮层可滚动 |
| B-03 | P1 | ✅ | 保留 palette 色条预览 | 缩略预览能区分单色、多色和彩虹方案 |
| B-04 | P2 | ❌ | 配色分类 | 至少推荐/经典/自定义；后续可增加智能配色 |
| B-05 | P2 | ❌ | 收藏与最近使用 | 收藏状态为用户状态，不成为教学 authority |
| B-06 | P2 | ❌ | 自定义配色完整生命周期 | 新建、编辑、复制、重命名、删除均可撤销或确认 |
| B-07 | P1 | ⚠️ | 升级背景颜色选择器 | 支持 HEX、透明度、预置色、最近颜色、清除/透明 |
| B-08 | P1 | ⚠️ | 明确背景作用域 | 决定是当前 Sheet 还是全文档，并在数据模型/UI 中一致表达 |
| B-09 | P2 | ❌ | 配色可读性检查 | 对低对比文字/节点组合给出非阻断预警 |
| B-10 | P3 | ❌ | AI 智能配色 proposal | 只生成可审查 proposal，不静默改图；应用仍走 command |
| B-11 | P4 | ❌ | 配色导入/导出 | 只处理静态颜色数据，不执行外部代码 |
| B-12 | P4 | ❌ | 背景图片/墙纸（StudiumX 增强） | 明确这是自有增强，不宣称 Xmind 26.05 parity；资源走 asset/path 安全边界 |

### C. 全局字体与文本继承

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| C-01 | P0 | ⚠️ | 修正全局字体优先级 | 内置主题下切换全局字体会影响所有未局部覆盖节点 |
| C-02 | P1 | ⚠️ | 提供真实字体列表 | 显示系统已安装/内置安全字体，支持搜索和最近使用 |
| C-03 | P1 | ❌ | 增加 CJK fallback 字体 | 中日韩与西文混排可独立选择 fallback |
| C-04 | P2 | ❌ | 字体缺失降级提示 | 导入 XMind 字体缺失时明确 fallback，不静默替换 |
| C-05 | P2 | ❌ | 全局字体与局部 override 指示 | 节点面板显示 inherited/global/local 状态 |
| C-06 | P2 | ❌ | 字体预览 | 下拉项使用自身字体预览，虚拟化长列表 |
| C-07 | P3 | ❌ | 字体嵌入策略 | 导出 SVG/PNG/XMind 时记录字体降级与兼容性结果 |

### D. 分支线全局设置

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| D-01 | P0 | ⚠️ | 修复线宽选中态 | 细/默认/粗均正确高亮，自动保存后不回退 |
| D-02 | P1 | ⚠️ | 扩为 5 档线宽 | 至少映射 1/2/3/5/8 或等价视觉 token |
| D-03 | P1 | ❌ | 增加锥形线 | 每档可选择普通/锥形，组合更新为原子 transaction |
| D-04 | P1 | ⚠️ | 将全局连接线类型移到地图面板 | 不再伪装成节点级属性 |
| D-05 | P1 | ⚠️ | 扩充连接线形状 | curve、straight、elbow、rounded elbow、bight、fold、rounded fold |
| D-06 | P1 | ❌ | 增加分支线型 | solid、dash、hand-drawn solid、hand-drawn dash |
| D-07 | P1 | ⚠️ | 彩虹分支 palette popover | 开关旁显示当前颜色组；支持切换颜色组 |
| D-08 | P1 | ❌ | 统一分支线颜色 | 关闭彩虹分支时可选择 lineColor |
| D-09 | P2 | ❌ | 结构默认与用户 override 分离 | 切换结构不会意外覆盖用户显式线型，或提供明确重设 |
| D-10 | P2 | ❌ | 导图级连接线类型快捷项 | 可作为 StudiumX 易用性增强；标明 Xmind 主要通过层级样式传播实现 |

### E. 结构与布局

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| E-01 | P1 | ⚠️ | 结构选择改为预览 popover | 右栏只显示当前结构；浮层按 family 分类 |
| E-02 | P1 | ✅ | 保留 map/logic/org/tree/brace/timeline/fishbone/matrix | 每类有真实几何和 connector，不回退成普通树 |
| E-03 | P2 | ❌ | 次级/三级结构参数 | `minorStructureClass/subMinorStructureClass` 或等价 typed model |
| E-04 | P1 | ✅ | 自动平衡 | 与具体 structure capability 联动，不适用时禁用 |
| E-05 | P1 | ✅ | 紧凑布局 | 明确 compact 对 spacing/geometry 的影响，避免重复控制 |
| E-06 | P2 | ❌ | 统一同级主题宽度 | 布局度量和渲染共同支持 |
| E-07 | P2 | ❌ | 分支自由布局 | 手动位置和自动布局规则有明确优先级，可重设 |
| E-08 | P3 | ❌ | 自由主题灵活定位 | 补齐 free-topic 渲染、选择、拖拽、格式化 |
| E-09 | P3 | ❌ | 主题层叠 | 关闭时执行可撤销的重排，不只改布尔值 |
| E-10 | P3 | 🟡 | Matrix/Grid 专属参数 | 列数、合并方式、单元格边框进入 typed layout settings |
| E-11 | P2 | ⚠️ | 布局重设与骨架默认关联 | 不再永远硬重设为 `logic.right` |
| E-12 | P2 | ⚠️ | 折叠/展开全部移出格式区 | 放到画布操作或导航区，避免把命令和样式混在一起 |

### F. 普通主题：节点外观

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| F-01 | P1 | 🟡 | 扩充主题形状 | 基础形状首屏 + 更多形状 popover；未知 XMind 形状有近似报告 |
| F-02 | P2 | ❌ | 填充 pattern | solid、hand-drawn、diagonal、horizontal 等 typed 枚举 |
| F-03 | P1 | ✅ | 填充颜色 | 支持颜色井、透明、最近颜色、混合值 |
| F-04 | P1 | ⚠️ | 边框颜色 | 与边框线型/粗细联动；none 时禁用 |
| F-05 | P1 | ❌ | 边框线型 | none、solid、dash、hand-drawn solid/dash |
| F-06 | P1 | ❌ | 边框粗细 | 至少五档；renderer 与 XMind 互通有映射 |
| F-07 | P2 | ❌ | 节点宽度 | 固定宽度、自动适应文字、重设宽度 |
| F-08 | P2 | ❌ | 快速样式 | 默认、重要、非常重要、划除；作为样式 preset 而非任务事实 |
| F-09 | P2 | ❌ | 更多形状搜索/分类 | 不在主侧栏一次铺出几十项 |
| F-10 | P2 | ⚠️ | 节点局部结构 override 完整化 | 不只提供 6 个 logic 选项，按当前结构提供有效 options |

### G. 普通主题：文本格式

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| G-01 | P1 | ✅ | 字体家族 | 支持继承、全局、具体字体、mixed |
| G-02 | P1 | ✅ | 字号 | 允许常用档位和合法数值输入，保留 undo merge |
| G-03 | P1 | ✅ | 字重 | 统一 token，不在 UI 中硬编码英文名称 |
| G-04 | P1 | ❌ | 粗体/斜体 | 可独立组合，不用仅靠 fontWeight 下拉替代 |
| G-05 | P1 | ✅ | 文字颜色 | 支持透明/最近颜色/mixed |
| G-06 | P2 | ❌ | 下划线/删除线 | 可独立重设和继承 |
| G-07 | P2 | ❌ | 大小写转换 | none/uppercase/lowercase/capitalize；不改原始标题文本 |
| G-08 | P2 | ❌ | 文本对齐 | left/center/right，并按结构方向提供合理默认 |
| G-09 | P2 | ❌ | 多选混合态 | 字体、字号、颜色等不一致时显示 mixed |
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
| H-07 | P2 | ❌ | 编号模式 | none、数字、字母、罗马数字 |
| H-08 | P2 | ❌ | 分级编号 | 支持 1、1.1、1.2 等层级模式 |
| H-09 | P2 | ❌ | 从当前主题重新编号 | 作用域明确、可撤销 |
| H-10 | P2 | ❌ | 应用到同级 | 与样式传播框架共用，不写专用旁路 |

### I. 对象专用格式面板

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| I-01 | P2 | 🟡 | Relationship inspector | 形状、起止箭头、线型、粗细、颜色、标题文本全部可渲染和持久化 |
| I-02 | P2 | 🟡 | Boundary inspector | 形状、填充、透明度、边框、标题文本 |
| I-03 | P2 | 🟡 | Summary inspector | 概要线与概要主题分成两个区，分别可重设 |
| I-04 | P2 | 🟡 | Callout inspector | 形状、填充、文本、leader line，支持位置重设 |
| I-05 | P3 | 🟡 | Free topic inspector | 普通主题样式 + 自由定位/对齐/自动着色 |
| I-06 | P3 | 🟡 | Image/asset inspector | 宽高、锁比例、边框、阴影、不透明度；安全读取 asset 元数据 |
| I-07 | P3 | ❌ | Grid cell inspector | 背景、对齐、边框，只有 grid 结构时可用 |
| I-08 | P4 | ❌ | Zone/区域 inspector | 若 StudiumX 引入 zone，需先定义正式 domain model，不以 boundary 冒充 |
| I-09 | P2 | ❌ | 对象格式 capability registry | 每种对象声明支持字段，避免面板写入 renderer 不消费的属性 |

### J. 多选、继承、传播和样式复用

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| J-01 | P1 | 🟡 | 将 selection 接入右栏 | 支持多个 topic 和单个 element；稳定 id，不保存为教学事实 |
| J-02 | P1 | ❌ | mixed state | 不同值显示 mixed；修改后只覆盖所选字段 |
| J-03 | P1 | ❌ | inherited/default/none 分离 | 序列化和 UI 均不复用一个空字符串 |
| J-04 | P2 | ❌ | 更新到当前层级 | command transaction，可撤销一次完成 |
| J-05 | P2 | ❌ | 更新到所有子主题 | 对大子树有进度/取消边界，不形成低位默认 quota |
| J-06 | P2 | ⚠️ | 重设样式 | 恢复继承，而不是复制主题当前具体值到节点 |
| J-07 | P2 | ❌ | 复制/粘贴样式 | 菜单和快捷键提供；粘贴只覆盖兼容字段 |
| J-08 | P2 | ❌ | 样式刷/重复应用 | 可选增强，复用复制样式 payload，不新建第二套格式模型 |
| J-09 | P2 | ❌ | capability disabled | 每字段独立禁用，并说明原因 |
| J-10 | P3 | ❌ | 多类型选择策略 | 只显示交集属性；禁止把 topic 字段写入 relationship |

### K. 自定义配色与自定义风格

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| K-01 | P3 | ❌ | 自定义配色模型 | 用户状态保存 id/name/colors；文档保存 resolved snapshot |
| K-02 | P3 | ❌ | 自定义配色编辑器 | 至少 6 色、预览、对比度提示、保存/取消 |
| K-03 | P3 | ❌ | 自定义风格模型 | 包含 map、central/main/sub、relationship、boundary、summary、callout 等层 |
| K-04 | P3 | ❌ | 自定义风格编辑器 | 独立窗口/页面，实时预览但保存为原子操作 |
| K-05 | P3 | ❌ | 风格应用策略 | 明确保留或覆盖节点局部 override，可撤销 |
| K-06 | P4 | ❌ | 导入/导出自定义风格 | 严格 JSON schema、大小上限、无代码/无脚本 |
| K-07 | P4 | ❌ | 收藏、排序、搜索 | 属于用户偏好，可同步但不成为 teaching authority |

### L. 持久化、互通和测试

| ID | 优先级 | 当前 | 改进项 | 验收标准 |
| --- | --- | --- | --- | --- |
| L-01 | P0 | ⚠️ | Schema/类型/command/proposal 同源 | 增加字段时四处不会再次漂移，最好由共享 schema/types 派生 |
| L-02 | P0 | ⚠️ | 真实 IPC round-trip 测试 | 不允许 mock 直接回显 payload 掩盖 parser strip |
| L-03 | P1 | ⚠️ | UI + store 重开测试 | 每个地图级控件保存、关闭、重开保持一致 |
| L-04 | P2 | ⚠️ | XMind 导入属性报告 | 每个 style 字段标记 preserved/approximated/dropped |
| L-05 | P2 | ⚠️ | XMind 导出 round-trip | topicStyles、节点 override、line pattern/width 等逐步保真 |
| L-06 | P2 | ❌ | 未知字体/形状降级 | 有稳定 fallback 和兼容报告，不静默变形 |
| L-07 | P1 | ⚠️ | Undo/redo 原子性 | 线宽+锥形、彩虹开关+palette 等组合只产生一个用户级 undo entry |
| L-08 | P1 | ❌ | 键盘与无障碍 | popover 焦点管理、方向键、Escape、ARIA label、mixed state 可读 |
| L-09 | P2 | ❌ | 性能 | 大配色/字体/形状列表虚拟化；改样式不重复全树昂贵布局 |
| L-10 | P2 | ⚠️ | 导出一致性 | PNG/SVG/XMind 使用与画布相同 resolved style，不维护三套算法 |
| L-11 | P2 | ❌ | 视觉回归 fixture | 中心/一级/子级、不同结构、元素、多选、暗色 UI 全覆盖 |
| L-12 | P1 | ❌ | 防回归 change detector | 检查 `MindMapTheme/MindMapLayoutSettings` 字段是否都被 schema 接受 |

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

- [ ] 打开导图，点击配色预览，在小窗口中切换方案，画布立即更新。
- [ ] 配色浮层关闭后焦点返回触发按钮。
- [ ] 修改背景色、透明度、全局字体、分支线粗细和线型。
- [ ] 等待自动保存后设置不回退。
- [ ] 关闭文档并重新打开，设置完全一致。
- [ ] 切换骨架不会意外重置配色和节点局部样式。
- [ ] 关闭彩虹分支后可选择统一线色；重新开启后恢复上次 palette。
- [ ] 多选不同样式节点时显示 mixed；修改一个字段不会覆盖其他字段。
- [ ] 选择 relationship/boundary/summary/callout 时自动显示正确面板。
- [ ] 样式传播、复制/粘贴、重设都可一次撤销和重做。

### 8.2 数据与互通

- [ ] 所有右栏字段均被 domain schema、IPC parser、proposal schema 接受。
- [ ] store 读写 round-trip 深度等价。
- [ ] PNG/SVG 渲染与画布 resolved style 一致。
- [ ] `.xmind` 导入/导出逐项报告 preserved/approximated/dropped。
- [ ] 未安装字体、未知形状、未知线型不会导致文档无法打开。
- [ ] 自定义配色删除后，旧文档仍使用保存时 resolved snapshot。

### 8.3 无障碍与性能

- [ ] 所有 popover 可仅用键盘完成选择。
- [ ] 颜色不仅靠颜色本身表达当前状态，具备描边/check/可读名称。
- [ ] mixed、disabled、inherit、none 有可访问名称。
- [ ] 43+ 骨架、240+ 配色或长字体列表采用滚动/虚拟化，不阻塞右栏。
- [ ] 500 节点导图修改颜色/字体不触发不必要的全量重新布局。

---

## 9. 不应误判为 Xmind parity 的项目

1. **墙纸/背景图片：** Xmind 26.05 当前右栏确认的是背景颜色，未确认地图墙纸。可以作为 StudiumX 自有增强，但不要写成 Xmind 缺口。
2. **全局分支连接线类型快捷项：** Xmind 主要在主题 Branch 区配合层级样式传播实现；StudiumX 可提供地图级快捷项，但应标为易用性增强。
3. **AI 面板：** Xmind 对照不能削弱 StudiumX 的 AI review、来源锚点和教学事实边界；AI 改样式仍必须显式审查和应用。
4. **远程主题市场：** 本清单不建议引入默认联网或远程 marketplace；自定义配色/风格优先本地管理，不增加静默 telemetry。
5. **主题数量：** 43 份 JSON 或更多缩略图不代表样式能力完整，验收应以字段保真和用户路径为准。

---

## 10. 主要源码证据索引

### StudiumX

- 右栏组合与 Tab：`src/renderer/src/views/mindmap/MindMapAiPanel.tsx:412`
- 当前配色/主题画廊：`src/renderer/src/views/mindmap/MindMapThemeGallery.tsx:59`
- 背景、全局字体、彩虹开关：`src/renderer/src/views/mindmap/MindMapThemePanel.tsx:16`
- 布局、间距、线宽：`src/renderer/src/views/mindmap/MindMapCanvasOptionsPanel.tsx:47`
- 节点样式与错误作用域的 lineStyle：`src/renderer/src/views/mindmap/MindMapTopicStyleInspector.tsx:63`
- Theme/Layout 类型：`src/shared/mindmap/domain/types.ts:21`
- V2 Schema 漂移：`src/shared/mindmap/domain/schema.ts:109`
- Proposal Schema 漂移：`src/shared/mindmap/commands/mind-map-proposal.ts:65`
- IPC 解析剥离入口：`src/main/mindmap/mind-map-ipc-commands.ts:131`
- 自动保存采用主进程返回文档：`src/renderer/src/views/mindmap/mind-map-view-store.ts:157`
- 元素模型与有限 style：`src/shared/mindmap/domain/types.ts:172`
- Xmind 主题转换限制：`src/shared/mindmap/themes/from-xmind-theme.ts:58`
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

