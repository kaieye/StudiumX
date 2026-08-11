# 思维导图 UI 重构方案 v2 —— 对齐 Xmind

> 状态：v2 设计稿（2026-08-11）。v1 方案的 P0–P5 骨架已基本落地（见 §1 审计表），
> 本方案是在其上的「视觉与信息架构收口」：让画布、工作区 chrome、右侧检查器
> 三个表面达到 Xmind 当代版本的观感。
>
> 依据：不基于截图目测。本机 `/Applications/Xmind.app/Contents/Resources/app.asar`
> 已解包至 `/tmp/xmind-ex/app`，§2 的所有数值直接取自其主题 JSON、配色方案表
> 与 vanakit 设计令牌；43 份主题 JSON 原件已入仓（`src/shared/mindmap/themes/xmind/`）。

---

## 0. 两张截图的差距在哪里

对比当前实现（截图 A）与 Xmind（截图 B），逐项归因：

| # | 截图可见问题 | 根因（代码位置） |
|---|---|---|
| 1 | 新建的子主题是**空白灰块**，整棵树像未完成品 | `newTopicNode()` 建空标题节点；`MindMapCanvas` 对空标题渲染 `' '`（`MindMapCanvas.tsx:995`） |
| 2 | 主分支彩色块上的文字是深灰小字，字级与子主题几乎无差 | `.is-branch .mindmap-node-label{fill:#33322e;font-size:13.5px}`；Xmind mainTopic 为白字、字级明显大于子主题 |
| 3 | 选中态是模糊光晕 + 节点放大抖动 | `drop-shadow` 滤镜 + `transform:scale(1.02)`（mindmap.css P5 层）；Xmind 是 crisp 的蓝色外描边环 |
| 4 | 连线弧度松散、粗细偏细，视觉重心弱 | `curveEdgePath` 控制点取中点对称；线宽 3/2/1.5 而 M01 实为 4/3 |
| 5 | 顶部一整条 header 栏 + 其下悬浮工具栏，画布被压缩两层 | `.mindmap-stage__header` 为通栏实体条（48px + border）；Xmind 标题/工具栏/操作全部悬浮在画布之上 |
| 6 | sheet 胶囊里铅笔/复制/删除/移动 5 个钮常驻 | `MindMapSheetTabs` 对 active tab 恒渲染操作钮；Xmind 只显示 tab 文本 + `+` |
| 7 | 右面板「样式 + MAP 徽章 + 图标 tabs」层层叠加，控件 10–11px 挤在一起，主题 id 用 `<code>` 直出 | `MindMapAiPanel` 面板头 + `MindMapThemePanel` 调试风格；Xmind 是 13px 行式布局、label 左控件右、iOS 开关 |
| 8 | 左栏三段折叠区 + 大纲全部展开，视觉噪音大 | `.mindmap-list` 各段自带边框/大写字母小标题堆叠 |
| 9 | 缩略图饱和度高、蓝色矩形块抢视觉 | `.mindmap-minimap__node{fill:var(--accent)}` 不透明度 0.6 |

结论：**功能骨架（v1 的 P0–P5）已齐，差的是三层皮**——画布渲染质感、chrome 悬浮化、检查器信息设计。

---

## 1. v1 落地情况审计（工作树 vs v1 方案）

| v1 阶段 | 状态 | 证据 |
|---|---|---|
| P0 画布基线（Dawn 色板/彩色 chip/线宽递减/焦点环） | ✅ | `mind-map-branch-colors.ts`、`mindmap.css` Snowbrush 层 |
| P0.5 坐标系修复（容器像素坐标、fit 不放大、单 `+` 钮、橙框修复） | ✅ | `MindMapCanvas.tsx:326-344`、`mindmap.css:2905` 起 |
| P1 chrome（悬浮工具栏/sheet 胶囊/状态栏/导出下拉/左栏折叠） | ✅ 结构完成，视觉未收口 | `MindMapView.tsx:802-981` |
| P2 检查器三 Tab（样式/画布/AI）+ 命令化样式写入 | ✅ 结构完成，视觉未收口 | `MindMapAiPanel.tsx:447-490` |
| P3 画布细节（分级字号度量/折叠计数徽标/标注气泡/概要随分支色） | ✅ | `mind-map-layout.ts:51-62`、`MindMapCanvas.tsx:1029-1067` |
| P4 主题系统（43 主题 JSON 入仓 + 转换器 + 画廊 + 配色方案） | ✅ | `src/shared/mindmap/themes/**` |
| P5 收尾（token 区/微交互/CSS 债务合并） | ⚠️ 部分：token 区存在，**债务未合并**（同一选择器仍有 3–4 处定义） | `mindmap.css` 3349 行、四个历史层 |

