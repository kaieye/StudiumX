# StudiumX Web 端规划

> **状态：** 规划草案（未实施）
> **日期：** 2026-07-30
> **范围：** StudiumX Web 端的定位、架构、目录结构、API 对接与实施路线

---

## 1. 背景与定位

StudiumX 桌面端是本地优先的 Electron 教学工作区，核心能力是 AI 课程生成、教学工作区文件管理、agent 对话与工具执行。这些能力依赖本地文件系统和 Electron 运行时，无法直接搬到浏览器。

但用户有"网页版"需求：从 landing 落地页点登录，进入一个和桌面端 UI 一致的 Web 界面。经过评估，如果 Web 端**只提供课程生成以外的服务**，则完全可行——因为 StudiumX-Server 已经具备账号、同步、分析聚合等全部后端 API，Web 端只需对接。

**Web 端定位：学习伴侣仪表盘**

- 登录后查看学习分析、管理学习计划、浏览已生成的课程和对话历史
- 参与自习室（计时、排行榜）
- 不执行课程生成、不管理工作区文件、不运行 agent loop

这与 Server 的设计哲学一致（MASTER_PLAN.md §0）："服务端不是教学执行引擎，不持有模型 key、不执行 agent loop。"

---

## 2. 为什么 Web 代码放在 StudiumX 仓库

### 2.1 核心诉求

桌面端 UI 或组件变更时，Web 端必须立即同步。只有共享同一份源码才能做到。

### 2.2 方案对比

| 方案 | UI 同步 | 代价 | 结论 |
| --- | --- | --- | --- |
| Web 放 landing 目录 | ❌ 需手动复制组件 | landing 是纯静态 HTML，无 React | 否决 |
| Web 独立仓库 | ❌ 需手动复制或发包 | 维护两份组件源码 | 否决 |
| **Web 放 StudiumX 仓库** | ✅ 同一份源码 | 新增 web/ 目录 + Vite 配置 | **采用** |

### 2.3 landing 的处理

landing 是营销落地页，与 App 零代码共享。独立仓库、独立部署。landing 上的"登录"按钮跳转到 Web 端 URL。

---

## 3. 桌面端架构回顾

理解 Web 端方案的前提是桌面端的分层结构：

```
Electron Main (src/main/)
  ├── 教学工作区文件读写
  ├── AI provider 调用（agent loop, lesson 生成）
  ├── better-sqlite3 本地数据库
  ├── MCP server 管理
  └── Web Remote Control LAN server

Preload (src/preload/)
  └── contextBridge.exposeInMainWorld('teachingSystem', api)
      → 将 Main 的能力封装为 TeachingSystemApi 接口

Renderer (src/renderer/src/)
  ├── App.tsx              ← 主应用，通过 window.teachingSystem 调用所有能力
  ├── views/workbench/     ← 自习室、分析图表、计时器
  ├── study-space/         ← 学习计划、任务、日程
  ├── views/settings/      ← 设置页
  ├── views/pet/           ← 宠物陪伴
  └── views/web-remote-control/
```

关键点：**Renderer 所有平台相关调用都经过 `window.teachingSystem`（TeachingSystemApi 接口）**，不直接碰 Electron API。这个接口就是 Web 端的切入点。

---

## 4. TeachingSystemApi 接口分析

接口定义在 `src/shared/teaching-types/system-api.ts`，约 100+ 个方法。按 Web 端可用性分类：

### 4.1 Web 端可实现（对接 Server HTTP API）

| 方法 | Server API | 说明 |
| --- | --- | --- |
| `getLearningAnalytics` | GET /analytics/summary?range= | 学习分析派生摘要 |
| `exportLearningAnalytics` | GET /analytics/summary (全部 range) | 导出分析数据 |
| `readStudyPlanning` | GET /study-planning | 读取学习计划快照 |
| `applyStudyPlanning` | PUT /study-planning | 更新学习计划（CAS + actionId 幂等） |
| `readLesson` | GET /lessons/:id/content | 浏览已归档的课程讲义 |
| `projectAgentConversationSummaries` | GET /conversations | 对话历史列表 |
| `readAgentConversation` | GET /conversations/:id/content | 对话归档内容 |
| `getSettings` | Web localStorage / Server | 非敏感设置可存本地 |
| `updateSettings` | Web localStorage / Server | 同上 |

