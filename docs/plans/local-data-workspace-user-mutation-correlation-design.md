# C-5H：Workspace 用户变更 correlation 设计门（mission-first，未实现）

> **状态：未批准、未实现。**
>
> 本文只保留 `mission_updated` 的 action correlation / exact-retry 设计门，以及将 `lesson_style_applied` 排除在首个切片外的理由。它不是功能完成声明，也不重复已经由 [ADR-0005：main-owned trace correlation 与安全日志](../adr/0005-main-owned-trace-correlation-and-safe-logs.md) 承接的 trace 生成、规范化和安全日志决定。
>
> 已关闭范围与仍待分配工作见 [本地数据待办](../local-data-todo.md)。ADR-0005 覆盖的 trace 不是 action identity、receipt、dedupe key 或 retry contract；本设计不得改变该边界。

## 1. 当前实现与缺口

当前实现已经分别持久化两个用户可见变更，但**没有** C-5H correlation contract：

```text
mission_updated:
  MISSION.md durable write → lifecycle JSONL append → registry touch/save

lesson_style_applied:
  assets/lesson.css durable write → lifecycle JSONL append → registry touch/save
  renderer 在 IPC 成功后另行写 global settings（second write）
```

截至当前分支，`UpdateMissionPayload` 仍只有 `{ workspaceId, prompt }`，`ApplyLessonStylePayload` 仍只有 `{ workspaceId, styleId }`，两个 IPC 结果均为 `TeachingAppState`。`updateMission()` 与 `applyLessonStyle()` 没有 action ID、private receipt、exact-retry、事件去重或 partial-failure recovery state machine。对应 durable 单测也明确断言当前 `mission_updated` / `lesson_style_applied` row 不含 `traceId`、`actionId` 或 `receipt`。

因此，一次 IPC 超时、renderer reload 或 file 已发布但后续 lifecycle/registry 失败时，现有调用无法安全地区分“重试同一用户动作”与“再次提交相同内容”。不得将既有 durable publish 顺序、ADR-0005 的 main-owned trace，或内容相同误读为 exact retry。

`lesson_style_applied` 还包含 renderer 成功后更新 global settings 的独立 second write；该写入不属于 workspace CSS/lifecycle/registry 的现有原子事实边界。未决定其用户可见状态、retry owner 与恢复责任前，style 不能纳入 mission 的首个切片。

## 2. 此设计门的范围与红线

- `MISSION.md` 和 `assets/lesson.css` 继续是用户可见事实；registry 与 lifecycle 保持既有语义。任何 receipt 只能是私有的恢复辅助记录，不能替代这些事实。
- 不在 Markdown、CSS、front matter、HTML comment、scaffold 或 lifecycle row 写入 action ID、receipt 或机器元数据；不扫描、回填、迁移或重写 legacy 文件/JSONL 来猜测完成状态。
- action ID 若获批，必须与 ADR-0005 的 main-generated trace 分离：renderer 不提供 trace；action ID 不成为 lifecycle identity、dedupe/query/filter key，也不写入用户可见文件或日志。
- receipt、测试夹具和诊断不得新增 raw prompt、CSS/内容 hash、secret-derived value、provider ID 或 request ID。外部编辑、legacy receipt 缺失、malformed historical row 或无法证明的 I/O 状态必须 fail closed，保留 canonical bytes。
- 非目标：其它 user actions（包括 `lesson_generated`）、JSONL read+append concurrency、C-1/C-2/C-6 工作，以及将 style 的 renderer settings second write 悄然并入 mission 事实事务。

## 3. 待批准的方案选择

| 方案 | exact retry 语义 | 结论 |
|---|---|---|
| A. lifecycle-only UUID | 每次 main 调用产生新 UUID，不能绑定 IPC retry，也不能返回原结果或处理 partial failure。 | 拒绝；它至多是调用诊断，且不得把 ADR-0005 trace 改作 identity。 |
| B. renderer opaque action ID + main private receipt | 同一 action ID 可在明确的重放、冲突与恢复协议下找回同一动作；相同 payload 但不同 action ID 仍是两个用户动作。 | **mission-first 候选方案**；需要产品/API 批准。 |
| C. main-generated UUID + 无 exact retry | 每次失败后的再次提交是新动作。 | 仅当产品明确接受 at-least-once 语义时可选；当前未批准。 |

方案 B 不表示 renderer action ID、receipt 文件、IPC 返回类型或 retention 已获批准。

