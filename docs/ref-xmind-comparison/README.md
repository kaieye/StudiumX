# Xmind vs StudiumX 借鉴对比文档

> 对 Xmind v26.05（解包自 `/Applications/Xmind.app`）与 StudiumX 进行全面对比，
> 识别值得借鉴的方面，输出可操作的采纳建议。

## 文档列表

| # | 文档 | 内容 | 关键发现 |
|---|---|---|---|
| 00 | [总览与功能矩阵](./00-overview-and-feature-matrix.md) | 项目元数据对比、功能全景矩阵、架构哲学对比 | Xmind 15 语言/3167 文案 vs StudiumX 2 语言/45 文案；43 套完整主题；72 HTML 多窗口 |
| 01 | [UI/UX 与设计系统](./01-ui-ux-and-design-system.md) | 窗口架构、组件库、信息架构、视觉资产、对话框模式、主题系统 | Xmind 多窗口+自研 UIKit vs StudiumX SPA+Tailwind；Lottie 动画；智能配色 |
| 02 | [思维导图模块深度对比](./02-mind-map-module-deep-dive.md) | 数据模型、布局族、主题系统、形状、导出/导入、AI 生成、编辑功能 | 8 布局族 vs 6 logic 变体；外框/概要/标注缺失；AI 生成已领先 |
| 03 | [国际化与用户引导](./03-i18n-and-onboarding.md) | 多语言、文案覆盖、快捷键系统、文件类型注册、URL Scheme、Onboarding | 15 语言×3167 条 vs 2 语言×45 条；无快捷键面板；无文件类型注册 |
| 04 | [可操作采纳建议](./04-actionable-recommendations.md) | P0-P3 优先级排序、实现步骤、工作量预估、路线图、兼容性检查 | P0: i18n 扩展/快捷键面板/文件类型注册/AI 配色；P1: 外框概要/timeline/PDF/URL Scheme |

## 核心发现摘要

### 最大差距（P0）
1. **国际化文案覆盖**：45 条 → 目标 500+ 条（70 倍差距）
2. **快捷键面板**：无 → 可搜索快捷键列表
3. **文件类型注册**：无 → OS 级文件类型 + URL Scheme
4. **AI 智能配色**：无 → AI 根据内容语义自动配色（低成本高回报）

### StudiumX 已有优势（不应放弃）
1. **AI 教学深度**：LearningSession ledger + 教学证据链 + outcome settlement
2. **安全治理**：effect lattice + TOOL_CONTRACT + settlement sole-writer
3. **架构文档**：172 条 ADR
4. **学习分析**：11 种图表 + 日历热力图
5. **专注工作台**：Pomodoro + 沉浸式场景 + 音乐
6. **本地优先隐私**：无默认遥测 + 同意门控记忆
7. **MCP 生态** + **Pet 陪伴系统** + **OPML 导入**

### 不建议借鉴
- 多窗口架构（SPA 更适合教学工作流）
- 自研 UIKit（Tailwind 更优）
- 付费墙系统（AGPL 开源）
- 云端协作（与本地优先冲突）
- 遥测上传（违反产品地板）
