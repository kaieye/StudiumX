# 自习室 · 学习数据分析页规划

> **状态**：规划定稿（WP-0 契约已冻结，待 P0 实现）  
> **关联入口**：自习室（`OfficeWorkbench`）左下角「数据分析」按钮  
> **目标页面**：全屏学习分析页（路由 `?workbench=analytics`）  
> **设计原则**：Apple Design（克制层级、透光材料、可打断动效、空间一致性）  
> **范围**：覆盖 StudiumX 当前应用的主要数据面——自习习惯、任务计划、AI Token、课程资产、复习、记忆、技能/模型等  
> **指标与接口契约**：[`study-analytics-metric-contract.md`](./study-analytics-metric-contract.md)（口径冲突时以契约为准）

---

## 1. 背景与目标

### 1.1 为什么做

自习室目前已具备番茄钟、任务清单、周历计划、实时榜单与座位等能力，但**缺少一份把「学了多久 / 学到什么 / AI 花了多少」串起来的总览**。用户需要一个从自习室一键进入的分析页，用来复盘与决策下一步学习动作。

### 1.2 成功标准

- 自习室左下角有清晰可点的数据分析入口
- 进入后 3 秒内能看到：本周专注、连胜、学习热力图主视觉、Token 用量、一句洞察
- 数据要素覆盖应用主链路，而非仅番茄钟统计
- 热力图按**学习/专注时间**上色，Token 用量可拆输入/输出并可按对话/工作区聚合
- 导航与任务详情页（`StudyTaskSchedulePage`）一致：可前进/后退、不打断进行中的番茄钟
- 视觉与动效符合 Apple Design：即时反馈、源点锚定、reduced-motion 友好

### 1.3 非目标（首期）

- 云同步、多用户跨设备汇总
- 服务端分析大盘
- 强制 AI 生成洞察文案（可用规则引擎；LLM 洞察为可选增强）
- 把分析页做成可编辑的数据管理后台

---

## 2. 入口与导航

### 2.1 入口位置

| 项 | 方案 |
|---|---|
| **位置** | 自习室画布**左下角**浮动按钮（FAB） |
| **布局关系** | 与左上榜单、右侧工具栏形成三角分区，不遮挡座位热区 |
| **文案 / 图标** | 图标 `ChartColumn`（或同类）+ 简短 label「学习分析」/「数据」 |
| **材质** | 与 workbench 一致的玻璃表面：`backdrop-filter: blur() saturate()` + 半透明底 |
| **反馈** | `pointer-down` 即 `scale(0.97)`；不要等 `click` 才高亮 |
| **可达性** | `aria-label="打开学习分析"`；键盘可聚焦；`:focus-visible` 描边 |

**自习室布局示意**

```
┌─────────────────────────────────────────────┐
│  [榜单 左上]              [工具栏 右侧]      │
│                                             │
│              像素自习室画布                   │
│                                             │
│  [数据分析 左下]                             │
└─────────────────────────────────────────────┘
```

### 2.2 路由

与任务详情页同一套 workbench 子路由约定：

| 页面 | 查询参数 | 说明 |
|---|---|---|
| 自习室 | `?workbench=1` | 默认房间视图 |
| 任务详情 | `?workbench=schedule` | 现有 `StudyTaskSchedulePage` |
| **学习分析** | `?workbench=analytics` | 新增 |

行为要求：

- `navigateWorkbenchRoute('analytics' | 'room' | 'schedule')`
- 支持 `popstate`（浏览器/系统后退回到自习室）
- 打开分析页时**不销毁** `useStudySession`；番茄钟在后台继续计时
- URL 同步失败时（异常环境）仍允许 React 本地 state 打开页面

### 2.3 过渡动效（Apple Design）

| 原则 | 落地 |
|---|---|
| **Spatial consistency** | 从左下 FAB 源点展开（`transform-origin` 锚定触发按钮）；返回沿原路径收回 |
| **Interruptible** | 过渡可被返回手势/点击打断，从当前呈现值继续，不锁输入 |
| **Default spring** | critically damped（无多余弹跳）；`bounce: 0`，`duration ~0.35–0.45s` |
| **Reduced motion** | `prefers-reduced-motion: reduce` 时改为短 opacity cross-fade，取消位移弹簧 |

---

## 3. 页面信息架构

### 3.1 命名

