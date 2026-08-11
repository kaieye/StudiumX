# 思维导图模块深度对比

> **对比焦点**：数据模型、主题系统、形状/线形、导出/导入兼容、布局族、编辑功能、AI 生成
>
> **背景**：StudiumX 的思维导图模块已经借鉴了 Xmind 的主题 JSON（43 套），
> 并有 `.xmind` 兼容导入。本文档深入对比两者的差距与可借鉴方向。

---

## 1. 数据模型对比

### Xmind 的数据模型（从主题 JSON 和兼容性代码推断）

Xmind 的 `.xmind` 文件是 ZIP 包，内部 JSON 结构如下（从 theme JSON 和
StudiumX 的 `xmind-compatibility.ts` 推断）：

```
.xmind (ZIP)
├── content.json          ← 核心：sheet -> rootTopic -> 递归 topic 树
├── metadata.json         ← 元数据
├── manifest.json         ← 文件清单
└── attachments/          ← 图片/附件
```

**Sheet 层**：
```
sheet {
  id, title, class, structureClass,
  rootTopic: { ... },          ← 中心主题
  relationships: [ ... ],     ← sheet 级联系
}
```

**Topic 层**（从兼容性审计可见）：
```
topic {
  id, title, note,
  collapsed,
  structureClass,              ← 局部布局覆盖
  children: {
    attached: [ ...topic ],    ← 附加子分支
    detached: [ ...topic ],    ← 分离主题
    summary: [ ...topic ],     ← 概要主题
    callout: [ ...topic ],     ← 标注
  },
  image: { ... },              ← 图片
  attachment: { ... },         ← 附件
  boundaries: [ ... ],         ← 外框
  summaries: [ ... ],          ← 概要
  callouts: [ ... ],           ← 标注
  markers: [ ... ],            ← 标记
  labels: [ ... ],             ← 标签
  links: { ... },              ← 超链接
  style: { ... },              ← 样式
}
```

### StudiumX 的数据模型

StudiumX 有 **v1 和 v2 两套数据模型**：

#### v1（`mind-map-types.ts`）- 镜像 Xmind 结构

```
MindMapDocument {
  schemaVersion: 1,
  id, title, createdAt, updatedAt,
  sheets: [
    MindMapSheet {
      id, title, structureClass,
      root: MindMapNode {
        id, title, note?, collapsed?,
        structureClass?,
        assetIds?,
        children: MindMapNode[]    ← 仅 attached 子分支
      },
      relationships?: MindMapRelationship[]
    }
  ]
}
```

**v1 特点**：
- 结构直接镜像 Xmind 的 `content.json`
- 但 `children` 只有 `attached`，不含 `detached`/`summary`/`callout`
- 不含 `boundaries`/`summaries`/`callouts`/`markers`/`labels`/`links`/`style`

#### v2（`domain/types.ts`）- 原生 StudiumX 模型

```
MindMapDocumentV2 {
  schemaVersion: 2,
  id, title, createdAt, updatedAt, revision,
  theme: MindMapTheme,
  assets: [...],
  interop?: MindMapInteropMetadata,
  sheets: [
    MindMapSheetV2 {
      id, title,
      layout: MindMapLayoutSettings {
        structureClass, direction?, compact?,
        spacing?, lineStyle?, lineWidthScale?
      },
      viewport: MindMapViewport { x, y, zoom },
      rootTopic: MindMapTopic {
        id, title, note?, collapsed?,
        style?: MindMapTopicStyleOverride,
        markers?: MindMapMarker[],
        links?: MindMapLink[],
        planning?: MindMapPlanningMetadata,
        sourceRefs?: MindMapSourceRef[],
        children: MindMapTopic[]
      },
      elements: MindMapElement[]    ← 扁平元素集合（relationships, boundaries, summaries, callouts, free topics）
    }
  ]
}
```

