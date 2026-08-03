# ADR-0170：Agent conversation 主进程串行化与无感并发恢复

- **状态：** 已实施（实现完成；验证结果见第 9 节）
- **日期：** 2026-08-03
- **范围：** 已将 desktop renderer 的同分支输入从“冲突后刷新/有限重试”前移为向 main/host per-conversation lane 提交窄 intent；host 持有 active-turn 与 follow-up 队列，同时保持 `expectedRevision` compare-and-swap（CAS）和 settlement sole-writer。
- **相关：** [ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0040](0040-teaching-session-protocol-facade.md)、[ADR-0055](0055-busy-input-queue-and-replay-contracts.md)、[ADR-0058](0058-agent-session-facade.md)、[ADR-0067](0067-cancel-tool-pair-close-and-busy-ack.md)、[ADR-0082](0082-agent-chat-steer-followup-ipc.md)、[ADR-0089](0089-agent-session-queue-projection.md)、[ADR-0091](0091-agent-session-queue-projection-ipc.md)、[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)。

> **实施状态边界：**本 ADR 的 desktop Agent Conversation 接线已完成：renderer ingress 只提交窄 intent 至 main/host per-conversation lane，host 是唯一会自动 FIFO drain 并启动下一 turn 的 consumer。§4.2 的精确 cancel intent 已经 public IPC、严格 parser、preload、host gateway 与 renderer 接线；它要求精确 active identity，并保持跨 lane 隔离。canonical read/CAS 与完整 transcript 旧前缀证明仍 fail-closed；现有 legacy direct `agentChatStream` 仅保留兼容用途，若会与已迁移 canonical lane 的 active turn 竞争则被拒绝，legacy steer/follow-up 也不得进入 host-lane stream。Web Remote Control 目前未接入 chat，隔离证据与未来接入约束见第 9 节。

## 1. 背景与问题

用户可能在多窗口、远程控制面、恢复后的旧 renderer 状态，或同一分支的相邻异步操作竞争时遇到：

```text
Conversation branch revision conflict: expected <n>, current <m>
```

该错误来自 agent conversation branch 的乐观并发控制：继续已有分支或保存已有分支时，调用方必须携带 `expectedBranchRevision`；主进程只在其等于 canonical branch revision 时接受写入。这一约束用于阻止旧 transcript、旧 archive/delete/restore 意图，或旧上下文生成的模型结果覆盖较新的 canonical conversation。

当前 renderer 的恢复策略仍有价值，并应在 host lane 尚未接管的入口继续保留：模型运行前的 stale revision 可静默刷新并安全重试一次；完成保存仅在 canonical transcript 与本地旧前缀逐项一致时才可合并本轮新增 turn；fork 须刷新并验证 source turn；archive、restore、delete、rename 等状态转换只刷新而不自动重放。它们不能替代 host 侧的同 lane 串行化。

## 2. 调研结论与不变边界

Pi 的 append-only JSONL tree 将消息以 parent identity 挂接为树上的新节点，不能被解读为允许旧 payload 覆盖最新 conversation。Codex 可迁移的是 host-owned session serialization：单一 active turn、受控 steer、session-scoped mailbox、identity precondition，以及由 host 记录 history；不是读取最新 revision 后强写旧操作。

因此，本 ADR 保持以下硬边界：

- `expectedRevision` / `expectedBranchRevision` CAS 继续由主进程验证；不得删除、放宽、默认省略或由 renderer 伪造“最新”值绕过。
- 严禁 latest-revision force write：不得把过期请求改写为刚读到的 revision 后，未经意图、前缀和 turn identity 验证直接保存。
- `TeachingTurnCoordinator` / host 仍是 Teaching outcome settlement 的唯一写入路径；queue 不得直接写 Evidence、Outcome、LearningSession 或 teaching plan。
- fork 仍须在消费前重新验证 source branch/source turn，且 `toolsReplayed: false` 不变。
- Agent run、runtime queue、SQLite projection、renderer、remote/sync 副本都不是 teaching authority；process-local lane 也不是跨进程或跨设备锁。

## 3. 已冻结的 lane 身份与所有权

### 3.1 Lane key 是判别联合，不能混淆 canonical 与 pending identity

每个 main/host lane 的稳定 key 必须是下列两种**之一**：

