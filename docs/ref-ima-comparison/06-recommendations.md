# 借鉴建议：StudiumX 可以从 IMA Copilot 学习什么

> **前提声明**：以下建议均需遵守 StudiumX 的产品地板（AGENTS.md §1）和红线（§3）。
> 任何建议不得降级教学权威、绕过 settlement sole-writer、引入默认遥测或 YOLO 标签。
> 四源借鉴 backlog 的实施历史由 Git 与 PR 保存；开放项若改变架构边界，须新 ADR。

---

## P0 高优先级（短期可落地，价值显著）

### 1. 文件查看器扩展：PDF + EPUB

**现状：** StudiumX 仅支持 Markdown 查看/编辑，学习者阅读 PDF/EPUB 资料需切换外部应用。

**IMA 做法：** 6 种独立查看器扩展（Markdown/Office/PDF/TXT/EPUB/Code），各有 sidePanel 权限。

**StudiumX 建议：**
- 集成 `pdf.js`（Mozilla，Apache-2.0）作为 PDF 查看器
- 集成 `epub.js`（BSD）作为 EPUB 查看器
- 嵌入资源查看器（`views/resources/`），不独立为扩展
- 保持本地解析，不依赖云转换
- 与学习记录关联：在 PDF/EPUB 中标注的内容可被引用为教学证据

**预估工作量：** 2-3 周
**ADR 需求：** 需新 ADR 记录查看器架构和资源关联策略

---

### 2. ECharts 数据可视化集成

**现状：** StudiumX 有学习分析模块（`views/workbench/analytics/`），但可视化能力有限。

**IMA 做法：** 集成 ECharts（828KB）+ ZRender（217KB）用于数据可视化。

**StudiumX 建议：**
- 在学习分析视图中集成 ECharts
- 图表类型：学习时长趋势、任务完成率、专注计时分布、复习进度
- 按需加载（tree-shaking）控制包体积
- 保持与 SQLite 投影的数据流一致

**预估工作量：** 1 周
**ADR 需求：** 无（属于渲染层增强）

---

### 3. 系统事件原生订阅

**现状：** StudiumX 有 `system-power-bridge.ts` 和 `planning-timer-sleep-hooks.ts`，但覆盖面有限。

**IMA 做法：** imaFrame 提供 30+ 系统级事件（暗色模式、网络状态、窗口焦点、缩放等）。

**StudiumX 建议：**
- 扩展 Electron 事件订阅，将以下事件推送到渲染层：
  - 暗色模式跟随系统（`nativeTheme.themeUpdated`）
  - 网络状态变更（`online`/`offline`）
  - 窗口焦点变更（`browserWindow.on('focus'/'blur')`）
  - 系统电源事件（已有，可扩展）
- 通过 preload contextBridge 暴露 typed 事件 API
- 渲染层通过 Zustand store 响应

**预估工作量：** 3-5 天
**ADR 需求：** 无（属于能力增强）

---

## P1 中优先级（中期规划，需 ADR）

### 4. 多格式知识源接入

**现状：** StudiumX 的 `RESOURCES.md` 是文本清单，不支持直接解析文件内容。

**IMA 做法：** 支持网页链接、微信文件、PPT/Office、脑图、AI 对话、笔记作为知识源。

**StudiumX 建议：**
- 在资源管理中支持文件附件（PDF/Office/EPUB/图片）
- 文件解析为文本提取（`mammoth.js` for docx, `sheetjs` for xlsx, `pdf.js` for PDF text）
- 提取的文本作为教学 context 的候选来源（经 `resource-grounder.ts`）
- **不引入向量检索**做产品搜索面（遵守红线 §5）
- 不同来源类型用不同彩色图标（借鉴 IMA 的 `colorful-*.svg` 设计）

**预估工作量：** 3-4 周
**ADR 需求：** 需新 ADR，记录知识源类型、解析策略和教学 context 注入边界

---

### 5. 侧边栏对话模式

**现状：** StudiumX 的 AI 对话是全屏或分栏视图，不支持侧边栏浮层。

**IMA 做法：** 12 个扩展使用 `sidePanel` 权限，AI 对话/搜索/文件查看在侧边栏。

**StudiumX 建议：**
- 在 Electron BrowserWindow 中增加侧边栏 panel（`BrowserView` 或 `WebContentsView`）
- 支持在查看课程/资源时侧边打开 AI 对话
- 侧边栏宽度持久化（类似 IMA 的 `onSidePanelWidthChanged`）
- 不影响主工作区布局

**预估工作量：** 2 周
**ADR 需求：** 需新 ADR 记录侧边栏布局策略和 IPC 复用

---

### 6. 模型模式切换 UI

**现状：** StudiumX 的模型配置是 provider + model + apiKey，没有"增强模式"/"思考链"开关。

**IMA 做法：** 每个模型有 `enableEnhancement` 和 `enableThinking` 开关，`subModelTypes` 区分模式。

**StudiumX 建议：**
- 在 AI 对话界面增加模型模式切换（如果提供商支持）：
  - "思考模式"：映射到 `reasoning_effort: high` / `thinking` parameter
  - "增强模式"：映射到更高 temperature / system prompt 增强
- 在 provider-adapter 中增加模式参数透传
- UI 上提供快速切换按钮

**预估工作量：** 1 周
**ADR 需求：** 无（属于 provider-adapter 增强）

