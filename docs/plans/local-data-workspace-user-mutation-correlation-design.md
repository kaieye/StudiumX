# C-5H：Workspace 用户变更 correlation 设计门（mission-first，未实现）

> **状态：未批准、未实现。**
>
> 本文是 `mission_updated` 的用户动作关联与受限重放设计门，而不是功能完成声明。现有 `MISSION.md` / `assets/lesson.css` durable publish 属于 [ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md)；main 生成、规范化和安全记录 trace 的既有范围属于 [ADR-0005：main-owned trace correlation 与安全日志](../adr/0005-main-owned-trace-correlation-and-safe-logs.md)。它们都**不**提供 action identity、receipt、跨文件事务或 exact retry。
>
> 任务分配的权威入口是[本地数据待办](../local-data-todo.md)的 P5H。本计划只提出批准后可执行的 mission-first 切片；`lesson_style_applied` 明确不在首个切片内。

## 1. 目标、问题边界与非目标

### 1.1 要解决的问题

用户点击“更新 mission”后，IPC response 可能丢失，renderer 可能 reload，或者 `MISSION.md` 已发布而 lifecycle append / registry save 尚未成功。当前调用方无法区分以下两件事：

- 对**同一次**用户提交的重新取得结果；
- 用户再次提交相同或相似 prompt 的新动作。

首个切片的目标是在批准的 action contract 内，让 main 能对已被证明完成的同一 mission action 返回稳定结果，而不重复写 `MISSION.md`、追加第二条 `mission_updated`，或再次 touch/save registry。无法证明状态时，宁可返回明确的 `conflict` 或 `indeterminate`，也不得猜测、覆盖或补写。

这不是“任意 crash 后一定可自动恢复”的承诺。现有用户可见 Markdown 不含 revision / mutation token；若不允许保存内容或内容派生的 verifier，main 在某些 crash 与外部编辑组合中无法证明当前 bytes 属于原 action。该不可证明性是本设计的硬边界，不得用文件存在、时间戳、同 prompt、trace 或 JSONL 扫描来伪造 exact retry。

### 1.2 首个切片范围

仅覆盖 renderer 的 mission submit 经既有 `teach:update-mission` IPC 至 main `TeachingWorkspaceService.updateMission()` 的以下链条：

```text
private receipt (proposed) → MISSION.md → workspace lifecycle JSONL → global workspace registry → result
```

其中 `MISSION.md` 是用户可见 canonical artifact；workspace lifecycle JSONL 是既有变更历史；registry 只保留现有 activation / `updatedAt` 语义。receipt 只能是 main-owned、workspace-private 的 recovery aid，不能成为 mission、lifecycle 或 registry 的事实来源。

### 1.3 明确排除

本 gate 不改变或不自动纳入：

- `lesson_style_applied`、CSS scaffold/repair、`write_workspace_file`、allowlisted Markdown writer、agent/tool mutation 或任何其它 lifecycle producer；
- [C-5I direct-UI lesson generation correlation](local-data-lesson-generation-user-action-correlation-design.md)、provider 调用、lesson/artifact journal 或 agent retry；
- ADR-0004 的 durable primitive、跨文件 transaction、rollback、legacy JSONL 回填 / 重写 / dedupe；
- 全局 receipt registry、跨 workspace action、云同步、多进程协作或 external editor 的隐式合并；
- 对既有 lifecycle prompt 的 redaction 或历史数据清理。若要改变既有 raw `prompt` 历史，须另立数据治理 / migration 方案，不能搭载在 C-5H；参见 [ADR-0007：persisted user history redaction](../adr/0007-persisted-user-history-redaction.md) 的范围限制。

## 2. 当前基线（压缩）

已实施能力不是 C-5H 的 action/receipt 实现。权威边界：

| 主题 | 权威记录 | 对本设计的含义 |
|---|---|---|
| `MISSION.md` 等 durable publish | [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) | 单文件 durable replace ≠ action identity、receipt 或跨文件 transaction |
| main-owned trace | [ADR-0005](../adr/0005-main-owned-trace-correlation-and-safe-logs.md) | trace 是诊断关联，不是 caller actionId 或 exact retry key |
| 新持久化 history 脱敏 | [ADR-0007](../adr/0007-persisted-user-history-redaction.md) | 不得搭载改变既有 lifecycle raw prompt 历史的治理 |

