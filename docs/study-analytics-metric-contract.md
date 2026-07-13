# 学习分析指标与接口契约（v1）

> **状态**：已冻结（WP-0）  
> **契约版本**：`contractVersion: 1`  
> **类型定义**：`src/shared/teaching-types/analytics.ts`  
> **渲染层视图类型**：`src/renderer/src/views/workbench/analytics/types.ts`  
> **适用阶段**：P0–P3

本文档是学习分析的数据与指标权威口径。`docs/study-analytics-page-plan.md` 负责产品布局和分期；两者冲突时，以本文档和共享类型为准。后续实现者不得在组件、hook 或 IPC 内另创日期、范围、状态、去重或隐私语义。

---

## 1. 本轮审计结论

当前代码能提供 `StudySnapshot` 当前/累计值、当前任务数组、Teaching workspace catalog、复习累计进度、Agent conversation turn metadata、append-only learning-work ledger 和 Presence 实时态，但存在以下不可回避的数据缺口：

1. `StudySnapshot` 没有按日、按小时、按任务的历史，不能生成真实热力图或历史趋势。
2. `src/renderer/src/study-space/domain.ts` 的 `todayKey()` 和 `nextStudyStreak()` 当前使用 ISO/UTC 日期，得到的边界不满足本契约的本地自然日。分析实现不得复用该行为；后续写入 worker 必须使用本地年月日构造键，并迁移 streak 更新逻辑。
3. `StudyTask` 只有 `id/title/done/schedule` 当前状态，没有创建、完成、重开、删除和 schedule 变化时间。当前数组不能反推区间任务历史。
4. learning-work ledger 是同一 conversation 的追加快照，不是可直接求和的 run 明细；把全部 JSONL 行相加会重复计数。
5. Presence 只提供当前 peers/events，不能构造历史在线曲线。
6. 现有复习 `ProgressSummary` 是累计快照，没有答题时间；在记录 timestamped fact 前，正确率只能是“截至当前”的累计指标。

因此 v1 采用：**不可变 fact 为历史真相、Daily projection 为可重建投影、当前快照与历史区间分开、Conversation 优先且 ledger 仅兜底**。

---

## 2. 日期、周与区间

### 2.1 本地自然日

- 日键格式固定为 `YYYY-MM-DD`，表示事件发生时设备本地日历中的自然日。
- 禁止用 UTC 日期键代替本地日期键；禁止直接以 `toISOString().slice(0, 10)` 生成分析日键。
- fact 同时保存绝对时间 ISO instant、本地日键和 `Date#getTimezoneOffset()` 语义的 offset，保证跨时区旅行和 DST 后历史桶不被重新归日。
- conversation/ledger/change history 等既有源只有 absolute timestamp、没有事件时本地日时，统一按 `query.calendarContext.timeZone` 转换为本地日，并可发 info 级 `source_timezone_inferred`；同一次 response 内不得混用 main 当前时区与 renderer 时区。
- 跨本地午夜或时区 offset 变化的 session 必须拆成多个 `StudySessionDaySegment`。每个 segment 的秒数只进入自己的本地日和本地小时桶。
- 暂停时间不计入 focus/break active seconds；只能进入 `pausedSeconds`。

### 2.2 周

- 周首固定为周一。
- `week` preset 固定为“本地周一到今天”，不包含未来的本周日期。
- 任务 schedule 的 weekday 沿用现有 UI：`0=周一 ... 6=周日`。

### 2.3 Range inclusive

- 所有 `AnalyticsDateRange` 均为双端包含：`fromInclusive: true`、`toInclusive: true`。
- 日粒度事实通过 `from <= localDate <= to` 匹配。
- “今日”固定为 `[today, today]`；“本周”为 `[本地周一, today]`；“本月”为 `[本地月初, today]`；“近 90 天”为 `[today-89, today]`，恰含 90 个本地日期。
- `all` 请求范围固定为 `[0001-01-01, today]`，各 section 再以 tracking start、retention 和源可用性计算 effective range；UI 不实际渲染公元 1 年起的空桶。
- `custom` 必须满足 `from <= to <= calendarContext.localToday`；不接受未来日期，非法请求返回参数错误而不是静默改写。
- query 必须携带 `calendarContext.localToday`、IANA `timeZone` 和 `weekStartsOn: 1`，防止 renderer/main 在午夜或不同时区各自重算出不同边界。
- 上期对比使用同等本地日数量、紧邻当前 range 之前的区间；上期分母为 0 时 ratio change 为 `null`，不得显示无穷大。