**v2 特点**：
- 增加了 `revision`（乐观并发）、`theme`、`assets`、`interop` 元数据
- `elements` 扁平集合替代 v1 的内嵌结构
- 增加了 `MindMapPlanningMetadata`（任务状态/截止/进度/优先级）
- 增加了 `MindMapSourceRef`（工作区源锚点 - StudiumX 特有）
- 增加了 `MindMapTopicStyleOverride`（节点级样式覆盖）

### 兼容性审计

StudiumX 的 `xmind-compatibility.ts` 实现了导入兼容性审计：

```
XmindCompatibilityReport {
  preserved:   [...]   ← 成功保留的字段
  approximated: [...]  ← 近似转换的字段
  dropped:     [...]   ← 丢弃的字段
  warnings:    [...]   ← 警告
}
```

被标记为 `UNSUPPORTED_ELEMENT_FIELDS`（导入时丢弃）的 Xmind 字段：
- `boundaries`（外框）
- `summaries`（概要）
- `callouts`（标注）
- `freeTopics`（自由主题）
- `markers`（标记）
- `labels`（标签）
- `links`（链接）
- `style` / `styles`（样式）

### 差距分析

| 数据模型维度 | Xmind | StudiumX v2 | 差距 |
|---|---|---|---|
| 主题树 | 递归 topic 树 | 递归 topic 树 | ✅ 对齐 |
| 子分支类型 | attached/detached/summary/callout | 仅 attached children + elements 扁平集 | 部分：v2 有 elements 但实现程度未知 |
| 外框（Boundary） | ✅ | ✗ 丢弃 | **高差距** |
| 概要（Summary） | ✅ | ✗ 丢弃 | **高差距** |
| 标注（Callout） | ✅ | ✗ 丢弃 | **高差距** |
| 自由主题（Free Topic） | ✅ | ✗ 丢弃 | 中等差距 |
| 标记（Marker） | ✅ | ✅ v2 有类型但导入丢弃 | 中等差距 |
| 标签（Label） | ✅ | ✗ | 低差距 |
| 超链接 | ✅ | ✅ v2 有 MindMapLink | 已有 |
| 样式 | ✅ 完整 style 对象 | ✅ v2 有 TopicStyleOverride | 已有基础 |
| 图片/附件 | ✅ | ✅ assetIds/assets | 已有 |
| 布局族 | 8 种（map/logic/org/matrix/brace/tree/timeline/fishbone） | 6 种 structureClass（logic 变体） | **高差距** |
| 主题系统 | 43 套完整主题 | 43 套（仅样式参数）+ Dawn 配色 | 部分对齐 |
| 工作区源锚点 | ✗ | ✅ MindMapSourceRef | StudiumX 优势 |
| 任务/计划 | ✅ sheet 级 | ✅ topic 级 planning metadata | StudiumX 优势（更细粒度） |
| 乐观并发 | ✗ | ✅ revision | StudiumX 优势 |

---

## 2. 布局族对比

### Xmind 的 8 种布局族

| 布局 | structureClass | 用途 | 主题数量 |
|---|---|---|---|
| **map**（思维导图） | `org.xmind.ui.logic.map` / `balanced` | 双向发散思维导图 | 15 套 |
| **logic**（逻辑图） | `org.xmind.ui.logic.right` / `left` | 单向逻辑图 | 6 套 |
| **org**（组织结构图） | `org.xmind.ui.logic.down` / `up` | 组织架构/树形 | 6 套 |
| **matrix**（矩阵图） | ? | 二维矩阵分析 | 4 套 |
| **brace**（大括号图） | ? | 层级展开 | 3 套 |
| **tree**（树状图） | ? | 树形展开 | 3 套 |
| **timeline**（时间线） | ? | 时间轴 | 3 套 |
| **fishbone**（鱼骨图） | ? | 因果分析 | 3 套 |

### StudiumX 支持的布局

从 `mind-map-types.ts`：

