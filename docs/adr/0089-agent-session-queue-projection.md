# ADR-0089：Agent session 队列只读投影（纯 main-side snapshot）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（pure projection helper + unit tests + 可选 façade thin method；**无** IPC；**无** product autoDrain flip）
- **日期：** 2026-07-21
- **范围：** B-02 residual — 提供 main 侧**纯**队列投影 DTO，供未来 renderer 同步消费；**不**开启 product `autoDrain`；**不**改 renderer FIFO；**不**接线 gateway/preload/contract（避免与 S-09 文件所有权冲突）
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0055](0055-busy-input-queue-and-replay-contracts.md)、[ADR-0058](0058-agent-session-facade.md)、[ADR-0082](0082-agent-chat-steer-followup-ipc.md)、[ADOPTION B-02](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/ai/agent-session-queue-projection.ts`
  - `src/main/ai/agent-session-facade.ts`（`projectQueue()` thin wrapper only）
  - `tests/unit/agent-session-queue-projection.unit.test.ts`
  - 本 ADR

## 背景

ADR-0055 / ADR-0058 已落地 bounded FIFO + session façade；ADR-0082 暴露 mid-run steer/follow-up IPC，但 **product `autoDrain` 仍为 false**，main↔renderer 队列镜像仍开放。

UI / 未来 sync 若直接读 `AgentQueuedInput.text` 会把完整用户输入推到投影面。B-02 residual 需要一条**纯、可测、隐私默认安全**的 snapshot 形状，而不是在本轮改 gateway 或翻 autoDrain。

## 决策

### 1. 纯模块：`projectAgentSessionQueue`

```ts
projectAgentSessionQueue(
  snapshot: AgentSessionQueueProjectionSource,
  queueEntries: readonly AgentQueuedInput[],
  options?: {
    autoDrain?: boolean
    includeTextPreview?: boolean
    textPreviewMax?: number
    closed?: boolean
  }
): AgentSessionQueueProjection
```

投影字段：

| 字段 | 含义 |
| --- | --- |
| `streamId?` / `conversationId?` | 身份（来自 façade snapshot） |
| `busy` / `phase` | 粗粒度 busy 相位 |
| `autoDrain` | **报告实际 façade 设置**；本 helper 默认 `false`，从不把产品路径翻成 true |
| `queueDepth` / `queueCapacity` | 深度与硬 cap |
| `closed?` | 可选；cancel clear 后关闭态 |
| `entries[]` | `{ id, kind: follow_up\|steer, enqueuedAt, conversationId?, expectedRevision?, textPreview? }` |

不变量：

- **纯 / 确定性**：不 mutate queue / snapshot。
- **kind 仅** `follow_up` \| `steer`。
- **不** drain、abort、invoke provider、打开 IPC。

### 2. 隐私：默认省略 free-text

| 模式 | 行为 |
| --- | --- |
| 默认 | **不**投影 `text` 或 `textPreview`（完整用户输入不进 DTO） |
| `includeTextPreview: true` | 可选硬 cap 预览（默认 `DEFAULT_QUEUE_TEXT_PREVIEW_MAX = 200` code units）；字段名 `textPreview`，**永不**带未截断全文键 |

选择理由：队列内容可能含作业答案、个人笔记；默认投影给 UI 同步时不应成为第二条 transcript 泄露面。需要调试/本地预览时显式 opt-in。

### 3. 可选 façade thin method

`AgentSessionFacade.projectQueue(options?)` 调用纯 helper，注入：

- `this.snapshot()` + `this.queue.snapshot()`
- `autoDrain: this.autoDrain`（产品 attach 仍 false）
- `closed: this.queue.isClosed()`

**不**改 constructor 默认、**不**改 `autoDrain !== false` 语义、**不**改 drain/steer/follow-up 行为。

### 4. IPC residual（明确开放）

本切片**不**编辑：

- `teaching-ipc-gateway.ts`
- `teaching-ipc-contract.ts` / commands
- `preload/index.ts`
- renderer `agent-conversation-runner` FIFO

未来 queue-sync IPC 应消费本纯投影，并在独立 ADR 中声明 channel / CAS / 隐私默认。

## 不变量（产品地板）

- **Product autoDrain 仍 false**（ADR-0082 注释与 gateway 强制保持）。
- steer ≠ abort；无 YOLO / always-approve / interrupt-on-busy 默认。
- 无 shell / MCP marketplace / 默认远程 telemetry。
- 不触碰 settlement sole-writer / `expectedRevision` 语义 / `toolsReplayed`。

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/agent-session-queue-projection.unit.test.ts
```

覆盖：空队列、元数据映射、默认无 text、可选 preview hard-cap、不 mutate 源、façade `projectQueue` 镜像 `autoDrain: false`。

## 不包含 / non-claims

- **不** 将 product `autoDrain` 设为 true。
- **不** 改 renderer 本地 FIFO 或 busy-ack 文案。
- **不** 接线 IPC / preload / gateway（仍 residual，交给后续与 S-09 协调）。
- **不** 改 busy policy / steer 语义 / interrupt 默认。
- **不** 改 ADOPTION.md 优先级表。

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-02 residual：pure main-side queue projection **已落地（ADR-0089）**；product autoDrain 仍 false；main↔renderer queue sync IPC 与 renderer FIFO 对齐 **仍开放**。