**当前缺口（获批前不得当作已实现）：**

- IPC `UpdateMissionPayload` 仅有 `{ workspaceId, prompt }`；无 caller action identity 或 replay/conflict result。
- renderer 每次直接提交 prompt；无跨 response-loss / reload 保留的 submit identity。
- `updateMission()` 顺序为 durable replace `MISSION.md` → 新 lifecycle event → registry touch/save；三者无共同原子性、无 private receipt / reconcile state machine。
- 用户可见 Markdown 不含 revision/mutation token；在不允许保存内容或内容派生 verifier 时，部分 crash + 外部编辑组合下无法证明 exact retry。

代码入口：`src/main/teaching-workspace.ts`、`src/main/teaching-ipc-commands.ts`、`src/renderer/src/app-shell/appStore.ts`。目标工作流与拟议 receipt 见后续章节，**未批准、未实现**。

## 3. 关联 ID 与事件契约

### 3.1 ID 的责任边界

| ID / 字段 | 生成者与生命周期 | 可以出现的位置 | 禁止用途 |
| --- | --- | --- | --- |
| `actionId` | renderer 在用户明确 submit 时生成；只在批准的 lost-response / reload retry 窗口复用；新 submit 必须新建。建议格式为严格 UUID，且 non-secret。 | 严格 IPC payload、main private receipt、内存中的 workspace queue。 | 不能是 trace、lifecycle event `id`、JSONL 字段、日志 / analytics query key、文件名以外的 user-visible artifact 元数据。 |
| `traceId` | main 在首次**接受** action 时生成并以 ADR-0005 的 UUID normalization 处理。 | receipt；在批准扩展 ADR-0005 范围后，`mission_updated.traceId`；固定安全词表日志。 | renderer 不提供；不能作为 receipt key、dedupe key、action identity 或 lifecycle filter。 |
| `eventId` | main 为该 lifecycle event 预分配随机 UUID。 | receipt 与既有 lifecycle event `id`。 | 不能被 renderer 作为 retry key，也不能替代 action ID。 |
| `workspaceId` / operation kind | caller supplies workspace ID；main validates registry / operation. | IPC、receipt、event（既有 workspace ID）。 | 不能由 receipt 重新授权路径或跨 workspace replay。 |

首个切片只允许一个 operation kind：`mission_update`。`lesson_style_applied` 不能借用该 receipt schema 或 actionId parser。

### 3.2 拟议 IPC 与结果表面

实施前须通过 shared type、IPC parser、preload、main 和 renderer 的同一 contract 审查。候选形状如下，名称不是已实现 API：

```ts
type UpdateMissionPayloadV2 = {
  workspaceId: string
  prompt: string
  actionId: string
  // 仅在第 6.2 节选定可验证 request/revision binding 后加入；
  // 不得假装现有 prompt 本身可安全比较。
}

type MissionMutationResult =
  | { disposition: 'completed'; state: TeachingAppState }
  | { disposition: 'reused'; state: TeachingAppState }
  | { disposition: 'conflict'; retryable: false }
  | { disposition: 'indeterminate'; retryable: false }
```

- `completed`：同一 action 的 file、event 与 registry 都已确认，receipt 已 final。
- `reused`：同一 action ID 的 final receipt 已被安全读取；不新写任何 participant，返回 fresh state。
- `conflict`：已观察到不满足获批 binding / ownership 的状态；不写 canonical artifact 或 JSONL。
- `indeterminate`：I/O、crash、receipt 或外部状态使 main 无法证明下一步安全；不自动 retry 或新建 action。

无效 IPC、未知 workspace、非法 action ID 和未获授权 operation 应继续在 parser / service 边界 reject，且不得创建 receipt。不得把底层异常文字、receipt 路径、prompt、CSS、hash、provider/request ID 或 secret 放入通用 error text。

### 3.3 lifecycle event contract

