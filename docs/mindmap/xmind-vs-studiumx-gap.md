# StudiumX 思维导图 vs XMind 桌面版 — 功能差距分析

- **参考对象：** 本机解包的 XMind 桌面版（26.05.01105，`/Users/chos1nz/Documents/project/StudiumX-project/ref_project/Xmind`）
- **当前实现：** StudiumX 原生思维导图（`src/renderer/src/views/mindmap/` 59 文件 + `src/shared/mindmap/` + `src/main/mindmap/`）
- **分析方式：** 逐一盘点双方功能，按「已实现 / 部分实现 / 未实现」三态标注差距。
- **注意：** ADR-0172/0173 明确「**不实现 XMind 全部功能**」；导图是用户内容，**不是教学权威**，不产生 settlement / evidence / learner-profile 写入。因此本表里的差距分两类：**「应做（符合产品地板与 ADR 目标）」** 与 **「明确不做 / 非目标」**。下文在每个差距上标注归属。

---

## 0. 一页速览

| 维度 | 当前状态 | 关键差距 |
| --- | --- | --- |
| 文档管理 | ✅ 完整 | 无版本历史 / 文件缓存 / 密码 / 合并 |
| 多画布 Sheet | ✅ 完整 | 无拖拽排序 UI、无「从主题新建画布」 |
| 节点编辑 | ✅ 完整 | 无自由主题；批量内容编辑仍仅支持单节点 |
| 结构类型 | ✅ 22 类 / 8 族 | 缺 Tree Table、Grid、Flowchart |
| 样式主题 | 🟡 部分 | 缺 43 套内置主题库、渐变、阴影、主题编辑器 |
| 元素 | 🟡 部分 | **外框/概要/联系/标注 UI 创建未接线**（仅渲染/导入/AI） |
| 大纲 / 搜索 | ✅ 完整 | 无「仅显示分支」、拼写检查 |
| 导入 / 导出 | 🟡 部分 | 已 xmind/md/opml/svg/png；缺 PDF/JPEG/Word/Excel/PPT/TextBundle/TXT |
| AI | 🟡 部分 | 后端已支持多 scope + 逐条审核，但 UI 只暴露 sheet 级自动接受 |
| 画布视口 | 🟡 部分 | 缩略图组件已写好但**未接线** |
| 演示 / 甘特 | ❌ 未做 | Pitch 演说、Gantt 任务/依赖/日历（ADR 非目标） |
| 协作 / 分享 / 云 | ❌ 未做 | 实时协作、分享链接、云存储（产品地板禁止默认远程 telemetry） |
| 设置 / 偏好 | ❌ 未做 | 外观、语言、快捷键自定义、拼写、自动更新 |

> 图例：✅ 完整实现 · 🟡 部分实现（有缺口）· ❌ 未实现 / 未接线 / 非目标

---

## 1. 文档管理

### StudiumX（已实现）
- 画廊/首页（`MindMapHomeGallery`）：文档卡片、新建对话框、按标题搜索、卡片右键菜单（重命名/复制/删除）。
- 新建（新建后直接进入可编辑中心主题，对齐 XMind 低摩擦流程）、打开、关闭、重命名、复制、删除。
- 文档级复制（`duplicateDocument`）保留全部 sheets/topics/elements/theme/interop。
- 存储：主进程 `mind-map-store.ts`，每文档一个 JSON 于 `<workspace>/mindmaps/<id>.json`，revision 乐观并发（CAS）+ journal-tmp 原子写（ADR-0131/0173）。

### XMind 参考（未实现 / 非目标）
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| 版本历史 / 编辑历史 / 恢复快照 | StudiumX 用 revision CAS + journal，但**无面向用户的版本历史 UI** | 应做（低成本，可复用 revision） |
| 文件缓存（自动备份 + 取回） | 无 | 可选 |
| 文件加密 / 密码 | 无 | 可选 |
| 合并 Xmind 文件 / 合并窗口 | 无 | 非目标 |
| 文件属性（作者/创建时间/主题数/字数） | 状态栏只有主题数 | 可选 |
| 最近打开 / 最近使用 | 无 | 应做（低成本） |
| 回收站 / 文件夹 / 星标 | 无 | 非目标（本地工作区模型不同） |
| 模板库 / 从图库新建 / 图库投稿 | 无模板库（有新建预设 `mind-map-create-presets.ts`） | 可选 |
| 云存储 / 我的导图 / 多端同步 | **无** | 产品地板：本地优先，不默认远程；不做 |

