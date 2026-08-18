# 功能逐项对比

## 总览矩阵

| 功能领域 | IMA Copilot | StudiumX | 差异 |
| --- | --- | --- | --- |
| AI 对话 | ✅ Copilot 扩展 | ✅ AgentConversation | IMA 更聚合，StudiumX 更结构化 |
| 知识库 | ✅ COS 云端 | ❌ 无独立知识库 | IMA 有，但云端依赖 |
| 学习目标 | ❌ 无 | ✅ MISSION.md | StudiumX 独有 |
| 学习计划 | ❌ 无 | ✅ Study Planning | StudiumX 独有 |
| 专注计时 | ❌ 无 | ✅ ImmersiveFocusTimer | StudiumX 独有 |
| 学习分析 | ❌ 无 | ✅ Analytics | StudiumX 独有 |
| 笔记 | ✅ 记笔记扩展 | ✅ Markdown 编辑器 | IMA 有独立笔记应用 |
| 脑图 | ✅ 脑图编辑器 | ✅ MindMap views | 两者都有 |
| 搜索 | ✅ 双搜索引擎 | ✅ 教学词汇搜索 | 定位不同 |
| 翻译 | ✅ 整页翻译 | ❌ 无 | IMA 独有 |
| 文件查看器 | ✅ 6 种格式 | ⚠️ Markdown 为主 | IMA 生态丰富 |
| 播客 | ✅ 播客播放器 | ❌ 无 | IMA 独有 |
| 录音 | ✅ 录音插件 | ❌ 无 | IMA 独有 |
| OCR | ✅ 内置 | ❌ 无 | IMA 独有 |
| 截图 | ✅ 截图知识库 | ❌ 无 | IMA 独有 |
| 收藏 | ✅ IMA收藏 | ❌ 无 | IMA 独有 |
| 历史 | ✅ IMA历史 | ✅ 对话归档 | 不同维度 |
| 间距复习 | ❌ 无 | ✅ SpacedReview | StudiumX 独有 |
| Skills | ❌ 无 | ✅ SkillLibrary | StudiumX 独有 |
| MCP | ❌ 无 | ✅ MCP SDK | StudiumX 独有 |
| Web 适配 | ❌ 无 | ✅ Web 层 | StudiumX 独有 |
| 自习室 | ❌ 无 | ✅ StudySpace + Presence | StudiumX 独有 |
| 宠物系统 | ❌ 无 | ✅ Pet | StudiumX 独有 |

---

## 1. 文件查看器生态

### IMA Copilot：6 种格式全覆盖

IMA 拥有完整的文档查看器扩展矩阵：

| 扩展 | 格式 | 版本 | 大小 |
| --- | --- | --- | --- |
| markdown查看器 | `.md` | 5.5.1 | 3.3MB JS |
| office查看器 | `.docx/.pptx/.xlsx` | 5.5.0 | 1.3MB JS |
| PDF Extension | `.pdf` | 5.4.2 | 6.0MB JS |
| txt查看器 | `.txt` | 5.4.0 | 1.6MB JS |
| epub查看器 | `.epub` | 5.2.0 | 2.0MB JS |
| code查看器 | 代码文件 | 5.6.0 | 1.8MB JS |

**共同特征：**
- 每个查看器都有 `sidePanel` 权限（侧边栏查看）
- 每个查看器都有 `fileSystem` 权限（本地文件访问）
- 每个查看器都集成 `imaFrame`（原生桥接）
- Markdown 查看器内置 KaTeX + Mermaid + highlight.js

### StudiumX：Markdown 为核心

StudiumX 的文档查看能力：
- `markdown-preview.tsx`：Markdown 预览
- `markdown-editor.tsx`：CodeMirror 6 编辑器
- `markdown-it` + `react-markdown` + `remark-gfm`：解析
- `katex`：数学公式
- `mermaid`：图表
- `highlight.js`（通过 CodeMirror）：代码高亮

**差距：** StudiumX 缺少 PDF / Office / EPUB / 纯文本的内置查看器。