### 4.2 Web 端不支持（依赖本地文件 / Electron / 模型 key）

| 方法 | 原因 |
| --- | --- |
| `generateLesson` / `generateLessonStream` | 需要 AI provider key + 本地文件写入 |
| `agentChatStream` / `cancelAgentChatStream` | agent loop 在 Main 进程执行 |
| `createWorkspace` / `importWorkspace` | 本地文件系统 |
| `readWorkspaceMarkdown` / `saveWorkspaceMarkdown` | 本地文件系统 |
| `pickDirectory` / `openPath` / `openExternal` | Electron 原生对话框 |
| `probeProvider` / `listUpstreamModels` | 本地 provider 配置 |
| `listGitWorktrees` / `switchGitBranch` | 本地 git |
| `mcp*` (全部 MCP 方法) | 本地 MCP server 进程管理 |
| `controlWindow` | Electron 窗口控制 |

Web 端遇到这些方法时，adapter 返回明确的 "not supported on web" 错误。

---

## 5. 目录结构

```
StudiumX/
  src/
    main/                         Electron 主进程（不动）
    preload/                      Electron preload（不动）
    renderer/
      src/                        共享 React 组件源码（不动）
        App.tsx                   桌面端主应用
        main.tsx                  桌面端入口
        views/
          workbench/              自习室、分析图表、计时器、排行榜
          settings/               设置页
          pet/                    宠物
          resources/              资源库
          agent-conversation/     对话视图
          web-remote-control/     远程控制
        study-space/              学习计划、任务、日程
        app-shell/                应用状态管理
        ...
      index.html                  桌面端 HTML
    shared/                       共享类型（不动）
      teaching-types/
        system-api.ts             TeachingSystemApi 接口定义
      study-planning/             学习计划类型
      ...

  web/                            ← 新增：Web 端
    src/
      main.tsx                    Web 入口
      App.tsx                     Web 专属 App（只渲染查看类视图）
      adapters/
        teaching-api.ts           TeachingSystemApi 的 HTTP 实现
        auth.ts                   微信登录 + JWT token 管理
        sync-client.ts            Server sync API 客户端
      views/
        Login.tsx                 微信扫码登录页
        Dashboard.tsx             仪表盘首页
      styles.css                  Web 专属样式（复用 renderer 的 Tailwind 配置）
    vite.config.ts                标准 Vite 配置（非 electron-vite）
    tsconfig.json                 继承根 tsconfig，补充 web 路径
    index.html                    Web HTML

  electron.vite.config.ts         Electron 构建（不动）
  package.json                    新增 build:web / dev:web 脚本
```

### 5.1 共享机制

Web 端通过相对路径直接 import renderer 组件：

```ts
// web/src/App.tsx
import { StudyAnalyticsPage } from '../src/renderer/src/views/workbench/analytics/StudyAnalyticsPage'
import { OfficeWorkbench } from '../src/renderer/src/views/workbench/OfficeWorkbench'
```

组件内部调用 `window.teachingSystem.*`，Web 端在入口处注入 HTTP adapter 实现：

```ts
// web/src/main.tsx
import { createWebTeachingApi } from './adapters/teaching-api'

// 注入 Web 版实现，替换 Electron preload 的 contextBridge
;(window as any).teachingSystem = createWebTeachingApi()
```

### 5.2 Vite 配置

`web/vite.config.ts` 是标准 Vite + React + Tailwind，不走 electron-vite：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist/web',
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',  // 代理到 StudiumX-Server
    },
  },
})
```

---

## 6. Adapter 实现要点

### 6.1 teaching-api.ts

实现 TeachingSystemApi 的 Web 子集：

```ts
import type { TeachingSystemApi } from '../src/shared/teaching-types/system-api'

