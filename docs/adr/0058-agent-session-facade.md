# ADR-0058：AgentSessionFacade 有状态门面与 B-01 drain 接线

- **决策状态：** accepted
- **实施状态：** partial
- **日期：** 2026-07-21
- **范围：** run 作用域 `AgentSessionFacade`（prompt / steer / followUp / abort / snapshot / drain）、与 B-01 队列/策略的完整 drain 语义、gateway 可选 registry 钩子、**product stream invoker 适配**；`autoDrain` 仍关闭
- **取代：** 无
- **被取代：** 无
- **相关：** [ADOPTION B-02](0121-improvements-adoption-closeout.md)、[ADR-0055](0055-busy-input-queue-and-replay-contracts.md)（B-01 模块）、[ADR-0040](0040-teaching-session-protocol-facade.md)（TeachingSessionProtocol，**不**被本 ADR 替换）、[ADR-0047](0047-agent-runtime-wire-and-turn-orchestrator.md)、[ADR-0067](0067-cancel-tool-pair-close-and-busy-ack.md)、[ADR-0082](0082-agent-chat-steer-followup-ipc.md)
- **证据：** `src/main/ai/agent-session-facade.ts`、`src/main/ai/product-agent-chat-invoker.ts`、`src/main/teaching-ipc-gateway.ts`（product invoker + `facade.prompt`）、`tests/unit/agent-session-facade.unit.test.ts`、`tests/unit/product-agent-chat-invoker.unit.test.ts`；ADOPTION 措辞快照见 `docs/adr/evidence/ADR-0058.md`。

## 背景

ADR-0055 落地了 `AgentInputQueue` / `agent-busy-input-policy` 与 cancel `clearOnCancel`，但缺少把「busy 下默认入队 → 安全边界 FIFO drain → abort 清空」收口到单一有状态门面的模块。ADOPTION **B-02** 冻结文件名为 `agent-session-facade.ts`（禁止 `agent-facade` / 对外 `CoreFacade`）。

TeachingSessionProtocol（ADR-0040）仍是更高层教学会话契约（create/send/cancel/…）。`AgentSessionFacade` 是 **run 作用域** 的 busy/input 面，完成 B-01 drain 接线，而不是第二套会话协议。

早期切片仅 attach registry + cancel abort；product turn 仍 bare `service.agentChatStream`，invoker no-op。本 residual 将 **首次 user 消息** 改走 `facade.prompt`，并由注入 invoker 调用既有 `service.agentChatStream`（**不**第二 loop、不改 settlement）。

## 决定

### 1. 冻结模块与 API

`src/main/ai/agent-session-facade.ts`：

| 方法 | 语义 |
| --- | --- |
| `prompt` | 空闲 accept + 注入 `run`；busy 默认 queue |
| `followUp` | 同策略路径，kind=`follow_up` |
| `steer` | **≠ abort**；仅 `turn_boundary` 可 inject；`write_tool` / `privileged_tool` demote → queue |
| `abort` | abort 当前 `AbortController` + `queue.clearOnCancel` + `reopen` |
| `snapshot` | `busy` / `phase` / `queueDepth` / `queueCapacity` / 可选 id |
| `drain` | 安全边界 FIFO；`canInjectQueuedInput` 门禁；unsafe head 停 drain 保序 |
| `createChildFacade` | **默认新队列**，子 run 不共享父 steering 队列 |
| `AgentSessionFacadeRegistry` | streamId → façade；cancel `abortAndDetach` |

内部仍调用注入的 `AgentSessionRunInvoker`。**不**在 façade 内重写 loop、settlement 或 Electron IPC。

### 2. 默认策略与 B-01 不变量

- busy 默认：`queue`（`resolveBusyInputAction`）
- steer ≠ abort（`abortsRun` 仅 interrupt）
- hard cap 继承 `AgentInputQueue`（默认 16）
- cancel：registry `clearOnCancel` **与** façade `abortAndDetach` 双钩子（gateway）

