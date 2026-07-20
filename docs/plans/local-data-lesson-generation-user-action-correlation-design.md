# C-5I：Direct-UI lesson generation 生命周期与用户动作关联设计（未实现）

> **状态：设计完成，实施 NO-GO。** 当前分支没有 renderer `actionId`、private receipt、direct-UI trace coverage、可恢复的 provider boundary 或 exact-retry 实现。本文定义获批后唯一可实施的首个切片；在产品、API、privacy、运维以及 ADR 审查批准前，不能把它当作已交付能力。
>
> 已实施的 durable publish / artifact journal、受限 recovery 与部分 main-owned trace correlation 分别以 [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 与 [ADR-0005](../adr/0005-main-owned-trace-correlation-and-safe-logs.md) 为准。教学事件协议以 [ADR-0015](../adr/0015-canonical-teaching-event-protocol.md) 为准；这里的 workspace lifecycle JSONL **不是** `TeachingEventEnvelope`，也不成为教学证据的替代物。待办入口见 [本地数据待办](../local-data-todo.md)。

## 1. 问题、目标与非目标

### 1.1 要解决的问题

一次 direct-UI 的“生成课程”会跨 renderer、IPC、provider、artifact publication、workspace index、lifecycle JSONL、change history 与 registry。当前任一步在返回 renderer 前中断时，用户只能再次点击生成；系统无法判断那是同一动作的 lost-response/reload retry，还是第二次相同输入的独立提交。因此可能重复调用 provider、生成第二套 artifact、追加第二条 `lesson_generated`、再次写 registry，或在不能证明结果时给出错误成功提示。

本设计的目标是为**同一次 direct UI submit**提供有界的、fail-closed 的恢复协议：

1. 同一 `actionId` 的并发调用、lost IPC response、stream transport 断开和 renderer reload 不会再次启动 provider 或重复完成可证明的副作用；
2. 同 prompt、但不同 `actionId` 的提交永远是两个独立用户动作，绝不按内容去重；
3. provider outcome、artifact、index、lifecycle、history、registry 或 receipt 状态不能证明时，返回明确的 `conflict` 或 `indeterminate`，而不是自动重跑、回滚或覆盖；
4. 结果只在 receipt 的保留窗口内可重取；过期动作必须新建 action，而不是把旧 ID 当作新请求。

这不是全局 exactly-once：本地跨文件写入没有事务，外部 provider 也没有可证明的 exactly-once API。这里的“exact retry”仅表示**在定义的 receipt / provider / recovery 证据可证明时**不重复接受同一 direct-UI action。

### 1.2 非目标和范围红线

首个切片仅覆盖 direct renderer 的 `generateLesson()` 与 `generateLessonStream()`。明确不覆盖：

- agent `generate_lesson`、agent run/tool retry、agent stream ID 或 turn-local attempted/failure 记录；虽然 agent 和 direct UI 当前共用 `generateAndPersistLesson()`，它们不能共用 action authority；
- `mission_updated`、`lesson_style_applied`、`write_workspace_file`、generic Markdown writer、教学事件总线、learning session / outcome 语义；
- C-4 的通用 durable publish 语义、artifact journal 的全局 recovery 策略、历史 artifact/index/lifecycle 的扫描、回填、修复或重写；
- 按 prompt、messages、title、artifact bytes 或任意 content hash 的 dedupe；
- 跨 workspace/global receipt registry、跨设备同步、provider/UI redesign，或让 renderer 提供 trace / 生命周期 event ID；
- 修改现有 `lesson_generated` event 中 `prompt` 的历史持久化语义。当前链路会写入 `generation.eventPrompt`；C-5I 不得再复制该内容到 receipt、日志或 analytics。若要缩减该既存字段，必须另开 privacy / lifecycle 设计并迁移审查。

## 2. 当前事实与缺口（压缩）

**状态重申：设计完成，实施 NO-GO。** 当前没有 renderer `actionId`、private receipt、direct-UI trace coverage、可恢复 provider boundary 或 exact-retry。

| 主题 | 权威记录 / 现状 | 不能充当 |
|---|---|---|
| durable publish / artifact journal | [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) | caller receipt、provider-call result、全局 transaction |
| main-owned trace | [ADR-0005](../adr/0005-main-owned-trace-correlation-and-safe-logs.md)；direct-UI `lesson_generated` 未覆盖 | action identity、dedupe key、renderer input |
| teaching event protocol | [ADR-0015](../adr/0015-canonical-teaching-event-protocol.md) | UI action retry identity |
| history redaction | [ADR-0007](../adr/0007-persisted-user-history-redaction.md) | 用 content 相似性猜测 lost UI action |

**当前 direct-UI 链路（仅说明缺口，不是目标合同）：**

```text
renderer appStore (transient lessonGenerationRunId)
  → preload invoke teach:generate-lesson[/stream]
  → gateway parseGenerateLessonPayload({ workspaceId, prompt, ... })
  → TeachingWorkspaceService.runLessonGeneration / generateAndPersistLesson
  → publishLessonArtifacts → index / lifecycle lesson_generated / journal finalize
  → registry / TeachingAppState
```

- payload 无 `actionId`；`lessonGenerationRunId` 与 gateway `streamId` 均非跨 reload 的 caller identity。
- artifact publication journal 服务 artifact set safety，不是 caller receipt。
- 现有测试覆盖 parser/route/publication/session opening 等，**没有** direct action retry、receipt 或 lost-response 覆盖。
- 因此当前只能提供 at-least-once 用户重试语义；不得把既有 durable/journal/trace 测试解释成 C-5I 已实现。

## 3. 获批后的目标合同

### 3.1 选择的方案与硬前提

采用 **renderer opaque action ID + main workspace-private receipt + keyed request binding**。这是唯一能同时区分“同一 action retry”与“相同内容的新 action”，又能在 restart 后检测 changed payload 的方案。

存在一个不可省略的 privacy 决定：若 receipt 既不能保存 raw request / messages / content hash，也不允许保存 main-keyed、不可逆的 request tag，则 main 在 restart 后无法证明 retry payload 与第一次请求相同。届时必须放弃 exact retry，并把每次再次提交定义为新动作；不得用 prompt 比较替代。本设计要求 privacy owner 明确批准下列 **仅在 private receipt 中、不可导出、不可日志化** 的 keyed tag。

### 3.2 Action ID 生命周期

- renderer 在用户确认生成后、首次 IPC 前产生 RFC 4122 UUID v4 `actionId`；它是 opaque、non-secret、只含 UUID 的 token。相同 prompt 的新点击必须产生新 ID。
- renderer 在同一次请求的 lost response、stream reconnect、页面 reload 后继续复用该 ID。reload 后只保存 `{ workspaceId, actionId, operation }` 作为 pending marker；不得把 prompt/messages、trace、result 或 receipt 写入 `sessionStorage` / local storage。
- reload 后 renderer 先调用 action-status endpoint；若状态为 `in_progress`，只轮询或等待，不附着旧 stream；若为 terminal，则呈现 terminal result；若为 `indeterminate` / `conflict`，让用户明确创建新 action。只有仍持有原始请求的同一 UI 实例才可用同 ID 再次 submit。
- main 拒绝非 UUID、跨 workspace、跨 operation、过期 tombstone 或与已绑定 request tag 不一致的重用。main 不生成或替换 caller action ID。
- 同一 `{ workspaceId, operation, actionId }` 在 main 以内存 mutex / queue 串行；第二个并发 caller 等第一个获得稳定 disposition 或读取其 receipt。不同 action 仍按现有产品并发策略运行；本设计不声称解决现有不同 producer 的 sequence/index 竞争。

### 3.3 IPC 与结果类型

普通和 stream endpoint 都改用同一 action payload；新增 status endpoint。所有三者必须经 shared type、gateway parser、preload 与 renderer 同步升级。

```ts
// 说明性合同；最终名称须在 ADR/API review 锁定。
type DirectLessonActionPayload = {
  workspaceId: string
  actionId: string                 // RFC 4122 UUID v4
  prompt: string
  courseName?: string
  messages?: AgentChatMessage[]
}

type DirectLessonActionResult =
  | { disposition: 'succeeded' | 'reused'; actionId: string; lesson: LessonSummary; state: TeachingAppState; source: 'ai' | 'fallback'; reason?: string; changeSummary?: TeachingWorkspaceChangeSummary | null }
  | { disposition: 'rejected'; actionId: string; code: 'invalid_request' | 'workspace_unavailable' | 'not_authorized' }
  | { disposition: 'conflict'; actionId: string; code: 'workspace_mismatch' | 'operation_mismatch' | 'request_mismatch' | 'external_mutation' | 'receipt_corrupt' | 'expired' }
  | { disposition: 'indeterminate'; actionId: string; code: 'provider_outcome_unknown' | 'publication_unprovable' | 'projection_unprovable' | 'receipt_unavailable' }

type DirectLessonActionStatus =
  | { disposition: 'in_progress'; actionId: string }
  | DirectLessonActionResult
```

- `generateLesson` 和 `generateLessonStream` 都返回 `DirectLessonActionResult`；stream 的 chunks/status 仍带**每次 transport 新建**的 `streamId`，不得携带或回显 receipt / trace。对 `reused`、`conflict`、`indeterminate` 不 replay 历史 chunks。
- action-status 只接受 `{ workspaceId, actionId }`，不接受 prompt/messages，也不返回 trace、receipt path、journal path、provider request ID 或 internal phase。
- `succeeded` 只由首次完成 invocation 返回；`reused` 表示相同 action 读取到已完成 receipt 后重建的同一 result。UI 对两者展示同一成功结果，不能因为 `reused` 再触发 open-path/notification 等 client effect。
- `rejected` 必须发生在 provider boundary 之前；`conflict` 和 `indeterminate` 都不会重新启动 provider。generic error text 不包含 action ID、private path、trace、provider diagnostics 或 user content。

### 3.4 Request binding 与 receipt schema

main 先用 gateway 的严格 parser 解析，再对**规范化后的 accepted input**计算 request tag：operation=`direct_ui_lesson_generation/v1`、workspace ID、cleaned prompt、规范化的 optional course name、以及 parser 接受的 message 序列（role/content/tool fields、顺序、null/empty 规则）。tag 为 main-only per-install key 上的 HMAC-SHA-256 输出；它只用于 receipt 内 constant-time equality 比较，不对 renderer、lifecycle、logger、analytics、测试快照或 error 返回暴露。它不是 content dedupe key，不能跨 action 查询。

receipt 放在新建、app-managed 的 workspace-private 目录：`.studiumx/private/direct-lesson-actions/v1/<actionId>.json`，目录权限 `0700`、文件 `0600`，所有路径只由 main 根据已验证 workspace root + UUID 构造。不能接受 renderer path，不能列给 UI，不能包含在 backup/export/analytics 默认收集范围。必须使用审核过的 durable replace，写后读回并校验 schema；写失败即停止进入下一 effect。

v1 receipt 的允许字段为：

| 字段 | 用途 | 禁止替代 |
| --- | --- | --- |
| `schemaVersion`, `operation`, `actionId`, `workspaceId`, `createdAt`, `updatedAt`, `phase` | 版本、绑定和状态机。 | lifecycle/lesson/session identity。 |
| `requestTag` | main-only changed-payload 检查。 | 内容索引、搜索、dedupe 或日志字段。 |
| `traceId`（若 ADR-0005 扩展获批） | main-generated lifecycle diagnostic metadata。 | action ID 或 receipt lookup key。 |
| `generationStartedAt`, fixed `effectTimestamp` | 重放时复用一次动作的 effect 时间，而非再次 `Date.now()`。 | provider completion proof。 |
| `publicationTransactionId`, `lessonId`, `lessonRelativePath`, `lifecycleEventId` | main-only、非内容性的受限 recovery reference。 | artifact bytes/hash、prompt/messages、event payload。 |
| `source`, bounded `reason`, completion/result phase | 重新构造已完成 UI result 所需的最小状态；`reason` 使用现有枚举/长度限制。 | provider request/response、API key、provider request ID、model diagnostic。 |

receipt **不得**保存 raw prompt、courseName、messages、rendered lesson、artifact bytes / SHA-256、provider secret/API key/request ID、agent secret、absolute path、change-history diff、trace-derived secret 或 generic diagnostics。`LessonSummary` 含 `prompt`，不得整体嵌入 receipt；重取结果只能在已证明的 canonical index/artifact 中按 receipt reference 重建。

完成 receipt 的完整结果保留 **30 天**；之后降级为只含 action/workspace/operation/requestTag/terminal kind 的 tombstone。tombstone 保留至 workspace 删除，旧 ID 永远返回 `conflict: expired`，从不作为新 action 接受。30 天与 workspace-delete cleanup 是本设计的建议产品值；若 owner 改变它，仍必须保留“不删除 tombstone 后把旧 ID 当新请求”的不变量。

### 3.5 Trace 与 lifecycle event 合同

首次 accepted action 可由 main 生成 trace，**但必须先以 ADR 更新将 direct-UI `lesson_generated` 加入 ADR-0005 的明确覆盖范围**。renderer 不传 trace；receipt 只记录 main-produced normalized UUID；lifecycle append 仅在该 scope 获批时写该 trace。trace 不回传给 renderer，也不进入 logger 的自由文本。

每个 action 预先生成 main-owned `lifecycleEventId`。同一 action 的恢复只可用此 ID 对现有 `.studiumx/sessions.jsonl` 作受限 existence/shape verification；不能依据 prompt、title 或 path 相似性推断，也不能重写旧行。若 append 后的 close/fsync 不确定且读回无法证明唯一匹配 event，返回 `indeterminate: projection_unprovable`，不再 append 第二行。

## 4. 目标时序、状态机与故障处理

### 4.1 需要先拆开的现有 seam

当前 `runLessonGenerationPipeline()` 将 provider production、render 和 `publishLessonArtifacts()` 串成一个调用，且 publisher 内部自行生成 transaction ID。C-5I 必须先拆出受限 seam，才能在 provider 和 publication 前持久化 receipt：

1. prepare / validate / canonicalize direct action；
2. 在 receipt durable 后，明确标记 **即将**跨 provider boundary；
3. provider/fallback 产生有效 plan；
4. 以 caller-reserved `publicationTransactionId` 写入 receipt 的 `publication_intent`，再开始 staging/publish；publisher 必须接受该 ID，或提供同等的“intent 先于第一个可见 artifact”的能力；
5. 沿既有 index → lifecycle → change history → registry 顺序完成 projections；
6. 在所有需要重取的 canonical state 已验证后，将 receipt 标为 completed；direct-action receipt 存活期间保留对应 publication journal，不能沿用当前无条件 best-effort finalize；receipt cleanup 才可以在安全顺序中清除 journal / receipt。

此改变是 direct-UI orchestration 与 publisher 的窄接口，不是把 C-4 变成全局 transaction。若 publisher 无法提供 caller-reserved intent 或对指定 transaction 的只读验证，C-5I 不能安全实现，应保持 NO-GO。

### 4.2 正常时序

```text
Renderer                         Main action coordinator                         Existing writers
--------                         -----------------------                         ----------------
new UUID actionId
submit(payload) ───────────────► parse + canonicalize + workspace auth
                                 load/create receipt [accepted] durable
                                 persist [provider_started] durable
                                 ───────── invoke provider/fallback ───────────► produce valid plan
                                 reserve transaction + persist [publication_intent]
                                 ───────── publish / bind Session ─────────────► committed artifacts + journal
                                 verify journal; persist [artifacts_committed]
                                 ───────── save index ─────────────────────────► .studiumx/index.json
                                 verify; persist [index_committed]
                                 ───────── append lifecycle event ─────────────► sessions.jsonl
                                 verify event ID; persist [lifecycle_committed]
                                 ───────── record change history ──────────────► existing audit writer
                                 verify; persist [history_committed]
                                 ───────── touch/save registry ────────────────► registry
                                 verify; persist [registry_committed]
                                 rebuild result from canonical state
                                 persist [completed] durable
◄─────────────────────────────── succeeded(result)
```

receipt phase 只能在它声称的 effect 已被读回证明后推进；不能先写 `completed` 再异步写 index / event / registry。所有 retry 使用 receipt 的 `effectTimestamp` 与 `lifecycleEventId`，不能产生第二个 timestamp/event ID。

### 4.3 恢复表

| receipt / 观察到的状态 | retry / restart 行为 | provider 是否可再入 | 结果 |
| --- | --- | --- | --- |
| 无 receipt，payload 合法 | 创建 `accepted` receipt，只有其 durable 成功后才继续。 | 可，首次。 | 正常执行。 |
| receipt 与 workspace/operation 不同，或 requestTag 不同 | 不读写 canonical state。 | 否。 | `conflict`。 |
| `accepted`，且能证明未到 `provider_started` | 清理/保留 receipt 后可从 pre-provider validation 恢复。 | 仅在再次 durable 标记 start 后。 | 正常或 `rejected`。 |
| `provider_started`，没有 durable `publication_intent` | provider 可能已经收到请求，plan 不在 receipt。 | **否。** | `indeterminate: provider_outcome_unknown`。 |
| `publication_intent` / `artifacts_committed` | 仅以 receipt 指定 transaction 的 publisher journal 和受限 artifact verification 判断 committed / abandoned / isolated；不能全盘 scan、删除正常 artifact 或新建第二套。无法证明即 `indeterminate`。 | 否。 | 继续可证明的 projection，或 `indeterminate` / `conflict`。 |
| index、lifecycle、history、registry 任一 pending | 逐项读取其 authoritative state。只补“receipt reference 与当前 state 唯一匹配且写前状态允许”的缺失步骤；append 前先按 `lifecycleEventId` 验证。外部变更、重复/错配或 I/O uncertainty 一律停止。 | 否。 | 继续、`conflict: external_mutation` 或 `indeterminate: projection_unprovable`。 |
| `completed`，journal 与 index/artifact/event references 均可验证 | 从 canonical state 重建 result；不写任何 artifact/index/event/history/registry。 | 否。 | `reused`。 |
| completed receipt 已损坏、journal/expected output 缺失或被外部修改 | 不覆盖、不回滚、不“修复”用户文件。 | 否。 | `conflict` 或 `indeterminate`，由下列错误分类固定。 |
| completed receipt 的 30 天 result window 已过 / tombstone | 不恢复 detail，不接受同 ID。 | 否。 | `conflict: expired`；用户新建 ID。 |

错误分类必须固定：**能证明输入或 current canonical state 与 receipt 不一致**为 `conflict`；**无法证明 effect 是否发生、provider 是否收到请求、或 durable read/write 是否完成**为 `indeterminate`。两者都要求明确的“新建 action”用户确认，不得自动 resend。

### 4.4 Streaming、reload 与 crash

- stream status 是展示进度，不是 durable commit acknowledgement。`streamId` 断开、WebContents destroyed、listener cleanup 或 chunk 丢失不改变 receipt phase。
- 同一 main process 中 status 为 `in_progress` 时，新 renderer 只能 status poll；不能订阅旧 `streamId`，不能重新进入 provider。原 stream 完成后，调用 action-status 获得 terminal result。
- process crash 后任何 `provider_started` receipt 默认 `indeterminate`；即使 provider 实际返回成功，也不能依据 UI chunk 或相同 prompt 自动重跑。
- 任何 publisher/index/lifecycle/history/registry write 的 throw、post-write close、directory-sync 或 read-back uncertainty 都按照恢复表处理。不得把 `finalizeLessonArtifactPublication(...).catch(() => undefined)` 作为 completed proof。
- 进程内 action mutex 不是 crash lock。receipt 的 phase + durable read-back 才是 restart authority；启动/first access 只查询 receipt 指定 transaction，不开展 legacy backfill。

## 5. 隐私、日志与可观测性

1. **最小化。** receipt 只保存第 3.4 节白名单字段。action ID 是 opaque 但仍可关联一次用户操作：不出现在 user-visible artifacts、front matter、HTML comments、lifecycle prompt/meta、change history、analytics、generic error 或普通日志。
2. **日志。** 日志只能使用固定事件名与有限 disposition / code，例如 `direct_lesson_action_indeterminate code=provider_outcome_unknown`；不得拼接 action ID、workspace root、relative path、prompt、message、lesson title、provider error body、trace 或 receipt path。需要诊断时依 ADR-0005 的安全词表、单行化和长度限制，并以 main-generated trace 为唯一获批 correlation metadata。
3. **访问与清理。** receipt file 由 main 专有，路径 containment、symlink/regular-file 检查、大小上限、schema validation、0700/0600 是上线前测试项。未知 schema、oversize、permission 失败、JSON 损坏、missing file 都不降级到 provider retry。receipt/tombstone 不进入 workspace export / import copy；import 的既有 workspace 无 receipt 即 legacy，不回填。
4. **外部修改。** receipt 从不授权覆盖用户修改的 artifact、index 或 lifecycle JSONL；publisher journal 的 hashes 只能由 publisher 安全验证，不能复制到 receipt/diagnostics。发现不匹配时保留 bytes 并返回 `conflict`。
5. **运维指标。** 仅允许聚合计数：accepted/completed/reused/conflict/indeterminate、receipt schema failure、recovery phase、provider-not-reentered assertion。指标维度不得含 action/workspace/trace/path/content。发布前由 privacy owner 审查 crash dump、test fixture、error serialization 与 telemetry export。

## 6. 迁移与兼容性

1. **版本切换。** Electron 的 shared types、gateway parser、preload、appStore 与 tests 在同一 release 一起切换。升级后 direct IPC 必须要求 `actionId`；旧 direct payload 返回 `rejected: invalid_request`，不能静默由 main 补 UUID。agent 到 service 的现有调用不走该 contract。
2. **无回填。** 既有 lesson、index、`sessions.jsonl`、registry、change history 和 `.studiumx/lesson-publications` journal 不创建 receipt、不添加 action/trace、不扫描猜测历史 submit。更新前 lost response 只能由用户以新 action 再次确认。
3. **新目录。** 首次 accepted action 才 lazy-create private receipt directory；目录创建/permission/durable write 不可证明即拒绝在 provider 前继续。receipt schema v1 不支持 in-place silent upgrade：未知 schema 只返回 fail-closed outcome，并保留文件供人工诊断。
4. **journal 协作。** direct-action receipt 活跃时，不能由 normal finalize path 删除其 referenced journal。需要一个明确、测试化的 hand-off：completed verification 之后，receipt retention worker 才可安全 finalize journal；worker crash 必须保守保留，不得删除 receipt 后留可重用 action ID。
5. **rollback。** 若 release 回滚到不理解 receipt 的版本，必须禁用 direct generation 或保留同一 action coordinator，不得让旧代码绕过 receipt 直接生成。数据库/文件 migration 不可作为 rollback 的替代。

## 7. 阶段任务、owner 与停止条件

| 阶段 | 交付与责任 | 停止条件 |
| --- | --- | --- |
| 0. Approval / ADR | 产品确定 30 天 result window、expired UX、人工恢复；API 锁定 payload/result/status；privacy 批准 keyed request tag 和 private retention；运维批准 recovery runbook；ADR 更新 ADR-0005 的 direct `lesson_generated` trace scope，或明确本切片不写 trace。 | 任一 owner 未批准，**不改 IPC / receipt / source**。 |
| 1. Contract tests first | shared type/parser 的 strict actionId、result union、status contract；renderer action lifecycle reducer；旧 payload rejection。 | tests 未先覆盖 parser/result discriminants，不接 main writer。 |
| 2. Receipt foundation | main-only receipt repository：safe path, permissions, size/schema validation, durable read/write, mutex, tombstone cleanup；无 provider integration。 | receipt 读写或 corrupt/missing fail-closed 不可证明，停止。 |
| 3. Generation seams | 将 direct path 从 agent path 分出 action coordinator；在 production boundary 注入 durable callback；publisher 支持 reserved transaction / targeted verification；直接 action 保留 journal。 | 无法在 provider 与第一可见 artifact 前建立 durable receipt intent，停止并维持 NO-GO。 |
| 4. Projection recovery | 以固定 event ID、固定 effect timestamp 完成 index → lifecycle → history → registry 的逐相 read/verify/continue；仅 direct UI 使用。 | 任何 phase 需要依据 content 相似性或重写 legacy JSONL 才能恢复，停止。 |
| 5. UI / stream | appStore pending marker、reload status、in-progress presentation、terminal vocabulary、new-action confirmation；`reused` 不重复 client effects。 | reload 会自动 resend、stream reconnect 会 attach old stream 或 UI 暴露 internals，停止。 |
| 6. Fault / operational sign-off | I/O/crash injection、provider hooks、privacy/log scans、target platform manual recovery、retention cleanup / rollback rehearsal。 | 仅 unit pass、没有真实 restart/ops evidence，不关闭 C-5I。 |

未来候选修改面仅供分配，不代表当前已存在：`src/shared/teaching-types/workspace.ts`、`src/shared/teaching-types/lesson.ts`、`src/shared/teaching-types/system-api.ts`、`src/main/teaching-ipc-commands.ts`、`src/main/teaching-ipc-gateway.ts`、`src/preload/index.ts`、`src/renderer/src/app-shell/appStore.ts`、`src/main/teaching-workspace.ts`、`src/main/teaching-lesson-generation.ts`、`src/main/teaching-lesson-artifacts.ts`，以及受限的新 main-only receipt/action-coordinator module。不得借此清单把 agent、MISSION、style 或 generic writer 纳入实现。

## 8. 逐项验收

以下项目全部需要自动化证据；带“操作”的项目还需要目标平台上的人工/集成记录。建议新增 direct-action 专用 test files，而不是把 receipt 行为混入 agent tests。

### A. Contract 与隔离

- [ ] 两个 direct endpoint 都拒绝缺失、非 UUID、超长或未知字段的 `actionId`；parser 不让 renderer 传 `traceId`、receipt path、transaction ID、event ID 或 provider fields。
- [ ] 普通和 stream endpoint 使用同一 `DirectLessonActionResult` discriminated union；status endpoint 不接受 payload content，且不泄露 internal phase / private locator。
- [ ] 同 prompt + 不同 action ID 触发两个独立 action；同 action ID + workspace/operation/requestTag 不匹配返回 `conflict`，从未调用 provider。
- [ ] agent `generate_lesson`、MISSION/style 和 generic writer 的 payload、result、trace coverage、正常执行路径均无行为变化；direct action ID 不进入它们。

### B. Provider 与并发

- [ ] 同一 action ID 的并发 ordinary/stream submit 只有一次 provider boundary entry、一次 artifact publication、一个 lifecycle event ID、一次 registry effect；两个 caller 收到 `succeeded` / `reused` 的稳定组合。
- [ ] lost IPC response、sender destroy、listener cleanup、chunk 丢失、renderer reload 都不会启动第二次 provider；reload 通过 status 获得 `in_progress` 或 terminal result。
- [ ] `provider_started` 后的 throw、timeout、crash、restart、receipt write failure 都返回 `indeterminate: provider_outcome_unknown`，并有断言证明没有 automatic provider rerun。
- [ ] pre-provider validation / auth / receipt prepare failure 不调用 provider，且只返回允许的 `rejected` / `indeterminate`。

### C. Publication 与 projection recovery

- [ ] 注入 artifact stage、rename、canonical Session bind、journal write、commit、post-commit close/directory-sync fault；只允许 publisher 已证明的 targeted transaction recovery，不产生第二套 artifact 或删除 external bytes。
- [ ] 对每个 index write、lifecycle append、history write、registry save、receipt write 前后执行 crash / EIO / read-back uncertainty 注入；恢复只能补唯一可证明缺口，或 fail closed。
- [ ] lifecycle append uncertainty 验证以 main-generated `lifecycleEventId` 为准：已有唯一匹配行不追加；无证明不追加；不按 prompt/title/path 匹配、不重写 JSONL。
- [ ] completed retry 不写 artifact/index/lifecycle/history/registry，不重新生成 state timestamp；从 canonical state 返回与首次兼容的 lesson/state/result。
- [ ] 修改、删除或替换 receipt-referenced artifact/index/journal/event 后，retry 返回 `conflict` 或 `indeterminate`，保留现有 bytes；不做 rollback / repair / provider rerun。

### D. 隐私、安全与迁移

- [ ] receipt JSON、tombstone、logs、errors、telemetry fixtures 和 snapshots 中没有 raw prompt/messages/courseName、rendered content、artifact SHA-256、absolute path、provider credential/request ID、trace 或 action ID 的自由文本输出。
- [ ] receipt path containment、symlink、directory/file permissions、oversize、malformed JSON、unknown schema、missing/corrupt file 都有 fail-closed tests；renderer/API 不存在 list/read receipt capability。
- [ ] legacy workspace/no-receipt action、旧 journal/index/lifecycle rows 没有被扫描、回填、添加 trace/action 或重写；旧 direct payload 的 migration behavior 为明确 reject，而不是 main-generated identity。
- [ ] 30 天 full-result cleanup 与 tombstone 保留经过 fake-clock tests：expired ID 从不重新进入 provider；workspace deletion 清理 private receipt/tombstone 的权限与失败行为可审计。

### E. 操作验收

- [ ] macOS、Windows、Linux 目标 profile 上验证 process kill/restart、renderer reload、provider network interruption、journal retention/cleanup、manual `indeterminate` runbook 与 rollback guard。
- [ ] 运维能在不读取 prompt/content/path 的前提下，用 approved aggregate metrics 发现 `indeterminate`、receipt corruption、provider non-rerun；privacy owner 签署日志 / crash dump / analytics review。
- [ ] ADR、runbook、API docs、[本地数据待办](../local-data-todo.md) 与本文件同步状态；只有上述所有验收及实际运维证据完成后，才能把 C-5I 从 NO-GO 改为已实施。

## 9. 当前结论

**当前结论仍为 NO-GO。** 当前代码没有 action identity、request tag、receipt、status query、provider boundary callback、reserved publication transaction、direct-action journal hand-off 或上述故障测试；ADR-0005 也明确不覆盖 direct-UI `lesson_generated`。本文件提供的是实施前必须遵守的 contract，而不是对现有 durable publish / trace / lifecycle 的完成声明。任何无法满足第 3.1 的 request-binding privacy 前提，或无法满足第 4.1 的 publisher intent/verification 前提的方案，都必须退回产品决定“每次 retry 是新 action”，不能以内容 dedupe 或自动 rerun 绕过。
