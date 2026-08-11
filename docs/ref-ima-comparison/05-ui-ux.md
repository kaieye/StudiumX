# UI / UX 对比

## 1. 组件库与设计系统

### IMA Copilot：TDesign React

IMA 使用腾讯的 **TDesign** 企业级组件库：

| 资源 | 大小 | 说明 |
| --- | --- | --- |
| `tdesign-react-BIpeOmVC.js` | 515KB | TDesign React 组件 |
| `tdesign-react-CWahkqUu.css` | 507KB | TDesign 样式 |
| `framer-motion-PC0P8-65.js` | 113KB | 动画库 |

**TDesign 优势：**
- 企业级组件完整性（表格/表单/对话框/树/上传等）
- 腾讯内部大规模验证
- 暗色模式原生支持（`onNotifyColorSchemeModeChange` 事件）
- 中文场景优化

### StudiumX：Tailwind CSS 4 + 自研组件

StudiumX 的 UI 栈：
- **Tailwind CSS 4**：原子化样式
- **Zustand**：状态管理
- **lucide-react**：图标库
- **react-router-dom 7**：路由
- **i18next + react-i18next**：国际化
- **CodeMirror 6**：代码/Markdown 编辑器
- **自研组件**：`SettingsPrimitives.tsx`, `DesktopSidebarFrame.tsx`, `DesktopTopbar.tsx`
- **Liquid Glass**：`ui/liquid-glass/`（毛玻璃效果）

**对比结论：** IMA 的 TDesign 提供了**开箱即用的企业级组件**（表格、复杂表单、树形控件），StudiumX 的 Tailwind 提供了**完全自定义的设计灵活性**。StudiumX 可考虑在某些复杂组件（如高级表格、树形选择器）上引入 Headless UI 组件库补充，但不应整体迁移到 TDesign。

---

## 2. 原生 UI 集成

### IMA Copilot：Touch Bar + 状态栏

IMA 有丰富的 macOS 原生 UI 集成：

| 资源 | 说明 |
| --- | --- |
| `touch_ai.png` | Touch Bar - AI 按钮 |
| `touch_copy.png` | Touch Bar - 复制按钮 |
| `touch_note.png` | Touch Bar - 笔记按钮 |
| `touch_translate.png` | Touch Bar - 翻译按钮 |
| `touch_more.png` | Touch Bar - 更多按钮 |
| `status_button_icon.png` | 状态栏图标 |
| `status_button_icon_dark.png` | 状态栏图标（暗色） |
| `upload_file_enter_bg.png` | 文件上传背景（133KB） |
| `upload_file_exit_bg.png` | 文件上传退出背景 |

**imaFrame 原生 UI 事件：**
- `onNotifyColorSchemeModeChange`：暗色模式自动切换
- `onDefaultZoomFactorChanged`：缩放
- `onVerticalTabStripStateChanged`：垂直标签栏
- `onSidePanelWidthChanged`：侧边栏宽度
- `onNotifyWindowFocusChange`：窗口焦点
- `onNotifyMiniWindowFocusChange` / `onNotifyMiniWindowClosed`：迷你窗口

### StudiumX：Electron 原生集成

StudiumX 的原生 UI 集成：
- `DesktopSidebarFrame.tsx`：桌面侧边栏框架
- `DesktopTopbar.tsx`：桌面顶栏
- `system-power-bridge.ts`：系统电源桥接
- `planning-timer-os-power.ts`：计时器电源管理
- `planning-timer-sleep-hooks.ts`：睡眠钩子
- `app-updater.ts`：应用更新
- Electron 原生菜单/托盘

**对比结论：** IMA 的 Touch Bar 集成是 macOS 专属功能，StudiumX 目前没有 Touch Bar 支持。但 Touch Bar 已是 deprecated 功能，借鉴价值低。更有价值的是 IMA 的**暗色模式自动跟随系统**和**侧边栏宽度持久化**，StudiumX 可加强这两个方面。

---

## 3. 文档渲染与可视化

### IMA Copilot：富文档渲染矩阵

IMA 在知识库和 copilot 扩展中集成了**完整的可视化技术栈**：

