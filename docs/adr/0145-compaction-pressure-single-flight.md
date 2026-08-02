# ADR-0145：压缩 pressure / 单飞 / mid-run 保护（LiveAgent Phase A）

- **状态：** **已实施**（2026-07-24）：`compaction-pressure-controller.ts` + `context-compactor.ts` 接线；pre_send / post_tool / **mid_stream 触发标签** + 单飞 join + pressure ladder；硬 run budget 优先。**说明：** 当前 `mid_stream` 是 call-site **标签**，不是真正的 mid-token overflow 拦截；并发调用 **join 复用第一次 flight 结果**。
- **日期：** 2026-07-23
- **范围：** 在既有 `ContextCompactor`（[ADR-0064](0064-context-compactor-cutpoints-and-reduction-guard.md)）之上，冻结 **多触发点**、**单飞互斥** 与 **pressure ladder**（压完仍超阈时加强 prune）；默认仍 **reference-only / 非 durable rewrite**；与 **硬 run budget / durable-success fallback** 共存时 **硬预算优先**。
- **相关：** LiveAgent 历史研究清单（已结项） §2.3、[ADR-0045](0045-context-hygiene-ladder-and-quality-gates.md)、[ADR-0064](0064-context-compactor-cutpoints-and-reduction-guard.md)、[ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)、[ADR-0100](0100-agent-loop-fallback-peel.md)、[ADR-0103](0103-agent-loop-budget-reason-peel.md)、[ADR-0121](0121-improvements-adoption-closeout.md) §6.14、[ADR-0143](0143-context-file-touch-ledger.md)
- **实现落点：** `src/main/ai/compaction-pressure-controller.ts`；`src/main/ai/context-compactor.ts`；`agent-loop` / request-context projector / teaching conversation runtime 调用点

## 1. 背景

ADR-0064 已 hardening 切点、不足缩减守卫与审计字段；产品路径具备 hygiene → threshold → compact 阶梯（ADR-0045）。长会话弱项在于 **运行中压力调度**：

- 仅 pre-send 触发时 mid-stream / 工具后仍可能炸窗；
- 并发多次 compact 浪费预算并竞态改写投影；
- 压完仍超阈时缺少 **阶梯加强**，易硬死或无脑连压。

LiveAgent 以 multi-trigger + single-flight + pressure ladder 处理同类问题。采纳时必须服从 StudiumX：**默认不 durable rewrite 会话正文**；多轴硬预算不可被 soft compaction 替代。

## 2. 决策

### 2.1 多触发点（style，非复制对方引擎）

允许在实现 PR 中接线（闭集，禁止随意新旁路）：

| 触发风格 | 意图 |
| --- | --- |
| **pre-send** | provider 调用前，投影超阈则 compact |
| **mid-stream** | **标签位**：允许 call-site 标记 mid_stream；**当前实现不**做真正 mid-token overflow 拦截 / 流内半段压窗。有界 compact 仍走同一 `compactIfNeeded` 入口 |
| **post-tool** | 工具结果并入 transcript 后，再评估是否超阈 |

具体信号源（token 估计、provider overflow 分类等）复用 ADR-0052 / 0125 与本地 estimator；**不** 新引入远程 telemetry。

### 2.2 单飞（single-flight）

| 规则 | 说明 |
| --- | --- |
| **互斥** | 同一 session/run 作用域内，**同时只允许一次** compact 执行 |
| **并发** | **已选定 join**：后续触发 **await 同一 in-flight promise 并复用其结果**（非跳过空结果、非二次 summarize）；禁止并行两路改写同一投影 |
| **失败 cooldown** | 与 ADR-0064 不足缩减 / summarize 失败 cooldown **兼容**，不得绕过 fail-closed |

### 2.3 Pressure ladder

当 compact **成功完成**（`outcomeCode: completed`）后投影 **仍超阈**（或连续 N 次仍不足）：