---

## 2. 多画布（Sheet）

### StudiumX（已实现）
- `MindMapSheetTabs` + `MindMapSheetMenu`：底部页签，新建（`Sheet N`）/ 重命名 / 复制 / 删除 / 切换；最后一个 sheet 禁止删除。
- 数据模型 `MindMapSheetV2`：独立 root 树、elements、layout、viewport。
- 命令集含 `sheet.create/rename/reorder/remove`；store 有 `reorderSheet`。

### 差距
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| 页签拖拽排序 | store 与 command 已具备，**无 UI 触发** | 应做（接线即可） |
| 从主题新建画布（New Sheet From Topic） | 无 | 应做 |
| 画布另存为 / 多画布导出（全部画布） | 无；导出只针对当前画布 | 可选 |
| 页签栏显隐 | 无 | 非目标 |

---

## 3. 节点 / 主题编辑

### StudiumX（已实现）
- 添加子/兄弟、上方插入、减少缩进、删除；工具栏 + 右键菜单 + 悬停「添加子主题」按钮。
- 行内编辑文本（F2 / 双击）。
- 拖拽移动/换父（`MindMapCanvas` node drag → `topic.move` 命令）。
- 复制 / 剪切 / 粘贴 / 复制节点（`mind-map-clipboard.ts`）。
- 多选（Ctrl/Cmd/Shift 加选）与空白区域拖拽框选；键盘导航。
- 框选后的批量操作：统一样式、删除、折叠/展开；内容（公式/图片/链接）编辑仍要求单节点。

### 差距
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| **自由主题（Floating Topic）** | 数据模型/约束已有，但布局与画布**不渲染**；inspector 标 `freeTopicCanvasUnavailable` | 应做（元素家族的一部分） |
| 自由主题对齐 / 自由定位 / 灵活自由主题 | 随自由主题一并缺失 | 应做 |
| 主题上移/下移/置顶/置底 | 无 | 可选 |
| 批量编辑（Pro） | 已支持框选多节点，并统一修改样式、删除、折叠/展开；尚未批量编辑公式/图片/链接 | 部分实现 |
| 智能辅助线（Smart Guideline） | 无 | 可选 |
| 自动平衡布局 / 自动排序 | 无 UI | 可选 |

---

## 4. 结构类型（骨架）

### StudiumX（已实现，较广）
- `structure-types.ts`：**22 个结构类、8 个族** —— logic（右/平衡/左）、map（radial/classic/顺时针/逆时针）、org-chart（上/下）、tree（左/右）、brace（左/右）、timeline（水平/垂直）、matrix（行/列）、fishbone（左/右头）。
- `MindMapCanvasOptionsPanel`：每画布结构类 + 间距 + 紧凑模式 + 连线样式 + 线宽缩放 + 线型 + 渐细 + 自动平衡。

### 差距
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| Tree Table（树型表格，行/列） | 无 | 可选 |
| Grid（网格结构，Pro） | 无 | 非目标 |
| Flowchart（流程图） | 无 | 非目标 |
| 继承上级节点结构（Follow Parent's Structure） | 无 | 可选 |

> 当前 22 类已覆盖 XMind 主要骨架（思维导图/逻辑图/括号图/组织结构图/鱼骨图/时间轴/树形图/矩阵图），差距集中在 Tree Table/Grid/Flowchart 三族。

---

## 5. 样式与主题