## 4. 方案 B 的最小合同（仅在批准后实施）

### 4.1 API 与私有 receipt

renderer 可为一次 mission submit 生成并在明确 retry/reload 窗口内复用 opaque、non-secret `actionId`。main 首次接受未见 action ID 时生成 ADR-0005 规定的 normalized trace；action ID 只用于 private receipt 定位，trace 只作为新 lifecycle event 的 correlation metadata。

receipt 需要独立的私有 workspace metadata 域和 owner。最小字段只能包括 schema/version、opaque action ID、operation kind、workspace ID、main-generated trace、有限 phase/status、必要的非内容性事实引用与更新时间；不得持久化 raw prompt、rendered mission、content hash 或 provider/request 数据。具体路径、权限、retention、清理和 IPC result 枚举尚未决定。

### 4.2 retry、冲突与恢复

获批实现必须在写代码前定义 crash/recovery 表，并至少满足：

1. **同一 action ID + 同一语义请求：** 返回原 action 的结果，不重写 `MISSION.md`、不追加第二个 `mission_updated` row、不再次 touch/save registry。
2. **相同 payload + 不同 action ID：** 是两个独立用户动作；不得按 prompt、rendered content 或内容 hash 自动 dedupe。
3. **同一 action ID + 改变 payload，或 external edit：** 不得静默覆盖。仅在能按获批 expected revision/CAS 或其他非内容 binding 证明状态匹配时继续；否则返回 `conflict` / `indeterminate`，不新写 canonical 文件或 JSONL。
4. **file、lifecycle、registry、receipt 任一阶段失败或中断：** retry 只能完成已证明安全的缺失步骤，或返回明确的 `indeterminate` / `conflict`；不能扫描并重写历史文件猜测状态，也不能为恢复新增重复 lifecycle row。
5. **顺序与 durability：** receipt 的 prepare/finalize 不能早于其所声称已完成的 canonical 状态；event reference、CAS/revision 与每个 crash point 的 authority 必须预先确定。

### 4.3 Style 仍明确排除

在 mission contract 实现、审查和验收之前，`lesson_style_applied` 不接入 action ID/receipt。其后续设计必须独立决定：backend CSS/lifecycle/registry 成功而 renderer settings 失败时的展示、retry ownership、scaffold/repair CSS writes 的事件边界，以及重复 style 应用和 CSS 实现演进的语义。

## 5. 获批后的预计落点与验收

下列仅为 future implementation 候选，不表示已修改或穷尽所有文件。

| 区域 | 候选落点 | 必须验收 |
|---|---|---|
| shared IPC/type | `src/shared/teaching-types/workspace.ts`、`system-api.ts` | action ID / receipt-aware result 只覆盖 mission；renderer 不传 trace。 |
| IPC、preload 与 renderer | `teaching-ipc-commands.ts`、`teaching-ipc-gateway.ts`、`preload/index.ts`、`appStore.ts` | 验证 token、单 submit 生命周期复用 action ID、清楚呈现 success/duplicate/conflict/indeterminate（枚举待批准）。 |
| main 与 receipt | `teaching-workspace.ts` 及受限的新 receipt module | mission-only prepare/reconcile/finalize；私有路径/权限；不污染 `MISSION.md`。 |
| tests | mission IPC/service/receipt/lifecycle 测试 | 同 ID retry 无额外写入；不同 ID 不按内容 dedupe；changed payload、external edit、receipt 损坏/缺失、每个 I/O/crash 边界均 fail closed；不泄露敏感内容；不改变 style flow。 |

## 6. 实现前必须由 owner 决定

1. **action-ID + receipt API：** 是否批准 renderer 提供 opaque non-secret action ID、main 持久化 private receipt 并返回 retry/conflict 结果？若否，是否明确接受方案 C 的“每次重试是新动作”？
2. **mission 冲突语义：** retry 遇到 external `MISSION.md` 编辑、changed payload 或无法证明的 partial state 时，是 fail-closed 并要求用户重新确认，还是引入明确的 expected revision/CAS UI？

## 审查结论

C-5H 当前只有设计门：现有 mission/style durable publish 已存在，但 action correlation、receipt、exact retry 和 partial-failure recovery 均未实现、未批准。实施前需先关闭以上两项 owner 决策；完成后应将稳定的 action-identity/receipt/recovery 架构决定沉淀为 ADR，而不是留在本计划中。
