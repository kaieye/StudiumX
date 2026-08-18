# ADR-0170：Agent conversation 主进程串行化与无感并发恢复

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-08-03
- **范围：** 将 desktop renderer 的同分支输入从「冲突后刷新/有限重试」前移为向 main/host per-conversation lane 提交窄 intent；host 持有 active-turn 与 follow-up 队列，同时保持 `expectedRevision` CAS 和 settlement sole-writer。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0040](0040-teaching-session-protocol-facade.md)、[ADR-0055](0055-busy-input-queue-and-replay-contracts.md)、[ADR-0058](0058-agent-session-facade.md)、[ADR-0067](0067-cancel-tool-pair-close-and-busy-ack.md)、[ADR-0082](0082-agent-chat-steer-followup-ipc.md)、[ADR-0089](0089-agent-session-queue-projection.md)、[ADR-0091](0091-agent-session-queue-projection-ipc.md)、[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)
- **证据：** 接线完成见正文「实施状态」；验证记录见 `docs/adr/evidence/ADR-0170.md`；相关单元覆盖 lane/状态机、conversation/CAS、cancel 精确性。

## 背景

用户可能在多窗口、远程控制面、恢复后的旧 renderer 状态，或同一分支的相邻异步操作竞争时遇到：

```text
Conversation branch revision conflict: expected <n>, current <m>
```

该错误来自 agent conversation branch 的乐观并发控制：继续或保存已有分支时，调用方必须携带 `expectedBranchRevision`；主进程只在其等于 canonical branch revision 时接受写入。该约束用于阻止旧 transcript、旧 archive/delete/restore 意图，或旧上下文生成的模型结果覆盖较新的 canonical conversation。

当前 renderer 的恢复策略仍有价值，并应在 host lane 尚未接管的入口继续保留：模型运行前的 stale revision 可静默刷新并安全重试一次；完成保存仅在 canonical transcript 与本地旧前缀逐项一致时才可合并本轮新增 turn；fork 须刷新并验证 source turn；archive、restore、delete、rename 等状态转换只刷新而不自动重放。它们不能替代 host 侧的同 lane 串行化。

## 决定

### 1. Lane 身份与所有权

每个 main/host lane 的稳定 key 必须是下列**两种之一**，不得混淆 canonical 与 pending identity：

```ts
type ConversationLaneKey =
  | { kind: 'canonical'; workspaceId: string; scope: 'workspace' | 'temporary'; conversationId: string }
  | { kind: 'pending';   workspaceId: string; scope: 'workspace' | 'temporary'; pendingConversationId: string }
```

规范化 tuple 分别为 `canonical: (workspaceId, scope, "conversation", conversationId)` 与 `pending: (workspaceId, scope, "pending", pendingConversationId)`。`workspaceId`、`scope` 与 identity 都是 key 的组成部分：不得只按 `conversationId` 串行化；不得把 `mode`、标题、文本、branch revision 或可选空字符串当作 identity。

一个 lane 同时至多有一个 active agent turn。新 conversation 在首个 canonical record 持久化之前只能使用 `kind: 'pending'` key；`pendingConversationId` 是 host 认可的、不可复用的 opaque identity。首个 canonical conversation 成功建立时，host 必须在同一 lane 临界区内把该 lane **原子地 rekey** 为 canonical key：已排队的 intents 跟随同一 lane object、不重新排序；host 记录仅供本 lane 生命周期内解析的 pending→canonical 映射（不是持久化 alias / crash recovery）；rekey 后不再接受新的 pending-key submission；不得将不同 pending lane 的队列仅因最后得到同一 conversation 而合并。若建立 canonical conversation 失败或被取消，pending lane 按既有 run/settlement 语义结算。

### 2. Submit intent

```ts
type SubmitConversationTurnIntent = {
  target: ConversationLaneKey
  clientRequestId: string
  text: string
  mode: 'teaching' | 'temporary'
  delivery: 'follow_up' | 'steer'
  expectedBranchRevision?: number
  expectedActiveTurnId?: string
  skillIds?: string[]
}
```

- `target` 完整携带 `workspaceId`、`scope` 和**恰好一种** conversation identity；canonical target 不得缺少 `conversationId`，pending target 不得携带 `conversationId`。
- `clientRequestId` 是调用方生成的 opaque idempotency key，不得包含正文、secret 或工具结果。
- `text` 是本次用户输入，不是完整可替换 transcript；`mode` 必须与 `target.scope` 的产品语义一致。
- `delivery: 'follow_up'` 是常规新输入（lane idle 可启动，lane active 时 FIFO 入队）；`delivery: 'steer'` 只能尝试注入当前 active turn，且必须提供 `expectedActiveTurnId`。
- `expectedBranchRevision` 是 caller 观察到的前置条件，不是 host 跳过 canonical read 或 force write 的许可；queued item 成为 active 前，host 必须重新读取 canonical branch 及 revision。

