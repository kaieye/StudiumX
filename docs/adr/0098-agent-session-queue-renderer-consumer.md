# ADR-0098：Agent session 队列只读 renderer consumer（Diagnostics）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（Settings Doctor 内只读队列快照 UI；**无** autoDrain 翻转；**无** main / FIFO 改写）
- **日期：** 2026-07-21
- **范围：** ADOPTION **B-02 residual** — renderer 薄只读 consumer：调用既有 `projectAgentSessionQueue` IPC，在 Teaching Doctor 诊断区展示 export-safe 队列字段
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0089](0089-agent-session-queue-projection.md)、[ADR-0091](0091-agent-session-queue-projection-ipc.md)、[ADR-0096](0096-agent-session-autodrain-product-evaluation.md)、[ADR-0095](0095-teaching-doctor-settings-ui.md)、[ADR-0067](0067-cancel-tool-pair-close-and-busy-ack.md)
- **证据：** 
  - `src/renderer/src/app-shell/agent-session-queue-client.ts`
  - `src/renderer/src/views/settings/sections/AgentSessionQueueDiagnostics.tsx`
  - `src/renderer/src/views/settings/sections/TeachingDoctorSettingsSection.tsx`（底部 mount only）
  - `src/renderer/src/i18n/locales/zh-CN.json` / `en-US.json`（`queueDiagnostics.*`）
  - `tests/unit/agent-session-queue-client.unit.test.ts`
  - `tests/unit/agent-session-queue-diagnostics.unit.test.tsx`
  - 本 ADR

## 背景

ADR-0089 落地 pure 队列投影；ADR-0091 落地 product IPC；ADR-0096 **决策 product 继续 `autoDrain: false`**。Renderer 此前无消费该只读投影的 UI 面：调试者无法在应用内查看 main façade 队列快照（busy / phase / depth / entries kind+enqueuedAt）。

本切片仅补 **thin read-only UI + 客户端 helper**，不改 main/preload/contract，不替换 renderer 本地 busy FIFO（ADR-0067）。

## 决策

### 1. 放置位置（最低风险）

挂载在既有 **Teaching Doctor Settings** 面板底部（ADR-0095），作为「Agent session queue (read-only)」诊断子卡：

- **不** 新增 `SettingsSection` enum
- **不** 改 App.tsx / busy-ack 主路径
- Doctor 已是诊断首页，语义一致

### 2. 调用约定

```ts
projectActiveAgentSessionQueue(api, streamId)
// → api.projectAgentSessionQueue({ streamId })
// 产品路径永不传 includeTextPreview: true
```

- `streamId`：产品路径中等于 agent conversation id（`agent-conversation-runner` 使用 `streamId: pendingConversationId`）
- UI 提供可编辑文本框；用户粘贴/输入 id 后手动 Refresh
- 结果：`{ ok: true, projection } | { ok: false, reason }`

### 3. 展示字段（export-safe）

| 字段 | 说明 |
| --- | --- |
| busy | 忙碌/空闲 badge |
| phase | 字符串 phase |
| autoDrain | badge；产品期望 **false**（ADR-0096） |
| queueDepth / queueCapacity | `depth / capacity` |
| closed? | 若投影提供则展示 |
| entries[] | **kind** + **enqueuedAt** + id；**不** 渲染 textPreview |

### 4. 不变量（产品地板）

- **只读**：UI **永不** drain / prompt / steer / follow-up / abort / 翻转 autoDrain
- **隐私**：产品 UI **默认 omit free-text**；不传 `includeTextPreview`
- **不** 替换 `agentBusyFollowUpQueue` 本地 FIFO 或 busy-ack banner
- **不** 改 `src/main/**`、preload、IPC contract、system-api
- 无 YOLO / shell / MCP marketplace / 默认远程 telemetry
- 不触碰 settlement sole-writer / `expectedRevision` / `toolsReplayed`

## 不包含 / residual

- 自动绑定 active conversation id（避免重 wiring App/Settings props）
- 轮询 / 实时订阅 main 队列
- 用 main 投影驱动或替换 local FIFO drain
- 任何 autoDrain true 产品路径或 steering 控件

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/agent-session-queue-client.unit.test.ts `
  tests/unit/agent-session-queue-diagnostics.unit.test.tsx
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-02 residual：可选只读 renderer consumer **已落地（ADR-0098）** — Doctor 内 queue diagnostics 调 `projectAgentSessionQueue`；展示 busy/phase/autoDrain(false)/depth/entries kind+time；无 free-text、无 drain/steer、无 autoDrain 翻转；local FIFO 仍 ADR-0067。