### StudiumX（已实现，较全）
- 主题样式面板（`MindMapTopicStyleInspector`）：填充、描边、文字颜色、字体（`mind-map-font-list`）、字号/字重/样式、文本装饰/变换/对齐、宽度模式、填充图案。
- **16 种节点形状**（`MindMapTopicShapePicker` + `mind-map-node-shapes`）：圆角矩形/矩形/椭圆/菱形/下划线/无/引号/标注/括号/左右箭头/心形/云/星形/平行四边形/六边形。
- 快速样式（默认/重要/很重要/删除线）+ 样式复制/粘贴/重置。
- 元素样式（`MindMapElementStyleInspector`）：描边、线宽、填充、文字、虚线、线形、箭头起止、线型、外框形状；按元素能力注册表。
- 文档主题（`MindMapThemePanel`）：背景色（含透明度）、字体、彩虹分支开关、单色分支线、复制/重置主题。
- 配色方案画廊（`MindMapThemeGallery` + `MindMapColorSchemeEditor`）：6 内置 + 用户自定义（localStorage）。
- 可读性（WCAG 对比度建议）。

### 差距
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| **43 套内置主题库**（Snowbrush/Classic/…/Peaceful） | StudiumX 只有 6 套配色方案，**无完整主题模板库** | 可选（可内建少量主题） |
| 主题编辑器 / 创建自定义主题 / 导入导出主题 | 无 | 可选 |
| 渐变 / 阴影 / 圆角 / 填充图案细节 | 无渐变/阴影 | 可选 |
| 智能配色方案（Smart Color Theme，6 色生成） | 无自动生成配色 | 可选 |
| 分支线粗细档位（Thin/Medium/Bold…） | 有线宽缩放，但无档位预设 | 可选 |
| 全局字体 / 默认 CJK 字体 | 无 | 可选 |
| 主题随画布记忆 / 跟随系统 | 部分（文档级 theme） | 可选 |

---

## 6. 元素：标记 / 笔记 / 标签 / 外框 / 概要 / 联系 / 标注 / 任务

### StudiumX（已实现）
- **标记（Markers）：** `MindMapMarkersPanel` + `mind-map-marker-icons`：优先级、任务进度、旗帜、星星、表情、人像、箭头、符号等。
- **笔记（Notes）：** `MindMapNotesPanel`，节点旁笔记指示符。
- **标签（Labels）：** 数据模型有 labels，搜索覆盖。
- **编号（Numbering）：** 阿拉伯/大小写/罗马、分级、重启，完整。
- **节点内容（Content）：** 支持 LaTeX/KaTeX 公式编辑与预览、HTTP/HTTPS 网页链接新增/编辑/删除/打开，以及本地图片导入、预览与删除；图片只保存 workspace asset 元数据与 `assetIds`，不把 Base64 写入导图 JSON。
- **外框/概要/联系/标注（Boundary/Summary/Relationship/Callout）：** 数据模型、reducer 命令（`element.create/update/remove`）、**画布渲染**、样式检查器、复制粘贴、XMind 导入、AI 创建**均具备**。

### 关键差距（重要）
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| **外框/概要/联系/标注的 UI 创建入口** | 渲染/导入/AI 都有，但**用户界面没有创建按钮**。「添加联系」工具栏按钮明确标 `coming soon`（`MindMapView.tsx:766`）；`insertMenu` i18n 键未接线到任何组件 | **应做（这是最大缺口之一）** |
| 自由主题画布 | 见 §3 | 应做 |
| 附件（Attachment，10MB 上限） | 无 | 可选 |
| 图片（插入本地图片） | 已支持本地导入、workspace asset 元数据、Inspector 预览/删除；尚未支持文件附件/文件链接 | 部分实现 |
| 方程 / LaTeX（Equation） | 已支持 LaTeX/KaTeX 编辑与 Inspector 预览；尚未在节点画布内排版公式 | 部分实现 |
| 任务 / 待办（Task/To-do：日期、进度、负责人） | 无 | 可选（关联甘特） |
| 语音备注（Audio Note） | 无 | 可选 |
| 贴纸 / 插画（800+） | 无 | 非目标 |
| 评论（Comments） | 无 | 非目标 |
| 专区（Zones） | 无 | 非目标 |
| 链接类型 | 已支持 HTTP/HTTPS 网页链接；文件链接、内部主题链接未做 | 部分实现 |
| 超链接 / 主题链接 / 文件链接对话框 | 已接入网页链接编辑/打开入口；主题链接/文件链接对话框未做 | 部分实现 |