单测基线：`mind-map-layout / view-store / viewport / commands` 4 文件 60 用例全绿（2026-08-11 复测）。

---

## 2. 依据：Xmind 真实实现数据

### 2.1 M01「Snowbrush」主题全量属性（`static/styles/themes/M01.json`，已入仓同名文件）

| 元素 | 属性（原值） |
|---|---|
| `map` | `svg:fill: #FFFFFF`（纯白画布） |
| `centralTopic` | `svg:fill: #F6212D`、`fo:font-size: 28pt`、`fo:font-weight: 600`、`border-line-width: 0`、`line-color: #333333`、`line-width: 4`、字体 NeverMind |
| `mainTopic` | **无 fill / 无 fo:color**（运行时由配色方案上色、文字自动反白）、`fo:font-size: 20pt`、`fo:font-weight: 500`、`fo:text-align: left`、`border-line-width: 0`、`line-width: 3` |
| `subTopic` | `svg:fill: #F8F7F7`、`fo:color: #333333`、`fo:font-size: 14pt`、`fo:font-weight: 500`、`shape-class: roundedRect`、`border-line-width: 0` |

要点：
- **字级三档比例 28 : 20 : 14 = 2 : 1.43 : 1**。当前实现 22/13.5/12.5（≈1.76 : 1.08 : 1），主分支与子主题几乎无层级差——这是截图 A「平」的主因之一。
- **连线 4 → 3 递减**（centralTopic.line-width=4 是根→一级线宽，mainTopic.line-width=3 是一级→二级）。当前 3/2/1.5 偏细。
- 三层主题**全部无边框**（border-line-width: 0），层级靠「填充色 + 字级」表达，不靠描边。

### 2.2 同类主题横向抽样（确定「白央题黑边」不是 Xmind 默认）

抽样 `M02–M07 / L01–L04`（原值见主题 JSON）：

| 主题 | centralTopic | mainTopic |
|---|---|---|
| M01 Snowbrush | 红 #F6212D 填充 | 配色方案上色 |
| M02 | 蓝 #0288D1 填充 | 无填充、#333 描边 2 |
| M03 | 白填充 + #374C75 线 | 无填充深字 |
| M04 | #5A729A 填充 | #96D2E7 填充 |
| M05 | 白填充 + #8793A5 边 3pt | 白填充 |
| L01 | #35455B 深靛填充 | #84A1C9 填充白字 |
| M14 | — | **#3A3A3C 深灰填充 + 白字**（截图 B 的黑色胶囊即此族） |
| L06 | — | #0D143A 深 navy 填充 + #B6D9FE 字 |

结论（解包核实）：截图 B 的「白央题蓝边 + 黑胶囊」**不是任何 M/L 主题 JSON**，而是新建文件模板
`static/snowbird/resource/templates/files/basic/logic_chart.xmind` 内嵌的生成式配色主题
**`Energy-#233ED9-TYPE_A`**（787.js 预生成表）：centralTopic 填充 `#233ED9` 蓝实心 28pt/600、
mainTopic 填充 `#0D0D0D` 近黑白字 18pt/600、boundary/summary/relationship 全部 `#233ED9` 蓝线。
即：这是「逻辑图模板 + Energy 活力配色」的组合，不是全局默认。
本方案默认外观取 Snowbrush 的**结构参数**（字级/线宽/无边框/灰 chip），央题填充色则跟随主题：
默认主题未给 `topicStyles.central.fill` 时，根节点保持「白底 + 主题线色描边」，
切到任一内置主题（含 Snowbrush 红央题、L01 深靛央题）时按主题 JSON 原值渲染。

