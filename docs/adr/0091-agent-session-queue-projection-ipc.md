# ADR-0091：Agent session 队列只读投影 product IPC

- **状态：** 已实施（shared DTO + fail-closed parser + pure IPC mapper + gateway register + preload whitelist + unit tests；**无** product autoDrain flip；**无** renderer FIFO 改写）
- **日期：** 2026-07-21
- **范围：** B-02 residual — 暴露 **一条** 只读 product invoke channel，将 active `AgentSessionFacade` 队列经 ADR-0089 `projectQueue()` 投影给 renderer；不 drain、不 steer、不 abort、不翻转 autoDrain
- **相关：** [ADR-0058](0058-agent-session-facade.md)、[ADR-0082](0082-agent-chat-steer-followup-ipc.md)、[ADR-0089](0089-agent-session-queue-projection.md)、[ADOPTION B-02](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/shared/teaching-types/agent-session-queue.ts`（shared DTO + payload/result）
  - `src/shared/teaching-types/system-api.ts` / `src/shared/teaching-ipc-contract.ts`
  - `src/main/teaching-ipc-commands.ts`（`parseProjectAgentSessionQueuePayload`）
  - `src/main/ai/agent-session-queue-ipc.ts`（`runProjectAgentSessionQueueIpc`）
  - `src/main/teaching-ipc-gateway.ts`（registry lookup + read-only action）
  - `src/preload/index.ts`（channel whitelist）
  - `tests/unit/agent-session-queue-ipc.unit.test.ts`
  - 本 ADR

## 背景

ADR-0089 落地了 pure main-side 队列投影与 `facade.projectQueue()`，但 **IPC residual 仍开放**。Renderer 若要同步 main 队列镜像，需要一条 fail-closed、隐私默认安全、且绝不触发 drain 的 product channel。B-02 产品地板要求 **product `autoDrain` 继续为 false**（gateway attach 已强制，见 ADR-0082）。

## 决策

### 1. Invoke channel（闭集）

| TeachingSystemApi | Channel | 行为 |
| --- | --- | --- |
| `projectAgentSessionQueue` | `teach:project-agent-session-queue` | `agentSessionFacades.get(streamId)` → `runProjectAgentSessionQueueIpc` → `facade.projectQueue(...)` |

### 2. Payload（fail-closed exact keys）

```ts
{
  streamId: string              // required, non-empty trimmed stream id
  includeTextPreview?: boolean  // optional; default omit free-text
  textPreviewMax?: number       // optional; only with preview; safe integer ≥ 0
}
```

- 拒绝未知顶层键。
- 拒绝 empty/whitespace / 非法 streamId（复用 `requireStreamId`）。
- 拒绝非 boolean `includeTextPreview`、非 safe-integer 或负的 `textPreviewMax`。

### 3. Result

```ts
| { ok: true; projection: AgentSessionQueueProjection }
| { ok: false; reason: 'no_active_session' | string }
```

- 缺失 façade → `{ ok: false, reason: 'no_active_session' }`（与 ADR-0082 精神一致）。
- 投影 DTO 与 ADR-0089 字段对齐；shared 层定义镜像类型，避免 renderer import main。

### 4. Gateway 行为

1. 只注册本 channel；**不**改 `agentChatStream` 的 `autoDrain: false`。
2. action 仅 lookup + pure mapper；**永不**调用 drain / prompt / steer / followUp / abort。
3. 注释明确：product autoDrain remains false；channel 为 read-only projection。

### 5. 隐私

默认 **不** 投影 free-text / `textPreview`；仅 `includeTextPreview: true` 时可选 hard-cap 预览（ADR-0089 默认 200 code units）。

### 6. Preload

仅 whitelist 本 channel；**不**建 queue UI 面板；**不**改 renderer `agent-conversation-runner` 本地 FIFO。

## 不变量（产品地板）

- **Product autoDrain 仍 false**（gateway attach 与本 channel 均不翻转）。
- 本 channel ≠ drain / steer / abort；无 YOLO / always-approve。
- 无 shell / MCP marketplace / 默认远程 telemetry。
- 不触碰 settlement sole-writer / `expectedRevision` 语义 / `toolsReplayed`。

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/agent-session-queue-ipc.unit.test.ts `
  tests/unit/agent-session-queue-projection.unit.test.ts
```

## 不包含 / residual

- **不** 将 product `autoDrain` 设为 true（需独立 queue-sync 设计 + ADR）。
- **不** 改 renderer 本地 FIFO / busy-ack 文案。
- **不** 强制 UI 消费本投影（renderer consumer 可选 residual）。
- **不** 改 busy policy / steer 语义 / interrupt 默认。
- **不** 改 ADOPTION.md 优先级表（主代理维护）。

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-02 residual：read-only queue projection IPC **已落地（ADR-0091）**，消费 ADR-0089 pure `projectQueue`；**product autoDrain 仍 false**；renderer consumer UI / product autoDrain enable 仍 residual（需 deliberate queue-sync design）。