---

## 3. Scope 必须分域

页面不存在一个能同时正确过滤所有数据的“全局范围”。查询中的 scope 是三个独立域：

| 域 | 固定语义 | range 是否适用 | 禁止行为 |
|---|---|---:|---|
| `personalFocus` | 当前本机 learner/client 的个人专注事实；可包含其在不同 room/space 的活动 | 是 | 不得把 Presence peers 的时长计入；不得因切换 Teaching workspace 而改变 |
| `teaching` | 一个明确 Teaching workspace、全部已扫描 workspaces，或 none | 对 conversation usage、历史 activity 适用；库存类为截至当前 | 不得用“当前自习空间”代替 workspace；不得把 temporary conversation 偷归某 workspace |
| `presence` | 当前 `spaceCode` 的只读实时快照，或 none | 否 | 不得按日期筛选、累计或虚构历史趋势 |

UI 规则：

- 顶栏可提供 **Teaching workspace** 选择器；它只影响 workspace/token/assets/review/memory 等有 workspace 归属的数据。
- 个人专注始终标为“本机个人专注”。如未来增加 room/mode/signal 过滤，应作为 focus 维度过滤器，不得复用 Teaching scope。
- Presence 明示“当前快照”和采集时间；range 改变时 Presence 数字不变。
- temporary conversations 必须使用独立稳定 scope key（例如 app-data root + conversation id）；在“全部 workspaces”是否包含 temporary conversation必须由产品显式开关决定，v1 默认不包含，不能隐式混入。

---

## 4. 数据状态、coverage 与 warnings

每个 section 必须返回 `AnalyticsSectionResult<T>`，状态只能是：

| 状态 | 精确定义 | 是否有 `data` | UI 行为 |
|---|---|---:|---|
| `available` | 扫描成功，所声明 coverage 内无已知缺口，且有数据 | 是 | 正常展示 |
| `empty` | 扫描成功且完整，所声明 coverage 内合法地为 0 条/0 值 | 是，使用零值结构 | 空态引导；不得显示错误 |
| `partial` | 有可用数据，但存在已知缺失、裁剪、fallback 或坏行 | 是 | 展示数据并显示 warning |
| `unavailable` | 数据不适用、未配置、无 active workspace、无权限或历史尚未记录 | 否 | 解释如何启用；不得伪装成 0 |
| `error` | 已尝试读取/聚合但异常失败 | 否 | 错误态与重试；不得吞成空态 |

### 4.1 empty 与 unavailable 的关键区别

- tracking 已开始、range 完整覆盖、当天没有专注：`empty`，focus 为真实 0。
- range 在 tracking 开始之前：不是 0；若整个 range 都在之前则 `unavailable(history_not_recorded)`，若只重叠一部分则 `partial`。
- workspace 已成功扫描但没有 conversations：Token `empty`。
- 没有 active workspace 且 query 要求 current workspace：`unavailable(no_active_workspace)`。
- Presence 未连接：`unavailable(not_configured/source_missing)`；连接后当前无人在线可为 `empty`。

### 4.2 Coverage 必填

每个结果都必须提供：

- requested range；
- 该 section 是否真正应用 range；
- effective range；
- `trackingStartedOn`；
- `dataStartDate/dataEndDate`；
- 400 天 retention cutoff；
- 每个源的 scanned/included/missing/rejected 和源状态；
- `complete`。

`dataStartDate` 是最早含有效 fact 的日期，不等同于 `trackingStartedOn`。tracking 开始后没有 fact 的日子是可确认的零；tracking 开始前的日子是未知。

### 4.3 Warning 规则

- `partial` 必须至少有一个 warning。
- fallback、坏行、缺 usage、缺 task attribution、range 被 tracking/retention 裁剪都必须产生 typed warning。
- warning 文案必须脱敏：不含绝对路径、API key、完整 endpoint、conversation 内容、tool 参数/结果。
- `available` 可以带纯信息级 warning，但不能带会否定 `coverage.complete` 的 warning。

---

## 5. 历史事实与 Daily projection