### 2.3 配色方案（multi-line colors，已全量补提）

`renderer/787.js` 共 **43 套**方案（每套 6 色，完整表见 §7 附录），zh-CN 名来自 `renderer/1857.js`
内嵌 i18n 表。生成式主题 ID 格式 `{Scheme}-{seedColor}-{TYPE_A|B|C}`（LIGHT/COLORFUL/DARK）。

要点：多数方案含近白色种子色（如 Energy 的 `#FFFFFF #F2F2F2`）——它们在 Xmind 里兼作生成式主题的
角色种子，直接当分支色会产生白底白块。因此 `color-schemes.ts` **只收编可作分支色板的 6 套（原值逐字）**：

| id | zh-CN | 6 色（787.js 原值） |
|---|---|---|
| dawn | 晨曦（默认） | `#FF6B6B #FF9F69 #97D3B6 #88E2D7 #6FD0F9 #E18BEE` |
| painter | Painter（无中文名） | `#EE4634 #B58D26 #33A86D #41A499 #4876EB #535AD1` |
| vintage | 复古 | `#E9C46A #F4A261 #DC856F #A4705E #2A9D8F #264653` |
| fire | 壁炉 | `#FDD29A #F9A655 #FC901A #E04B51 #A4564C #6D3B37` |
| deep-sea | 海洋 | `#B4F2FD #6EE2FD #3BB6E3 #135CAE #01206A #000D2D` |
| green-tea | 绿茶 | `#D6D9C3 #b6ad90 #579360 #656d4a #265834 #1F2B1D` |

v1 时代杜撰的 Classic/Rainbow/Macaron/Candy 近似值已删除（"Classic/永恒"实为经典主题族名，
不在 43 方案之列）。旧文档若存有已废弃的 `colorSchemeId`，渲染仍走文档内已持久化的
`branchColors`，`getColorScheme` 兜底 dawn，零迁移。

### 2.4 vanakit 设计令牌与面板规格（已提取，`static/vanakit/themes/vana.css`）

| 类别 | Xmind 原值 | 本方案采用 |
|---|---|---|
| UI 正文字级 | body-medium **13px/400/17**（UI 默认） | ✅ 检查器正文 13px |
| 悬浮工具条圆角 | `.uk-darwin` platform-radius-toolbar-bg = **24px（胶囊）** | ✅ 五个悬浮件改胶囊（`--mm-radius-pill: 999px`） |
| 悬浮件阴影 | effect-light-l3：`inset 高光 + 0 6px 20px rgba(0,0,0,.06) + 0 0 4px rgba(0,0,0,.04)` | ✅ `--mm-shadow-float` 改 l3 风（深色模式换深阴影 + 1px 描边） |
| 工具条钮 | 高 **28px**，容器 padding 3-5px，hover mask-overlay-s | ≈（我方 34px 钮、42px 条，保持触达面积） |
| 右面板 | bg material-acrylic（rgba(245,246,247,.6)+blur 6）、内距 **12px 20px** | 侧距 20px ✅；亚克力毛玻璃不采用（面板后无内容可透） |
| sheet 条 | 底部 bar 高 36、tab 高 28、mac 圆角 24 | ✅ 胶囊 + 38px |
| 开关 | `.vk-switch` 36×16、选中底 **gray-700 #383c40** | ✖ 保留 36×20 + accent 蓝（与应用语言一致，且截图 B 中新版 Xmind 开关亦为蓝） |
| 灰阶/语义色 | gray-25~950 阶梯、text-primary #1f2326、fill-surface #fafbfc | 参考；继续走应用 tokens.css |
| 菜单 | mac 圆角 16、bg acrylic-bright + l4 阴影 | 导出菜单圆角 12（app 密度） |

主题 JSON 的 `spacing-major/minor` 仅存在属性名枚举，**42 份主题 JSON 均无数值**（引擎内置），
故 §3 G 项的深度间距（64/44、24/10）维持我方实测标定。

