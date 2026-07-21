# ADR-0082：Agent chat mid-run steer / follow-up IPC

- **状态：** 已实施（main-side invoke channels + fail-closed parsers + gateway façade delegation；product `autoDrain` 仍为 false；renderer 本地 FIFO 未改）
- **日期：** 2026-07-21
- **范围：** B-02 residual — 对 **active** `streamId` 暴露 `steer` / `followUp` IPC，委托已 attach 的 `AgentSessionFacade`；不开启 product autoDrain；不做 main↔renderer 队列镜像
- **相关：** [ADR-0058](0058-agent-session-facade.md)、[ADR-0067](0067-cancel-tool-pair-close-and-busy-ack.md)、[ADR-0055](0055-busy-input-queue-and-replay-contracts.md)、[ADOPTION B-02](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/shared/teaching-ipc-contract.ts`（`steerAgentChatStream` / `followUpAgentChatStream`）
  - `src/shared/teaching-types/agent.ts` / `system-api.ts`（payload + result）
  - `src/main/teaching-ipc-commands.ts`（`parseSteerAgentChatPayload` / `parseFollowUpAgentChatPayload`）
  - `src/main/ai/agent-chat-steer-followup-ipc.ts`（pure result mapper）
  - `src/main/teaching-ipc-gateway.ts`（registry lookup + `facade.steer` / `facade.followUp`）
  - `src/preload/index.ts`（channel whitelist）
  - `tests/unit/agent-chat-steer-followup-ipc.unit.test.ts`

## 背景

ADR-0058 将 product `agentChatStream` 收口到 `AgentSessionFacade.prompt`，并 attach registry，但 **mid-run** 输入只能走 renderer 本地 FIFO（ADR-0067），main façade 的 `steer` / `followUp` 没有 IPC 面。ADOPTION B-02 residual 要求暴露 main-side 命令，同时 **保持 product `autoDrain: false`**。

## 决策

### 1. Invoke channels（闭集）

| TeachingSystemApi | Channel |
| --- | --- |
| `steerAgentChatStream` | `teach:agent-chat-steer` |
| `followUpAgentChatStream` | `teach:agent-chat-follow-up` |

Payload 精确形状：`{ streamId, text, conversationId?, expectedRevision? }`。解析 fail-closed：拒绝未知键、非法 streamId、非 canonical conversationId、负 revision、超长 text。

### 2. Gateway 行为

1. `context.agentSessionFacades.get(streamId)`；缺失 → `{ ok: false, disposition: 'no_active_session', reason: 'no_active_session' }`。
2. 调用 `facade.steer(...)` 或 `facade.followUp(...)`（busy policy 在 façade 内；**steer ≠ abort**）。
3. 返回 disposition 快照：`mapAgentSessionPromptResultToIpc(result, facade.snapshot())`。
4. **不** 启动第二 `agentChatStream` loop；**不** 将 `autoDrain` 设为 true。
5. Cancel 仍 `abortAndDetach`（本切片不改）。

### 3. Product autoDrain

`agentChatStream` 创建 façade 时继续 `autoDrain: false`（显式注释保留）。开启 autoDrain 仍依赖 renderer transcript 同步，属 residual。

### 4. Preload

仅 whitelist 两 channel；**不** 建 UI queue 面板，**不** 重写 renderer busy FIFO。

## 不变量

- steer ≠ abort；默认 busy 策略仍为 queue（无 YOLO / interrupt-default）
- 无 shell / MCP marketplace / always-approve
- 不触碰 settlement / TeachingTurnCoordinator / `toolsReplayed`
- 无默认远程 telemetry

## 不包含 / residual

- Renderer 仍本地 FIFO busy-ack（ADR-0067）；**main↔renderer queue 同步仍开放**
- Product autoDrain 仍 false
- 不默认 interrupt；不暴露 preferredAction 覆盖 interrupt 的产品路径

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/agent-chat-steer-followup-ipc.unit.test.ts `
  tests/unit/agent-session-facade.unit.test.ts
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-02 residual：mid-run steer/follow-up IPC **已落地（ADR-0082）**；product autoDrain 仍 false；renderer 本地 FIFO / main↔renderer queue sync 仍 residual。