```ts
type ConversationLaneKey =
  | {
      kind: 'canonical'
      workspaceId: string
      scope: 'workspace' | 'temporary'
      conversationId: string
    }
  | {
      kind: 'pending'
      workspaceId: string
      scope: 'workspace' | 'temporary'
      pendingConversationId: string
    }
```

其规范化 tuple 分别为：

```text
canonical: (workspaceId, scope, "conversation", conversationId)
pending:   (workspaceId, scope, "pending", pendingConversationId)
```

`workspaceId`、`scope` 与 identity 都是 key 的组成部分。不得只按 `conversationId` 串行化；不得把 `mode`、标题、文本、branch revision 或可选空字符串当作 identity；不得用同一个未标记字段在 `conversationId` 与 `pendingConversationId` 间猜测含义。

一个 lane 同时至多有一个 active agent turn。所有 renderer、Web Remote Control 和未来入口都必须通过同一个 main/host protocol 投递 intent；这是单一进程内的约束，canonical CAS 仍负责进程外、同步及重启后的冲突。

### 3.2 Pending/new conversation 的规则

新 conversation 在首个 canonical record 持久化之前只能使用 `kind: 'pending'` key。`pendingConversationId` 是 host 认可的、不可复用的 opaque identity；它必须在创建 pending conversation / draft 时获得，并在该 workspace 与 scope 内唯一。一个 pending identity 绝不能因为标题、文本、当前活动会话或相同 `clientRequestId` 而与另一个 pending conversation 合并。

首个 canonical conversation 成功建立时，host 必须在同一 lane 临界区内把该 lane **原子地 rekey** 为对应的 canonical key：

1. 已在该 pending lane 中排队的 intents 跟随同一个 lane object，不重新排序也不转移到别的 pending lane；
2. host 记录仅供本 lane 生命周期内解析的 pending→canonical 映射；它不是持久化 alias，也不是 crash recovery 机制；
3. rekey 后不再接受新的 pending-key submission；caller 必须刷新并使用返回/投影中的 canonical `conversationId`；
4. 不得将不同 pending lane 的队列仅因最后得到同一 conversation 或相同内容而合并。

若建立 canonical conversation 失败或被取消，pending lane 按既有 run/settlement 语义结算；不能猜测或自动改投到某个 canonical conversation。

## 4. 已冻结的 IPC intent 与 disposition 合同

以下是实施时必须保持的**语义字段和稳定 code**。可按既有 `TeachingSystemApi`、IPC parser 和 Remote Control contract 调整 TypeScript 名称或传输包装，但不得删除、合并或改变其含义。

### 4.1 Submit intent

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

字段规则：

- `target` 完整携带 `workspaceId`、`scope` 和**恰好一种** conversation identity。canonical target 不得缺少 `conversationId`；pending target 不得携带 `conversationId`。
- `clientRequestId` 是调用方生成的 opaque idempotency key，不得包含正文、secret 或工具结果。
- `text` 是本次用户输入，不是完整可替换 transcript。
- `mode` 必须与 `target.scope` 的产品语义一致；host 验证它，不能以 mode 重写 lane identity。
- `delivery: 'follow_up'` 是常规新输入：lane idle 时可启动，lane active 时 FIFO 入队。`delivery: 'steer'` 只能尝试注入当前 active turn，且必须提供 `expectedActiveTurnId`。
- `expectedBranchRevision` 是 caller 观察到的前置条件，不是 host 跳过 canonical read 或 force write 的许可。queued item 成为 active 前，host 必须重新读取 canonical branch 及 revision。
- `expectedActiveTurnId` 是 host mint 的精确 active identity；不匹配、lane idle 或当前 turn 不可 steer 时，不得改投到另一 turn，也不得静默转换为 follow-up。

稳定 submit disposition code：

```ts
type SubmitConversationTurnDisposition =
  | { code: 'started'; activeTurnId: string; streamId: string; conversationId?: string }
  | { code: 'queued'; queuePosition: number; activeTurnId: string }
  | { code: 'steered'; activeTurnId: string; streamId: string }
  | { code: 'duplicate'; originalCode: 'started' | 'queued' | 'steered' | 'refresh_required' | 'rejected' }
  | { code: 'refresh_required'; reason: 'stale_branch' | 'active_turn_mismatch' | 'pending_promoted' }
  | { code: 'rejected'; reason: 'invalid_intent' | 'queue_full' | 'branch_unavailable' }
```

