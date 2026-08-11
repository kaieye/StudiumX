# UI/UX 架构与设计系统对比

> **对比维度**：窗口架构、组件库、设计令牌、交互动效、多窗口 vs SPA、信息架构

---

## 1. 窗口架构：多窗口 HTML vs 单页 SPA

### Xmind：每窗一 HTML 的多窗口模式

Xmind 采用**每个对话框/面板都是独立 HTML 文件**的架构，共 **72 个 HTML 入口**：

```
app/renderer/
├── editor.html              ← 主编辑器
├── editor-frame.html        ← 编辑器框架
├── presentation.html        ← 演示模式（全屏）
├── presentationwindowed.html← 演示模式（窗口）
├── gantt.html               ← 甘特图
├── welcome.html             ← 欢迎页
├── new.html                 ← 新建
├── about.html               ← 关于
├── preferences.html         ← 设置
├── dialog-create-with-ai.html
├── dialog-export-to-image.html
├── dialog-export-to-pdf.html
├── dialog-print.html
├── dialog-share.html
├── dialog-share-to-gallery.html
├── dialog-setpassword.html
├── dialog-data-masking-done.html
├── dialog-onboarding.html
├── dialog-keyassist.html     ← 快捷键面板
├── dialog-quick-entry-guide.html
├── ... (共 72 个)
```

每个 HTML 的结构高度统一：

```html
<!doctype html>
<html class="uk-height-1-1">
<head>
  <meta charset="UTF-8"/>
  <script defer src="runtime.js"></script>     <!-- Webpack runtime -->
  <script defer src="common.js"></script>       <!-- 公共模块 -->
  <script defer src="9834.js"></script>         <!-- 共享 chunk -->
  <script defer src="8212.js"></script>         <!-- 共享 chunk -->
  <script defer src="1857.js"></script>         <!-- 共享 chunk -->
  <!-- 以下为该窗口特有的 chunk -->
  <script defer src="3310.js"></script>
  <script defer src="5181.js"></script>
  <script defer src="editor.js"></script>       ← 该窗口入口
</head>
<body class="uk-height-1-1">
  <div id="app" class="uk-width-1-1 uk-height-1-1"></div>
  <script src="../static/vanakit/uikit.js"></script>
</body>
</html>
```

**关键设计决策**：
- **共享 chunk 分层**：`runtime.js` → `common.js` → `9834.js` → `8212.js` → `1857.js` 是所有窗口共享的基础层，之后才是窗口特有的 chunk。这种分层确保了代码复用 + 按需加载。
- **vanakit UIKit 全局注入**：每个 HTML body 末尾都加载 `uikit.js`（468KB），作为全局 UI 组件库。
- **CSS 类前缀 `uk-`**：来自 UIKit 的类名系统（`uk-height-1-1`、`uk-width-1-1`）。

### StudiumX：React SPA 内部路由

StudiumX 采用**单页应用 + 内部视图路由**：

```
src/renderer/src/
├── App.tsx                    ← 根组件，内部路由
├── main.tsx                   ← 入口
├── views/
│   ├── agent-conversation/    ← AI 教学对话
│   ├── mindmap/               ← 思维导图
│   ├── workbench/             ← 专注工作台
│   ├── resources/             ← 资源库
│   ├── settings/               ← 设置
│   ├── pet/                   ← 宠物
│   ├── updater/               ← 更新
│   └── web-remote-control/    ← Web 远程控制
├── ui/
│   ├── liquid-glass/          ← 液态玻璃效果
│   ├── DesktopSidebarFrame.tsx
│   ├── DesktopTopbar.tsx
│   └── AuthScreenLayout.tsx
└── app-shell/                 ← 应用外壳（状态、路由、导航）
```

### 对比分析