若且仅若 ADR-0005 的覆盖表经 ADR / owner 批准扩展到 mission，新的 `mission_updated` 仍使用现有 schema：

```json
{
  "id": "<main eventId>",
  "kind": "mission_updated",
  "timestamp": "<existing timestamp semantics>",
  "workspaceId": "<existing workspace ID>",
  "prompt": "<existing field; C-5H 不新增或迁移它>",
  "paths": ["MISSION.md"],
  "traceId": "<normalized main-owned trace, if approved>"
}
```

不得新增 `actionId`、receipt location、phase、fingerprint、payload binding 或诊断数据到 JSONL。receipt 中保存 `eventId` 是为了在**已有** event identity 的严格匹配下判断是否已经 append；不得把 action ID 当作 lifecycle dedupe key。event 的 raw prompt 是当前实现而非本计划新增的数据处理；它必须单独接受 privacy review，不能因 receipt 不记录 prompt 而被错误描述成“mission mutation 不持久化 prompt”。

## 4. 私有 receipt、持久化与可观测性

### 4.1 receipt 的最小 authority

receipt 是 main-owned 的私有 metadata，候选放置为 workspace `.studiumx/` 下一个新的受限 namespace；**路径、descriptor/no-follow capability、权限、retention 与 cleanup 尚未获批，不能先创建文件。**实施设计必须指定：

- 0600（或更严格）的 schema-versioned JSON、bounded bytes、严格 allowlist parser、unknown version / malformed / symlink / unexpected file type fail closed；
- action ID 定位的非枚举风险、per-workspace ownership、workspace removal / import / move 时的行为，以及任何 backup 的同等私有权限；
- receipt 本身的 durable write / replacement 语义、崩溃点与保留期。不得复用 user-visible Markdown/CSS 或 lifecycle JSONL；
- 仅含：schema version、operation kind、workspace ID、action ID、main trace ID、event ID、有限 phase / timestamps、以及获批准的非内容性 state reference。不得含 raw prompt、rendered mission、CSS、content hash、provider/request ID、secret、绝对路径、可枚举的外部 locator 或错误 stack。

receipt 的 candidate phase 只能陈述已 durably known 的事实，例如 `prepared`、`mission_published`、`event_appended`、`registry_saved` / `final`；每一次 phase publish 都必须在它声称的 participant 已完成之后。receipt 不是跨文件 commit record：`final` 只表示本 action 的三个既有 participant 已逐项确认，不制造共同原子性。

### 4.2 可观测性与支持边界

日志继续使用 ADR-0005 的安全 tagged-text / normalized trace 边界。允许的诊断只应为 operation kind、有限 disposition / phase、错误类别和 trace ID；不得记录 action ID、workspace path、prompt、receipt body、payload binding、文件 bytes 或 stack 中的敏感值。若 action ID 对支持排障确有必要，必须另行批准专用、受限的 support channel；默认不记录。

面向用户的 UI 只显示稳定 disposition 和下一步（已完成、已恢复结果、需重新确认、状态不明并联系恢复流程）。它不得显示 receipt 文件、内部阶段、event ID、trace ID 或“请重试”这种会诱导不安全盲重放的文案。

### 4.3 retention、清理与迁移

- 新 receipt 仅对新 action 生效；不扫描、回填、重命名、修改或依 actionId 解释已有 `MISSION.md`、lifecycle segment 或 registry。
- upgrade 后没有 receipt 的历史 mission action 一律是 legacy / uncorrelatable，不能被自动认领为 `reused`；新 action 使用新 schema。
- cleanup 只能删除已 final、超过获批 retention 的**私有 receipt**，且删除失败不得影响 canonical mission/event/registry；非-final、损坏或未知版本 receipt 不得自动删除。
- downgrade / 旧版本再次运行、workspace import/export/copy、receipt 与 workspace 分离、path move 与 workspace deletion 的 owner / runbook 必须在实施前确定。若不能保证安全读取与 ownership，返回 `indeterminate`，不重建 receipt。

## 5. 错误、重试、并发与恢复矩阵

### 5.1 不能被省略的证明规则