| 用途 | 文案 |
|---|---|
| 页面标题 | **学习分析** |
| 英文/备用 | Learning Insights |
| 入口按钮 | 学习分析 / 数据 |
| 副标题模式 | 时间范围摘要 + 一句话洞察，例如：「本周专注 12.4h · 连胜 5 天」 |

### 3.2 顶部 Sticky 控制栏

轻玻璃 sticky header，内容滚动时贴顶：

| 控件 | 说明 |
|---|---|
| 返回 | 回自习室（与 `study-schedule-back` 同构） |
| 标题 | 学习分析 |
| **时间范围** | 今日 / 本周 / 本月 / 近 90 天 / 全部 / 自定义 |
| **Teaching scope** | 当前教学工作区 / 全部教学工作区；仅影响有 workspace 归属的数据 |
| **Scope 提示** | 个人专注固定为本机 learner；Presence 固定为当前 space 实时快照，不随 Teaching scope/range 改变 |
| 导出（次要，二期） | CSV / JSON |

Wayfinding：每个 section 有稳定锚点 id，KPI 卡点击可平滑滚到对应章节。

### 3.3 首屏 Hero KPI 带（6 张主指标卡）

立刻回答「我学得怎样」：

| KPI | 主数据来源 | 展示备注 |
|---|---|---|
| **专注时长** | P0 当前 snapshot；P1 起按 range 聚合 facts | 主数字 + 单位 + 环比；无历史时明确状态 |
| **学习会话** | P0 当前/今日 snapshot；P1 起按 range 聚合 completed focus facts | 完成的专注番茄数 |
| **连续学习** | P0 legacy `streakDays`；P1 本地日 streak | 当前连胜，range-invariant；P0 UTC 历史需 partial warning |
| **等级 & XP** | `xp` + `studyLevel()` 当前快照 | 当前累计，range-invariant |
| **Token 用量** | turn/run `usage.totalTokens` 聚合 | 可拆输入/输出 |
| **任务完成率** | current tasks done / total | 当前库存，range-invariant；区间完成数另算 |

每张卡结构：

- 大数字（负 tracking）+ 单位
- 迷你 sparkline（有历史时）
- 环比箭头（↑↓ 与上期对比）
- 点击 → 滚到对应详细 section

---

## 4. 内容分区（覆盖全应用）

以下分区按页面默认滚动顺序排列。首屏优先 A + C 的主视觉；其余可默认展开或折叠（实现时可把 D/F/G 默认折叠以降低噪音）。

---

### A. 专注与习惯（自习室核心）

| 模块 ID | 名称 | 可视化 | 数据要素 |
|---|---|---|---|
| **A1** | 学习热力图 | GitHub 风格日历热力，**按专注秒数**上色 | 日粒度 `focusSeconds`；hover：日期、时长、会话数、任务完成；图例 0→深 |
| **A2** | 时段分布 | 24×7 网格 或 24h 柱状 | 按小时桶累计专注；标出「黄金时段」 |
| **A3** | 专注趋势 | 面积/折线 | 日/周专注时长、会话数；可选对比上期 |
| **A4** | 番茄结构 | 堆叠条 / 双环 | 专注 vs 休息；平均会话长；完成率；中断次数（若可记） |
| **A5** | 模式 / 房间 | 横向条 | `modeId`（自由/同频/深度/考试）与 `roomId`（静音/冲刺/深度/备考）时长占比 |
| **A6** | 信号偏好 | 小 pill + 占比 | `signalId`：阅读 / 写作 / 练习 / 复习 / 考试 |
| **A7** | 徽章与成长 | 徽章墙 + 植物阶段 | 现有 badges + `studyPlantStage(xp)`；未解锁灰色 |

#### A1 热力图交互细节

- **悬停**：即显 tooltip（日期 · 时长 · 会话），无需点击
- **点击某日**：下方或侧栏 drill-down 当日明细（会话列表、任务、token）
- **月份浏览**：横向滚动或切换；边界 rubber-band，硬停会显得「卡死」
- **空态**：全空格子 + 引导「完成第一个番茄后这里会亮起来」

#### 数据缺口（热力图/趋势的前提）

当前 `StudySnapshot` 仅有今日与累计字段，**没有按日历史**。`viewModel.weeklyFocus` 目前为占位比例，不能直接作为真实热力图数据。

必须新增按日日志（见第 6 节）。

---

### B. 任务与计划