### 2.5 交互件资产（`static/snowbird/resource/addons/`）

Xmind 的画布交互件是独立 SVG 资产：`add_action_button.svg`（子题 `+` 钮）、
`zone_folded_button.svg` / `zone_unfolded_button.svg`（折叠钮）、`boundary_add_title_button.svg` 等。
印证两点：`+` 钮为**单一右侧蓝底圆钮**；折叠态是**数字胶囊**（均已在 P0.5/P3 落地，仅需微调尺寸）。

---

## 3. 差距清单（本次要修的全部条目）

每条：现状 → 目标（依据）→ 改法。**G 编号在实施与验收中引用。**

### 画布（S1）

- **G1 字级三档拉开**：22/13.5/12.5 → **26 / 16 / 13**（保持 M01 的 2:1.43:1 比例但整体缩至适合 100% 缩放的密度；根 600、一级 500、子级 500 字重）。
  `mind-map-layout.ts` 的 `charWidthsForDepth/paddingForDepth` 与 CSS 字号**同步改**（root cjk 26/ascii 13.5、L1 cjk 16/ascii 8.5、sub cjk 13/ascii 7；padding 36/32/24），基础高分级 root 56 / L1 42 / sub 34。
- **G2 主分支白字**：`.is-branch` 文字 `#33322e` → **白字**（M01 mainTopic 反白规则）。深色模式下同为白（chip 色不变，Xmind 同款）。
- **G3 空标题占位**：空标题渲染 `' '` → 渲染 `t('mindmap.untitledTopic')`，`opacity .45`、不写入数据。度量按占位文案宽度算，杜绝「空白胶囊」。
- **G4 连线**：线宽 3/2/1.5 → **4/3/2**（M01 原值 + 三级顺延）；`curveEdgePath` 控制点从对称中点改为**贴近子端的 fold 弧**（c1 = 起点 + 0.32Δx，c2 = 终点 − 0.6Δx），消除大 S 弯。
- **G5 选中环 crisp 化**：去掉 `drop-shadow` 光晕与 `scale(1.02)`；画布内为选中节点绘制**独立环矩形**（节点外扩 3px、rx+3、`stroke:#438EFF` 2px、无填充）。hover 同几何 1.5px、55% 透明度。根节点选中不再 `fill:transparent`（修 bug）。
- **G6 根节点主题化**：CSS 默认根 = 白底 + `var(--mindmap-theme-line, #333)` 2px 描边、26px/600；主题带 `topicStyles.central` 时按主题渲染（含 Snowbrush 红央题）。
- **G7 折叠徽标/加号钮微调**：徽标高 16 → 18、字 11px；`+` 钮 r=9 → 10，仅 hover/选中淡入（已有）确保过渡 120ms。
- **G8 缩略图弱化**：节点块改用分支色 45% 透明度、视口框 1px、容器透明度 0.92，尺寸 160×120 → 148×108。

### 工作区 chrome（S2）

- **G9 header 悬浮化**：删通栏 `.mindmap-stage__header`；改为
  左上悬浮 identity 胶囊（home + 标题 + 保存点）与右上悬浮操作组（重命名/分享/面板开关），
  均 absolute、白底圆角 12、同 toolbar 阴影；画布铺满 stage 全高。
- **G10 工具栏归位**：`top:60px` → `top:16px`（与 identity/操作组同一行）；
  Tag/StickyNote 钮当前误开 style tab —— 行为改为「打开检查器样式 Tab 并滚动至对应分区」，无选中节点时禁用。
- **G11 sheet 胶囊简化**：操作钮（改名/复制/删除/移动）改为**双击重命名 + hover 显示**；默认态只有 tab 文本 + `+`。
- **G12 状态栏统一**：高度、圆角、内边距与工具栏一致（36px 高、圆角 12）。
- **G13 左栏轻量化**：去分区边框堆叠；文档列表行高 30、13px；`搜索/来源` 折叠头改 12px 非全大写；大纲行 12px/行高 24、缩进线淡化；整栏背景用 `--surface-subtle` 无右边框（靠明度分层）。
- **G14 空态**：`mindmap-empty` 居中结构保留，按钮主样式（已有），文案层级微调。