| 维度 | Xmind 多窗口 | StudiumX SPA |
|---|---|---|
| **内存** | 每窗口独立渲染进程，内存更高 | 单进程，内存更低 |
| **隔离性** | 窗口间完全隔离，崩溃互不影响 | 一个崩溃可能影响全局 |
| **加载性能** | 首次加载某窗口需初始化；但共享 chunk 可缓存 | 首次加载 SPA 后，视图切换即时 |
| **对话框管理** | 每对话框是 BrowserWindow，可独立最小化/置顶 | 模态层叠加在主窗口内 |
| **代码复用** | 通过 webpack 共享 chunk | 通过 React 组件 + Context |
| **适合场景** | 重交互编辑器 + 大量独立对话框 | 工作流驱动的连续体验 |

### 借鉴建议

> **StudiumX 不需要改为多窗口架构**。SPA 模式更适合教学对话驱动的连续工作流。
> 但可以借鉴 Xmind 的**共享 chunk 分层思路**：确保 Vite 的 manualChunks 配置合理，
> 将 vendor / shared / feature 三层分离，避免单 chunk 过大。

**可借鉴的特定场景**：
1. **导出对话框**可考虑弹出独立窗口（避免长导出阻塞主界面）
2. **演示/全屏专注模式**可考虑独立窗口（已有 ImmersiveFocusTimerScene，可增强）
3. **快捷键面板**可考虑独立窗口（可搜索、可置顶、可常驻）

---

## 2. 组件库：自研 UIKit vs Tailwind CSS

### Xmind：vanakit UIKit

Xmind 使用自研 UI 组件库 `vanakit`：

- **文件**：`app/static/vanakit/uikit.js`（468KB 压缩）
- **辅助文件**：`app/static/vanakit/components.js`、`app/static/vanakit/themes/`
- **类名前缀**：`uk-`（如 `uk-height-1-1`、`uk-width-1-1`）
- **设计**：类似 UIkit（https://getuikit.com/）的 CSS 框架风格

### StudiumX：Tailwind CSS 4 + 自研组件

StudiumX 使用 Tailwind CSS 4 作为原子 CSS 引擎，组件用 React 封装：

- **基础**：Tailwind CSS 4（utility-first）
- **状态管理**：Zustand
- **国际化**：i18next
- **特殊效果**：`ui/liquid-glass/`（液态玻璃效果，疑似借鉴 macOS Sequoia 设计语言）
- **设计令牌**：通过 Tailwind 配置定义

### 借鉴建议

> **StudiumX 的 Tailwind 方案优于 Xmind 的自研 UIKit**。Tailwind 生态更活跃、
> 维护成本更低、与 React 集成更自然。不需要改用 UIKit。
>
> 但可以借鉴 Xmind 的**组件库主题分离**思路：vanakit 有独立的 `themes/` 目录，
> 允许组件库本身支持多主题。StudiumX 可考虑将设计令牌（颜色、间距、圆角、
> 阴影）集中管理，支持教学场景 / 专注场景 / 暗色场景的令牌切换。

---

## 3. 信息架构与导航

### Xmind 的信息架构

Xmind 的功能入口分布在三个层次：

1. **菜单栏**：文件 / 编辑 / 视图 / 插入 / 修改 / 工具 / 窗口 / 帮助
2. **侧边面板**：主题面板、大纲面板、标记面板、任务信息面板
3. **对话框**：72 个 HTML 对话框覆盖所有功能入口

从 `translation.json` 可还原的菜单结构（部分）：

```
文件：新建 / 打开 / 最近打开 / 保存 / 另存为 / 导入 / 导出 / 打印 / 关闭
编辑：撤销 / 重做 / 剪切 / 复制 / 粘贴 / 删除 / 全选 / 查找替换
视图：放大 / 缩小 / 实际大小 / 适应窗口 / 展开/折叠 / 大纲 / 甘特图 / 演示
插入：主题 / 子主题 / 浮动主题 / 联系 / 外框 / 概要 / 标注 / 图片 / 附件 / 超链接 / 笔记 / 标记 / 标签 / 编号 / 任务 / 方程
修改：主题样式 / 形状 / 线形 / 颜色 / 字体 / 对齐 / 边框 / 阴影 / 布局 / 风格
工具：拼写检查 / 字数统计 / 加密 / 数据脱敏 / 文件缓存 / 智能配色 / AI
窗口：全屏 / Zen 模式 / 标签页
帮助：快捷键 / 教程 / 反馈 / 关于 / 检查更新
```