### 5.1 StudySessionFact 是专注历史真相

每次 timer session 形成一个不可变 `StudySessionFact`：

- `timerMode`: focus/break；
- `outcome`: completed/interrupted/canceled；
- `startedAt/endedAt/activeSeconds/pausedSeconds/plannedSeconds`；
- 正常完成 focus 时 `completedFocusSessions=1`，其他情况为 0；
- `xpEarned` 必须与 session 结算同源；
- session 开始时捕获 mode/room/signal/space；中途切换不回写旧 fact。若实现允许中途切换并要求秒级归因，应结束当前 segment/fact 后创建新 fact，不得把整段归到最后状态；
- `daySegments` 按本地午夜/offset 拆分，segment active 秒之和等于 fact active 秒；
- 一个 fact ID 必须幂等，重复写入只能去重，不能重复累计。

首期可以只在正常完成时落 completed fact，但若 UI 展示完成率/中断次数，则必须同时记录 interrupted/canceled；不能从“未出现 completed”推断中断。

### 5.2 StudyActivityFact

range-aware 非 timer 指标使用 append-only activity facts：

- task：created/completed/reopened/schedule_changed/title_changed/deleted；
- review：review_answered；
- workspace/lesson：workspace_changed/lesson_generated；
- skill：skill_used。

未落相应 fact 的历史指标返回 `unavailable` 或 `partial`，不得用当前库存倒推历史。

### 5.3 DailyLog 只为投影

原规划中的 `StudyDailyLog` 冻结为 `StudyDailyProjection`：

- 它只能由保留期内 facts 重建；
- 它可随时删除、重算或升级；
- 写入投影失败不得丢失已成功持久化的 fact；
- 聚合发现投影版本不匹配、fact count/revision 不一致时必须重建；
- 不能同时向 fact 和 projection 各自独立“加一”，避免双写漂移；正确顺序是持久化 fact，再由 fact 更新/重建 projection；
- `StudySnapshot.todayFocusSeconds/totalFocusSeconds` 是当前 UI/legacy 累计读模型，不是历史回填来源。不能把 lifetime total 平摊到日期。

---

## 6. 专注指标口径

| 指标 | 口径 |
|---|---|
| 专注时长 | range 内 personal focus facts 的 focus day segments `activeSeconds` 之和；暂停不计 |
| 学习会话 | range 内 `timerMode=focus && outcome=completed` 的数量，即 `completedFocusSessions` 之和 |
| 休息时长 | range 内 break segments active seconds 之和 |
| 完成率 | completed focus / (completed + interrupted + canceled)；分母 0 为 `null` |
| 平均完成专注时长 | completed focus facts active seconds / completed count；分母 0 为 `null` |
| 热力图 | 每个本地日 focusSeconds；未知 coverage 日必须与真实 0 使用不同视觉 |
| 小时桶 | segment 按事件发生时的本地小时累计 active seconds；24 桶 |
| mode/room/signal | 按 session 捕获的维度累计 active seconds；share 分母为 range focusSeconds |
| 连胜 | 截至 bundle 生成时按有 focus 的本地自然日计算：最后学习日为今天或昨天时保留连续日数，更早则为 0；range-invariant。P0 若只能使用现有 UTC 口径 snapshot，必须标 `partial` + `legacy_utc_date_semantics`，不能宣称精确 |
| XP/等级/徽章/植物 | 当前 snapshot 派生值；range-invariant |

跨日 session 的“会话数”和 `xpEarned` 归属其完成所在本地日；active seconds 仍按 segments 分日。若 session 未完成则不计 completed session，且未结算 XP 为 0。

---

## 7. Token：Conversation-first + ledger fallback

### 7.1 权威顺序

1. **Conversation-first**：读取 materialized Agent conversation，逐个 assistant turn 使用 `turn.metadata.runUsage`。每个 usage-bearing turn 规范化为一个 `TokenUsageFact`。
2. **Ledger fallback**：只有 conversation 文件不可读/不存在，或整段 conversation 完全没有 usage-bearing turn 时，才允许用 ledger 的 conversation snapshot 兜底。
3. session audit 只可补充时间线/诊断；v1 不得与 conversation usage 再相加，除非未来契约提供稳定 run ID 与严格去重映射。