1. 只要 receipt、canonical file、event 或 registry 的状态无法证明，main 不得写另一个 canonical file、append 新 event、touch registry 或“修复”历史。
2. 文件存在、相同 prompt、mtime/size、相同 trace、JSONL 中相似 row 都不是 action completion 的证明。文件元数据最多用于发现疑似外部变化，不能作为 bytes identity。
3. 同 prompt + 不同 action ID 必须是两个独立动作；不得 content-dedupe。
4. 同 action ID 的并发调用必须在进入 receipt read / write 前序列化。当前 `updateMission()` 没有该 queue；现有 durable primitive 的单路径 queue 也不覆盖 lifecycle 与 registry。实施前须定义 main 内 per-workspace queue，并决定多 Electron instance / 外部 writer 的 exclusive-ownership 或 fail-closed policy。
5. 不能把 registry save 失败当作可忽略的 UI success。response 只在 `final` 后返回 `completed`；任何非-final 结果不得返回新 state 伪装成功。

### 5.2 必需 crash / retry 表

下表是实现必须转化为 fault-injection tests 的最低表，不是当前已具备的 recovery 行为。

| 观察到的 receipt / participant 情况 | 允许动作 | public result | 禁止动作 |
| --- | --- | --- | --- |
| action ID 不存在，输入与 action ID 都通过严格校验 | 在获批 binding 和锁已取得后创建 `prepared` receipt，开始一次新 action。 | 后续 `completed`，或明确失败。 | 复用 trace / event ID；依据 payload 内容去找旧 action。 |
| final receipt，且 operation/workspace/action 严格匹配 | 不写任何 participant；重新组装 fresh state。 | `reused`。 | 重写 mission、重 append event、重 touch registry。 |
| pre-publish I/O 明确失败，且能证明 rename 未发生 | 记录有限已知失败；由获批 UI 以**新** action 重新确认。 | reject / non-success（最终词汇待批准）。 | 在没有 request binding 的情况下把变更后的 payload 继续塞回旧 action。 |
| `prepared` 后发生进程中断，或 receipt write / file rename 的先后无法证明 | 不写、不扫描猜测、不覆盖。 | `indeterminate`。 | 依据 file existence、stat 或相同 prompt 自动继续。 |
| `mission_published` / `event_appended` 后 restart，且获批 binding 不能证明 canonical ownership 或 external edit 未破坏语义 | 不写；保留 receipt 给受控恢复。 | `conflict` 或 `indeterminate`。 | 补 append、补 registry、rollback 或删除 mission。 |
| 已能用获批 event identity 严格证明 event 已 append、且所有前置 canonical ownership 均可证明 | 仅推进缺失的后续 participant，再持久化下一 phase。 | 最终 `completed` / `reused`。 | 追加第二条 event 或新建 event ID。 |
| receipt 缺失、损坏、未知版本、权限 / safe-path failure，或 workspace ID / operation 不匹配 | 不创建替代 receipt，不触及 canonical state。 | `indeterminate` 或 `conflict`。 | 以 legacy files “重建” receipt。 |
| lifecycle append 或 registry save 报错 / crash | 按 receipt phase 和获批 proof 处理；未知即停止。 | 非 success，除非随后严格证明 final。 | 只因 `MISSION.md` 已存在而报成功。 |
| 同 action ID 同时到达 | queue / lease 内一个 owner 执行，其他调用等待并读取 final 或相同 non-final disposition。 | 相同稳定结果。 | 两个 writer 分别 append / save。 |
| 不同 action ID 同 workspace 同时到达 | 按获批 workspace serialization policy 排队；第二个 action 在获取所有必要 revision/binding 后才可开始。 | 各自独立结果。 | 并行读取旧 registry 后互相覆盖，或按 payload dedupe。 |

**关键限制：**在“不持久化 raw content、content hash 或其他可验证 content binding”与“canonical Markdown 不含 revision”的组合下，`prepared → file publish` crash 后无法可靠识别原写入或外部覆盖。上述表故意要求 `indeterminate`。若产品要求该窗口的自动 exact recovery，必须先批准第 6.2 节的 stronger binding / revision protocol；仅补测试或 receipt phase 不能解决信息不足。