| 模块 ID | 名称 | 可视化 | 数据要素 |
|---|---|---|---|
| **B1** | 完成漏斗 | 进度环 + 列表 | 待办 / 已完成、完成率、逾期（有 schedule 且过期未完成） |
| **B2** | 计划 vs 实际 | 对比条 | 可重建 schedule history 的计划时长 vs 显式 task attribution 专注；「计划执行率」 |
| **B3** | 任务耗时 Top | 排行 | 有 schedule 的任务按时长排序；完成状态 |
| **B4** | 工作日负荷 | 7 日条形 | 每天计划任务数 / 完成数 |

**来源**：`StudyTask[]` 及其 `schedule` 字段（与 `StudyTaskSchedulePage` 同源）。

---

### C. AI 对话与 Token 用量

| 模块 ID | 名称 | 可视化 | 数据要素 |
|---|---|---|---|
| **C1** | Token 总览 | 大数字 + 双色环 | `promptTokens` / `completionTokens` / `totalTokens` |
| **C2** | Token 趋势 | 日/周柱状 | 按日聚合 token；可与专注时长叠对比 |
| **C3** | 按对话排行 | 表格 | 标题、消息数、tokens、providerCalls、toolCalls、时长、状态 |
| **C4** | 按工作区 / 课程 | 树状条 / treemap | workspace → course → conversation |
| **C5** | 运行效率 | 指标卡 / 散点 | tokens/会话、tokens/消息、tool 错误率、budget stop 次数 |
| **C6** | 上下文治理 | 指标条 | compaction 节省 tokens、hygiene `savedTokens`、child runs 占比 |
| **C7** | 工具调用分布 | 横向条 | web_search / web_fetch / workspace / skill / ask 等 |

#### 数据源优先级

1. 会话 turn 内 `runUsage` / `AgentRunUsageAggregate`（conversation-first）
2. `.studiumx/learning-work.jsonl` 的 `evidence.runUsage`（仅 conversation 缺失或完全无 usage 时按 conversation 兜底）
3. session audit 仅作诊断；v1 不与 conversation usage 叠加

ledger 是追加式 conversation snapshot：同一 conversation 只能选择最新有效 snapshot，不能把多行求和；采用 conversation 数据后必须忽略其全部 ledger snapshots。部分 turn 缺 usage 时使用已有 turn 并标记 `partial`，不得再叠加 ledger。完整规则见指标契约第 7 节。

---

### D. 课程 · 讲义 · 学习资产

| 模块 ID | 名称 | 可视化 | 数据要素 |
|---|---|---|---|
| **D1** | 资产盘点 | 指标网格 | courses / sessions / lessons / resources / records / references / conversations |
| **D2** | 课程进度 | 课程卡列表 | 每课 session 数、lesson 数、最近更新、是否 pinned |
| **D3** | 讲义时间线 | 时间轴 | `LessonSummary.createdAt`、`durationMinutes`、objective 摘录 |
| **D4** | 学习记录 | 列表（词云可选） | `LearningRecordSummary` 密度、最近 N 条 |
| **D5** | Mission 健康度 | 状态卡 | mission 是否填写、excerpt 长度、距上次更新 |

**来源**：`TeachingWorkspaceSummary` / `TeachingAppState`（文件系统为真相来源）。

---

### E. 复习与检索练习

| 模块 ID | 名称 | 可视化 | 数据要素 |
|---|---|---|---|
| **E1** | 测验正确率 | 大环 + 趋势 | `ProgressSummary.totalAnswered` / `correct` |
| **E2** | 分课薄弱点 | 条形 / 热力 | `byLesson` answered/correct；标红薄弱课 |
| **E3** | 复习卡片库存 | 数字 + 列表 | `ReviewCard` 数量；按 lesson 分组 |
| **E4** | 间隔复习建议 | 建议列表（二期） | 基于上次错误题与时间衰减 |

**来源**：`GetProgressResult` / `ListReviewCardsResult`（`teaching-workspace/review.ts`）。

---

### F. 记忆与个性化

| 模块 ID | 名称 | 可视化 | 数据要素 |
|---|---|---|---|
| **F1** | 记忆库存 | 数字 + scope 饼图 | user / workspace / project；active vs tombstone |
| **F2** | 标签分布 | tag chips | `TeachingMemoryRecord.tags` |
| **F3** | 置信度 | 直方图 | `confidence` 分布 |
| **F4** | 注入活跃度 | 列表 | `lastInjectedIds`、最近更新记忆 |

**来源**：`TeachingMemoryDiagnostics` + memory list API。

---

### G. 技能 · 宠物 · 模型与变更（轻量全覆盖）

