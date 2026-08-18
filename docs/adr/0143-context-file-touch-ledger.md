# ADR-0143：确定性 context file-touch ledger（LiveAgent Phase A）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** **已实施**（core ledger，2026-07-24）：`src/main/ai/context-file-ledger.ts` 已接线 agent-loop / request-context-projection；learner 透明 UI 仍可后续消费同一结构（非本条阻塞）
- **日期：** 2026-07-23
- **范围：** 为 agent 运行中单路径 workspace 工具触碰建立**可合并、路径消毒**的 file-touch 账本，并作为 teaching/context **投影数据（data not instructions）**注入；**不**进入 summarizer payload；**不**成为 teaching-evidence 或 settlement 权威。
- **取代：** 无
- **被取代：** 无
- **相关：** LiveAgent 历史研究清单（已结项） §2.1、[ADR-0013](0013-budgeted-provenance-aware-teaching-context.md)、[ADR-0045](0045-context-hygiene-ladder-and-quality-gates.md)、[ADR-0064](0064-context-compactor-cutpoints-and-reduction-guard.md)、[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0121](0121-improvements-adoption-closeout.md)、`AGENTS.md`、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`
- **证据：** `src/main/ai/context-file-ledger.ts`；挂钩 tool dispatch / `agent-loop`；注入 `request-context-projection`（及压缩 resume 路径若需要）

## 1. 背景

长会话在 hygiene / compact 之后，模型与 UI 容易**只靠摘要幻觉**回忆「碰过哪些教学文件」。LiveAgent 的 file ledger（见对照清单）用确定性扫描工具调用中的单 `path`，在压缩与续聊中保留**地板事实**。

StudiumX 产品地板：

- **文件是教学真相源**；投影可重建。
- **LearningSessionLedger / settlement sole-writer** 仍是教学过程与 outcome 权威（ADR-0008 / ADR-0011 / ADR-0023）。
- Context 注入须预算化、可溯源（ADR-0013）；压缩默认 reference-only（ADR-0064）。

因此需要的是 **context/projection 层账本**，不是第二套 teaching ledger。

## 2. 决策

### 2.1 账本语义

| 规则 | 说明 |
| --- | --- |
| **收录来源** | 仅 **单路径** workspace 工具族：read / write / edit / delete 风格（以注册表与 TOOL_CONTRACT 中的 path 参数为准） |
| **失败剔除** | 工具调用 **失败 / 被拒 / 未完成** 的 path **不得** 记为 touched |
| **`modified` 粘性** | 合并时：若任一来源将该 path 标为 modified，合并结果 **保持 modified**（读后写不得降级为仅 read） |
| **合并序** | 跨 checkpoint / 分片按 **消息序 / 调用序** 合并为可重放结果 |
| **路径消毒** | 相对 workspace 规范化；拒绝绝对路径泄漏、越界 `..`、密钥型路径进入公开投影时按既有 redact 政策 |
| **超预算** | 条目超长/超条数时 **丢弃整项，不截断路径或半写**（避免伪路径） |
| **注入形态** | 进入 teaching/context 投影为 **结构化 data**（如 touched paths + flags），**不是** 指令性 system 文案；模型不得被教成「账本 = 已结算证据」 |
| **与 summarizer** | **不** 进入 summarizer payload（压缩摘要输入不得用账本替换 transcript 权威） |

### 2.2 权威边界

| 是 | 否 |
| --- | --- |
| Provider / UI **投影地板**：「本 run / 本压缩窗口触碰过的路径」 | **Teaching evidence** / outcome settlement 权威 |
| 辅助压缩 resume 与导师透明 UI（P1 可消费同一结构） | **替换** `LearningSessionLedger` 或 AgentRun 状态机 |
| 可重建、可单测的纯合并逻辑优先 | Shell / Glob 伪解析当作「全集真相」 |

### 2.3 红线（Phase A 硬约束）

1. **禁止** 把 Shell 输出、Glob 展开、MCP 多路径伪解析当作账本全集。
2. **禁止** YOLO / always-approve；账本 **不** 绕过 effect lattice 或审批。
3. **禁止** 将账本写入 outcome / Learning record 作为 settlement 输入。
4. **文件 SoT 不变**；账本丢失或预算丢弃时，以工作区文件与 ledger 为准，不编造 path。
5. **不** 引入 FTS / 向量产品搜索、默认 remote telemetry、product `autoDrain: true`、fork `toolsReplayed: true`。

## 3. 实现形状（core 已落地）

```text
src/main/ai/context-file-ledger.ts   # pure merge / sanitize / budget drop
# hooks: tool dispatch success path → record touch
# agent-loop / request-context-projection → inject data slice
# tests/unit: merge order, modified sticky, failure exclude, sanitize, budget drop, not in summarizer payload
```

验收已由本 ADR 的实现落点和目标测试闭环；learner 透明 UI 消费同一结构为 residual（非 core 阻塞）。

## 4. 与既有 ADR 的关系

| 文档 | 关系 |
| --- | --- |
| ADR-0008 / 0011 / 0023 | ledger / settlement 权威 **不变**；本账本是旁路投影 |
| ADR-0013 / 0045 | 注入须进预算与 hygiene 阶梯，不得撑破 prompt-cache 稳定前缀合同（ADR-0044） |
| ADR-0064 | 压缩仍 reference-only 默认；账本 **不** 塞进 summarizer |
| ADR-0121 | 四源结项后开放项须新 ADR；本条为 LiveAgent Phase A 第 1 项 |
| Phase B+（fuzzy edit、透明 UI 等） | **不** 由本 ADR 授权 |

## 5. 非目标

- 不把 learner 透明 UI / files-touched 面板当作 core ledger 阻塞项（UI 可后续消费同一结构）。
- 不做 Phase B/C/D（fuzzy edit、MCP ops、Pin/FTS 等）。
- 不改 TOOL_CONTRACT 的 effect 分级（除非后续 PR 明确登记 path 工具列表）。

## 6. 一句话

**单路径 workspace 触碰的可合并消毒账本，只作 context 投影 data；失败剔除、modified 粘性、超预算丢弃；永不进 summarizer，永不取代 LearningSessionLedger。**