## 6. 实施前的批准门与推荐决策

### 6.1 必须由 owner 共同批准

产品、API、privacy、安全 / 本地存储、运维 owner 必须在任何类型或 writer 改动前批准：

1. action ID 的生成者、格式、最长长度、renderer reload / abandoned action 生命周期，以及“相同 prompt 的新 submit 必须新 action ID”；
2. 稳定 result vocabulary、UI 文案、何时允许用户新建 action 重新确认，以及 `conflict` / `indeterminate` 的人工恢复 owner；
3. receipt namespace、schema、private permissions、safe path capability、retention / cleanup、backup、import / deletion / downgrade 与 support policy；
4. workspace serialization / multi-process ownership，外部编辑的产品语义，以及 crash matrix 中哪些 phase 可以自动继续；
5. 是否扩展 ADR-0005 到 `mission_updated` trace，并把稳定 action/receipt architecture 单独沉淀为新 ADR 或 ADR amendment；
6. 现有 `mission_updated.prompt` 的 privacy posture。C-5H 不扩大它，但新 trace / receipt implementation 不能借机复制它。

未通过上述批准时，唯一正确状态是保留当前 at-least-once 调用语义；不得悄然加 actionId、receipt、event trace 或“retry”按钮。

### 6.2 request binding 的不可回避决策

当前约束禁止 receipt 保存 prompt、rendered mission、content hash 和 secret-derived value。于是 main 无法仅凭同一 action ID 判断一个 reload 后的 prompt 是否仍是首次请求，也无法在外部编辑后证明 `MISSION.md` 的 bytes 仍来自该 action。

必须在下列方案中**明确选择并记录**，不得把选择留给实现者：

| 方案 | 能力与代价 | 本计划建议 |
| --- | --- | --- |
| A. 维持最小化限制 | 服务端只把 final receipt 作为结果 replay；非-final / uncertain action 返回 `indeterminate`。同 action ID 的 payload mismatch 不声称可检测，UI 必须在编辑后新建 ID。 | **保守默认。**不承诺 crash-window exact recovery。 |
| B. 批准私有、受限的 request / content verifier | 定义算法、key ownership、rotation、泄露模型、retention、日志禁令与 external-edit proof；它是新的 content-derived metadata，须 privacy/security ADR。 | 仅在产品必须要 stronger retry 时采用；不能伪装成“非内容数据”。 |
| C. 改变 canonical protocol 以提供可信 revision / CAS | 需要新的 user-visible artifact / sidecar authority、兼容性、external editor 和 migration 设计。 | 不属于 C-5H 首个切片，须独立 design gate。 |

没有选择 A/B/C 之一，就不能声称“same actionId + changed payload 会被检测为 conflict”。`expected revision` 也只能解决其实际定义的 revision 问题；它本身并不神奇地比较 prompt。

## 7. 分阶段实施计划与验收

### Phase 0 — 设计批准与 ADR

**产物：**已签署的第 6 节决策、更新的 [本地数据待办](../local-data-todo.md) 状态、trace 范围 ADR amendment / 新 ADR，以及 crash matrix 的 machine-testable specification。

**验收：**能逐项回答 receipt authority、request binding、external edit、non-final recovery、多进程、retention、UI result 与人工恢复责任；没有 “TBD 后实现” 的安全关键字段。否则不进入代码阶段。

### Phase 1 — shared contract 与 renderer lifecycle

**候选落点：**`src/shared/teaching-types/workspace.ts`、`system-api.ts`、`teaching-ipc-contract.ts`、`src/main/teaching-ipc-commands.ts`、`src/main/teaching-ipc-gateway.ts`、`src/preload/index.ts`、`src/renderer/src/app-shell/appStore.ts` 及对应 unit tests。

**任务：**引入 mission-only 的严格 payload / result discriminated union；parser 拒绝多余或非法 action fields；renderer 在一次明确 submit 内保存 action ID，lost response / reload 仅按获批条件复用，输入改变或显式放弃时新建 ID；UI 区分 completed、reused、conflict、indeterminate，且不把 non-success state 当作 success。