1. **加强** prune / 更 aggressive 切点参数（ladder 档位闭集，实现 PR 文档化）；
2. **禁止** 无界死循环连压；须有 **最大 ladder 档** 与 **停止条件**；
3. 不足缩减仍 **fail closed 保留原始 transcript**（ADR-0064 不变量）；
4. ladder **不得** 默认打开 durable rewrite session JSON body。

### 2.4 与硬预算的共存

| 规则 | 说明 |
| --- | --- |
| **硬 run budget** | `maxProviderCalls` / run 预算轴与 durable-success / budget fallback **优先** |
| **冲突时** | 若 compaction 调度与硬停机条件冲突：**硬预算 wins**（停机 / fallback 路径，不无限 compact） |
| **压缩结果** | 仅影响 **provider 投影**；**不是** teaching SoT，**不是** settlement 输入 |
| **默认持久化** | **保持** ADR-0064 / ADR-0121：reference-only；ADR-0045 层 B durable boundary **仍不** 由本 ADR 默认开启 |

### 2.5 与 file-touch ledger（ADR-0143）

- Compact 后 resume 可消费 **file-touch ledger 投影** 以保留「碰过哪些文件」的地板数据。
- Ledger **不** 进入 summarizer payload（0143）；pressure ladder **不得** 把账本当作可丢弃的「指令块」随意截断半路径（预算丢弃须整项 drop）。

### 2.6 红线

- 无 Shell / YOLO / FTS 产品搜索 / 默认 phone-home。
- 不推倒 EventBus/timeline、不重写 AgentRun 状态机。
- Product `autoDrain: true`、fork `toolsReplayed: true` **禁止**。
- Settlement sole-writer 不变。

### 2.7 交付诚实边界（实现对照）

| 宣称 | 当前落地 |
| --- | --- |
| multi-trigger | call-site 可传 `triggerPoint: pre_send \| mid_stream \| post_tool`；**算法不因标签分支** |
| mid-stream overflow | **未**实现流式 token 半段溢出拦截；`mid_stream` 仅为标签 / 审计字段（`void input.triggerPoint`） |
| single-flight | **join 语义**：并发调用共享第一次 flight 的 Promise 与结果 |
| pressure ladder | compact 成功且仍超阈时 escalate prune 档；有界、fail-closed |
| hard budget | 预算耗尽 / stop pending 时 no-op，优先于再压 |


## 3. 实现形状（已落地）

```text
src/main/ai/compaction-pressure-controller.ts  # pressure state + single-flight + ladder
src/main/ai/context-compactor.ts               # wires controller into compact path
src/main/ai/agent-loop.ts (or equivalent)      # pre_send / post_tool (+ mid_stream label) call sites
src/main/ai/request-context-projection.ts
# tests: single-flight mutex, ladder escalate, hard-budget wins, reference-only default regression
```

验收已由本 ADR 的实现落点和目标测试闭环。

## 4. 与既有 ADR 的关系

| 文档 | 关系 |
| --- | --- |
| ADR-0064 | **基线**；本 ADR 加调度与 pressure，不换引擎、不取消 reduction guard |
| ADR-0045 | 阶梯 A 内 hardening；层 B durable **仍延期/可选，非默认** |
| ADR-0057 / 0100 / 0103 | 硬预算与 fallback **优先于** 无限 compact |
| ADR-0143 | 压缩后文件触碰地板数据的并列 Phase A 项 |
| ADR-0121 §6.14 | 默认非 durable rewrite 会话正文 **保持** |

## 5. 非目标

- 不替换 ContextCompactor 摘要引擎（pressure 为调度层，非新 summarizer）。
- 不实施 Phase B+（fuzzy edit、会话 Pin 等）。
- 不把 pressure 当作远程遥测实验平台。

## 6. 一句话

**多触发点（含 mid_stream 标签）压缩 + 单飞 join + 仍超阈则 pressure ladder；默认 reference-only；与硬 run budget 冲突时硬预算赢；真 mid-token overflow 拦截非本 ADR 当前交付。**