| 库 | 大小 | 用途 |
| --- | --- | --- |
| `mermaid-CIvSSwYd.js` | 1.16MB | 流程图/时序图/架构图等 13+ 种图表 |
| `echarts-Clsdq8m9.js` | 828KB | 数据可视化图表 |
| `zrender-BbGFnfvN.js` | 217KB | ECharts 底层渲染引擎 |
| `cytoscape-DWcTVsTP.js` | 570KB | 图网络可视化 |
| `markmap-TevCrwlj.js` | 150KB | 思维导图 |
| `katex-RsMOB8Rx.js` | 576KB | 数学公式 |
| `markdown-it-Weq_ypqv.js` | 53KB | Markdown 解析 |
| `highlight-BsLfNlS5.js` | 957KB | 代码语法高亮 |
| `html2canvas-DcnxOvY9.js` | 203KB | DOM 截图 |

**Mermaid 图表类型支持（完整列表）：**
- `pieDiagram` 饼图
- `classDiagram` / `classDiagram-v2` 类图
- `stateDiagram` 状态图
- `flowDiagram` 流程图
- `sequenceDiagram` 时序图
- `architectureDiagram` 架构图
- `blockDiagram` 块图
- `c4Diagram` C4 架构图
- `gitGraphDiagram` Git 图
- `quadrantDiagram` 象限图
- `timeline-definition` 时间线
- `treemap` 矩形树图
- `cose-bilkent` 图布局算法

### StudiumX：教学文档渲染

StudiumX 的文档渲染栈：
- `markdown-it`：Markdown 解析
- `react-markdown` + `remark-gfm`：React Markdown 渲染
- `katex`：数学公式（v0.17.0）
- `mermaid`：图表（v11.16.0）
- `highlight.js`（通过 CodeMirror）：代码高亮
- `parse5`：HTML 解析
- `lesson-rendering/`：课程专用渲染（document-frame, markup-compiler）
- `lesson-style-themes/`：12 种课程样式主题

**差距分析：**
- StudiumX 已有 `mermaid` v11.16.0（比 IMA 更新），但可能未启用所有图表类型
- StudiumX 缺少 `echarts`（数据图表）和 `cytoscape`（图网络可视化）
- StudiumX 缺少 `html2canvas`（DOM 截图导出）
- StudiumX 的 `markmap` 功能通过自研 MindMap 视图实现，不依赖 markmap.js

**借鉴建议（中优先级）：**
1. **ECharts 集成**：用于学习分析数据可视化（StudiumX 已有 analytics 模块，可用 ECharts 增强图表）
2. **Mermaid 图表类型扩展**：确认已启用所有 mermaid 支持的图表类型
3. **html2canvas**：用于课程讲义导出为图片

---

## 4. 侧边栏模式

### IMA Copilot：sidePanel 优先

IMA 大量使用 `sidePanel` 权限（12 个扩展有此权限）：
- copilot：AI 对话在侧边栏
- 搜索：搜索结果在侧边栏
- 文件查看器：文件在侧边栏查看
- 笔记：笔记在侧边栏

**优势：** 不遮挡主内容，支持同时查看和操作

### StudiumX：全屏 + 分栏

StudiumX 的布局模式：
- `DesktopSidebarFrame.tsx`：左侧导航栏
- `OfficeWorkbench.tsx`：办公工作台
- `ImmersiveFocusTimerScene.tsx`：全屏沉浸模式
- 无全局 sidePanel 模式

**借鉴建议（中优先级）：** StudiumX 可考虑在 AI 对话和资源查看时增加**侧边栏模式**，支持同时查看课程内容和 AI 对话。

---

## 5. 暗色模式

### IMA Copilot：原生跟随系统

- `onNotifyColorSchemeModeChange` 事件：系统暗色模式变更时自动通知
- 所有图标都有 dark 变体（`status_button_icon_dark.png`, `IDR_TENCENT_KNOWLEDGE_DARK_ICON` 等）
- TDesign 原生支持暗色模式

### StudiumX：需确认

StudiumX 使用 Tailwind CSS 4（原生支持暗色模式），但需确认：
- 是否有系统暗色模式自动跟随？
- 是否所有 UI 组件都有暗色变体？
- `liquid-glass/` 效果在暗色模式下是否正常？

**借鉴建议（低优先级）：** 确认暗色模式完整覆盖，特别是课程样式主题（12 种主题是否有暗色变体）。

---

## 6. 国际化

### IMA Copilot：中文优先

- `intl.accept_languages: zh-CN,zh,en-US,en`
- TDesign 中文优化
- `defaultLocale` 资源在 copilot 扩展中

### StudiumX：i18next 完整国际化

- `i18next` + `react-i18next`
- `src/renderer/src/i18n/locales/`：本地化资源目录
- 支持多语言切换

**对比结论：** StudiumX 的国际化框架**更完整**，IMA 是中文优先的产品。
