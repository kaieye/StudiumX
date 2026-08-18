# ADR-0096：Product autoDrain 评估（保持 false）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 评估结论已记录（**决策：product 继续 `autoDrain: false`**；**无** 生产行为变更；**无** 代码翻转）
- **日期：** 2026-07-21
- **范围：** B-02 residual evaluation — 记录 product 接线现状、队列只读 IPC 能力、renderer 消费缺口，以及未来翻转 autoDrain 的显式前置条件；**不**实施 autoDrain；**不**改 gateway / façade 默认；**不**实现 renderer 队列 UI
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0055](0055-busy-input-queue-and-replay-contracts.md)、[ADR-0058](0058-agent-session-facade.md)、[ADR-0067](0067-cancel-tool-pair-close-and-busy-ack.md)、[ADR-0082](0082-agent-chat-steer-followup-ipc.md)、[ADR-0089](0089-agent-session-queue-projection.md)、[ADR-0091](0091-agent-session-queue-projection-ipc.md)、[ADOPTION B-02](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/teaching-ipc-gateway.ts`（product attach `autoDrain: false` + queue/steer 注释）
  - `src/main/ai/agent-session-facade.ts`（constructor 默认 vs product 强制 false；turn 后 `drain()` 门闩）
  - `src/main/ai/agent-session-queue-projection.ts` / `agent-session-queue-ipc.ts`
  - `src/shared/teaching-ipc-contract.ts` / `src/shared/teaching-types/system-api.ts` / `agent-session-queue.ts`
  - `src/preload/index.ts`（channel whitelist）
  - `src/renderer/src/app-shell/agent-conversation-runner.ts`（本地 FIFO drain；**未**调用 `projectAgentSessionQueue`）
  - unit：`tests/unit/agent-session-facade.unit.test.ts`、`agent-session-queue-projection.unit.test.ts`、`agent-session-queue-ipc.unit.test.ts`
  - 本 ADR

## 背景

B-02 主切片已落地：

| 能力 | ADR | 状态 |
| --- | --- | --- |
| AgentSessionFacade + product invoker | ADR-0058 / ADR-0067 | 已实施 |
| mid-run `steer` / `followUp` IPC | ADR-0082 | 已实施；**autoDrain 仍关** |
| pure 队列投影 `projectAgentSessionQueue` / `facade.projectQueue` | ADR-0089 | 已实施；**autoDrain 仍关** |
| 只读 product IPC `projectAgentSessionQueue` / `teach:project-agent-session-queue` | ADR-0091 | 已实施；**autoDrain 仍关** |

ADOPTION B-02 仍把 **product autoDrain 评估** 标为可选 residual，且要求：**勿在无队列同步设计时翻 true**。本 ADR 只做评估与决策记录，不授权任何 product 行为变更。

## 现状：product 接线（证据摘要）

评估当日（2026-07-21）product 接线快照如下；完整行号 / 路径证据见
`docs/adr/evidence/ADR-0096.md`。

| 层 | 现状 | autoDrain |
| --- | --- | --- |
| Product gateway（`teaching-ipc-gateway.ts`） | 唯一产品构造点显式 `autoDrain: false` | **false（强制）** |
| Façade 库默认（`agent-session-facade.ts`） | `options.autoDrain !== false` → 库默认 true（供 unit / 非 product 宿主） | 产品路径被 gateway 覆盖 |
| 投影 / IPC / preload | `projectAgentSessionQueue` 只读报告 flag，从不 drain/steer/abort/flip | 不启用 |
| 生产 `src/**` | **无** `autoDrain: true`（仅 unit 覆盖） | 不启用 |
| Renderer | 仍用本地 FIFO + busy-ack（ADR-0067），未镜像 main façade 队列 | 未消费只读 IPC |

**结论：** main 队列只读 IPC 已备齐；renderer 仍用本地 FIFO。双队列未统一前开启
product autoDrain 会造成“main 自动 drain + renderer 再本地 drain”双轨竞态风险。

## 决策

1. **Product 继续保持 `autoDrain: false`**（gateway 强制点与注释不变）。
2. **禁止** 在无独立 queue-sync 设计 ADR 的情况下，将 product `autoDrain` 设为 true、或将 façade 默认改为“产品真默认 true 且 gateway 漏传仍安全”以外的隐式翻转。
3. **安全 residual 路径（可选，本 ADR 不实施）：** 仅只读消费 `projectAgentSessionQueue` 的 thin renderer（显示 depth / phase / busy-ack 对齐），**不得**依赖或启用 autoDrain。
4. 未来若翻转，**必须**先有 **design ADR**（可另编号）覆盖 §前置条件，再开实现切片；本 ADR **不**授权实现。

## 未来翻转前置条件（显式清单）

在 **任何** product 路径出现 `autoDrain: true` 之前，须同时满足：

1. **用户可见队列投影**
   - Renderer 至少有一个只读 consumer：`projectAgentSessionQueue` → 展示 `queueDepth` / entry kind（follow_up \| steer）/ phase / busy。
   - 用户能区分“已入队待 drain”与“当前 turn 仍在跑”。

2. **main ↔ renderer 队列同步设计**
   - 单一权威：要么 main façade 队列为 drain 权威且 renderer 镜像；要么明确禁止双 FIFO 同时 drain。
   - 取消 / clearOnCancel 与本地 `agentBusyFollowUpQueue` 语义对齐（ADR-0055 / ADR-0067）。

3. **与 mid-run steer / follow-up 的交互**
   - steer ≠ abort 保持（ADR-0055 / ADR-0082）。
   - 明确：busy 时 follow-up 入队 vs autoDrain 出队的顺序；`canInjectQueuedInput` 对 steer 的门闩不因 autoDrain 绕过。
   - 不得启动第二 `agentChatStream` loop 来“模拟” drain。

4. **busy-ack / cancel UX**
   - busy-ack 文案与真实 main 队列 depth 一致（或明确仅本地 ack）。
   - cancel 清空两侧队列；无“ghost follow-up”在下一 turn 复活。

5. **settlement / 回放非交互（硬地板）**
   - **不** 把 autoDrain 与 settlement sole-writer、`expectedRevision`、或 fork `toolsReplayed: false` 耦合。
   - drain 产生的后续 turn 仍走既有 invoker / coordinator 路径；禁止 YOLO / always-approve；禁止 shell / MCP marketplace。

6. **独立实现 ADR + 测试**
   - 新 ADR 声明 product 构造点、失败模式、回滚策略。
   - unit / 可选 integration：autoDrain on 时 FIFO 顺序、cancel 清空、steer 门闩、投影 `autoDrain: true` 报告与真实 façade 一致。

未满足以上任一条 → **保持 false**。

## 安全 residual（可选，不在本切片）

**只读 renderer consumer of `projectAgentSessionQueue`**（无 autoDrain）：

- 调用已有 preload API；默认 **省略** free-text（ADR-0089 / 0091 隐私默认）。
- 可用于 statusbar depth / “N 条待处理” 与本地 busy-ack 对照，**不**替换本地 FIFO 行为。
- **禁止** 在同一切片里改 gateway `autoDrain: false`。
- 本评估 **不** 实现该 consumer（除非后续独立、trivial 且不触 gateway 的切片另批）。

## 明确不包含 / non-claims

- **不** 将任何 product 路径 `autoDrain` 设为 true。
- **不** 修改 `AgentSessionFacade` constructor 默认语义。
- **不** 改 gateway attach / steer / follow-up / projectQueue 行为。
- **不** 实现 renderer 队列 UI / 改写 `agent-conversation-runner` FIFO。
- **不** 触碰 settlement sole-writer、`expectedRevision`、`toolsReplayed`。
- **不** 编辑 [ADR-0121](0121-improvements-adoption-closeout.md)（主代理维护优先级表）。
- 本 ADR **不是** 实现授权；仅冻结 **keep false** 决策与翻转门槛。

## 验证入口

本切片为 ADR-only；无强制测试套件。复核证据可用：

```powershell
rg -n "autoDrain" src
# 期望：product 构造仅 gateway `autoDrain: false`；src 无 `autoDrain: true`
rg -n "projectAgentSessionQueue" src/renderer
# 期望：无调用（consumer residual）
```

可选（未改代码则非必须）：

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/agent-session-facade.unit.test.ts `
  tests/unit/agent-session-queue-projection.unit.test.ts `
  tests/unit/agent-session-queue-ipc.unit.test.ts
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-02 residual：**product autoDrain 评估已落地（ADR-0096）** — **决策 keep false** 直至 queue-sync 设计 ADR；只读队列 IPC 仍为 ADR-0091；**可选 residual**：thin 只读 renderer consumer of `projectAgentSessionQueue`（**无** autoDrain）。