### StudiumX 的信息架构

StudiumX 采用**侧边栏导航 + 主内容区**的 SPA 模式：

```
侧边栏：
├── 教学对话（agent-conversation）
├── 思维导图（mindmap）
├── 专注工作台（workbench）
│   ├── 学习任务
│   ├── 学习日程
│   ├── 专注计时（Pomodoro）
│   ├── 学习分析
│   └── 自习室
├── 资源库（resources）
│   ├── 课程讲义
│   ├── 技能库
│   └── 宠物库
├── 设置（settings）
│   ├── 模型提供商
│   ├── MCP 连接
│   ├── 远程控制
│   ├── 教学诊断
│   └── 回合审查
└── 更新（updater）
```

### 借鉴建议

> **StudiumX 的信息架构清晰且适合教学场景**。但可以借鉴 Xmind 的几个设计：

1. **右键上下文菜单**：Xmind 有丰富的右键菜单（MindMapContextMenu.tsx 已有，可增强）
2. **侧边面板可折叠/可拖拽**：Xmind 的主题/大纲/标记面板可自由组合
3. **快捷键入口**：Xmind 有 `dialog-keyassist` 快捷键面板 + 搜索快捷键功能
   - StudiumX 已有 `mind-map-keyboard.ts`，但缺少全局快捷键面板
   - **建议**：添加一个可搜索的快捷键面板（`Cmd+/` 或 `Cmd+Shift+/` 唤起）

---

## 4. 视觉资产系统

### Xmind 的视觉资产

| 类别 | 数量 | 格式 | 用途 |
|---|---|---|---|
| 对话框插图 / 图标 | 555 个 | 381 PNG + 172 SVG + 2 JPG | 空状态、对话框插图、功能图标 |
| Lottie 动画 | 12+ 个 | JSON | 协作引导、新建引导、付费墙功能演示 |
| 配色主题 | 43 套 | JSON | 完整样式系统（字体/颜色/线形/形状/边框） |
| 形状定义 | 13 类 | JSON | 主题/外框/联系/概要/箭头/连线的形状数据 |
| 许可协议 | 2 份 | HTML | EULA（中英文） |
| Word 模板 | 1 份 | .docx | 导出 Word 模板 |

**Lottie 动画分布**：
```
lottie/
├── collaboration/    ← 协作功能引导动画
│   └── share.json
├── new/              ← 新建/空状态动画
│   ├── no-trash.json
│   ├── new-map.json
│   └── no-shared-map.json
└── paywall-e/        ← 付费墙功能演示动画
    ├── createColorTheme.json
    ├── showBranchOnly.json
    ├── selectAll.json
    ├── grid.json
    ├── equation.json
    ├── insert.json
    ├── alignFloatingTopic.json
    └── pitch.json
```

### StudiumX 的视觉资产

| 类别 | 内容 | 用途 |
|---|---|---|
| Pet 精灵动画 | PetSprite.tsx | 学习陪伴宠物 |
| 沉浸式场景 | ImmersiveSceneLayer / ImmersiveScenePicker | 专注场景背景 |
| 分析图表 | 11 种图表组件 | 学习数据分析 |
| 液态玻璃效果 | liquid-glass/ | UI 玻璃质感 |
| 课程讲义样式 | lesson-style-themes/ | 讲义排版风格 |

### 借鉴建议

> **StudiumX 已有特色视觉资产（Pet、沉浸式场景），不需要复制 Xmind 的资产**。
> 但可以借鉴以下模式：

1. **空状态 Lottie 动画**：Xmind 用 Lottie 动画填充空状态（无文件、无共享等），
   比纯文字/静态图更有吸引力。StudiumX 的 `EmptyStartSheet.tsx` 可考虑添加
   轻量 Lottie 动画。
2. **功能引导动画**：Xmind 在付费墙用 Lottie 演示功能效果。
   StudiumX 可在 onboarding 或新功能提示中使用类似动画。