`refresh_required` 是可恢复的非执行结果，renderer 应刷新 canonical projection 并保留输入或按产品流程重新提交；不得显示原始 revision-conflict 文案。`rejected` 不是伪成功，必须有可解释的本地文案和脱敏诊断 code。对于 `delivery: 'steer'` 的 active identity 不匹配，返回 `refresh_required/active_turn_mismatch`，不入队。

### 4.2 Cancel intent

取消必须使用精确 active identity，而不是“取消当前 conversation”：

```ts
type CancelConversationTurnIntent = {
  target: ConversationLaneKey
  clientRequestId: string
  expectedActiveTurnId: string
}

type CancelConversationTurnDisposition =
  | { code: 'cancelled'; cancelledActiveTurnId: string; clearedQueuedCount: number }
  | { code: 'duplicate'; originalCode: 'cancelled' | 'refresh_required' | 'rejected' }
  | { code: 'refresh_required'; reason: 'active_turn_mismatch' | 'pending_promoted' }
  | { code: 'rejected'; reason: 'invalid_intent' | 'lane_unavailable' }
```

只有 `target` 与 `expectedActiveTurnId` 都精确匹配该 lane 的 active reservation 时，host 才执行取消。匹配后，host 按现有 `abortAndDetach` / run settlement 语义取消该 active run，并在同一个 lane 临界区中清除该 lane 的**全部** queued follow-ups；返回实际 `clearedQueuedCount`。不得用旧 cancel 去取消后来开始的 turn，不得保留该 lane 的旧队列，也不得清理其他 lane。取消之后新到达的独立 follow-up 依其线性化顺序正常处理，不属于被清除的旧队列。

### 4.3 Queue hard cap 与 request-id receipt

每个 lane 的 follow-up queue hard cap 固定为 **32** 个 queued intents，**不含**一个 active turn。32 既限制进程内内存和长时间排队造成的过期语义，又足以覆盖正常的连续输入 burst；该值不是软提示，不允许配置为无限。第 33 个不同 request 必须得到 `rejected/queue_full`，不静默丢弃、不挤掉旧项。

host 为每个 lane 维护 `clientRequestId` receipt：同一 lane 内重复 submission/cancel 不得重复启动、入队、steer、保存或取消，而返回 `duplicate` 及原始类别。receipt retention 仅为**process-local lane lifetime**：lane 从首次路由到 registry，并至少保留至 active 与 queue 清空；空闲 lane 可由有界 housekeeping 逐出，逐出时其 receipt 一并释放。receipt 不写入 canonical conversation、不进入 SQLite/sync，也不承诺固定 TTL、跨窗口全局永久幂等、进程崩溃恢复或 restart 后自动重放。进程重启后没有 receipt 的请求仍必须经过 canonical read、CAS 和既有 run-stage 恢复判定。

public DTO、日志、Doctor 与 support bundle 不得泄露对话正文、secret 或工具敏感结果。

## 5. Host 行为、状态机与 settlement

lane 的最小逻辑状态为：

```text
idle
  → reserving
  → active(activeTurnId, streamId, runId, canonicalRevisionAtStart)
  → settling
  → draining-next
  → idle
```

另有最多 32 项的 FIFO `queued[]` 与 receipt 集合。实现必须满足：

1. reservation、active identity 校验、enqueue/dequeue、cancel queue cleanup 和 rekey 在 lane 临界区内线性化；任何 `await` 后都不能假定 reservation 仍属于当前调用。
2. lane idle 的 follow-up 从 canonical branch 读取当前状态与 revision 后才启动。每个 queued item 在成为 active 前重新读取，绝不复用上一 turn 的 revision。
3. active turn 的新 follow-up 不启动第二条竞争 stream。它按 FIFO queued；只有明确 `steer` 且精确 active identity 匹配时走受控注入路径。
4. 当前 turn 正常完成、取消、模型错误、工具拒绝或 save failure 后，均须按现有 AgentRun / facade / transcript / settlement 语义结算和释放 lane；lane 不得吞错、伪装成功或永久卡死。
5. conversation final save 仍走 canonical CAS；host 使用自己读取/推进的 revision，不信任 renderer 声称的“最新” revision。parent-turn stage、assistant confirmation、staged child transcript promotion、audit 和 `TeachingTurnCoordinator` sole-writer 均不得被 lane 旁路。
6. archive、restore、delete、rename 只刷新 canonical projection，必要时重新确认；保存完整 transcript 仅在前缀证明成立时合并本轮新增 turn；fork 在消费前重新验证。它们都不能通过 latest-revision force write 自动重放。