若 conversation 中部分 turns 有 usage、部分缺 usage：使用已有 turns，状态为 `partial`；**不得再叠加 ledger**，因为当前 ledger snapshot 的 `evidence.runUsage` 不能安全证明对应哪个缺失 turn。

### 7.2 Ledger 去重

learning-work ledger 是追加快照，必须：

1. 用稳定 `conversationKey = source-root identity + workspace identity + conversation.id` 分组；不能只用 title/path。
2. 每组仅选择一个最新有效 snapshot，排序优先 `conversation.updatedAt`，再以 ledger `createdAt` 打破平局。
3. 不得对同一 conversation 的多条 ledger snapshots 求和。
4. conversation source 一旦被采用，同 conversation 的所有 ledger snapshots 都忽略。
5. ledger fallback 的 range 归日使用 `conversation.updatedAt`；不得使用 ledger append 的 `createdAt`，后者可能是稍后重建时间。
6. ledger 坏行计入 rejected/`ledger_rows_invalid`，有其他可用数据时 section 为 `partial`，全部失败时为 `error`。

### 7.3 Token 数值

- source 有 `totalTokens`：采用 source total。
- source 无 total 但 prompt/completion 都有：`total = prompt + completion`。
- source total 与 prompt+completion 不一致：total 仍采用 source total，并发 `token_total_inconsistent`；prompt/completion 保留原值。
- 只有 total：总量可计；prompt/completion 不伪造，section/子指标标记 components missing。
- 完全没有 token 字段：该 usage 不计 token，但其他 calls/duration 可计；coverage 记 missing。
- child run token 不单独加到 parent，除非 source 明确声明 parent total 不含 child；当前 `AgentRunUsageAggregate` 无此声明，因此只统计 parent aggregate。
- `byTool` 只有在存在可去重的 tool-call 明细时才 available；不能用总 `toolCalls` 猜工具名称分布。
- Token 时间使用 assistant turn `createdAt`；ledger fallback 使用 conversation `updatedAt`。二者的 local date 均按 query 的 IANA time zone 推导，因为现有源未保存事件时 local date/offset。

---

## 8. 当前状态型指标不随 range

下列数据是“截至 `generatedAt` 的当前状态”，range 切换不得改变：

- streak、lifetime XP、level、badges、plant stage；
- 当前任务 open/completed/overdue/total 和当前任务完成率；
- Teaching workspace 资产库存、当前 Mission health；
- review cumulative progress 和 review card inventory（直到 timestamped review facts 接通）；
- memory inventory、skill installed inventory、pet appearance、当前 provider/model/configured connectors；
- Presence snapshot。

类型使用 `AnalyticsTemporalBasis.kind='as_of'` 或 `live_snapshot`，且 `rangeInvariant: true`。同时含区间和当前字段的 hero/focus/tasks/review/platform section 使用 `kind='mixed'`，显式列出 `rangeFields` 与 `rangeInvariantFields`。UI 文案必须写“当前”“累计”或“截至现在”，不得放在会随 range 变化的标题下造成误解。

range-aware 的同域历史指标必须独立命名，例如：

- `tasks.flow.completed`（区间完成事件）与 `tasks.current.completed`（当前 done 数）不是同一个数；
- `review.range.accuracy` 与 `review.cumulative.accuracy` 分开；
- `platform.skills.usedInRange` 与 `skills.installed` 分开。

---

## 9. 任务历史、计划与归因

### 9.1 当前任务完成率

`currentTaskCompletionRate = current done tasks / current total tasks`，分母 0 为 `null`。这是 as-of 指标，不随 range。

禁止把当前 `done` 状态当成“在所选区间完成”。range 完成数只能来自 `task_completed` facts。

### 9.2 Task lifecycle

- 每次创建、完成、重开、改 schedule、改标题、删除都写 activity fact，包含 before/after 快照。
- task ID 是历史稳定主键；标题仅为事件时快照。
- 删除 completed task 不应抹掉其保留期内历史。
- P1 开始记录前的 legacy tasks：可以进入 current inventory，但历史时间未知。相关 range 结果为 partial/unavailable，并发 `task_history_missing`。

### 9.3 Session task attribution