| 模块 ID | 名称 | 数据要素 |
|---|---|---|
| **G1** | Skill | 已安装 skill 数、分类分布；有 slash 使用日志则展示最近使用，否则仅库存 |
| **G2** | 宠物 | 当前 `petAppearance`；与等级 / 植物阶段的叙事关联 |
| **G3** | 模型与生成 | 默认 provider/model、最近生成 lesson 次数、失败率（runtime / change history） |
| **G4** | 工作区变更 | `changeHistory` / `recentChangeSummary` 近 7 日写入密度 |
| **G5** | 连接器 / 搜索 | 配置是否就绪（**不展示密钥**）；搜索 backend 使用次数（若 ledger 含 tool 名） |

---

### H. 社交自习室（Presence 只读快照）

| 模块 ID | 名称 | 数据要素 |
|---|---|---|
| **H1** | 房间活跃 | 当前 space 在线人数、房间占用率、同桌专注时长和 |
| **H2** | 事件流摘要 | checkin / focus_start / task_done / cheer 计数（会话级，可不持久） |
| **H3** | 本机 vs 房间 | 自己今日时长在榜单中的百分位 |

说明：presence 是实时态。分析页以「当前快照 + 本机会话统计」为主，**不虚构历史在线曲线**。

---

### I. 洞察与行动（页尾）

| 模块 ID | 名称 | 内容 |
|---|---|---|
| **I1** | 规则 / AI 洞察 | 3 条可解释结论，例如：「你在 21–23 点专注最高」「Token 多用于检索工具」「薄弱课：XXX」 |
| **I2** | 下一步行动 | 深链：继续专注 / 打开薄弱课 / 复习错题 / 整理 mission |
| **I3** | 数据说明 | 数据来自本机；可清除 / 导出；无云同步 |

---

## 5. 页面线框

### 5.1 桌面宽布局