> 元素创建 UI 未接线是「应做」项里性价比最高的一块：后端命令、渲染、样式、导入导出都已就绪，只差在上下文菜单/工具栏接入 `element.create` 命令。

---

## 7. 大纲 / 搜索 / 布局工具

### StudiumX（已实现）
- **搜索与替换**（`MindMapSearchPanel` + `mind-map-search`）：标题/笔记/标签/链接全文搜索，单个 + 全部替换（事务化），结果导航并自动展开折叠祖先。
- **大纲**（`MindMapOutline`）：树形大纲，共享画布选择与折叠命令，点击即选中并展开。
- 折叠/展开、全部折叠/展开、快捷键、键盘空间导航。
- 视口：缩放、适应、平移、`MindMapZoomControls` + 状态栏。

### 差距
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| **缩略图（Minimap/Overview）** | `MindMapMinimap.tsx` 已完整写好（缩放总览/点击导航/视口指示/<5 节点隐藏），但**未在画布中接线渲染** | 应做（接线即可） |
| 仅显示分支（Show Branch Only） | 无 | 可选 |
| 按标签/标记筛选主题 | 无 | 可选 |
| 主题对齐 / 等距分布 / 层级排列 | 无 | 可选 |
| 拼写检查 | 无 | 可选 |
| 整词/区分大小写搜索选项 | 无（`MindMapSearchPanel` 简化） | 可选 |
| Map Shot（截图） | 无 | 非目标 |

---

## 8. 导入 / 导出

### StudiumX（已实现）
- **导入：** `.xmind`、`.md`/`.markdown`、`.opml`（`MIND_MAP_IMPORT_ACCEPT`）。
- **导出：** XMind、Markdown、OPML、SVG、PNG（导出下拉）。
- XMind 互通带 `preserved/approximated/dropped/warnings` 兼容性报告（ADR-0173 禁止静默丢字段）。
- 导出流程带 fail-closed 就绪证明（flush + revision + pendingWrites）。

### 差距
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| 导出 PDF | 无 | 应做（常见） |
| 导出 JPEG | 无 | 可选 |
| 导出 Word / Excel | 无 | 可选 |
| 导出 PPT（Pitch → PowerPoint） | 无 | 关联演示模式，非目标 |
| 导出 TXT | 无 | 可选 |
| 导出 TextBundle | 无 | 非目标 |
| 导入 Freemind / MindManager / MindNode | 无 | 可选 |
| 多比例导出（2x/3x）/ 透明背景 / 加边框 | PNG 有基本导出，无这些选项 | 可选 |
| 打印（Print） | 无 | 可选 |
| 导出分支为 | 无 | 可选 |

---

## 9. AI 辅助

### StudiumX（已实现）
- **无文档打开：** `generateMindMap` 从提示词生成全新文档，带流式预览与取消。
- **有文档打开：** `generateMindMapProposal` 针对当前画布生成，**自动接受每一项**并作为单一原子可撤销事务应用。
- 后端能力（IPC/gateway）已支持多 scope：`['selection','sheet','source','selected-file','notes','lesson']`，并有逐条接受/拒绝审核状态机（`mind-map-proposal-state/review`）、请求预览、来源刷新（source-refresh）。

### 差距
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| **多 scope + 逐条审核 UI** | 后端齐全，但 `MindMapAiPanel` 只调 `scope:'sheet'`，**无 scope 选择器、无逐条接受/拒绝界面** | 应做（后端已就绪，UI 未接） |
| 来源锚定 UI（source-refresh 预览/写回） | 后端 + IPC 已实现，UI 未突出暴露 | 应做 |
| 文本/文件/链接 → 导图 | StudiumX 是「提示词 → 导图」；无文件/链接输入 | 可选 |
| 扩展想法（Grow Ideas）/ 解释（Explain） | 无 | 可选 |
| 待办生成 / 工作分解（含时间线） | 无 | 关联甘特，非目标 |