```typescript
type MindMapStructureClass =
  | 'org.xmind.ui.logic.right'    // 右侧逻辑图
  | 'org.xmind.ui.logic.balanced' // 两侧均衡（默认）
  | 'org.xmind.ui.logic.left'     // 左侧逻辑图
  | 'org.xmind.ui.logic.map'      // 思维导图（双向发散）
  | 'org.xmind.ui.logic.down'     // 向下组织图
  | 'org.xmind.ui.logic.up'       // 向上组织图
```

### 差距

StudiumX 支持 6 种 `structureClass`（都是 logic 变体），但**缺少**：
- **matrix**（矩阵图）- 适合知识二维分类
- **brace**（大括号图）- 适合层级展开
- **tree**（树状图）- 适合知识树
- **timeline**（时间线）- **适合学习进度/历史时间线**
- **fishbone**（鱼骨图）- 适合问题分析（如错题原因分析）

### 借鉴建议

> **高优先级**：`timeline` 布局对学习场景非常有用 - 可以将学习计划/进度
> 以时间线形式展示在思维导图中。`fishbone` 布局适合分析学习困难的原因。
> 这两个布局与 StudiumX 的教学定位天然契合。
>
> **实现成本**：StudiumX 已有 Canvas 渲染层（`MindMapCanvas.tsx`），
> 增加新布局主要是布局算法 + 主题映射，不需要重写渲染层。

---

## 3. 主题系统对比

### Xmind 主题 JSON 结构

每套主题定义了**每种元素类型**的完整样式属性：

```json
{
  "name": "M01",
  "content": {
    "name": "Snowbrush",
    "centralTopic": {
      "properties": {
        "fo:color": "#颜色",
        "fo:font-family": "字体栈",
        "fo:font-size": "28pt",
        "fo:font-weight": "600",
        "fo:font-style": "normal",
        "fo:text-align": "center",
        "fo:text-decoration": "none",
        "fo:text-transform": "manual",
        "line-class": "org.xmind.branchConnection.fold",
        "line-color": "#颜色",
        "line-width": "4",
        "shape-class": "org.xmind.topicShape.roundedRect",
        "svg:fill": "none",
        "border-line-color": "#颜色"
      },
      "styleId": "uuid",
      "type": "topic"
    },
    "mainTopic": { ... },
    "subtopic": { ... },
    "floatingTopic": { ... },
    "calloutTopic": { ... },
    "boundary": { ... },
    "summary": { ... },
    "relationship": { ... },
    "expiredTopic": { ... }
  }
}
```

**样式属性维度**（每个元素类型）：
- `fo:color` - 文字颜色
- `fo:font-family` - 字体栈（含多语言回退）
- `fo:font-size` - 字号
- `fo:font-weight` - 字重
- `fo:font-style` - 斜体
- `fo:text-align` - 对齐
- `fo:text-decoration` - 下划线/删除线
- `fo:text-transform` - 大小写
- `line-class` - 分支连接线类型
- `line-color` - 线条颜色
- `line-width` - 线宽
- `line-pattern` - 线条图案（实线/虚线/点线）
- `shape-class` - 形状类型
- `svg:fill` - 填充
- `border-line-color` - 边框颜色
- `border-line-width` - 边框宽度

### StudiumX 主题系统

```typescript
type MindMapTheme = {
  id: string
  name?: string
  background?: string
  branchColors?: string[]
  textColor?: string
  lineColor?: string
  fontFamily?: string
  shape?: string
  rainbowBranches?: boolean
  colorSchemeId?: string
  topicStyles?: {
    central?: MindMapTopicStyleOverride
    main?: MindMapTopicStyleOverride
    sub?: MindMapTopicStyleOverride
  }
}

type MindMapTopicStyleOverride = {
  fill?: string
  stroke?: string
  textColor?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  shape?: string
  structureClass?: MindMapStructureClass
}
```

### 差距

