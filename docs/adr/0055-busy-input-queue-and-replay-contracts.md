# ADR-0055：Busy 输入有界队列与回放 / revision 契约

- **状态：** 已实施（模块 + 契约测试 + 薄 cancel 接线）
- **日期：** 2026-07-21
- **范围：** `agent-input-queue` / `agent-busy-input-policy`、cancel 清空、A-08 反回归契约（`expectedRevision` 拒、`toolsReplayed:false`、无启动自动 memory）
- **相关：** [ADOPTION.md](0121-improvements-adoption-closeout.md) A-08 / B-01、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0040](0040-teaching-session-protocol-facade.md)、[ADR-0044](0044-teaching-prompt-cache-contract.md)、[ADR-0047](0047-agent-runtime-wire-and-turn-orchestrator.md)、[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)

## 背景

渲染层在 `agentChatBusy` 时对新输入早退；main 仅有 `AbortController` 取消路径，缺少 busy 下的 follow-up / steer 有界队列与三态策略。同时 ADOPTION A-08 要求对 revision CAS、`toolsReplayed:false` 与「无启动自动 memory」做契约级反回归封口。

## 决策

### B-01 Busy 输入

1. **唯一模块名**
   - 运行时 FIFO：`src/main/ai/agent-input-queue.ts`（禁止 `agent-loop-queue` / `agent-prompt-queue` / `agent-interjection` 第二命名）
   - 纯策略：`src/main/ai/agent-busy-input-policy.ts`（`interrupt | queue | steer`）

2. **默认与不变量**
   - busy 默认动作：`queue`（优于 interrupt）
   - **steer ≠ abort**：steer 不设置 `abortsRun`；interrupt 才 abort
   - steer 仅在 `turn_boundary` 安全相位注入；`write_tool` / `privileged_tool` 期间禁止 steer，强插意图 demote → queue
   - stranded 输入 → queue（满则 reject，不静默丢弃）
   - hard cap（默认 16）；`clearOnCancel` 清空并关闭 enqueue，`reopen` 后可再入队

3. **接线边界（本 ADR 已落地）**
   - `TeachingIpcGateway` 持有 `AgentInputQueueRegistry`
   - `cancelAgentChatStream` 在 abort 后对 `streamId` 调用 `clearOnCancel`
   - **尚未**把 renderer busy 早退改为完整 façade drain（留给 B-02 `AgentSessionFacade`）；本切片交付模块 + 单测 + cancel 钩子

### A-08 契约封口

契约测试覆盖：

| 红测 | 证据 |
| --- | --- |
| 缺 `expectedRevision` 拒 | IPC `parseFork` / `parseUpdateStatus` + session-tree fork/save/status |
| fork 不默认可执行工具历史 | `projectAgentConversationReplay` / `forkAgentConversationBranchAtRoot` 固定 `toolsReplayed:false` 且剥离 toolCalls |
| 无启动自动 memory | `createApplicationRuntime` start 不 list/create memory；`buildSessionStablePrefix` 不含 memory body |

## 已实施范围与验证入口

```bash
pnpm exec vitest run --project unit \
  tests/unit/agent-input-queue.unit.test.ts \
  tests/unit/agent-busy-input-policy.unit.test.ts \
  tests/unit/a08-revision-tools-memory-contracts.unit.test.ts
```

## 不包含 / non-claims

- **不** 实施完整 AgentSessionFacade（B-02）或 renderer busy-ack banner UI 终态
- **不** 在 agent-loop 内中途强插 provider messages（仅安全 turn 边界策略已定义）
- **不** 改变 settlement sole-writer、effect lattice、YOLO / shell / MCP 边界
- **不** 允许 fork 默认 `toolsReplayed:true` 或启动自动注入 memory 正文