### 检查器（S3）

- **G15 面板结构**：删除面板头（icon+标题+MAP/AI 徽章）；顶部直接是**分段 tabs**［样式｜画布｜AI］（Xmind 顶部三段式），高 40、下边 1px 分隔；面板宽 300px 保持。
- **G16 行式控件语言**：所有分区改「label 左（13px/`--text-muted`）+ 控件右」行式，行高 32；
  分区标题 13px/600/`--text`、上方 16px 间距；控件（select/color/segmented）统一高 28、圆角 8、边 `--line`。
- **G17 开关组件**：checkbox → 纯 CSS switch（36×20、圆点 16、选中 `--accent`），用于 彩虹分支/紧凑布局/平衡导图。
- **G18 样式 Tab 重排**（选中节点时）：
  `样式`分区：形状 select + 填充色 swatch 行（8 色 + 自定义 + 清除）；边框色 swatch 行；
  `文本`分区：字体 select、字号 select、字重 select、文字色 swatch 行；
  `分支`分区：连线样式三段 segmented（曲线/折线/直线）；
  `标记`分区：MindMapMarkersPanel 内嵌（去自带边框）；`备注`分区：NotesPanel 内嵌。
  未选中时空态文案居中。swatch 统一 20px 圆形（Xmind 语言），当前方形 18px 弃用。
- **G19 画布 Tab 重排**：
  ① 结构 select（全宽，带方向 glyph）；② `配色方案` 分区：色带按钮一行（每带 6 色块 24×16 圆角 4，选中蓝环）；
  ③ 主题卡片格 **2 列**（卡 ~128×84 真实预览 SVG，选中 2px 蓝环 + 名称 11px）；
  ④ `背景颜色` 行（label + 32×24 色井）；⑤ `全局字体` 行；⑥ `分支线粗细` 行（细/默认/粗 segmented）；
  ⑦ `彩虹分支` switch 行；⑧ `导图样式`分区：平衡导图 switch、紧凑布局 switch、间距 segmented；
  ⑨ `导图操作`分区：折叠全部/展开全部/重置布局。
  删除 `MindMapThemePanel` 的 `<code>` 主题 id 与复制调试钮（重置并入导图操作分区）。
- **G20 AI Tab 整理**：表单/审阅卡片化（无边框卡 + `--surface-muted` 底），request JSON 收进 `<details>`（默认收起），按钮排布右对齐；功能零改动。

### 收尾（S4）

- **G21 CSS 债务合并**：四个历史层（基础/enhancement/chrome polish/P0.5–P5 追加）合并为
  「tokens → 布局 → 左栏 → 画布 → 悬浮件 → 检查器 → 深色 → 响应式」单序文件；同一选择器只保留终值
  （`.is-root .mindmap-node-rect` 现有 3 处、`.mindmap-floating-toolbar__btn:hover` 2 处等）；目标 ≤ 2600 行。
- **G22 i18n**：新增 key ≤ 10 个（分区标题类），zh/en 同批。
- **G23 测试**：`mind-map-layout`（新字号/间距断言）、`mind-map-create-flow`（header DOM 变更）、
  `mind-map-keyboard`（不受影响，跑通即可）、`view-store`（不动）。新增：空标题占位渲染断言、选中环存在性断言。

---

## 4. 设计规格（实施对照表）

### 4.1 Token 增补（`mindmap.css :root` 区）

```css
--mm-focus: #438eff;              /* 既有 */
--mm-ink: #333333;                /* M01 线/字墨色 */
--mm-sub-fill: #F8F7F7;           /* M01 subTopic 填充（浅色模式） */
--mm-radius-node: 10px;           /* 节点圆角（chip 仍 min(12, h/2)） */
--mm-panel-w: 300px;
--mm-row-h: 32px;                 /* 检查器行高 */
--mm-ctl-h: 28px;                 /* 控件高 */
--mm-font-root: 26px;  --mm-font-main: 16px;  --mm-font-sub: 13px;
--mm-line-w1: 4;  --mm-line-w2: 3;  --mm-line-w3: 2;
```