稳定 submit disposition：`started`（含 activeTurnId/streamId/conversationId?）、`queued`（含 queuePosition/activeTurnId）、`steered`、`duplicate`（含 originalCode）、`refresh_required`（`stale_branch` | `active_turn_mismatch` | `pending_promoted`）、`rejected`（`invalid_intent` | `queue_full` | `branch_unavailable`）。`refresh_required` 是可恢复的非执行结果，renderer 应刷新 canonical projection 并保留输入或重新提交，不得显示原始 revision-conflict 文案；`rejected` 不是伪成功。

### 3. Cancel intent

```ts
type CancelConversationTurnIntent = {
  target: ConversationLaneKey
  clientRequestId: string
  expectedActiveTurnId: string
}
```

只有 `target` 与 `expectedActiveTurnId` 都精确匹配该 lane 的 active reservation 时，host 才执行取消：按现有 `abortAndDetach` / run settlement 语义取消该 active run，并在同一个 lane 临界区中清除该 lane 的**全部** queued follow-ups，返回实际 `clearedQueuedCount`。不得用旧 cancel 取消后来开始的 turn，不得保留旧队列，不得清理其他 lane。取消之后新到达的独立 follow-up 正常处理。

### 4. Queue hard cap 与 request-id receipt

每个 lane 的 follow-up queue hard cap 固定为 **32** 个 queued intents（**不含**一个 active turn）；第 33 个不同 request 必须得到 `rejected/queue_full`，不静默丢弃、不挤掉旧项。host 为每个 lane 维护 `clientRequestId` receipt：同一 lane 内重复 submission/cancel 不得重复启动、入队、steer、保存或取消，而返回 `duplicate` 及原始类别。receipt retention 仅为 **process-local lane lifetime**；空闲 lane 可由有界 housekeeping 逐出。receipt 不写入 canonical conversation、不进入 SQLite/sync、不承诺固定 TTL / 跨窗口全局永久幂等 / crash 恢复 / restart 自动重放。进程重启后没有 receipt 的请求仍必须经过 canonical read、CAS 和既有 run-stage 恢复判定。public DTO、日志、Doctor 与 support bundle 不得泄露对话正文、secret 或工具敏感结果。

### 5. Host 行为、状态机与 settlement

lane 的最小逻辑状态为 `idle → reserving → active(activeTurnId, streamId, runId, canonicalRevisionAtStart) → settling → draining-next → idle`，另有最多 32 项的 FIFO `queued[]` 与 receipt 集合。实现必须满足：

1. reservation、active identity 校验、enqueue/dequeue、cancel queue cleanup 和 rekey 在 lane 临界区内线性化；任何 `await` 后都不能假定 reservation 仍属于当前调用。
2. lane idle 的 follow-up 从 canonical branch 读取当前状态与 revision 后才启动；每个 queued item 在成为 active 前重新读取，绝不复用上一 turn 的 revision。
3. active turn 的新 follow-up 不启动第二条竞争 stream；仅明确 `steer` 且精确 active identity 匹配时走受控注入路径。
4. 当前 turn 正常完成、取消、模型错误、工具拒绝或 save failure 后，均按现有 AgentRun / facade / transcript / settlement 语义结算和释放 lane；lane 不得吞错、伪装成功或永久卡死。
5. conversation final save 仍走 canonical CAS；host 使用自己读取/推进的 revision，不信任 renderer 声称的「最新」revision。parent-turn stage、assistant confirmation、staged child transcript promotion、audit 和 `TeachingTurnCoordinator` sole-writer 均不得被 lane 旁路。
6. archive、restore、delete、rename 只刷新 canonical projection，必要时重新确认；保存完整 transcript 仅在前缀证明成立时合并本轮新增 turn；fork 在消费前重新验证。它们都不能通过 latest-revision force write 自动重放。

### 6. 迁移顺序与 authoritative queue consumer