export function createWebTeachingApi(): TeachingSystemApi {
  return {
    platform: 'web',

    async getLearningAnalytics(request) {
      const res = await fetch('/api/analytics/summary?range=sevenDays', {
        headers: authHeaders(),
      })
      // Legacy summaries contain only headline totals. When the desktop has
      // consented to learning-analytics sync, v1 also carries a narrow,
      // chart-ready aggregate for focus/task visualizations — never teaching
      // evidence, raw timer facts, task titles, or workspace content.
      return res.json()
    },

    async readStudyPlanning({ workspaceRoot }) {
      const res = await fetch('/api/study-planning', {
        headers: authHeaders(),
      })
      if (!res.ok) return { ok: false, error: { code: 'NOT_FOUND', message: 'no snapshot' } }
      const data = await res.json()
      return { ok: true, snapshot: data, path: 'remote', source: 'canonical' as const }
    },

    async applyStudyPlanning({ expectedRevision, command }) {
      const res = await fetch('/api/study-planning', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          revision: expectedRevision,
          updatedAtMs: Date.now(),
          payload: command,
        }),
      })
      // 处理 409 conflict
      ...
    },

    async readLesson({ lessonId }) {
      const res = await fetch(`/api/lessons/${lessonId}/content`, {
        headers: authHeaders(),
      })
      return res.json()
    },

    // 不支持的方法
    async generateLesson() {
      throw new Error('generateLesson is not available on web')
    },
    async agentChatStream() {
      throw new Error('agent chat is not available on web')
    },
    // ...其余 not-supported 方法
  } as unknown as TeachingSystemApi
}
```

### 6.2 auth.ts

微信网页扫码登录流程（snsapi_login）：

```
1. Web 端展示微信扫码二维码（微信开放平台 oauth2/authorize）
2. 用户扫码授权，回调获得 code
3. POST /api/auth/wechat/login { code, platform: 'web' }
4. Server 返回 { accessToken, refreshToken, user }
5. token 存 localStorage，后续请求带 Authorization: Bearer <accessToken>
6. accessToken 过期时用 refreshToken 调 POST /api/auth/refresh
```

### 6.3 组件适配

桌面端的部分组件使用了 Electron 专属能力，Web 端需要处理：

| 组件 | Electron 依赖 | Web 适配 |
| --- | --- | --- |
| `App.tsx` 主框架 | window.controlWindow, 窗口 chrome | Web 版写独立 App.tsx，只组合查看类视图 |
| `SettingsView` | 本地 secret storage, provider 配置 | 只展示非敏感设置，provider 配置隐藏 |
| `OfficeWorkbench` | 本地计时器 dual-write 到文件 | 计时逻辑保留，dual-write 改为调 Server API |
| `StudyAnalyticsPage` | 本地 analytics 数据 | 改为从 Server GET /analytics/summary 拉取 |
| `MarkdownPreview` | 本地文件读取 | 只用于展示 Server 返回的归档内容，不读本地 |

---

## 7. Web 端功能范围

### 7.1 包含

| 功能 | 数据来源 | 交互 |
| --- | --- | --- |
| 微信扫码登录 | Server /auth/wechat/login | 扫码 -> JWT |
| 学习分析仪表盘 | Server /analytics/summary | 只读 + 图表展示 |
| 学习计划与任务 | Server /study-planning (GET/PUT) | 增删改任务、日程、计时计划 |
| 自习室计时器 | Web 前端本地计时 + Server 同步 | 番茄钟、专注计时 |
| 学习排行榜 | Server (sync/pull) | 只读展示 |
| 课程讲义浏览 | Server /lessons + /lessons/:id/content | 只读浏览已归档讲义 |
| 对话历史浏览 | Server /conversations + /conversations/:id/content | 只读浏览已归档对话 |
| 设备管理 | Server /devices | 查看已绑定设备 |
| 设置（非敏感） | Web localStorage | 界面偏好、主题等 |

### 7.2 不包含

| 功能 | 原因 |
| --- | --- |
| 课程/讲义生成 | 需要 AI provider key + 本地文件写入 |
| Agent 对话 | agent loop 在 Electron Main 执行 |
| 教学工作区管理 | 本地文件系统 |
| Provider/API Key 配置 | 本地 secret storage |
| MCP 工具 | 本地进程管理 |
| Git 分支管理 | 本地 git |
| Skill 库执行 | 本地文件 + agent loop |
| Web Remote Control | LAN server 是 Electron Main 的功能 |

---

## 8. 实施路线

### Phase 1：脚手架

- 创建 `web/` 目录结构
- 配置 Vite + React + Tailwind（复用 renderer 的 Tailwind 配置）
- 配置 tsconfig，确保能 import `src/renderer/src/` 和 `src/shared/`
- package.json 加 `dev:web` / `build:web` 脚本
- 验证：`pnpm dev:web` 能启动空白页面

### Phase 2：登录

- 实现微信网页扫码登录页（Login.tsx）
- 实现 auth.ts（token 管理、refresh 轮换）
- 对接 Server POST /auth/wechat/login
- 验证：扫码后拿到 JWT，存 localStorage

### Phase 3：Adapter 骨架

- 实现 teaching-api.ts 框架（teachingSystem 注入）
- 实现 not-supported 方法的统一报错
- 验证：Web 页面能调用 adapter 不崩溃

### Phase 4：学习分析仪表盘

- 移植 StudyAnalyticsPage 及图表组件
- adapter 实现 getLearningAnalytics（GET /analytics/summary）
- 验证：Web 端展示 Server 的派生图表数据；旧汇总仅显示 headline，已同意同步的 v1 aggregate 恢复专注/任务可视化，教学决策权威仍在本地 ledger/文件

### Phase 5：学习计划与自习室

- 移植 OfficeWorkbench / study-space 组件
- adapter 实现 readStudyPlanning / applyStudyPlanning
- 计时器 dual-write 改为 Server sync API
- 验证：Web 端可增删改任务、运行计时器、数据同步到 Server

### Phase 6：课程与对话浏览

- 移植讲义渲染组件（MarkdownPreview / lesson HTML 渲染）
- adapter 实现 readLesson / projectAgentConversationSummaries / readAgentConversation
- 验证：Web 端可浏览已归档的课程和对话

### Phase 7：Landing 联通

- landing 页面"登录"按钮跳转到 Web 端 URL
- landing 独立仓库创建
- 验证：landing -> 登录 -> Web 仪表盘 全链路

---

## 9. 红线与约束

继承自 StudiumX 和 StudiumX-Server 的既有红线：

1. **Web 端不做教学执行引擎** -- 不持有模型 key、不运行 agent loop、不写教学工作区文件。
2. **Web 端是 Server 的又一个 device** -- 通过 sync API 参与同步。`local-wins` 只适用于教学资产的归档冲突；等级/XP、偏好、规划与经同意的派生摘要按各自的同步契约处理，且不得成为 AI 教学决策 authority（ADR-0167）。
3. **Token 安全** -- accessToken 存 localStorage（短期 15m），refreshToken 存 httpOnly cookie 或 localStorage（30d 轮换）。不存微信 access_token。
4. **分析数据默认关闭** -- 用户需在 Web 端显式开启"学习分析同步"才上传派生摘要（继承 Server §5.4 红线）。
5. **组件共享不破坏桌面端** -- Web 端通过 adapter 注入 teachingSystem，不修改 renderer 既有组件源码。如果某组件需要 Web 适配，通过运行时检测 `platform === 'web'` 分支处理，不拆分组件。

---

## 10. 待定问题

| 问题 | 说明 | 倾向 |
| --- | --- | --- |
| Web 端计时器离线怎么办 | 计时是本地行为，断网时 Web 端无法 sync | 本地计时正常运行，联网后批量 push |
| 排行榜数据来源 | Server 目前没有排行榜 API，只有 sync/pull | 需要 Server 新增排行榜聚合端点 |
| 多 workspace 在 Web 端怎么呈现 | 桌面端有多 workspace，Web 端只读归档 | Web 端展示所有已同步 workspace 的归档列表，不做 workspace 切换 |
| Tailwind 配置共享方式 | renderer 用 @tailwindcss/vite，Web 端需要相同配置 | 抽取 tailwind config 到共享文件，两端引用 |