---

### 7. 语音输入

**现状：** StudiumX 无语音输入能力，所有交互通过键盘。

**IMA 做法：** copilot JS 中有 `voice`（6 次）和 `audio`（19 次）关键字，支持语音输入。

**StudiumX 建议：**
- 集成 Web Speech API（`webkitSpeechRecognition`，Electron 原生支持）
- 在 AI 对话输入框增加麦克风按钮
- 语音转文字后填入输入框，用户可编辑后发送
- 支持中英文识别

**预估工作量：** 3-5 天
**ADR 需求：** 无（属于输入增强）

---

## P2 低优先级（长期探索，需评估）

### 8. Office 文档预览

**现状：** StudiumX 不支持 Office 文档预览。

**IMA 做法：** 独立 office 查看器扩展（v5.5.0, 1.3MB JS）。

**StudiumX 建议：**
- 集成 `mammoth.js`（docx -> HTML）做轻量预览
- 集成 `sheetjs`（xlsx -> 表格）做轻量预览
- 不追求完美还原，只做内容预览（够读即可）
- 与文件查看器扩展（建议 #1）合并

**预估工作量：** 2 周
**ADR 需求：** 与建议 #4 合并

---

### 9. 翻译辅助

**现状：** StudiumX 无翻译功能。

**IMA 做法：** 独立翻译扩展，整页翻译/双语对照。

**StudiumX 建议：**
- 在资源查看器中增加"翻译辅助"功能
- 选中文本 -> 右键 -> 翻译（调用 AI 或翻译 API）
- 双语对照查看外文资料
- 不做整页翻译（那是浏览器功能，不是教学工作区功能）

**预估工作量：** 1-2 周
**ADR 需求：** 需新 ADR 记录翻译能力边界

---

### 10. 截图与 OCR

**现状：** StudiumX 无截图和 OCR 能力。

**IMA 做法：** `screenshot` + `ocr` + `IDR_TENCENT_SCREENSHOT_KNOWLEDGE` 截图知识库。

**StudiumX 建议：**
- Electron 原生截图（`desktopCapturer`）
- OCR 使用 Tesseract.js（WASM，本地运行，不上传）
- 截图 -> OCR -> 文本 -> 注入 AI 对话或保存为资源
- **保持本地处理**，不上传图片到云

**预估工作量：** 2-3 周
**ADR 需求：** 需新 ADR 记录截图权限、OCR 本地化和数据流

---

## 不建议借鉴的方面

以下 IMA Copilot 的做法**不建议** StudiumX 借鉴：

| 方面 | 原因 |
| --- | --- |
| **定制 Chromium 替代 Electron** | 过度工程化，Electron 足够且生态更好 |
| **远程 Web 前端加载** | 违反本地优先原则和安全边界 |
| **云优先数据存储** | 违反"文件是教学真相源"底线 |
| **默认远程遥测** | 违反"无自动 remote telemetry"红线 |
| **宽权限模型**（所有扩展都有 cookies/webRequest） | 违反 effect lattice + 最小授权原则 |
| **服务端 RAG/向量检索** | 违反"文件是教学真相源"和"禁止向量库做产品搜索面" |
| **内置模型（不暴露 API key）** | 违反"用户可控 AI 提供商"定位 |
| **IM SDK / 微信集成** | 超出教学工作区范畴 |
| **播客/录音功能** | 超出教学工作区范畴，资源投入产出比低 |
| **Touch Bar 支持** | 已 deprecated，投入产出比极低 |
| **TDesign 迁移** | Tailwind 更灵活，迁移成本高且无收益 |

---

## 借鉴路线图建议

```
Phase 1（1-2 月）                     Phase 2（3-4 月）                    Phase 3（5-6 月）
┌────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
│ #1 PDF/EPUB 查看器      │    │ #4 多格式知识源接入       │    │ #8 Office 文档预览        │
│ #2 ECharts 可视化       │    │ #5 侧边栏对话模式         │    │ #9 翻译辅助               │
│ #3 系统事件订阅         │    │ #6 模型模式切换 UI        │    │ #10 截图与 OCR            │
│ #7 语音输入             │    │                          │    │                          │
└────────────────────────┘    └──────────────────────────┘    └──────────────────────────┘
     独立可交付                    需 ADR + 设计评审                需评估投入产出比
```

---

## 总结

IMA Copilot 是一个**功能广度优先**的通用 AI 知识助手，通过 24 个 Chrome 扩展实现了丰富的功能矩阵。StudiumX 是一个**教学深度优先**的本地 AI 教学工作区，通过 ADR 驱动的架构演进建立了完整的教学证据链。

**StudiumX 的核心优势不应动摇：**
- 文件优先的教学权威
- Effect lattice + 审批策略安全边界
- Settlement sole-writer 唯一写入路径
- 172 ADR 架构可审计性
- 无默认遥测的隐私保护
- 用户可控的 BYOK 模型配置

**StudiumX 可以补强的短板（从 IMA 借鉴）：**
- 文件查看器生态（PDF/EPUB/Office）
- 数据可视化（ECharts）
- 系统事件原生订阅
- 多模态输入（语音/截图/OCR）
- 侧边栏对话模式
- 模型模式切换 UI

这些补强都在**不违反产品地板和红线**的前提下进行，属于"在工作流中增强体验"而非"改变产品定位"。