迁移分阶段进行，每个阶段只有一个会**自动 drain 并启动下一 run** 的 authoritative queue consumer：先实现纯 main-only lane 状态机（不改变 public IPC / renderer）→ host 接管 conversation start（renderer local FIFO 若暂留只能作输入暂存/展示 mirror，不得自行 drain 后调用 start）→ 统一 follow-up / steer / cancel 到同一 lane 与精确 active identity → 增加只读 queue snapshot/events（renderer 成为纯展示与输入提交端）→ 接入 Web Remote Control 及其他入口（复用同一 gateway/lane，绝不另建可执行队列）→ 清理冗余 retry/queue 分支（仅在等价行为、cancel、恢复、持久化、UX 与领域门禁都有覆盖后）。实现 PR 必须说明当前处于哪一阶段；若任一阶段同时存在两个自动 drain consumer，视为违反本 ADR。

## 实施状态（接线完成）

desktop Agent Conversation 接线已完成：renderer ingress 只提交窄 intent 至 main/host per-conversation lane，host 是唯一会自动 FIFO drain 并启动下一 turn 的 consumer。§3 的精确 cancel intent 已由 public IPC、严格 parser、preload、host gateway 与 renderer 接线。canonical read/CAS 与完整 transcript 旧前缀证明仍 fail-closed；legacy direct `agentChatStream` 仅保留兼容用途（若会与已迁移 canonical lane 的 active turn 竞争则被拒绝），legacy steer/follow-up 不得进入 host-lane stream。Web Remote Control 当前仅 authenticated pairing + 只读 catalog，未接入 chat。验证记录与 WRC 隔离细节见 `docs/adr/evidence/ADR-0170.md`。

## 不变量

- `expectedRevision` / `expectedBranchRevision` CAS 由主进程验证；不得删除、放宽、默认省略或由 renderer 伪造「最新」值绕过；**严禁 latest-revision force write**。
- `TeachingTurnCoordinator` / host 仍是 Teaching outcome settlement 的唯一写入路径；queue 不得直接写 Evidence、Outcome、LearningSession 或 teaching plan。
- fork 仍须在消费前重新验证 source branch/source turn，且 `toolsReplayed: false` 不变。
- Agent run、runtime queue、SQLite projection、renderer、remote/sync 副本都不是 teaching authority；process-local lane 也不是跨进程或跨设备锁。

## 后果

- renderer 不再显示 `Conversation branch revision conflict` 或原始 CAS 文案；queue 显示为可解释的「已排队 / 正在继续」，不是伪成功。
- 排队提交者拥有自己的 lifecycle 起始交付：queued submitter 在其 item 真正成为 active 时收到 sender-owned lifecycle start delivery，不借用先前 active sender 的 stream。
- 既有 `cancelAgentChatStream` 保留为兼容旧 stream ID 的行为；`agentChatStream` 保留为 compatibility-only。

## 验证

- lane/状态机 unit：并发 follow-up 只启动一个 active run；canonical/pending key 不可混淆；32 项 hard cap；相同 `clientRequestId` 幂等；精确 cancel 清空该 lane queue；turn 结算后下一项重新读 revision。
- conversation/CAS 集成：stale stream 无模型运行、安全 refresh/重提；两个 caller 完成保存只在前缀证明成立时合并；archive/delete/restore/rename 与 active/queued input 竞争时不 force replay；fork source 变更/删除时安全拒绝或刷新，`toolsReplayed:false` 不变。
- 触及 IPC/gateway：`pnpm run check:teaching-ipc-contract`、`pnpm run check:blocking-ci` 及相关 unit；触及 conversation/evidence/settlement：`pnpm run check:teaching-evidence`；始终 `pnpm typecheck` 与 `git diff --check`。
- 完成证据（2026-08-03 验证结果）：`docs/adr/evidence/ADR-0170.md`

## 非目标

- 不删除、放宽或 force-write 绕过 `expectedRevision` / `expectedBranchRevision` CAS；不自动重放 archive、restore、delete、rename 或未经重新验证的 fork。
- 不让 renderer、Web Remote Control、SQLite、同步副本或 AgentRun 成为 teaching authority；不改变 settlement sole-writer，或把 fork 改为 replay 工具历史。
- 不把 process-local queue/receipt 宣称为跨进程、跨设备、持久化或 crash-safe 队列。
- 不默认远程 telemetry、YOLO / always-approve，或不通过队列旁路 effect lattice、approval、budget、workspace trust、path fence 和 tool contract。
- 不推倒 EventBus/timeline、重写 AgentRun 状态机或拆分 LearningSession ledger 权威。
- 如需持久化 queue、跨进程排他、跨设备同步、crash replay、不同 cap 或「取消后保留队列」语义，必须另开 ADR。