## 6. 迁移顺序与 authoritative queue consumer

迁移必须分阶段进行，且每个阶段只有一个会**自动 drain 并启动下一 run** 的 authoritative queue consumer：

1. **Lane state machine。**先实现并测试纯 main-only lane 状态机；不改变 public IPC 或 renderer。此阶段 renderer 现有 local FIFO 仍是运行时唯一 consumer，host lane 不接真实 start。
2. **Host 接管 conversation start。**让 main conversation intent gateway 通过 lane 启动 agent-chat。自此 host lane 是该接入入口的唯一 authoritative consumer。renderer local FIFO 如需暂留，只能作为输入暂存/展示 mirror：它只转发新 intent 或展示 host snapshot，**不得**在 completion/cancel 后自行 drain 并再调用 start。
3. **统一 follow-up、steer 与 cancel。**把这些 IPC 接入同一 lane 与精确 active identity；删除或禁用会与 host 竞争的 renderer auto-drain 路径。此时 host queue 是已接入入口的唯一 queue authority。
4. **增加只读 queue snapshot/events。**renderer 逐步成为纯展示与输入提交端；queue position、active identity 和 disposition 来自 host，不能由 renderer 合成权威状态。
5. **接入 Web Remote Control 及其他入口。**它们复用同一 gateway/lane，绝不另建可执行队列。
6. **清理冗余 retry/queue 分支。**仅在等价行为、cancel、恢复、持久化、UX 和领域门禁都有覆盖后进行；不得借机重写 AgentRun 状态机、EventBus/timeline 或 LearningSession ledger。

实现 PR 必须说明当前处于哪一阶段、哪些入口已由 host lane 覆盖、以及是否还有 renderer local FIFO。若任一阶段同时存在两个自动 drain consumer，视为违反本 ADR，而不是可接受的过渡状态。

## 7. 明确不包含 / 禁止事项

本 ADR 不授权：

- 删除、放宽或 force-write 绕过 `expectedRevision` / `expectedBranchRevision` CAS；
- 自动重放 archive、restore、delete、rename 或未经重新验证的 fork；
- 让 renderer、Web Remote Control、SQLite、同步副本或 AgentRun 成为 teaching authority；
- 改变 settlement sole-writer，或将 fork 改为 replay 工具历史（`toolsReplayed` 必须仍为 `false`）；
- 将 process-local queue/receipt 宣称为跨进程、跨设备、持久化或 crash-safe 队列；
- 默认远程 telemetry、YOLO / always-approve，或通过队列旁路 effect lattice、approval、budget、workspace trust、path fence 和 tool contract；
- 为此工作推倒 EventBus/timeline、重写 AgentRun 状态机或拆分 LearningSession ledger 权威。

如需持久化 queue、跨进程排他、跨设备同步、crash replay、不同 cap，或“取消后保留队列”语义，必须另开 ADR，不得通过实现细节暗中扩展本设计。

## 8. 实施验收与测试矩阵

最低测试集应覆盖：

### Lane / 状态机单元测试

- 同 lane 并发两条 follow-up：只启动一个 active run，另一条 FIFO queued；不同 workspace、scope、canonical identity 或 pending identity 的 lane 不互相阻塞。
- canonical/pending key 不可混淆；pending rekey 保序，且不接受新的 pending-key submission。
- 32 项 hard cap：第 33 项稳定返回 `rejected/queue_full`，没有静默丢弃或挤掉旧项。
- 相同 `clientRequestId` 的重复 submit/cancel 不执行第二次；lane eviction 或 process restart 不被误宣称为幂等恢复。
- active identity 不匹配时不 steer、不取消后来的 turn；精确 cancel 会取消对应 run 并清空该 lane queue。
- turn 结算后下一项重新读 canonical revision；模型、工具或 save failure 后 lane lock 释放。

### Conversation / CAS 集成测试

- stale stream start 无模型运行，安全 refresh/重提；两个 caller 完成保存只在前缀证明成立时合并，否则不覆盖。
- archive/delete/restore/rename 与 active/queued input 竞争时不 force replay；等待中的 fork source 变更/删除时安全拒绝或刷新，`toolsReplayed:false` 不变。
- parent-turn stage、final answer confirmation、staged child transcript promotion、audit 和 run settlement 顺序保持现有不变量。

### 产品与边界检查

