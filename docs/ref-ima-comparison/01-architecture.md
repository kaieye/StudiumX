# 架构与技术底层对比

## 1. 整体架构

### IMA Copilot：定制 Chromium + 24 扩展 + 远程 Web 前端

```
┌──────────────────────────────────────────────────────────┐
│                   ima.copilot.app (壳)                     │
│  ┌──────────────────────────────────────────────────────┐ │
│  │         Chromium Framework (147.0.7727.5026)         │ │
│  │  ┌──────────┐  ┌───────────┐  ┌───────────────────┐  │ │
│  │  │resources │  │ 24个内置   │  │  imaFrame 原生    │  │ │
│  │  │  .pak    │  │ .crx扩展  │  │  桥接 API         │  │ │
│  │  └──────────┘  └───────────┘  └────────┬──────────┘  │ │
│  └─────────────────────────────────────────┼─────────────┘ │
│                                            │               │
│  ┌─────────────────────────────────────────▼────────────┐  │
│  │     Web 前端 (React + Vite + TDesign)               │  │
│  │  从 https://ima.qq.com 加载，缓存在 Service Worker    │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**关键特征：**
- 不是标准 Electron 应用，而是**定制版 Chromium**（类似于 Edge / Brave 的技术路线）
- 功能通过 **24 个 Chrome 扩展（CRX）** 模块化拆分，每个扩展独立 manifest、权限、Service Worker
- Web 前端从**远程服务器**加载（`https://ima.qq.com`），通过 Service Worker 缓存 81 个 JS 脚本
- 原生能力通过 `chrome.imaFrame` 自定义权限暴露给扩展
- 扩展间通过 `externally_connectable` + `chrome.runtime.sendMessage` 通信

### StudiumX：Electron + 三进程 + 本地打包

```
┌──────────────────────────────────────────────────────────┐
│                     StudiumX (Electron 42)                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Main Process (Node.js 22)                           │ │
│  │  教学/AI/持久化/MCP/工具执行/Agent Loop              │ │
│  │  300+ TS 模块，172 ADR 记录架构决策                   │ │
│  └───────────────────────┬──────────────────────────────┘ │
│                          │ Electron IPC                    │
│  ┌───────────────────────▼──────────────────────────────┐ │
│  │  Preload (安全桥接层)                                │ │
│  │  contextBridge: typed API, 无 Node 直接暴露            │ │
│  └───────────────────────┬──────────────────────────────┘ │
│  ┌───────────────────────▼──────────────────────────────┐ │
│  │  Renderer (React 19 + Vite 7 + Tailwind 4)          │ │
│  │  本地打包加载 file://，无远程依赖                      │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**关键特征：**
- 标准 **Electron** 应用，main/preload/renderer 三进程分离
- **本地打包**，渲染层从 `file://` 加载，无远程前端依赖
- 主进程承载核心逻辑（教学、AI、工具执行、持久化），300+ TS 模块
- 207 个 shared 模块定义跨进程类型与协议
- 172 个 ADR（架构决策记录）文档化每个重要决策的"为什么"

---

## 2. 模块化策略对比

### IMA Copilot：扩展级模块化

IMA 将功能拆分为 **24 个独立 Chrome 扩展**，每个扩展是一个自包含的功能单元：

| 扩展类别 | 扩展名 | 版本 |
| --- | --- | --- |
| **AI 对话** | copilot | 4.8.5 |
| **知识库** | IMA知识库 | 5.6.4 |
| **搜索** | IMA搜索, 问问ima | 5.8.0, 5.7.0 |
| **笔记** | 记笔记 | 4.50.6 |
| **脑图** | 脑图编辑器 | 5.3.0 |
| **文件查看** | markdown查看器, office查看器, PDF, txt, epub, code | 5.2-5.6 |
| **翻译** | IMA 网页翻译 | 1.4.1 |
| **收藏/历史** | IMA收藏, IMA历史 | 5.2.0, 5.1.4 |
| **内容中心** | imaHub | 5.4.1 |
| **设置** | IMA设置 | 5.6.2 |
| **媒体** | 播客播放器, 音频播放器, 录音插件, 图片工具 | 5.2-5.4 |
| **基础设施** | HTML沙箱, 用量统计, Chrome 内置扩展 | - |

**优势：**
- 每个扩展独立版本管理，可单独更新
- 权限最小化：每个扩展只申请自己需要的权限
- 扩展间通过 `externally_connectable` 白名单精确控制通信对象
- Service Worker 后台运行，扩展间解耦

**劣势：**
- 24 个扩展共享大量相同代码（TDesign、KaTeX 字体、mermaid 等），存在重复
- 扩展间通信复杂，依赖 `externally_connectable` 白名单维护
- 所有扩展共享相同 `manifest_version: 3` 基础设施，灵活性受限

### StudiumX：源码级模块化 + ADR 驱动

StudiumX 采用 TypeScript 源码级模块化，按领域和职责拆分：