**借鉴建议（高优先级）：**
1. **PDF 查看**：集成 `pdf.js`（Mozilla），作为资源查看器的一部分
2. **EPUB 查看**：集成 `epub.js`，支持电子书阅读笔记
3. **Office 文档预览**：集成 `mammoth.js`（docx）/ `sheetjs`（xlsx）做轻量预览
4. **保持本地处理**：不依赖云转换，符合本地优先原则

---

## 2. 笔记能力

### IMA Copilot：独立笔记应用

IMA 的"记笔记"扩展（`cninonkgpcmdognjppglnkelbkhlhhee`, v4.50.6）：
- `chrome_url_overrides: { note: "pages/ima-editor.html" }`：作为应用级页面
- 独立编辑器入口 `ima-editor.html`
- 主 JS 3.5MB（`use-click-pc-ima-DFT8qg3A.js`）
- `unlimitedStorage` 权限
- `alarms` 权限（定时提醒）
- `downloads` 权限（导出笔记）
- 笔记可与知识库关联（`onNotifySaveNote` 事件）
- 支持 visitor 模式（未登录查看）

### StudiumX：Markdown 编辑器 + 课程讲义

StudiumX 的笔记能力：
- `markdown-editor.tsx`：CodeMirror 6 编辑器
- 课程讲义作为 Markdown 文件保存在工作区
- `lesson-style-themes/`：12 种课程样式主题（blueprint, chalkboard, classic, editorial, manuscript, mono, nightfall, paper, poster, terminal, vivid）
- 学习记录保存在 JSONL ledger

**对比结论：** IMA 有独立的笔记应用（富功能但封闭），StudiumX 的笔记是**教学工作流的一部分**（讲义 + 学习记录）。StudiumX 可借鉴 IMA 的**笔记独立入口**（快速记录想法，不一定要绑定课程），但应保持 Markdown 本地文件格式。

---

## 3. 脑图编辑器

### IMA Copilot：独立脑图扩展

IMA 的脑图编辑器（`plpfbadbocioapeolmdippopkebeapof`, v5.3.0）：
- 独立扩展，2.1MB JS
- `<all_urls>` + `sidePanel` + `fileSystem` + `management`
- 支持脑图文件导入（`colorful-mindmap-file.svg`）

### StudiumX：内置 MindMap 视图

StudiumX 的脑图能力（`src/renderer/src/views/mindmap/`，24 个组件）：
- `MindMapCanvas.tsx`：画布
- `MindMapAiPanel.tsx`：AI 辅助
- `MindMapContextMenu.tsx`：右键菜单
- `MindMapDocumentList.tsx`：文档列表
- `MindMapExportFeedback.tsx`：导出反馈
- `MindMapMarkersPanel.tsx`：标记面板
- `MindMapMinimap.tsx`：缩略图
- `MindMapNotesPanel.tsx`：笔记面板
- `MindMapOutline.tsx`：大纲
- `MindMapSearchPanel.tsx`：搜索
- `MindMapSheetTabs.tsx`：多页签
- `MindMapSourcePanel.tsx`：数据源
- `MindMapThemeGallery.tsx`：主题画廊
- `MindMapTopicStyleInspector.tsx`：主题样式
- `MindMapZoomControls.tsx`：缩放控制

**对比结论：** StudiumX 的脑图编辑器实际上**功能更丰富**（24 个组件 vs IMA 的单文件应用），特别是 AI 辅助面板和导入兼容性报告。这是 StudiumX 的优势项。

---

## 4. 多媒体能力

### IMA Copilot：完整多媒体矩阵

| 功能 | 扩展 | 说明 |
| --- | --- | --- |
| 播客播放器 | `emagenjhmpjalpoconjkojjhiljigfoh` v5.4.1 | 播客收听，2.0MB JS |
| 音频播放器 | `jkfgholpigobipmfnpckjghnfbbkpecn` v5.2.0 | 音频播放，3.8MB JS |
| 录音插件 | `hgpacghgeonehmbpbfgfceodbeaohlfb` v5.4.3 | 录音，1.9MB JS |
| 图片工具 | `jhnkclbnlaofmbgaepmgiedepkbafipg` v5.3.0 | 图片查看/编辑，1.5MB JS |

