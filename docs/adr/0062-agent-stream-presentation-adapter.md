# ADR-0062：Agent stream presentation 适配层

- **状态：** 已实施（ADOPTION B-06；产品 runtime 全量 rewire residual 见下文）
- **日期：** 2026-07-21
- **范围：** 多回调 / 多形态 agent stream 信号 → 单一 presentation sink 的薄适配；presentation 异常不得抛回 agent loop
- **相关：** [ADR-0043](0043-doctor-config-locator-and-fix-suggestion.md) 保护面旁路无关、[ADR-0047](0047-agent-runtime-wire-and-turn-orchestrator.md)、[ADOPTION B-06](0121-improvements-adoption-closeout.md)
- **证据路径：** `src/main/ai/agent-stream-events.ts`、`src/main/ai/agent-event-bus.ts`（薄 wrap）、`tests/unit/agent-stream-events.unit.test.ts`

## 背景

`AgentLoopEvent` 与 EventBus 的 `onChunk` / `onStatus` / `onTool` 是多形态出口；UI/IPC presentation 若直接挂在 loop 回调上，一旦抛错会回灌 agent loop，破坏 turn 执行与 settlement 边界。B-06 要求**增量**适配层收敛呈现合同，**不**推倒 EventBus/timeline，**不**重写 ADR-0043 既有保护。

## 决定

1. 新增 deep module `src/main/ai/agent-stream-events.ts`：
   - `AgentStreamPresentationSink`：chunk / status / tool（可选 loopEvent）
   - `mapAgentLoopEventToPresentation`：纯映射，不拥有 timeline 存储
   - `createAgentStreamPresentationAdapter`：多回调 → 单一 sink API
   - `safePresent`：catch + 可选本地 diagnostic，**吞掉** presentation 异常
   - `wrapPresentationCallbacks`：对既有 multi-callback 形状做 exception isolation
2. `AgentEventBus` 构造时用 `wrapPresentationCallbacks` 包裹出站回调；`publishLoopEvent` 改为调用纯映射，避免在 bus 内重复业务分支逻辑。
3. **不**新增第二套 timeline store；**不**改 settlement sole-writer、`toolsReplayed`、`expectedRevision`。
4. Diagnostic 仅本地 hook（`onPresentationError`）；**禁止**默认 remote telemetry / phone-home。

## 已实施范围与验证入口

```powershell
pnpm exec vitest run --project unit tests/unit/agent-stream-events.unit.test.ts
```

覆盖：token/status/tool_result 映射；sink 抛错不 rethrow；cancel/terminal 在 sink 健康时仍送达；EventBus 在 chunk 回调抛错后仍可继续 publish 并记录 terminal。

## 不变量

- Presentation 异常不得中断 agent loop / publish 调用方。
- 映射语义与历史 `AgentEventBus.publishLoopEvent` 分支一致（token→answer chunk、reasoning channel、tool_call/tool_result、child_run* 状态文案、context_compaction* 状态文案）。
- EventBus replay / sequence / terminal 权威仍在 `AgentEventBus`。

## Residual（非阻塞）

- 产品路径仍通过 `teaching-conversation-runtime` → `createAgentEventBus`；adapter 工厂可直接用于 loop `emit`，但**未**强制替换全部 runtime 入口（低风险薄 wrap 已覆盖 bus 出站回调）。
- Renderer 呈现（`agent-conversation-presentation.ts`）未改；仍为独立 UI projection。

## 不包含 / non-claims

- **不**重写 EventBus 类或 timeline 协议。
- **不**引入 shell / MCP marketplace / YOLO / always-approve。
- **不**默认远程 telemetry。
- **不**改 settlement / toolsReplayed / sole-writer。