---

## 10. 画布 / 视口

### StudiumX（已实现）
- `mind-map-viewport.ts`（center/fit/zoom + MIN/MAX）、滚轮缩放、背景拖拽平移、状态栏缩放/适应按钮。
- 视口动作：fit / actual / center / zoom-in / zoom-out / navigate。

### 差距
| XMind 功能 | 差距说明 | 归属 |
| --- | --- | --- |
| 缩略图接线 | 组件就绪未接线（见 §7） | 应做 |
| 导航面板 / 前往中心主题 | 无（可用缩略图替代） | 可选 |
| 仅显示分支 / 跟随分支 | 无 | 可选 |

---

## 11. 未做 / 明确非目标的大块

以下为 XMind 全功能，但按 ADR-0172 §3「明确不包含 / 非声明」与产品地板（本地优先、导图非教学权威）**明确不做**，仅列出以对齐预期：

| 大块 | 说明 |
| --- | --- |
| 演示模式（Pitch/Presentation） | XMind 的幻灯片式演说（列表/概要/主题幻灯片、动效、导出 PPT） |
| 甘特图（Gantt） | 任务/依赖/日历/工作日/导出 Excel |
| 实时协作 / 邀请协作者 / 团队与空间 | 远程多人协作 |
| 云存储 / 多端同步 / 我的导图 | 默认远程外发，违反本地优先 |
| 分享链接 / 发布到网页 / 嵌入 | 公开分享 |
| 账号体系 / 付费墙 / 图库投稿 | 商业闭环 |
| 数据打码 / 举报 / 内容审核 | 平台治理 |
| 快捷键自定义 / 新手模式 / 快捷输入 | 辅助体验 |

---

## 12. 建议优先级（按性价比排序的「应做」项）

综合「后端是否已就绪」与「对学习/备课场景的价值」给出建议，**全部不触碰教学权威边界**：

1. **元素创建 UI 接线**（外框/概要/联系/标注 + 自由主题）—— 后端命令、渲染、样式、导入导出、AI 创建全部就绪，只差把 `insertMenu` / 上下文菜单接到 `element.create` 命令。这是当前差距最大、成本最低的一块。`coming soon` 占位应移除。
2. **公式/图片/链接画布内可视化** —— 当前已可在内容面板编辑与预览；可进一步把轻量指示器或缩略图放到节点上，避免用户必须打开 Inspector 才知道节点附有内容。
3. **缩略图接线** —— `MindMapMinimap.tsx` 已完整，仅需在 `MindMapCanvas` 挂载。
4. **Sheet 拖拽排序** —— store/command 已具备，补 UI。
5. **AI 逐条审核 + scope 选择器** —— 后端 `mind-map-proposal-review` 已实现，UI 补审核步骤与 scope 下拉。
6. **版本历史 / 最近打开** —— 复用现有 revision，提供低成本 UI。
7. **导出 PDF / 从主题新建画布 / 仅显示分支** —— 常见编辑导出需求。
8. **少量内置主题库** —— 从 43 套中挑几套落地，丰富视觉。

---

## 13. 附：当前实现事实基准

- 底层：**完全自绘 SVG**，无 react-flow / d3 等重型图形库（ADR-0172 §2.6）；依赖 zustand / fflate / zod / lucide-react。
- 组件规模：`src/renderer/src/views/mindmap/` 59 文件（~15.7k 行），另有 `src/shared/mindmap/`（schema/命令/converter）与 `src/main/mindmap/`（持久化/IPC）。
- 明确占位：`MindMapView.tsx:766` 「添加联系 - coming soon」；`MindMapMinimap.tsx` 未接线；`MindMapDocumentList.tsx` 未使用；i18n 存在 `shareComingSoon` 键但代码未引用（分享按钮实际只打开导入/导出菜单）。
- 相关 ADR：0172（mind-map + AI）、0173（schema v2 + revisioned repository + 互通保真承诺）；边界见 ADR-0167（教学权威）。