| 属性 | Xmind | StudiumX | 差距 |
|---|---|---|---|
| 文字颜色 | ✅ | ✅ | ✅ |
| 字体栈 | ✅ 多语言回退 | ✅ 单一 | 可增强 |
| 字号 | ✅ | ✅ | ✅ |
| 字重 | ✅ | ✅ | ✅ |
| 斜体 | ✅ | ✗ | 低 |
| 对齐 | ✅ | ✗ | 低 |
| 文字装饰 | ✅ 下划线/删除线 | ✗ | 低 |
| 文字变换 | ✅ | ✗ | 低 |
| 分支线类型 | ✅ fold/roundedElbow 等 | ✗ | **中** |
| 线条颜色 | ✅ | ✅ | ✅ |
| 线宽 | ✅ | ✅ lineWidthScale | ✅ |
| 线条图案 | ✅ dash/solid/dot | ✗ | **中** |
| 形状 | ✅ 多种 | ✅ 基础 | **中** |
| 填充 | ✅ | ✅ | ✅ |
| 边框颜色 | ✅ | ✅ stroke | ✅ |
| 边框宽度 | ✅ | ✗ | 低 |
| 元素类型覆盖 | 8 种（central/main/sub/floating/callout/boundary/summary/relationship） | 3 种（central/main/sub） | **高** |
| 智能配色 | ✅ Smart Color Theme | ✗ | **高** |

### 借鉴建议

1. **增加元素类型样式**：为 `floating`、`callout`、`boundary`、`summary`、
   `relationship` 添加样式定义（当这些元素被实现后）
2. **增加线形图案**：支持 `solid`/`dash`/`dot` 线条图案
3. **增加分支连接线类型**：支持 `fold`/`roundedElbow` 等连接线类型
4. **AI 智能配色**：StudiumX 有 AI 能力，可让 AI 根据内容语义自动配色
5. **多语言字体回退**：字体栈包含多语言回退（CJK + Latin）

---

## 4. 形状系统对比

### Xmind 的形状定义

Xmind 有 13 类形状定义（`app/static/shapes/`），虽然文件标记为 `__deprecated_*`，
但代表了完整的形状分类：

| 形状文件 | 内容 |
|---|---|
| `topic-shapes.json` | 主题形状（圆角矩形/椭圆/菱形/箭头/...） |
| `boundary-shapes.json` | 外框形状 |
| `callout-shapes.json` | 标注形状 |
| `summary-topic-shapes.json` | 概要主题形状 |
| `branch-connections.json` | 分支连接方式 |
| `summary-connections.json` | 概要连接方式 |
| `summary-branch-connections.json` | 概要分支连接 |
| `special-branch-connections.json` | 特殊分支连接 |
| `boundary-line-patterns.json` | 外框线图案 |
| `relationship-shapes.json` | 联系形状 |
| `relationship-line-patterns.json` | 联系线图案 |
| `begin-arrows.json` | 起始箭头 |
| `end-arrows.json` | 结束箭头 |

### StudiumX 的形状系统

`mind-map-node-shapes.ts`（从文件名推断为基础形状定义）。

### 借鉴建议

> 当 StudiumX 实现外框/概要/标注等高级元素时，可借鉴 Xmind 的形状分类：
> 每种元素类型有独立的形状集合。将形状定义外部化为 JSON 资源文件，
> 而非硬编码在 TS 文件中，便于扩展。

---

## 5. 导出能力对比

### Xmind 的导出能力

| 格式 | 选项 | 对话框 |
|---|---|---|
| **PNG 图片** | 尺寸/缩放/背景/画框 | dialog-export-to-image.html |
| **SVG** | 矢量导出 | （内嵌） |
| **PDF** | PDF 导图 + PDF 大纲 | dialog-export-to-pdf.html |
| **纯文本** | TXT | （菜单） |
| **大纲** | 导出大纲 | （菜单） |
| **Word** | .docx 模板 | （菜单） |
| **甘特图** | 导出甘特图 | dialog-gantt-print.html |
| **打印** | 打印机/尺寸/系统对话框 | dialog-print.html |
| **多文件另存** | 批量另存 | dialog-multiple-save-as.html |

