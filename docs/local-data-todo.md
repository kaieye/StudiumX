# 本地数据：未关闭工作的分派入口

> **用途。** 本文只记录尚未关闭或尚未批准的本地数据工作。已结项的 C-4P6/P8/P9 scope decisions 见 [ADR-0021](adr/0021-c4-p6-p8-p9-closeout-scope-decisions.md)；C-6 只读 dry-run 与 destructive 延期见 [ADR-0022](adr/0022-memory-readonly-migration-dry-run-and-destructive-deferral.md)。
>
> **已完成内容。** 已实施决定、受限 production scope 和验证入口以 [ADR 索引](adr/README.md)为准。本页不维护已关闭切片、实现细节、测试编号或提交台账，也不把局部 durable、trace 或 readonly preflight 误作完整 close-out、action identity、receipt 或 transaction。

## 1. 当前状态快照

| 工作流 | 状态 | 当前可分派范围 | 既有边界 |
| --- | --- | --- | --- |
| C-5H workspace user mutation correlation | **未批准、未实现** | 先作 mission-first 的产品/API/privacy/operations 决策。 | [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md)；trace 不是 caller action identity 或 receipt。 |
| C-5I direct-UI lesson generation correlation | **NO-GO：未批准、未实现** | 先作 direct-UI action/retry/provider/receipt 决策。 | [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md)；不得把现有标识或 artifact 能力当 retry 证明。 |

## 2. 全局不变量、分派规则与完成定义

### 2.1 不变量