- focus session 只有在开始时显式选择/绑定 task ID 才算 attributed。
- fact 保存 task ID、标题快照和可选 workspace ID。
- `contractText`、标题文本相似、当前第一个未完成 task 等都不能用于事后猜测。
- 未显式绑定的 session 为 `unattributed`，仍计个人专注总量，但不进入 task Top/计划实际 numerator。
- task 被改名/删除后，旧 session 仍按 fact 中 ID 和标题快照归因。

### 9.4 计划 vs 实际

- `plannedSeconds` 必须从 task lifecycle 中可重建的 schedule 有效期生成 occurrence；不得拿当前 schedule 向过去投影。
- schedule weekday 为 Monday=0；每个 occurrence 的计划秒数为 `endMinutes-startMinutes`。
- `attributedFocusSeconds` 只累加显式归因到有计划 task 的 focus active seconds。
- `executionRate = attributedFocusSeconds / plannedSeconds`，分母 0 或 schedule history 不完整时为 `null`；允许大于 1，不截断。
- P1 task history/attribution 接通前，P0 可展示 current task inventory；计划实际和历史 Top 必须 unavailable，不得用全部专注秒数代替 attributed focus。

---

## 10. 数据起始日期与 400 天保留期

### 10.1 起始日期

存储必须记录：

- `trackingStartedOn`：analytics fact logging 首次启用的本地日期；清除个人 activity history 后重置为清除当日。
- `dataStartDate`：当前保留数据中最早出现有效 fact 的本地日期，可为 null。
- `dataEndDate`：当前保留数据中最后出现有效 fact 的本地日期，可为 null。

行为：

- `trackingStartedOn` 之后、无 fact 的日期可视为真实 0。
- 之前的日期是未知，不得补 0。
- legacy `StudySnapshot.totalFocusSeconds/totalSessions/xp` 只用于当前累计展示，不建立伪造历史点。

### 10.2 保留期

- policy 固定为 rolling 400 local days，包含今天和之前 399 个本地日期。
- 每次成功写 fact、启动修复或显式维护时执行裁剪。
- cutoff 之前的 session/activity facts 和 daily projections 删除；跨 cutoff 的 session 只聚合 cutoff 及之后的 segments。实现可保留整条跨界 fact，但不能把旧 segment 计入。
- 因 retention 裁剪 range 时为 `partial` 并发 `range_before_retention_window`/`retention_pruned`。
- 当前状态快照不受 400 天裁剪；Token/workspace 源文件也不因 analytics retention 被删除。Token 查询可扫描更早 source，但 bundle coverage 必须明确其源保留能力；v1 页面为一致性默认仍按 query range，不强行裁成 personal fact cutoff。

---

## 11. 清除、导出与隐私

### 11.1 本机原则

- 分析默认仅在本机读取和聚合，不上传第三方 analytics 服务。
- API keys、secret endpoints、proxy credentials、绝对路径永不进入 bundle、warning、error 或 export。
- 聚合器不得为了分析把完整 conversation、Mission、memory、tool arguments/results 复制进 analytics store。

### 11.2 导出

支持 `summary` 和 `detailed`：

- `summary` 为默认：聚合数字、日期、状态、coverage；省略用户创作的 task/conversation/workspace/lesson 标题和文本。
- `detailed` 需用户显式选择：可包含页面已展示的名称/标题、session/task facts 的非文本统计字段；仍不包含 conversation 内容、Mission 内容、memory 内容、tool 参数/结果、绝对路径和 secrets。
- JSON 必须带 contractVersion、query、generatedAt、coverage、warnings 和 export manifest。
- CSV 按 section 输出独立表或明确 discriminator；日期保持 `YYYY-MM-DD`，秒/token 使用原始整数，不只导出格式化字符串。
- export 是只读操作，不改变 retention 或 tracking start。

### 11.3 清除

分析页只允许清除 analytics 自己拥有的数据：

| target | 删除 | 保留/后果 |
|---|---|---|
| `derived_cache` | Daily projections、聚合缓存 | facts 保留；下次自动重建 |
| `personal_activity_history` | analytics session/activity facts 和 projections | 重置 tracking start；`StudySnapshot` 当前/lifetime、current tasks 不删 |
| `analytics_preferences` | range、折叠、展示偏好 | 所有源数据保留 |

以下源绝不能从分析页清除：Teaching workspaces、Agent conversations、learning-work ledger、review、memory、current tasks。Token/资产等可重建结果会在重新扫描后再次出现，确认文案必须明确这一点。若用户要删除源数据，应进入相应领域的管理入口。