```
┌─ sticky: [← 返回] 学习分析    [今日|本周|本月|全部] [工作区▾] ─┐
│ Hero 洞察条：「本周 12.4h · 连胜 5 · Token 2.1M」              │
│ ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐                       │
│ │专注││会话││连胜││等级││Token││任务│  KPI 行                │
│ └────┘└────┘└────┘└────┘└────┘└────┘                       │
│ ┌──────────────────────────┐ ┌─────────────┐                 │
│ │  A1 学习热力图 (主视觉)   │ │ A2 时段分布  │                 │
│ │  (12 个月 / 按专注时间)   │ │  24h / 周   │                 │
│ └──────────────────────────┘ └─────────────┘                 │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│ │ A3 专注趋势   │ │ C1 Token 总览 │ │ C2 Token 趋势 │           │
│ └──────────────┘ └──────────────┘ └──────────────┘           │
│ ┌─────────────────────┐ ┌─────────────────────┐             │
│ │ B 任务执行          │ │ E 复习正确率/薄弱点  │             │
│ └─────────────────────┘ └─────────────────────┘             │
│ ┌──────────────────────────────────────────────┐             │
│ │ D 工作区资产：课程/讲义/资源/记录/对话        │             │
│ └──────────────────────────────────────────────┘             │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│ │ C3 对话 Token│ │ F 记忆       │ │ G 技能/模型  │           │
│ │    排行表     │ │              │ │              │           │
│ └──────────────┘ └──────────────┘ └──────────────┘           │
│ I 洞察 + 行动建议 + 数据来源说明                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 窄屏

- 单列瀑布布局
- 热力图区域可横向滚动
- KPI 采用 2×3 网格
- sticky 筛选可折为第二行或 sheet

### 5.3 首屏 3 秒内必须可见

1. 本周专注多久 / 连胜  
2. **学习热力图**（主视觉）  
3. **Token 用量**  
4. 一句可执行洞察  

其余内容进入二级滚动或默认折叠，避免仪表盘过载。

---

## 6. 数据模型与来源

### 6.1 已有可直接使用的数据

| 域 | 已有结构 / 位置 | 可用于 |
|---|---|---|
| 自习快照 | `StudySnapshot`（`study-space/types.ts`） | 今日/累计专注、会话、连胜、XP、任务、mode/room/signal |
| 实时房间 | presence peers / events | H 区快照 |
| 工作区目录 | `TeachingWorkspaceSummary` | D 区资产盘点 |
| 复习进度 | `ProgressSummary` / `ReviewCard` | E 区 |
| Token / 运行 | `AgentRunUsageAggregate`、turn metadata | C 区 |
| 工作台账 | `.studiumx/learning-work.jsonl` | conversation 快照 + `runUsage` |
| 记忆 | `TeachingMemoryDiagnostics` / `TeachingMemoryRecord` | F 区 |
| 设置 | provider / pet / theme 等 | G 区只读摘要 |

#### `StudySnapshot` 关键字段（摘录）

```ts
// src/renderer/src/study-space/types.ts
export type StudySnapshot = {
  // ...
  focusMinutes: number
  breakMinutes: number
  todayFocusSeconds: number
  todaySessions: number
  totalFocusSeconds: number
  totalSessions: number
  streakDays: number
  xp: number
  lastStudyDate: string
  tasks: StudyTask[]
  modeId: StudyModeId
  roomId: StudyRoomId
  signalId: StudySignalId
  // ...
}
```

#### `AgentRunUsageAggregate`（摘录）

```ts
// src/shared/teaching-types/agent.ts
export type AgentRunUsageAggregate = {
  providerCalls: number
  toolCalls: number
  toolErrors: number
  iterations: number
  childRuns: number
  durationMs: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  budgetStopReason?: AgentRunBudgetStopReason
}
```

### 6.2 必须新增：事实存储 + 按日投影

热力图与真实趋势依赖不可变 `StudySessionFact` / `StudyActivityFact`。`StudyDailyProjection`（原规划 `StudyDailyLog`）只允许作为由 facts 重建的读模型，不能作为唯一真相，也不能与 fact 独立双写累加。

冻结要求：

1. 使用本地自然日键，周一为周首；当前 `todayKey()` 的 UTC 日期行为不能用于 analytics。
2. 专注/休息 session 保存绝对时间、本地日、offset、active/paused 秒，并在本地午夜/offset 变化处分段。
3. task created/completed/reopened/schedule changed/deleted 写 activity fact；session 的 task attribution 只能在开始时显式捕获 task ID。
4. tracking start 与首个数据日分开记录；analytics-owned facts/projections 滚动保留 400 个本地日期（含今天）。
5. 完整存储结构见 `src/shared/teaching-types/analytics.ts` 与指标契约第 5、9、10 节。

### 6.3 冻结的共享 DTO

Token、页面 bundle、section 五态、coverage/warnings、scope、导出/清除请求统一定义于：

- `src/shared/teaching-types/analytics.ts`
- `docs/study-analytics-metric-contract.md`

实现不得复制本节旧的“建议类型”到 renderer 私有目录后自行演化。Main/preload/renderer 应共享 `LearningAnalyticsQuery`、`LearningAnalyticsBundle` 与 `AnalyticsSectionResult<T>`；renderer 私有展示类型集中在 `views/workbench/analytics/types.ts`。

---

## 7. Apple Design 落地清单

| 原则 | 落地 |
|---|---|
| **Purpose** | 一页看清「学了多久、学会了什么、AI 花了多少」；拒绝无因果的装饰图 |
| **Simplicity** | 首屏 6 KPI + 热力图；其余 section 可折叠；默认展开 A/C |
| **Materials** | 卡片复用 workbench glass surface；热力格子用实色保证可读（不把数据糊在毛玻璃上） |
| **Motion** | section 入场 opacity + 轻微 y；默认 critically damped；reduced-motion → cross-fade |
| **Spatial consistency** | FAB 源点展开 / 原路返回 |
| **Feedback** | 热力 hover tooltip；KPI 可点跳转锚点；按钮 down 即反馈 |
| **Agency** | 时间范围与工作区筛选常驻；导出/清除在页脚；破坏性操作需确认 |
| **Typography** | KPI 大数字负 tracking（约 `-0.02em`）；正文 system-ui；表格紧凑 |
| **Responsibility** | 全部本机数据；不上传；密钥永不展示 |
| **Wayfinding** | 每屏能回答：我在哪、能去哪、怎么回去 |

### 7.1 材质与主题

- 跟随 `data-resolved-theme` light/dark
- 分析页背景用 app shell 主背景，卡片悬浮于内容之上
- 热力图色阶建议：低饱和蓝绿或系统强调色阶梯，确保 dark 模式对比度
- `prefers-reduced-transparency` 时提高卡片不透明度、取消 blur

### 7.2 手势与指针

- 热力格子 hit padding 略放大，避免难点
- 横向滚动区域支持触控板与鼠标滚轮
- 边界 rubber-band，避免 hard stop

---

## 8. 实现结构建议

### 8.1 文件结构

```
src/shared/teaching-types/analytics.ts  # P0–P3 shared contract / facts / bundle
src/renderer/src/views/workbench/
  OfficeWorkbench.tsx                 # 左下 FAB + analytics 路由分支
  StudyAnalyticsPage.tsx              # 页面壳：筛选、section 编排、返回
  office-workbench.css                # + analytics / FAB 样式
  analytics/
    types.ts                          # renderer-only section/view models；共享 DTO 在 shared analytics.ts
    useStudyAnalytics.ts              # 聚合 hook（或调 IPC）
    studyAnalyticsStore.ts            # facts 持久化、400 天裁剪、Daily projection 重建
    mock.ts                           # 优雅空态 / 开发示意（可选）
    AnalyticsKpiStrip.tsx
    FocusHeatmap.tsx                  # 学习时间热力图
    HourlyFocusChart.tsx
    FocusTrendChart.tsx
    TokenUsagePanel.tsx
    ConversationTokenTable.tsx
    TaskExecutionPanel.tsx
    WorkspaceAssetsPanel.tsx
    ReviewProgressPanel.tsx
    MemoryPanel.tsx
    PresenceSnapshotPanel.tsx
    InsightsFooter.tsx
