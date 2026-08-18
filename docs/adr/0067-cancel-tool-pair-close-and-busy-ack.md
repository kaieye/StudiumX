# ADR-0067：Cancel tool-pair close + renderer busy-ack queue

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（主进程 pair-close + gateway façade 生命周期 + renderer 本地 busy 队列/ack banner；product stream 已经 façade.prompt + invoker；autoDrain/steer IPC residual 见 ADR-0058）
- **日期：** 2026-07-21
- **范围：** B-12 / B-02 residual — cancel 时 transcript tool_call 成对闭合；renderer busy 默认入队 + 闭口 copy banner；gateway `AgentSessionFacade` registry attach
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0055](0055-busy-input-queue-and-replay-contracts.md)、[ADR-0058](0058-agent-session-facade.md)、[ADOPTION B-12 / B-02](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/ai/close-open-tool-calls.ts`
  - `src/main/ai/agent-loop.ts`（`canceledResult`）
  - `src/shared/agent-session-busy-ack.ts`
  - `src/renderer/src/app-shell/agent-conversation-runner.ts`
  - `src/main/teaching-ipc-gateway.ts`（facade attach/detach）
  - `tests/unit/close-open-tool-calls.unit.test.ts`
  - `tests/unit/agent-conversation-runner.unit.test.ts`（busy queue/ack/cancel clear）

## 背景

ADR-0055/0058 落地了 main 侧队列策略与 `AgentSessionFacade`，但：

1. Renderer 在 `agentChatBusy` 时 **静默 early-return**，用户消息被丢弃，没有 busy-ack。
2. Cancel 时若 transcript 上仍有未配对 `tool_calls`，后续 provider 回放/续写可能形状不合法。
3. Gateway 尚未把 live stream 挂到 façade registry（cancel 钩子有、stream 生命周期 attach 不全）。

## 决策

### 1. Cancel tool-pair close（main）

- 纯函数 `closeOpenToolCalls(messages)`：仅对 assistant 已声明、且尚无 `tool` 结果的 `tool_call_id` 追加合成 `tool` 消息。
- 内容稳定：`JSON.stringify({ error: 'tool_canceled', message: TOOL_CANCELED_MESSAGE })`（`工具调用已取消。`）。
- `runAgentLoop` 的 `canceledResult` 在返回前闭合 transcript 并 emit `tool_result` 事件。
- **不** 发明 assistant tool_calls；部分工具已有结果时只补剩余 open ids。

### 2. Busy-ack + 本地 follow-up 队列（renderer）

- 共享闭口文案：`AGENT_SESSION_BUSY_QUEUED_ACK`（`src/shared/agent-session-busy-ack.ts`）；main façade re-export，renderer **不得** import main。
- Hard cap：`AGENT_BUSY_FOLLOW_UP_QUEUE_HARD_CAP = 16`（对齐 main `AgentInputQueue` 默认）。
- `AgentConversationTurnRunner.run`：busy 时入本地 FIFO、设 `agentBusyAckMessage`、清空 composer；空闲后 FIFO drain（串行 `executeTurn`）。
- Cancel：清空队列 + ack（对齐 main `clearOnCancel`）。
- UI：OverviewChat statusbar 与 PetAssistantDialog 最小 banner（**不是** ask interruption dock）。
- 默认策略仍是 **queue**，不是 interrupt / YOLO。

### 3. Gateway façade attach（product invoker 见 ADR-0058 residual）

- `agentChatStream`：创建 `AgentSessionFacade`（共享 AbortController）、`attach(streamId)`；`finally` / `streamCleanup` detach。
- **Product invoker 已接线（ADR-0058 residual）：** 首条消息经 `facade.prompt`；注入 `run` 调用 `service.agentChatStream`（非第二 loop）。`autoDrain` 仍 false；mid-run steer/follow-up IPC residual。
- Cancel 仍 `abortAndDetach` + `agentInputQueues.clearOnCancel`。

## 验证入口

```powershell
pnpm exec vitest run --project unit `
  tests/unit/agent-session-facade.unit.test.ts `
  tests/unit/close-open-tool-calls.unit.test.ts `
  tests/unit/agent-conversation-runner.unit.test.ts
```

## 不变量

- busy 默认 queue（非 interrupt-as-default）
- 无 YOLO / shell marketplace / remote telemetry
- 不改 settlement sole-writer / `expectedRevision` / `toolsReplayed:false`
- Renderer 不 import main 模块

## Residual（诚实）

- **Product stream 经 façade.prompt + real invoker**（ADR-0058 residual 已接线）；`autoDrain` 仍关；mid-run steer/followUp IPC 与 main/renderer 队列同步仍 residual。
- Renderer 队列与 main `AgentInputQueue` **未跨进程同步**（本地 FIFO 即可用；IPC enqueue 未引入）。
- 教学模式 `generating`（非 agentChat）仍可硬拦发送（与 agent busy-queue 正交）。

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-12：cancel pair-close + renderer busy-ack/queue + shared constant → **本切片完成**（ADR-0067）
- B-02 residual product invoker → **基本完成**（gateway `facade.prompt` + real invoker；autoDrain/steer IPC residual；见 ADR-0058）