### 4.2 画布节点规格

| 层 | 填充 | 文字 | 边框 | 高度基准 |
|---|---|---|---|---|
| 根 | 主题 central.fill ?? 白 | 26/600，主题 textColor ?? `--text` | 主题线色 2px（有 central.fill 时无边框） | ≥56 |
| 一级 | 分支色实心 | **16/500 白** | 无 | ≥42 |
| 子级 | `--mm-sub-fill`（深色模式 `color-mix(text 8%, surface)`） | 13/500 `#333`/`--text` | 无 | ≥34 |

选中环：`x-3 y-3 w+6 h+6 rx=nodeRx+3`，`#438EFF` 2px；hover 同几何 1.5px @55%。

### 4.3 chrome 布局（stage 内 absolute 层）

```
top-left  16,16   identity 胶囊（home | 标题 13/650 | 绿点保存态）
top-center 16     工具栏（7 位，34px 钮，圆角 12）
top-right 16,16   操作组（重命名 | 分享▾ | 面板开关）
bottom-left 16    sheet 胶囊；其上 148×108 minimap（bottom 64）
bottom-right 16   状态栏（主题数 | − % + | 适配）
```

全部悬浮件共用：白底（深色 `--surface-solid`）、圆角 12、阴影 `--mm-shadow-float`、z-index 20。

### 4.4 检查器规格

见 G15–G20。tabs 高 40；正文区 padding 14px 16px；分区间距 18px；行高 32；控件高 28 圆角 8；
switch 36×20；swatch 20px 圆；主题卡 2 列、gap 8、卡圆角 10。

---

## 5. 实施批次

| 批次 | 内容 | 涉及文件 | 验收 |
|---|---|---|---|
| S1 | G1–G8 画布 | mind-map-layout.ts / mind-map-edge-styles.ts / MindMapCanvas.tsx / MindMapMinimap.tsx / mindmap.css / 布局与画布单测 | 中英混排 30 字根题不溢出；空标题显示占位；选中环 crisp；线宽 4/3/2 |
| S2 | G9–G14 chrome | MindMapView.tsx / MindMapSheetTabs.tsx / mindmap.css / create-flow 单测 | 画布满 stage；四角悬浮件不重叠；sheet 操作 hover 化仍全可用 |
| S3 | G15–G20 检查器 | MindMapAiPanel.tsx / MindMapTopicStyleInspector.tsx / MindMapThemePanel.tsx / MindMapThemeGallery.tsx / MindMapCanvasOptionsPanel.tsx / mindmap.css / i18n | 三 Tab 全功能保持（每控件走命令、可 undo）；无 code/JSON 裸露（AI 的收进 details） |
| S4 | G21–G23 收尾 | mindmap.css / tests | 全部 mindmap 单测绿；css 单序无重复终值选择器 |

顺序 S1 → S2 → S3 → S4，每批次后跑相关单测；S4 后全量 `vitest run tests/unit/mind-map-*`。

## 5.1 实施记录（2026-08-11）

S1–S4 已全部落地并通过验证：

- **S1**：字级 26/16/13 + 度量同步（含空标题按占位文案度量 `MindMapLayoutOptions.emptyTitleFallback`）、
  主分支白字、线宽 4/3/2、fold 弧（控制点 40%/80%）、crisp 选中/悬停环（`.mindmap-node-ring`）、
  根节点主题化描边、折叠徽标 18px、缩略图 148×108 弱化。
- **S2**：header 拆为悬浮 identity 胶囊 + 右上操作组；工具栏归位 top:16；Tag/StickyNote 改为
  「打开样式 Tab 并滚动到对应分区」且无选中时禁用；sheet 操作钮 hover/focus 才显 + 双击重命名；
  通知/导出反馈/兼容性报告改为画布顶部浮层；左栏轻量化。