```

可选主进程：

```
src/main/
  learning-analytics.ts               # 聚合 conversations / ledger / review
# IPC 注册于 teaching-ipc-commands 等现有入口
```

### 8.2 与现有页面一致性

复用 `StudyTaskSchedulePage` 模式：

- 全屏 `office-workbench-page` 子页
- 顶栏返回按钮
- `navigateWorkbenchRoute`
- 不销毁自习 session

`OfficeWorkbench` 伪代码：

```tsx
// 路由
// workbench=1        → 房间
// workbench=schedule → 任务详情
// workbench=analytics→ 学习分析

if (analyticsOpen) {
  return (
    <section className="office-workbench-page" aria-label="学习分析">
      <StudyAnalyticsPage onBack={closeAnalytics} /* bundle props or hook */ />
    </section>
  )
}

// 房间视图左下角
<button
  type="button"
  className="workbench-analytics-fab"
  onClick={openAnalytics}
  aria-label="打开学习分析"
>
  {/* ChartColumn */} 学习分析
</button>
```

### 8.3 写入 Session fact 的钩子点

优先挂在现有 `study-space/session/transitions.ts` 的会话结算路径，先持久化幂等 `StudySessionFact`，再由 fact 更新/重建 Daily projection；task mutation 路径同步写 lifecycle facts，避免 UI 层重复或启发式记账。

---

## 9. 分阶段交付

| 阶段 | 范围 | 验收要点 |
|---|---|---|
| **WP-0** | 指标口径、scope、状态、事实模型与共享 DTO 冻结 | 契约和 P0–P3 类型可编译；后续实现无隐含口径 |
| **P0** | 左下入口 + 页面壳 + Hero 当前/累计 KPI + 正确五态/coverage 的空态 + 返回路由 | 可进可出；不打断番茄；不使用假历史；range-invariant 指标有明确标签 |
| **P1** | session/activity facts + task history/显式 attribution + Daily projection + 真实热力图/趋势/时段 | 本地日/跨日正确；投影可重建；400 天裁剪正确 |
| **P2** | Conversation-first Token + ledger fallback 去重 + 任务/复习/资产 + Presence 快照 | 缺 usage/fallback 有 partial warning；Presence 不随 range |
| **P3** | 规则洞察、导出/清除、计划 vs 实际、记忆/技能深化、自定义日期 | 洞察可解释；导出脱敏；清除不误删源数据 |

---

## 10. 空态、边界与隐私

### 10.1 空态

| 场景 | UI |
|---|---|
| 新用户无专注记录 | 热力图全空 + 引导完成第一个番茄 |
| 无打开工作区 | D/E/F/C 的工作区相关块显示「打开或创建教学工作区后可见」 |
| 无任何对话 usage | Token 区显示 0 + 说明「完成带 usage 的对话后显示」 |
| 部分会话缺 usage | 总量旁 warning 文案，不假装精确 |

### 10.2 边界

- 时间范围切换不丢滚动位置的 section 偏好（可选记住折叠状态）
- 大数据量（数百会话）时表格虚拟滚动或 Top N +「查看更多」
- ledger / analytics 文件损坏时降级为空态，不白屏

### 10.3 隐私与责任

- 所有分析数据默认**仅本机**，不上传到云端分析服务
- 不在 UI/bundle/export 展示 API Key、secret endpoint、绝对路径、conversation/Mission/memory 正文或 tool 参数/结果
- 默认 `summary` 导出只含聚合与 coverage；`detailed` 显式选择后可含页面已显示的名称/标题，但仍排除正文与 secrets
- 清除分为 derived cache、personal activity history、analytics preferences；不得删除 Teaching workspaces、conversations、ledger、review、memory 或 current tasks
- 破坏性清除需二次确认，并明确可重建 Token/资产数据会在重扫后再次出现

---

## 11. 无障碍与国际化

| 项 | 要求 |
|---|---|
| 语义 | 页面 `aria-label` / 标题 `aria-labelledby`；KPI 用可读 `aria-label` |
| 键盘 | FAB、返回、范围切换、表格行均可键盘操作 |
| 对比度 | 热力最低档与背景可区分；dark/light 双测 |
| 动态文字 | 布局用 `rem`/`em` 间距，避免大字体撑破 KPI |
| i18n | 文案走现有 i18n 习惯（`zh-CN` / `en-US`）；首期可先中文，键名预留 |

---

## 12. 指标定义（口径）

统一口径，避免页面各图表数字互相矛盾。

| 指标 | 定义 |
|---|---|
| **专注时长** | range 内 personal focus facts 的 active focus seconds；暂停不计；跨本地自然日分段 |
| **学习会话** | range 内正常完成的 focus session 数；跨日会话数归完成日 |
| **连胜 / XP / 等级** | 截至当前的 snapshot/派生值，range-invariant |
| **Token 总量** | conversation turn usage 优先；conversation 缺失或完全无 usage 时按 conversation 选最新 ledger snapshot 兜底；两源不叠加 |
| **Prompt / Completion** | 有字段才累加；只有 total 时不伪造拆分，并标记 components missing |
| **当前任务完成率** | 当前 `done === true` 数 / 当前任务总数；分母 0 为 —；range-invariant |
| **区间任务完成数** | range 内 `task_completed` activity facts 数；不能由当前 done 状态倒推 |
| **计划执行率** | 显式归因到有计划 task 的 focus seconds / 可由 schedule history 重建的 planned seconds；允许 >100%，无完整历史为 — |
| **累计正确率** | 当前 `correct / totalAnswered`，range-invariant；有 timestamped review facts 后另算 range 正确率 |

完整口径、状态和边界以 [`study-analytics-metric-contract.md`](./study-analytics-metric-contract.md) 为准。

---

## 13. 与领域语言的对齐

遵循仓库 `CONTEXT.md` 用语：

| 使用 | 避免 |
|---|---|
| Teaching workspace / 教学工作区 | project（指工作区时） |
| Mission | prompt（指学习意图时） |
| Lesson | page / generated output |
| Learning record | log / transcript（指学习记录时） |
| Agent conversation | chat log |
| Course / Session | folder / chapter |

分析页对外文案优先中性学习语言：「专注时长」「讲义」「学习记录」「对话 Token」，避免工程黑话直出（内部类型名可保留）。

---

## 14. 测试清单（实现时）

### 14.1 功能

- [ ] 左下 FAB 打开分析页，URL 变为 `workbench=analytics`
- [ ] 返回 / 浏览器后退回到自习室
- [ ] 打开分析页期间番茄钟继续走时
- [ ] KPI 与 snapshot / 聚合数据一致
- [ ] 完成番茄后 Session fact 幂等写入，Daily projection/热力图由 fact 更新
- [ ] 跨日切分正确
- [ ] Token 聚合与抽样会话 usage 一致
- [ ] 无工作区 / 无数据空态可读
- [ ] 时间范围切换后各图同步

### 14.2 视觉与动效

- [ ] light / dark 主题
- [ ] reduced-motion 无大幅位移
- [ ] reduced-transparency 卡片可读
- [ ] 窄屏不横向撑破主壳

### 14.3 回归

- [ ] 任务详情 schedule 路由仍可用
- [ ] 榜单 / 番茄 / 任务工具栏布局不被 FAB 遮挡
- [ ] 座位点击与键盘切座不受 FAB 影响

---

## 15. 决策记录（当前约定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 入口位置 | 自习室左下角 FAB | 用户明确要求；与右上工具区分区 |
| 信息架构 | 单页分区滚动 + sticky 筛选 | 比多 tab 更适合「总览复盘」；tab 可作为后续增强 |
| 热力度量 | 专注秒数 | 用户明确要求按学习时间 |
| Token | 独立大区，非埋在设置里 | 教学助手核心成本与使用面 |
| 历史存储 | 本机不可变 facts + 可重建 Daily projection；现有 ledger 仅 Token fallback | 防止双写漂移与 ledger snapshot 重复计数 |
| 实现节奏 | WP-0→P3 | 先冻结口径与接口，再通路、事实历史和全应用聚合 |

---

## 16. 下一步

1. 以 [`study-analytics-metric-contract.md`](./study-analytics-metric-contract.md) 和 shared analytics types 作为实现边界  
2. 启动 **P0**：`workbench-analytics-fab` + `StudyAnalyticsPage` 骨架 + 正确五态/coverage + 当前/累计 KPI  
3. **P1** 在 timer transition 同源路径写 `StudySessionFact`，并在 task mutation 路径写 lifecycle facts；Daily projection 只从 facts 更新/重建  
4. **P2** 按 conversation-first + ledger fallback 去重规则接通 Token  

---

## 附录 A · 模块速查表

| ID | 分区 | 模块 | 优先级 |
|---|---|---|---|
| KPI | Hero | 6 张主指标 | P0 |
| A1 | 专注 | 学习热力图 | P0 正确状态空态 / P1 facts 驱动真实数据 |
| A2 | 专注 | 时段分布 | P1 |
| A3 | 专注 | 专注趋势 | P1 |
| A4 | 专注 | 番茄结构 | P1 |
| A5 | 专注 | 模式/房间 | P1 |
| A6 | 专注 | 信号偏好 | P1 |
| A7 | 专注 | 徽章与成长 | P0（可用现成 snapshot） |
| B1–B4 | 任务 | 当前库存 + 历史完成/计划/归因 Top | P1 记录 facts / P2 展示 |
| C1 | Token | 总览 | P0 正确状态 / P2 完整聚合 |
| C2–C7 | Token | 趋势/排行/效率/工具 | P2 |
| D1–D5 | 资产 | 课程讲义资源记录 | P2 |
| E1–E3 | 复习 | 正确率/薄弱/卡片 | P2 |
| E4 | 复习 | 间隔建议 | P3 |
| F1–F4 | 记忆 | 库存/标签/置信度 | P3 |
| G1–G5 | 其它 | 技能/宠物/模型/变更 | P3 |
| H1–H3 | 社交 | 在线快照 | P2（轻量） |
| I1–I3 | 洞察 | 结论/行动/说明 | P0 静态说明 / P3 规则洞察 |

## 附录 B · 相关代码索引

| 路径 | 作用 |
|---|---|
| `src/renderer/src/views/workbench/OfficeWorkbench.tsx` | 自习室壳、schedule 路由范式 |
| `src/renderer/src/views/workbench/StudyTaskSchedulePage.tsx` | 全屏子页 + 返回交互参考 |
| `src/renderer/src/views/workbench/WorkbenchTasks.tsx` | 任务清单与打开详情入口 |
| `src/renderer/src/views/workbench/WorkbenchPomodoro.tsx` | 番茄钟 UI |
| `src/renderer/src/views/workbench/WorkbenchLeaderboard.tsx` | 榜单 |
| `src/renderer/src/views/workbench/office-workbench.css` | 自习室样式与玻璃 token |
| `src/renderer/src/study-space/types.ts` | `StudySnapshot` 等类型 |
| `src/renderer/src/study-space/domain.ts` | 时长格式化、等级、连胜 |
| `src/renderer/src/study-space/viewModel.ts` | 房间 VM；`weeklyFocus` 占位 |
| `src/renderer/src/study-space/session/transitions.ts` | 番茄状态迁移与结算（Session fact 同源写入点） |
| `src/renderer/src/study-space/session/useStudySession.ts` | 会话 hook |
| `src/main/learning-work-ledger.ts` | learning-work.jsonl |
| `src/main/teaching-workspace/review.ts` | 复习进度 |
| `src/shared/teaching-types/agent.ts` | usage / conversation 类型 |
| `src/shared/teaching-types/workspace.ts` | 工作区目录类型 |
| `src/shared/teaching-types/memory.ts` | 记忆类型 |
| `CONTEXT.md` | 领域用语 |

---

*文档生成自学习分析页产品/交互规划讨论，可直接作为 P0–P3 实现依据。*