**配合能力：**
- OCR（copilot JS 中有 `ocr` 关键字）
- 截图（`screenshot` 关键字 + `IDR_TENCENT_SCREENSHOT_KNOWLEDGE` 资源）
- 语音输入（`voice` 关键字）
- 音频转文字（播客 + 录音 -> 文字 -> 知识库）

### StudiumX：环境音乐 + 学习场景

StudiumX 的多媒体能力：
- `src/renderer/src/views/workbench/music/`：工作台背景音乐
- `src/renderer/src/assets/audio/`：音频资源
- `src/renderer/src/assets/videos/workbench/`：场景视频
- `src/renderer/src/views/workbench/ImmersiveSceneLayer.tsx`：沉浸式场景
- `src/renderer/src/views/workbench/ImmersiveFocusTimerScene.tsx`：沉浸式专注计时
- `ambient-playback.ts`：环境音播放
- `planning-timer-session-analytics.ts`：计时分析

**对比结论：** IMA 的多媒体是**知识获取向**（播客/录音 -> 文字 -> 知识），StudiumX 的多媒体是**学习氛围向**（背景音乐/场景视频 -> 专注）。方向不同，但 StudiumX 可借鉴 IMA 的**语音输入**能力（学习者口述问题 -> AI 回答，降低交互门槛）。

---

## 5. 设置与配置

### IMA Copilot：统一设置面板

IMA 设置扩展（`khmgfdkajnigikondkcjbaflpjflfiee`, v5.6.2）：
- `chrome_url_overrides: { global_settings: "index.html" }`
- 模块：`account-BVdK4ROJ.js`（86KB 账号管理）
- `import-bookmarks-dialog`：书签导入
- `proxy` 权限：代理配置
- `bookmarks` 权限：书签管理

### StudiumX：分层设置

StudiumX 的设置能力（`src/renderer/src/views/settings/`）：
- `ModelProviderSettingsSection.tsx`：模型提供商配置
- `UserMcpSettingsSection.tsx`：MCP 配置
- `UserMcpServerEditor.tsx` / `UserMcpServerList.tsx`：MCP 服务器管理
- `TeachingDoctorSettingsSection.tsx`：教学诊断
- `TeachingTurnReviewSettingsSection.tsx`：教学轮次审查
- `RemoteControlSettingsSection.tsx`：远程控制
- `AgentSessionQueueDiagnostics.tsx`：Agent 会话队列诊断

**配置分层：**
- `studiumx-settings.example.json`：示例配置
- managed overlay（校/团级注入）
- `config-optimistic-writer.ts`：指纹乐观并发
- `path-access.ts`：路径访问控制
- `provider-connection.ts`：提供商连接管理

**对比结论：** StudiumX 的设置更**技术导向**（模型/MCP/诊断），IMA 的设置更**用户导向**（账号/代理/书签）。StudiumX 可借鉴 IMA 的**账号管理 UI** 和**代理配置入口**。

---

## 6. 学习特有功能（StudiumX 独有）

以下功能是 StudiumX 的核心差异化，IMA 完全没有：

| 功能 | 模块 | 说明 |
| --- | --- | --- |
| **学习目标** | `MISSION.md` | 明确学习目标为教学起点 |
| **学习计划** | `study-planning-*`（64 文件） | 任务/日程/计时/排程 |
| **教学证据链** | `learning-session-ledger`, `evidence-*` | 可追溯的教学过程记录 |
| **学习成果评估** | `learning-outcome-evaluator`, `learning-outcome-committer` | 基于证据的 outcome 结算 |
| **间距复习** | `review-schedule-facts.ts`, ADR-0003 | 遗忘曲线驱动的复习计划 |
| **学习分析** | `views/workbench/analytics/` | 学习数据可视化 |
| **自习室/在线状态** | `study-space/presence/`（MQTT） | 多端学习状态同步 |
| **宠物系统** | `views/pet/` | 学习陪伴宠物 |
| **Skills 系统** | `skill-library.ts`, `skill-orchestration-*` | 可组合的教学技能 |
| **课程样式** | `lesson-style-themes/`（12 主题） | 课程讲义视觉样式 |
| **教学轮次审查** | ADR-0001 | 人工审批教学结果 |
| **上下文压缩** | `context-compactor.ts` | Agent 上下文管理 |