### StudiumX 的导出能力

| 格式 | 实现 |
|---|---|
| **PNG** | `mind-map-png-export.ts` + `png-export.ts` |
| **SVG** | `svg-export.ts` |
| **Markdown** | `markdown-export.ts` |
| **OPML** | `opml-export.ts` |
| **PDF** | ✗ 无 |
| **Word** | ✗ 无 |
| **打印** | ✗ 无 |

### 差距

| 格式 | Xmind | StudiumX | 借鉴价值 |
|---|---|---|---|
| PNG | ✅ 带选项 | ✅ 基础 | 中：增加导出选项 |
| SVG | ✅ | ✅ | ✅ |
| PDF | ✅ 导图+大纲 | ✗ | **高**：课程讲义 PDF |
| Markdown | ✅ 导入 | ✅ 导入+导出 | StudiumX 优势 |
| OPML | ✗ | ✅ | StudiumX 优势 |
| Word | ✅ | ✗ | 中：学习讲义 |
| 打印 | ✅ | ✗ | 中 |

### 借鉴建议

1. **PDF 导出**：学习讲义 + 思维导图导出为 PDF 是高价值功能
   - 可用浏览器原生 `window.print()` + CSS print 样式
   - 或用 `pdf-lib` / `puppeteer` 生成
2. **导出选项面板**：借鉴 Xmind 的导出向导（选格式 -> 配参数 -> 预览 -> 导出）
3. **批量导出**：多个思维导图批量导出

---

## 6. 导入兼容对比

### Xmind 导入兼容

| 格式 | 支持 |
|---|---|
| `.xmind`（原生） | ✅ |
| `.xmap`（旧版） | ✅ |
| `.mm`（FreeMind） | ✅ |
| `.mmap`（MindManager） | ✅ |
| `.md`（Markdown） | ✅ |
| TextBundle | ✅ |

### StudiumX 导入兼容

| 格式 | 支持 | 实现 |
|---|---|---|
| `.xmind`（原生） | ✅ | `xmind-converter.ts` + `xmind-compatibility.ts` |
| Markdown | ✅ | `markdown-import.ts` |
| OPML | ✅ | `opml-import.ts` |
| `.mm`（FreeMind） | ✗ | - |
| `.mmap`（MindManager） | ✗ | - |

### 借鉴建议

> StudiumX 已有 `.xmind` 导入兼容性审计（`xmind-compatibility.ts`），
> 这比 Xmind 更透明。不需要增加 FreeMind/MindManager 导入（小众格式）。
> 但可考虑增加 `.xmind` 导出（当前只有导入），实现双向互通。

---

## 7. AI 生成对比

### Xmind 的 AI 能力

- `dialog-create-with-ai.html`：AI 生成思维导图
- AI 项目分解为任务
- AI 智能配色

### StudiumX 的 AI 能力

- `mind-map-generation.ts`：AI 生成思维导图（更深度 - 基于学习内容）
- `mind-map-prompts.ts`：生成提示词
- `MindMapAiPanel.tsx`：AI 面板
- `mind-map-source-refresh.ts`：基于工作区源刷新导图

### 对比

StudiumX 的 AI 思维导图生成**更深度**：
- 基于 LearningSession ledger 中的教学事实
- 支持工作区源锚点（`MindMapSourceRef`）
- 与教学对话、课程讲义联动
- 有 prompt 管理和 source refresh 机制

> **StudiumX 在 AI 思维导图方面已领先 Xmind**。可借鉴 Xmind 的 AI 智能配色。

---

## 8. 编辑功能对比

### Xmind 的编辑功能（从 translation.json 推断）