| 层 | 模块数 | 代表模块 |
| --- | --- | --- |
| **main/** | 300+ | `learning-session-ledger`, `teaching-turn-orchestrator`, `agent-loop`, `provider-adapter`, `learning-outcome-evaluator` |
| **shared/** | 207 | `lesson-schema`, `mcp/`, `lesson-style-themes/`, `agent-conversation-turns` |
| **renderer/** | 100+ | `study-space/`（64 文件）, `views/mindmap/`（24 文件）, `views/workbench/` |
| **scripts/** | 166 | 安全检查、契约检查、教学证据检查、doctor 诊断 |

**优势：**
- 强类型约束贯穿全栈（shared types → IPC → main → renderer）
- 172 个 ADR 记录每个架构决策的"为什么"和"不做什么"
- 模块尺寸政策（<500-800 行目标，>800 优先拆分）
- 领域门禁优先于泛型 lint（教学/隐私/安全门禁 blocking CI）

**劣势：**
- 单一打包，功能模块不能像扩展那样独立更新
- 没有运行时插件系统（MCP 是配置级接入，非代码级扩展）

---

## 3. 原生桥接对比

### IMA Copilot：imaFrame API

IMA 在 Chromium 中注入了一个自定义权限 `imaFrame`，通过两个函数和 30+ 事件实现原生桥接：

```typescript
// 函数（同步 + 异步）
chrome.imaFrame.invoke({ action, params, byteData })
chrome.imaFrame.invokeWithCallback({ action, params }, (result) => { ... })

// 事件（部分）
onAccountInfoChange    // 账号切换
onAppInfoChange        // 应用信息变更
onAppVersionUpdateChange // 版本更新
onNotifyColorSchemeModeChange // 暗色模式
onNotifyWindowFocusChange    // 窗口焦点
onNotifyNetworkStateChange   // 网络状态
onLocalFileReceive           // 本地文件接收
onNotifyAddKnowledgeFileInfo  // 知识库文件添加
onNotifyImSdkMessage         // IM 消息
onNotifySaveNote             // 保存笔记
onToggleTranslate            // 翻译开关
onSidePanelWidthChanged      // 侧边栏宽度
onDefaultZoomFactorChanged   // 缩放
onSearchEngineChanged        // 搜索引擎切换
onVerticalTabStripStateChanged // 垂直标签栏
// ... 共 30+ 事件
```

**特点：**
- `action` + `params`（JSON 字符串）的 RPC 风格
- 支持二进制数据传输（`byteData: ArrayBuffer`）
- 覆盖窗口管理、文件系统、IM SDK、账号、版本更新、网络状态等系统级能力
- 错误上报到远程 `galileotelemetry.tencent.com`

### StudiumX：Electron IPC + Preload 安全桥

```typescript
// preload: contextBridge 暴露 typed API
contextBridge.exposeInMainWorld('studiumx', {
  teaching: { /* ... */ },
  agent: { /* ... */ },
  tools: { /* ... */ },
  // ...
})

// main: ipcMain.handle 处理
ipcMain.handle('teaching:turn', async (event, payload) => {
  // expectedRevision 校验
  // settlement sole-writer 路径
})
```

**特点：**
- 完全类型安全的 IPC（shared types 贯穿）
- `expectedRevision` 乐观并发控制
- Settlement sole-writer（唯一写入路径）
- 无远程依赖，所有逻辑在本地 Node.js 进程

**对比结论：** IMA 的 imaFrame 是一个更"宽"的原生桥（覆盖系统级事件），但 StudiumX 的 IPC 是一个更"深"的领域桥（覆盖教学流程、证据链、工具审批）。StudiumX 可借鉴 IMA 的**系统级事件订阅模式**（如暗色模式变更、窗口焦点、网络状态等原生事件直接推送到渲染层）。

---

## 4. 构建与发布对比

| 维度 | IMA Copilot | StudiumX |
| --- | --- | --- |
| 构建工具 | Vite（Web 前端）+ Chromium 扩展打包 | electron-vite + Vite 7 + TypeScript 6 |
| 打包格式 | `.app`（macOS）+ CRX 扩展 | electron-builder（dmg/exe/AppImage） |
| 版本管理 | 应用级版本（`kAppCurVersion`）+ 扩展独立版本 | package.json semver |
| 自动更新 | `onAppVersionUpdateChange` 事件 + `updateNow` 重启 | electron-updater |
| 配置 | Chromium Preferences.json + Secure_Preferences.json | studiumx-settings.json + managed overlay |
| 代码保护 | JS 混淆（Vite 打包） | 源码级（AGPL-3.0） |

---

## 5. 数据架构对比

### IMA Copilot：云优先

```
用户文件 → COS 上传（cos-*.js）→ 服务端索引/RAG → AI 检索
用户会话 → 服务端数据库 → Web API 返回
设置 → Chromium Preferences（本地）+ 云同步
错误 → galileotelemetry.tencent.com（远程）
```

- 文件存储依赖**腾讯云 COS**（对象存储）
- 知识库的 RAG/向量检索在**服务端**进行（前端 JS 中无 embed/vector/chunk 逻辑）
- 会话历史存储在服务端
- 本地仅保留 Chromium 偏好配置

### StudiumX：本地优先

```
教学事实 → 工作区文件（MISSION.md / RESOURCES.md / 课程 / 学习记录）
         → LearningSession Ledger（JSONL，分区+分段）
         → SQLite 投影/索引（不取代文件权威）

工具执行 → effect lattice → 审批策略 → ToolOutcome → Settlement
AI 会话 → AgentRun 状态机 → 对话历史归档 → 摘要投影
```

- 教学事实权威在**本地文件 + JSONL ledger**
- SQLite 仅做投影/索引/用户状态，**不取代**教学事实
- Settlement sole-writer 保证唯一写入路径
- `expectedRevision` 乐观并发
- 无远程遥测，Doctor/支持包脱敏后导出

**对比结论：** 两者的数据哲学截然不同。IMA 的优势在于**跨设备同步天然支持**（云存储）；StudiumX 的优势在于**数据主权和教学权威**（本地优先）。StudiumX 可借鉴 IMA 的**COS 式文件上传体验**（拖拽上传 → 进度反馈 → 文件管理），但应保持本地存储而非云依赖。