### 3. Gateway product invoker（本 residual）

`TeachingIpcGateway.agentChatStream`：

1. 创建共享 `AbortController`；`createAbortController: () => controller` 保证 cancel 与 service stream 同一 signal。
2. 注入真实 `run` invoker：
   - `mapProductAgentChatInvokerPayload`：`text` → `userInput`，可选覆盖 `streamId` / `conversationId` / `expectedBranchRevision`，**保留** messages / workspace / skills / compaction 等原 IPC 字段。
   - 调用 `service.agentChatStream(mappedPayload, { streamId, signal: invokerInput.signal, onChunk/onStatus/onTool/... })`（闭包 IPC 回调）。
   - `mapAgentChatStreamResultToRunResult` 供 façade `AgentSessionRunResult`；完整 product result 由 gateway 闭包变量回传 invoke reply。
3. **首条**用户消息：`await facade.prompt({ text: payload.userInput, conversationId, expectedRevision: expectedBranchRevision })`（idle → accept；`prompt` 自管 `provider` phase，**不**预 `setPhase('provider')`，以免 busy-queue）。
4. `autoDrain: false`（产品安全默认）：多 turn drain 需要 mid-run steer/follow-up IPC 与 renderer transcript 同步；开启 autoDrain 会在无新 messages 的情况下复用原 payload 再跑 turn，破坏教学真相源形状。
5. cancel：`abortAndDetach` + `agentInputQueues.clearOnCancel`（不变）。
6. **不**新增 renderer IPC 大改；steer/followUp 产品面 residual（见下）。

纯映射模块：`src/main/ai/product-agent-chat-invoker.ts`（无 Electron import）。**不**新开 ADR-0068：仍属 B-02 / ADR-0058 同一决策面。

### 4. 与 TeachingSessionProtocol 的边界

| 层 | 职责 |
| --- | --- |
| TeachingSessionProtocol / Runtime | 会话级 create/send/cancel/compact/fork/… |
| AgentSessionFacade | 单 live run 的 busy 输入、队列、drain、abort |
| product invoker adapter | gateway 将 façade run 字段映射到 `AgentChatStreamPayload` |
| runAgentLoop / teaching-conversation-runtime | 工具循环与预算（不变） |

禁止用 façade 替换 protocol 或绕过 settlement sole-writer。

## 不变量

- 无 Electron IPC import 进入 façade / pure mapper 模块
- 无 YOLO / always-approve / shell / MCP marketplace
- 不改 `toolsReplayed`、settlement sole-writer、`expectedRevision` CAS
- 子 façade 默认隔离队列
- 不重写 `runAgentLoop` / `teaching-conversation-runtime` / settlement

## 验证

```powershell
pnpm exec vitest run --project unit `
  tests/unit/agent-session-facade.unit.test.ts `
  tests/unit/product-agent-chat-invoker.unit.test.ts `
  tests/unit/agent-input-queue.unit.test.ts `
  tests/unit/agent-busy-input-policy.unit.test.ts `
  tests/unit/agent-conversation-runner.unit.test.ts `
  tests/unit/close-open-tool-calls.unit.test.ts
```

## 非目标 / residual

- **已落地：** 主进程 façade + drain + 单测 + gateway product invoker 经 `facade.prompt` 驱动 live `agentChatStream`（ADR-0055 B-01 residual 收口）。
- **autoDrain 未开**：产品多 turn 需 mid-run steer/follow-up IPC + renderer 同步后再评估开启。
- **mid-run steer/follow-up IPC 已落地（ADR-0082）**；product `autoDrain` 仍关；renderer 仍本地 FIFO + busy-ack（ADR-0067），main↔renderer 队列同步 residual。
- 不接线 A-05 provider retry、B-03 并行 tool batch（若仍开放见 ADOPTION）。