3. **形状定义 JSON 化**：Xmind 的 13 类形状定义是纯 JSON，可扩展、可序列化。
   StudiumX 的 `mind-map-node-shapes.ts` 可考虑将形状定义外部化为 JSON 资源。

---

## 5. 对话框 / 模态交互模式

### Xmind 的对话框分类

从 72 个 HTML 文件可归纳出 Xmind 的对话框设计模式：

| 类别 | 对话框 | 设计模式 |
|---|---|---|
| **导出/打印** | export-to-image, export-to-pdf, print, gantt-print, multiple-save-as | 向导式：选格式 → 配参数 → 导出 |
| **分享/协作** | share, share-to-gallery, copy-link, invite-collaborators, invite-by-email, team-drive-move, upload-local-file | 步骤式：选内容 → 配权限 → 生成 |
| **购买/授权** | paywall (×3), payment, license, mas-credits-paywall, lenovo-purchase, gift-card, coupon, promotion, start-evaluation | 分层式：功能展示 → 定价 → 支付 |
| **账号/登录** | signin, signin-preload, google-signin | 居中模态 |
| **主题/样式** | theme-editor, smart-color-theme, map-templates | 侧边面板 + 预览 |
| **安全/异常** | setpassword, enterpassword, exception, err, problem, report, progress, confirm | 居中模态 + 进度条 |
| **引导/提示** | onboarding, quick-entry-guide, keyassist, rate, congratulate, auto-updater | 步骤式 / 单页 |

### StudiumX 的对话框/Sheet 模式

StudiumX 使用**底部 Sheet + 居中 Dialog** 的混合模式：

- **底部 Sheet**：`BatchClassifySheet`、`ClassificationPromptSheet`、`EmptyStartSheet`、
  `FutureBlocksDecisionSheet`、`MigrationBannerSheet`、`PhasePromptSheet`、
  `ReconcileSheet`、`RecurrenceSeriesEditSheet`、`V1AuthorityDemoteSheet`
- **全屏场景**：`ImmersiveFocusTimerScene`
- **设置面板**：`SettingsView` 内嵌分区
- **独立对话框**：`AppUpdateDialog`、`WebRemoteControlDialog`、`PetAssistantDialog`

### 借鉴建议

1. **向导式导出对话框**：StudiumX 的导出目前较简单（PNG/SVG），
   借鉴 Xmind 的向导式导出（选格式 → 配参数 → 预览 → 导出）可提升体验
2. **进度对话框**：Xmind 有独立的 `dialog-progress.html`，StudiumX 可增加
   统一的进度展示组件（AI 生成课程、导出等长操作）
3. **确认对话框标准化**：Xmind 有 `dialog-confirm.html`，StudiumX 可确保
   所有破坏性操作有统一的确认对话框样式

---

## 6. 主题与暗色模式

### Xmind 的主题系统

Xmind 的主题系统分两个层次：

#### 6.1 配色主题（Map Themes）- 43 套

每套主题是一个完整 JSON，定义了思维导图中**每种元素类型**的完整样式：

```json
{
  "name": "B01",
  "content": {
    "id": "d49929466cf934a4ab87fa6891",
    "name": "Blackboard",
    "centralTopic": {          ← 中心主题样式
      "properties": {
        "fo:color": "#e5eef9",
        "fo:font-family": "'Nunito','NeverMind',...",
        "fo:font-size": "28pt",
        "fo:font-weight": "600",
        "fo:text-align": "center",
        "line-class": "org.xmind.branchConnection.fold",
        "line-color": "#e5eef9",
        "line-width": "4",
        "shape-class": "org.xmind.topicShape.roundedRect",
        "svg:fill": "none"
      }
    },
    "mainTopic": { ... },      ← 主分支主题
    "subtopic": { ... },        ← 子主题
    "floatingTopic": { ... },   ← 浮动主题
    "calloutTopic": { ... },    ← 标注主题
    "boundary": { ... },        ← 外框
    "summary": { ... },         ← 概要
    "relationship": { ... },    ← 联系
    "expiredTopic": { ... }      ← 过期主题
  }
}
```