所有破坏性清除必须：明确 target、二次确认、返回 `ClearAnalyticsResult`，并在 UI 告知保留的源域。

---

## 12. 页面级接口

权威 DTO 是 `LearningAnalyticsBundle`：

- `contractVersion: 1`；
- `generatedAt/query`；
- hero/focus/tasks/tokens/workspaceAssets/review/memory/platform/presence/insights；
- 每一项都是独立 `AnalyticsSectionResult<T>`，允许同一页面中 focus available、tokens partial、workspace unavailable、presence live。

### 12.1 聚合边界

建议 main/preload 提供一次性查询接口（命名可遵循现有 IPC 规范）：

```ts
getLearningAnalytics(query: LearningAnalyticsQuery): Promise<LearningAnalyticsBundle>
exportLearningAnalytics(request: AnalyticsExportRequest): Promise<AnalyticsExportResult>
clearLearningAnalytics(request: ClearAnalyticsRequest): Promise<ClearAnalyticsResult>
```

接口实现必须使用 shared contract，不把 main 私有 ledger 类型或 renderer `StudySnapshot` 类型直接暴露为页面 DTO。renderer 可以先本地聚合 personal facts，但最终仍组装同一 bundle/state/coverage 结构。

### 12.2 P0–P3 约束

- **WP-0（本波）**：冻结本文和类型。
- **P0**：页面壳、range control、Teaching scope control；当前 snapshot KPI；所有 section 即使占位也返回正确 state/coverage，不使用假数据。Token 若无法完整扫描必须 partial/unavailable，不能写“能聚多少算多少”而不提示。
- **P1**：session facts、task lifecycle facts、显式 task attribution、Daily projection、真实热力图/趋势/小时桶；同时开始 400 天 retention。
- **P2**：conversation-first Token 聚合、ledger fallback、workspace assets、review、task panels、Presence snapshot。
- **P3**：规则洞察、导出/清除、自定义日期、memory/platform 深化。洞察必须列出 evidence section IDs；不能根据 unavailable 数据生成确定性结论。

---

## 13. 验收示例

1. 用户在本地 23:55 开始、次日 00:10 完成 15 分钟 focus：session count 归完成日；focus seconds 按两个本地日 segments 分配。
2. 用户选择“近 90 天”，tracking 仅开始 20 天：focus section partial；前 70 天显示未知而非 0。
3. 当前 tasks 10 个、done 4 个，切换今日/本月：current completion rate 始终 40%；本月 `task_completed` count 可不同。
4. conversation 有 3 个 usage turns，ledger 有 5 个历史 snapshots：只求和 conversation 3 turns，ledger 全忽略。
5. conversation 只有 2/3 turns 有 usage：使用 2 turns，状态 partial；不再加 ledger。
6. conversation 文件缺失，ledger 有同 conversation 4 snapshots：选最新有效 1 条，不求和 4 条，发 fallback warning。
7. Presence 当前 online=0：连接成功且扫描完整时可 empty；未连接时 unavailable，不能显示“历史平均 0”。
8. 用户清除 derived cache：热力图短暂重建后恢复；facts 和 source data未删除。
9. 用户清除 personal activity history：历史热力图清空、tracking start 重置；Agent conversation Token 在重扫后仍出现。
10. summary export 不含 task/conversation/workspace titles；detailed 可含页面标题，但永不含 conversation 正文、绝对路径或 keys。

---

## 14. 后续 worker 不得更改的冻结点

- 本地自然日、周一周首、双端 inclusive range。
- personal focus / Teaching workspace / live Presence 三域 scope 分离。
- 五态及其 empty/unavailable/error 区别。
- coverage/warnings 必传且可解释。
- fact 为真相、Daily projection 可重建。
- Conversation-first、ledger conversation-level fallback、snapshot 去重。
- current-state 指标不随 range。
- 任务必须有 lifecycle history；session task attribution 只能显式捕获，禁止文本猜测。
- 清除不删除 Teaching 源数据；导出默认脱敏。
- tracking start 与 data start 分开；analytics-owned history rolling 400 local days。

任何需要改变上述语义的实现必须先升级 contract version，并提供迁移与兼容策略，不能静默改变 v1。