- renderer 不显示 `Conversation branch revision conflict` 或原始 CAS 文案；queue 显示为可解释的“已排队 / 正在继续”，不是伪成功。
- 触及 IPC/gateway 时运行 `pnpm run check:teaching-ipc-contract`、`pnpm run check:blocking-ci` 及相关 unit；触及 conversation/evidence/settlement 时运行 `pnpm run check:teaching-evidence`；触及工具、权限、remote control 或脱敏时运行对应 security / tool-contract 检查；始终运行 `pnpm typecheck` 与 `git diff --check`。

## 9. Adoption 与完成证据

本 ADR 的冻结合同已在 desktop Agent Conversation 入口实施完成；这里的“完成”只覆盖本 ADR 的 host serialization 接线。验证结果按实际命令结果记录：通过的检查不扩大为未运行或未成功执行检查的 green。

### 9.1 已完成的接线与不变量

1. **Desktop renderer ingress 已迁移。**renderer 现在只向 main/host 的 per-conversation lane 提交窄 `SubmitConversationTurnIntent`；不再由 renderer 以完整 transcript 或“最新 revision”主张直接竞争 start/save。
2. **Host 是唯一 FIFO auto-drainer。**同一 lane 至多一个 active turn；host 负责 reservation、完成/失败/取消后的释放及 FIFO 启动下一项。renderer 的队列展示/输入暂存不再是第二个自动 drain consumer。
3. **排队提交者拥有自己的 lifecycle 起始交付。**queued submitter 在其 item 真正成为 active 时，收到该 sender-owned lifecycle start delivery/event stream；不会借用先前 active sender 的 stream，也不会因已排队而伪报已经启动。
4. **canonical 保护保持 fail-closed。**每次启动前仍读取 canonical branch 并验证 CAS；final save 仍要求完整 transcript 的既有前缀逐项证明，不能证明即拒绝合并，绝不 latest-revision force write。`TeachingTurnCoordinator` / host settlement sole-writer、budget、effect lattice / approval、teaching authority 及 fork `toolsReplayed:false` 均未被 lane 旁路。
5. **精确取消与 legacy 隔离。**§4.2 的 `CancelConversationTurnIntent` 已由 public IPC、严格 exact-key parser、preload、host gateway 与 renderer 接线；它要求精确 `target` 与 `expectedActiveTurnId`，只 abort/detach 对应 active reservation，并只清除该 lane 的 queued follow-ups，绝不影响其他 lane。控制面接受取消后仍由 active-run finalization 作为 release/promote 的唯一路径。既有 `cancelAgentChatStream` 保留为兼容旧 stream ID 的行为；既有直接 `agentChatStream` 保留为 compatibility-only，若会与已迁移 canonical lane 的 active turn 竞争，gateway 必须拒绝它，而不是启动第二条竞争 stream；legacy steer/follow-up 对 host-lane stream ID 同样必须拒绝，不能旁路 lane。

### 9.2 WRC 当前隔离与未来约束

当前 Web Remote Control（WRC）有 authenticated pairing，并且只投影只读的 workspace / conversation-task catalog；这**不**是 WRC chat。现有 HTTP 与 `/ws` 均不接受 Agent Conversation text，也不调用 agent-chat、follow-up、steer、save 或 tool approval。因此 WRC 未拥有 Agent Conversation 的可执行队列、不会与本 ADR lane 竞争，也不应被表述为已经支持远程聊天。

未来任何 remote chat、bot、RPC 或 tool-approval 入口都必须复用本 ADR 的 shared gateway / per-conversation lane，经过既有 CAS、settlement、effect lattice、approval、budget 与 workspace-trust 边界；禁止建立独立的可执行 queue。

### 9.3 已知验证结果（2026-08-03）

以下是本实现变更已知、实际完成的验证结果：

- `pnpm typecheck`（通过）；
- 8 个 ADR focused unit 文件：**91 passed / 2 skipped**；
- `pnpm run check:teaching-ipc-contract`（通过）；
- `pnpm run check:teaching-ipc-commands`（通过）；
- `pnpm run check:teaching-evidence`（通过）；
- `pnpm run check:tool-contract`（通过）；
- `pnpm run check:security`（通过）；
- `pnpm run check:provider-privacy`（通过）；
- `pnpm run check:blocking-ci`（通过；`.github/workflows/blocking-ci.yml` 已恢复）；
- `git diff --check`（通过）。