**验收：**类型、preload、gateway、service、renderer 的 payload/result 一致；renderer 不传 trace；不存在 style 或 generic writer 的 API 变化；IPC fuzz / negative tests 不产生 receipt 或 side effect。

### Phase 2 — main receipt 与单 action state machine

**候选落点：**`src/main/teaching-workspace.ts` 及一个新的、受限的 mission receipt module；不得把逻辑塞入 generic durable writer。

**任务：**实现 receipt schema validation、private durable replacement、per-workspace serialization、main trace/event-ID allocation、prepare / reconcile / finalize；只在 proof table 允许时调用既有 mission file、lifecycle 与 registry participant。将 receipt path / malformed input / retention 安全性封装在 main，renderer 无路径能力。

**验收：**schema unknown / corrupted / symlink / permission / workspace mismatch 全部 fail closed；receipt 与 backups 不含禁止字段；同 ID final retry 零额外 file/event/registry write；不同 ID 同 prompt 不 dedupe；trace 仅 main-generated且仅在批准的 event coverage 内出现。

### Phase 3 — fault、restart、并发与隐私验证

**任务：**在 mission service / receipt / IPC / integration suites 加入可注入 faults，覆盖每个 receipt write、`replaceDurably` 的 write/sync/close/rename/directory-sync、JSONL append、registry save、process restart、response loss、renderer reload、同/不同 action ID 并发、external edit、receipt tamper / missing、disk-full / permission 与 unsupported platform profile。

**验收：**逐项执行第 5.2 节表：所有不能证明的路径无 canonical rewrite、无 duplicate JSONL row、无 registry touch 且返回 non-success；final retry 的 write counters 为零；日志 / fixtures / snapshots 中没有 prompt、mission bytes、action ID、receipt path、hash、provider/request ID 或 secret。POSIX mock 不能作为 Windows / power-loss closure；若目标 profile 未验证，明确保留为不支持 / fail closed。

### Phase 4 — rollout、兼容性与运维

**任务：**限定 feature flag / release cohort（如获批）、定义 upgrade / downgrade、retention cleanup、workspace copy/import/removal 与 manual recovery runbook；在 docs 中登记最终实施证据和 ADR 状态。

**验收：**fresh install、legacy workspace、receipt missing/corrupt、feature disabled、upgrade、downgrade、workspace moved / imported、cleanup failure 均不会扫描或改写 legacy canonical data；关闭 feature 后新 action 回到获批准的既有语义，不误读旧 receipt；运维能只凭安全 disposition / trace（受权限控制）路由人工恢复。

## 8. `lesson_style_applied` 为何仍排除

现有 `applyLessonStyle()` 在 main 完成 `assets/lesson.css` → lifecycle → registry 后返回 `TeachingAppState`；renderer 随后独立调用 `updateSettings({ workspace: { lessonStyleId } })`。因此它至少跨越 workspace CSS/lifecycle/registry 与 global settings 两个独立写入边界，且 settings failure 发生在 IPC success 之后。

将 mission receipt 直接套到 style 会掩盖尚未决定的问题：CSS 成功而 settings 失败时用户可见状态、retry owner、重复 style apply、CSS 实现演进、scaffold/repair 写入是否产生 event、global settings 的 authority、以及跨 workspace / global 的并发与恢复。必须先完成 mission 的独立审查、实现和验收，再为 style 建立单独 design gate；在此之前，不得修改 `ApplyLessonStylePayload`、`lesson_style_applied` event 或 renderer settings sequence。

## 审查结论

截至本次审阅，C-5H 仍只有设计门：mission 与 style 的 durable publish 已存在，但 renderer action identity、private receipt、mission trace coverage、typed replay result、跨阶段 proof、并发 ownership 和 partial-failure recovery 均未实现。首个可实现目标应是**受证据约束的 mission-only result replay**，而不是以未证明的自动重试冒充 exactly-once。只有在第 6 节的 owner 决策与 ADR 完成后，才可按第 7 节分阶段实施；稳定架构必须沉淀在 ADR，而不能只留在本计划。