1. canonical JSON、Markdown、JSONL、immutable Learning record 与 Memory 文件仍是事实来源。projection、partition、sealing、summary、`.bak`、journal、marker 和 private receipt 不得删除、覆盖或取代它们。
2. `possibly_published`、provider outcome unknown、损坏、identity conflict、越界路径和无法证明的 I/O 结果，均不得自动 retry、rollback、delete 或报告成功；获批 contract 必须给出唯一 disposition。
3. [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 的局部 durable scope、[ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md) 的 trace、[ADR-0006](adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) 的 readonly preflight，以及 [ADR-0022](adr/0022-memory-readonly-migration-dry-run-and-destructive-deferral.md) 的 dry-run intent/receipt，都不得被复用为 actionId、receipt、dedupe、transaction 或 destructive authorization。
4. 任何 schema、path、IPC、lifecycle、retention、repair、deletion 或 canonical authority 改动都必须显式定义 legacy reader/writer compatibility、upgrade/downgrade 与 unknown-version 的 fail-closed 行为。
5. diagnostics、audit、IPC 和 UI 不得泄露 content、prompt/messages、absolute/relative locator、secret、provider/request ID、content hash 或其他未获批准的可关联数据。

### 2.2 分派前的 Definition of Ready

每一张实现任务必须先链接到本页某一工作流及对应 plan，并在任务中写清：

- 单一问题、canonical authority、明确排除项，以及范围/产品/API/privacy/operations/实现 owner；
- identity、public result enum、retry/conflict/unknown-state 语义；
- 目标平台 capability profile；逐 I/O phase 的 failure/crash matrix；recovery 可做的唯一动作；
- schema/path/IPC/lifecycle/retention 是否改变，以及 compatibility/upgrade 路径；
- diagnostics/audit 的数据最小化边界；
- 验收 owner、测试层级、host-native/operations 证据和停止条件。

缺少任一项时，只能分派为**设计澄清或 capability audit**，不得修改 writer、IPC、schema、canonical data 或 destructive path。

### 2.3 Close-out 证据要求

某项只能在同时满足以下条件后从本页移除，并将长期有效的已采纳决定写入 ADR：

1. 已批准的 contract 与实现范围逐条落地，且没有超出已批准的 writer/surface；
2. 所有 failure/crash/recovery 状态都有可验证的 public disposition，未知状态仍 fail closed；
3. compatibility、privacy、sole-writer/authority 与 non-destructive/rollback 禁令被测试覆盖；
4. 针对声明的平台完成 host-native 验证；若声称 crash/reboot/power-loss/directory durability，证据必须匹配该声明，普通 mock/unit tests 或“最终文件存在”不足；
5. operations owner 接受 runbook、observability、rollout/upgrade/rollback、capacity/retention 与人工恢复责任；
6. ADR、对应 plan 和本页状态一致，并明确保留未包含的范围。

## 3. 开放工作流

### C-5H：workspace user mutation correlation（mission-first）

- **设计门：**[P5H mission-first 设计门](plans/local-data-workspace-user-mutation-correlation-design.md)。
- **首先要由 owner 决定：**
  1. 是否批准 renderer 提供 opaque、non-secret `actionId` 与 main workspace-private receipt；若否，是否明确采用“每次 retry 都是新动作、没有 exact retry”的产品语义；
  2. 同 actionId 遇到 payload change、外部 canonical 编辑、partial failure、receipt missing/corrupt 时，是 fail-closed `conflict`/`indeterminate`，还是另行批准 expected revision/CAS UI；
  3. receipt namespace/schema/access/retention、prepare/reconcile/finalize、main-owned serialization，以及允许/禁止字段；prompt、CSS、content hash、provider/request ID 和 secret 不得写入；
  4. trace 与 action identity 的边界：trace 只能作 diagnostic correlation，不能替代 receipt 或 retry identity。
- **首个可能实现范围：**仅 mission submit 的 canonical mutation、其必要 projection 与 receipt-aware recovery；同 prompt 的不同 actionId 必须是不同用户动作。
- **明确排除：**`lesson_style_applied`、CSS scaffold/repair、generic workspace writer、C-4 publish 语义与任何 legacy backfill/repair。
- **验收：**同 ID retry 无第二次 canonical/projection 写入；不同 ID 不按内容 dedupe；payload change、external edit、receipt 损坏/缺失与每个 I/O/crash boundary 都 fail closed，且无敏感数据泄露。

### C-5I：direct-UI lesson generation correlation

- **设计门：**[P5I direct-UI 设计门](plans/local-data-lesson-generation-user-action-correlation-design.md)。当前没有获批的 caller `actionId`、durable receipt 或 status-query contract；既有标识、trace 与 artifact 能力均不得当作 retry identity 或 receipt。
- **首先要由 owner 决定：**
  1. actionId 在 submit、lost response、stream reconnect、renderer reload 与明确放弃时的生成/复用/过期规则；相同 prompt 的新 submit 必须产生新 actionId；
  2. 同 actionId request binding 如何在不持久化 prompt/messages/content hash 的前提下验证；payload mismatch、external edit、receipt missing/corrupt、canonical/projection 无法证明时的 `conflict`/`indeterminate`；
  3. stable API/UI disposition、private receipt 的 authority/placement/retention/locking，以及 main 对首次 accepted action 的 trace 边界；
  4. provider authority/cost：receipt 是否先于 provider call、何时能再次进入 provider、provider outcome unknown 的 fail-closed disposition；未批准前绝不得自动重跑 provider；
  5. canonical/projection partial state 的 crash/recovery table、人工恢复和 privacy-safe diagnostics。
- **明确范围与排除：**仅 direct UI generate/stream；不覆盖 agent generation、mission、lesson style、generic writer、C-4 durable publish、artifact journal/reconciliation、legacy backfill/repair。receipt 不是 canonical data、projection、journal 或 audit authority，也不得进入 user-visible artifact、lifecycle/logger/analytics 或 generic error text。
- **验收：**同 actionId 的明确 retry 不重复 provider/canonical writes；不同 actionId 不按内容 dedupe；unknown provider/partial state 不自动继续；reconnect/reload/concurrency/crash 与 receipt failure 均返回获批 stable state。

## 4. 依赖与冲突检查

| 需求 | 未满足的依赖/约束 |
| --- | --- |
| P5H/P5I exact retry | 产品/API/privacy 对 actionId、receipt、provider 与 recovery 的共同决定；每个 producer 保持独立 scope。 |

任何工作流都不得通过复用既有 durable、trace 或 preflight 跨越上表依赖。若一个候选任务同时触及两个工作流，必须拆分为独立 proposal；没有获批的共同 protocol 时，不得称为 transaction 或统一 idempotency。

## 5. 更新与交接规则

- 新的长期有效、已采纳决定必须新增递增编号 ADR；已实施 scope、边界或验证入口变化必须更新对应 ADR；未关闭范围、blocker、依赖或实施顺序变化必须更新本页及对应 design gate。
- 本页只维护未关闭工作的分派信息，不维护已关闭切片、测试编号、实现细节或提交台账。
- 分派者关闭或拆分任务前，必须复查本页、对应 plan、相关 ADR 和实际代码；不得仅因测试绿色、最终文件存在或局部实现看似可用而关闭整个工作流。