| 功能 | 描述 | StudiumX |
|---|---|---|
| 添加主题/子主题/同级主题 | 键盘/按钮/右键 | ✅ 已有 |
| 浮动主题 | 独立于主题树的主题 | ✗ |
| 拖拽排序 | 拖拽调整主题顺序 | ✅? |
| 折叠/展开 | 折叠子树 | ✅ 已有 |
| 外框 | 框选多个主题 | ✗ |
| 概要 | 为选中主题添加概要 | ✗ |
| 标注 | 气泡标注 | ✗ |
| 联系 | 两个主题间画连线 | ✅ relationships |
| 标记 | 优先级/星标/进度 | ✅ 基础 |
| 标签 | 文本标签 | ✗ |
| 编号 | 自动编号 | ✗ |
| 笔记 | 主题级笔记 | ✅ 已有 |
| 超链接 | 主题级超链接 | ✅ 已有 |
| 图片 | 主题内图片 | ✅ assetIds |
| 附件 | 文件附件 | ✅ assetIds |
| 方程 | LaTeX 方程 | ✗ |
| 查找替换 | 全文搜索 | ✅ MindMapSearchPanel |
| 大纲模式 | 切换至大纲视图 | ✅ MindMapOutline |
| 多 Sheet | 多画布标签 | ✅ MindMapSheetTabs |
| 缩略图 | 小地图导航 | ✅ MindMapMinimap |
| 缩放控制 | 放大/缩小/适应 | ✅ MindMapZoomControls |
| 右键菜单 | 上下文操作 | ✅ MindMapContextMenu |
| 主题样式 | 节点样式覆盖 | ✅ MindMapTopicStyleInspector |
| 标记面板 | 标记选择器 | ✅ MindMapMarkersPanel |
| 笔记面板 | 笔记编辑器 | ✅ MindMapNotesPanel |
| 源面板 | 工作区源引用 | ✅ MindMapSourcePanel（StudiumX 特有） |
| AI 面板 | AI 操作 | ✅ MindMapAiPanel |
| 主题画廊 | 主题选择 | ✅ MindMapThemeGallery |
| 主题面板 | 主题属性 | ✅ MindMapThemePanel |
| 画布选项 | 画布设置 | ✅ MindMapCanvasOptionsPanel |

### 差距总结

**StudiumX 已有**（甚至超过 Xmind）：
- ✅ 工作区源锚点（`MindMapSourceRef`）- Xmind 无
- ✅ 任务/计划元数据（`MindMapPlanningMetadata`）- 更细粒度
- ✅ 乐观并发（`revision`）- Xmind 无
- ✅ AI 深度生成 - 基于教学事实

**StudiumX 缺少**（Xmind 有）：
- ✗ 外框（Boundary）
- ✗ 概要（Summary）
- ✗ 标注（Callout）
- ✗ 浮动主题（Free Topic）
- ✗ 方程（LaTeX）
- ✗ 编号（Numbering）
- ✗ 标签（Label）
- ✗ matrix/brace/tree/timeline/fishbone 布局
- ✗ PDF/Word 导出
- ✗ 打印
- ✗ AI 智能配色

### 借鉴优先级

| 功能 | 借鉴价值 | 实现难度 | 优先级 |
|---|---|---|---|
| 外框（Boundary） | 高 - 知识分组 | 中 | P1 |
| 概要（Summary） | 高 - 知识归纳 | 中 | P1 |
| timeline 布局 | 高 - 学习进度 | 中 | P1 |
| fishbone 布局 | 中 - 错题分析 | 中 | P2 |
| AI 智能配色 | 高 - AI 优势 | 低 | P1 |
| PDF 导出 | 高 - 讲义输出 | 中 | P1 |
| 标注（Callout） | 中 - 注释 | 中 | P2 |
| 编号 | 中 - 结构化 | 低 | P2 |
| 方程（LaTeX） | 中 - 数学 | 中 | P2 |
| matrix 布局 | 低 - 分类 | 中 | P3 |
| 打印 | 低 | 低 | P3 |