**8 种布局族**：
| 族 | 数量 | 示例 |
|---|---|---|
| map（思维导图） | 15 | Snowbrush, Classic, Business, Dark, ZEN |
| logic（逻辑图） | 6 | Steady, Bright, Technology, Night Sky |
| org（组织结构图） | 6 | Simple, Champagne, Prairie, British |
| matrix（矩阵图） | 4 | Elegant, Magnificent, Passionate, Peaceful |
| brace（大括号图） | 3 | Blackboard, Whiteboard, Daisy |
| tree（树状图） | 3 | Finance, Robot, Deep Forest |
| timeline（时间线） | 3 | Explorer, Fantasy, Distinctive |
| fishbone（鱼骨图） | 3 | Shallow Sea, Volcano, Deep Sea |

#### 6.2 智能配色（Smart Color Theme）

Xmind 有 `dialog-smart-color-theme.html`，提供 AI 自动配色功能。

### StudiumX 的主题系统

StudiumX 的思维导图主题系统：

- **借鉴 Xmind 主题**：`src/shared/mindmap/themes/built-in-themes.ts` 通过
  `fromXmindTheme()` 转换 Xmind 43 套主题（仅提取样式参数 - 颜色/字号/字重/线宽）
- **自研配色方案**：`color-schemes.ts` 中的 `DAWN_COLORS` 分支色
- **主题画廊**：`MindMapThemeGallery.tsx`
- **暗色模式检查**：`check:dark-theme-neutrality` 脚本

### 借鉴建议

1. **完整样式属性提取**：目前 `fromXmindTheme` 只提取基本样式参数。
   可考虑增加更多属性（边框样式、线形 pattern、阴影等），让主题更丰富
2. **AI 智能配色**：StudiumX 有 AI 能力，可借鉴 Xmind 的 Smart Color Theme，
   让 AI 根据学习内容自动配色（如：数学知识图谱 vs 语言学习树用不同色调）
3. **布局族扩展**：StudiumX 目前可能只有 map 布局，可考虑增加 timeline
   布局（学习进度时间线）和 logic 布局（知识逻辑关系）

---

## 7. 响应式与窗口尺寸适配

### Xmind

- 每个对话框 HTML 有独立的 `<meta name="viewport">`
- 使用 UIKit 的 `uk-height-1-1` / `uk-width-1-1` 实现全屏适配
- 对话框尺寸由 BrowserWindow 在 main.js 中控制（不可读，压缩代码）
- 支持 macOS 原生窗口样式（`vana-osx-api-window-style`）

### StudiumX

- Tailwind CSS 4 的响应式断点
- `DesktopSidebarFrame.tsx` / `DesktopTopbar.tsx` 控制布局
- 液态玻璃效果适配 macOS 设计语言
- `check:window-chrome-clickability` 脚本确保窗口控件可点击
- `check:dialog-ime` 确保 IME 输入法兼容

### 借鉴建议

> StudiumX 的响应式方案已足够。可借鉴 Xmind 的**窗口尺寸记忆**：
> 记住每个面板/对话框的上次尺寸和位置，下次打开时恢复。

---

## 8. 总结

| 维度 | 借鉴价值 | 具体建议 |
|---|---|---|
| 多窗口架构 | 低 | 保持 SPA；仅导出/演示场景可考虑独立窗口 |
| 组件库 | 低 | 保持 Tailwind；增加设计令牌集中管理 |
| 信息架构 | 中 | 增加可搜索快捷键面板；增强右键菜单 |
| 视觉资产 | 中 | 空状态 Lottie 动画；形状定义 JSON 化 |
| 对话框模式 | 中 | 向导式导出对话框；统一进度组件 |
| 主题系统 | 高 | 完整样式属性提取；AI 智能配色 |
| 暗色模式 | 低 | 已有基础，继续保持 |
| 窗口尺寸记忆 | 中 | 面板/对话框尺寸位置持久化 |