- **S3**：检查器去面板头，顶部分段 tabs；样式 Tab 按 样式/文本/分支/布局 分区行式重排（圆形 swatch）；
  画布 Tab 重排为 配色方案 → 主题画廊（2 列）→ 文档主题行 → 布局/间距/线宽/操作；checkbox 全部
  换成 `.mm-switch`；AI Tab 的 request JSON 收进 `<details>`。
- **S4**：mindmap.css 从 4142 行（含新增层）清到 ~3560 行——删除 41 个死类的全部规则、
  合并同选择器多处定义（node-rect/label 系列三层归一）、token 收口至文件头；
  修复既有 bug：**均衡布局子层不再左右交替**（Xmind 行为：仅根层交替，子层继承分支侧向），
  附回归测试；修复选中根节点 `fill: transparent` 旧 bug。
- 冒烟验证：Playwright 驱动隔离 profile 的 Electron 实例，建文档/键盘建树/切 Tab 截图核对
  （截图见 /tmp/studiumx-shots/）。单测 532 文件 4915 用例通过（1 个既有失败与本次无关，见 §6.1）。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 字号度量与 CSS 再次脱节 | 二者同 PR 改，`mind-map-layout` 断言按 §4.2 写死数值 |
| create-flow 测试依赖 header DOM | S2 内同步改断言（改为悬浮 identity 选择器） |
| CSS 合并误删仍在用的规则 | 合并前先 `grep` 每个类名在 tsx 中的使用；合并后手动冒烟浅/深两主题 |
| 主题 JSON 版权 | 维持 v1 结论：仅使用色值/数值参数，不打包 Xmind 字体与图片资产 |

### 6.1 已知无关失败

- `tests/unit/teaching-workspace-evidence.unit.test.ts`（'established' vs 'not_evidenced'）：
  教学工作区证据链逻辑，其导入模块均不在本次改动集中，重构前的工作树即已失败。
- `npm run check:dark-theme-neutrality`：断言 `.remove-dialog-option`（设置视图）的深色底色，
  与 mindmap 无关，重构前即失败。

## 7. 附录：Xmind 43 套 multi-line 配色方案全量表（renderer/787.js 逐字提取）

| 内部名 | zh-CN | 6 色 |
|---|---|---|
| Dawn | 晨曦 | `#FF6B6B #FF9F69 #97D3B6 #88E2D7 #6FD0F9 #E18BEE` |
| Iris | （无） | `#FFFFFF #9257FF #9D02EA #5C14C8 #2E0F6B #C5AEF9` |
| Energy | 活力 | `#FFFFFF #F2F2F2 #F22816 #F2B807 #233ED9 #0D0D0D` |
| Freshness | 水粉 | `#f0f0f0 #F2BDC7 #F2DC6B #5BA683 #B796D9 #3C74A6` |
| Kimono | 和风 | `#FFFFFF #FFABAA #FF7B31 #8CB5FF #4A51D9 #191959` |
| Forid | 华丽 | `#EDF3FF #C1E554 #FFAA39 #D389D5 #1692D2 #0A052E` |
| Quaint | 雅致 | `#F9F5DE #DFDDCE #4B9D9D #7884A4 #AA79AA #153E5D` |
| Variety | 多彩 | `#F6F5F5 #9BFFED #FFC947 #E46D57 #1F3C88 #070D59` |
| Dazzling | 炫彩 | `#FFFFFF #EFD7E6 #FF7DC1 #A239EA #5C37E5 #092933` |
| Vanllia | 香草 | `#FFFFFF #E4F9F5 #30E3CA #11999E #40514E #0D4040` |
| GreenTea | 绿茶 | `#D6D9C3 #b6ad90 #579360 #656d4a #265834 #1F2B1D` |
| CyberPunk | 霓虹 | `#ffffff #72efdd #56cfe1 #4ea8de #5e60ce #7400b8` |
| Fire | 壁炉 | `#FDD29A #F9A655 #FC901A #E04B51 #A4564C #6D3B37` |
| DeepSea | 海洋 | `#B4F2FD #6EE2FD #3BB6E3 #135CAE #01206A #000D2D` |
| Islands | 岛屿 | `#ffe8d6 #ddbea9 #cb997e #b7b7a4 #a5a58d #6b705c` |
| Violet | 紫藤 | `#FFFBEF #FBD58A #DCBEF4 #b67be6 #9d4edd #72369d` |
| Roses | 玫瑰 | `#fff0f3 #ffccd5 #ffb3c1 #ff758f #c9184a #a4133c` |
| Rainforest | 薄荷 | `#ffffff #c4fff9 #9ceaef #68d8d6 #06AFA9 #046562` |
| Vintage | 复古 | `#E9C46A #F4A261 #DC856F #A4705E #2A9D8F #264653` |
| Dessert | 甜点 | `#F9F8ED #FFEDD2 #FFBC9F #D8AC8F #83c5be #006d77` |
| Candy | 糖果 | `#ffffff #FF9C72 #f5cd6c #F09E3A #9cc3e4 #54A6D6` |
| Space | 宇宙 | `#d9dcd6 #81c3d7 #3a7ca5 #2f6690 #16425b #0D2F42` |
| Sakura | 樱花 | `#FFE3E8 #FFDCC8 #FFB4B6 #FFA9C6 #D1C3BD #C1CFDE` |
| Christmas | 假日 | `#D5F2E3 #F0A346 #E12A37 #BC191E #2D6C65 #101F23` |
| Code | 代码 | `#FFF0B8 #CBFFB8 #FFFFFF #DB8FFF #8ABEFF #2C2D30` |
| Sophisticated | 精致 | `#7D5A2C #FDFBF7 #DFCAA4 #C49C64 #D3381D #1E1D1A` |
| Dancing | 舞动 | `#4E60EF #EB4758 #FFFFFF #FFF8E0 #AA0E1D #363026` |
| Innocence | 纯真 | `#FDC9D1 #EA618A #A4D0F9 #4F73BA #FDF8E7 #3C4244` |
| Macaron | 马卡龙 | `#CAB08F #FEB58C #AFD4C4 #ECF6F6 #F9E088 #3C4244` |
| Woodland | 林地 | `#E1C356 #5B805C #86964F #B3C785 #F9FFEB #1F2513` |
| Cream | 奶油 | `#D8EAD2 #D4D0DE #FFFFFF #C9DBEC #DCC4C0 #7D6E83` |
| Hawaii | 夏威夷 | `#B7D6E8 #4A94C3 #254B85 #4B9383 #D29F55 #F3E6CF` |
| Pinecone | 松果 | `#64625C #978477 #1D414B #C8C6CB #AA9FA3 #D1BFAF` |
| Dystopia | 反乌托邦 | `#BD2828 #F4F5F6 #DFE4E7 #A5ACB1 #606466 #2A2C2C` |
| Rainbow | 彩虹 | `#000229 #1F2766 #52CC83 #4D86DB #99142F #245570` |
| Painter | （无） | `#EE4634 #B58D26 #33A86D #41A499 #4876EB #535AD1` |
| Aurora | （无） | `#4C415D #524AB0 #7C46E2 #F8E559 #F3F3F2 #16887B` |
| Hills | （无） | `#597E52 #AB8F54 #F1E4C3 #FFFFEC #73846C #585555` |
| Cartoon | （无） | `#A21111 #E8E8E8 #CE0D7E #474FB0 #026DCA #364891` |
| Jungle | （无） | `#769CD0 #6FB37C #0A6EBD #B29362 #BC975C #F6EFE3` |
| Amethyst | （无） | `#FDC9E7 #B5B5B5 #829B99 #C88FD6 #B485C1 #2D2735` |
| Geek | （无） | `#4A966F #19A7CE #F6F1F1 #55525B #9A969C #E6E6E6` |
| Crimson | （无） | `#9699A2 #FFFFFF #5F5649 #BF1828 #4E4647 #BFA1A4` |

（en-US 显示名差异：Vanllia→Vanilla、GreenTea→Green Tea、DeepSea→Ocean、Rainforest→Mint、
Fire→Fireplace、Christmas→Holiday、Forid→Florid。「Classic/永恒」等属经典主题族枚举，非本表。）
