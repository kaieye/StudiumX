# 本地数据：未关闭工作的分派入口

> **用途。** 本文只记录尚未关闭或尚未批准的本地数据工作。已结项决定、受限 production scope 与验证入口以 [ADR 索引](adr/README.md) 为准；本页不维护已关闭切片、实现细节、测试编号或提交台账。
>
> **当前。** 无开放 local-data 实现切片。唯一延期项：C-6 destructive Memory migration（见 [ADR-0038](adr/0038-memory-readonly-migration-dry-run-and-destructive-deferral.md)），不可分派为实现。

## 1. 当前状态快照

| 工作流 | 状态 | 当前可分派范围 | 既有边界 |
| --- | --- | --- | --- |
| — | **当前无开放 local-data 实现切片** | 无 | 已结项范围见 ADR 索引；destructive C-6 延期见 ADR-0038。 |

## 2. 全局不变量、分派规则与完成定义

### 2.1 不变量

1. canonical JSON、Markdown、JSONL、immutable Learning record 与 Memory 文件仍是事实来源。projection、partition、sealing、summary、`.bak`、journal、marker 和 private receipt 不得删除、覆盖或取代它们。
2. `possibly_published`、provider outcome unknown、损坏、identity conflict、越界路径和无法证明的 I/O 结果，均不得自动 retry、rollback、delete 或报告成功；获批 contract 必须给出唯一 disposition。
3. [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 的局部 durable scope、[ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md) 的 trace、[ADR-0006](adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) 的 readonly preflight，以及 [ADR-0038](adr/0038-memory-readonly-migration-dry-run-and-destructive-deferral.md) 的 dry-run intent/receipt，都不得被复用为 actionId、receipt、dedupe、transaction 或 destructive authorization。
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

（无）

## 4. 依赖与冲突检查

| 需求 | 未满足的依赖/约束 |
| --- | --- |
| C-6 destructive migration | **延期/不可分派为实现**（[ADR-0038](adr/0038-memory-readonly-migration-dry-run-and-destructive-deferral.md)）；readonly dry-run 不授权 destructive。未来立项须先满足 ADR-0038 第 3 节前提，并另立独立 ADR。 |

任何工作流都不得通过复用既有 durable、trace 或 preflight 跨越上表依赖。若一个候选任务同时触及两个工作流，必须拆分为独立 proposal；没有获批的共同 protocol 时，不得称为 transaction 或统一 idempotency。

## 5. 更新与交接规则

- 新的长期有效、已采纳决定必须新增递增编号 ADR；已实施 scope、边界或验证入口变化必须更新对应 ADR；未关闭范围、blocker、依赖或实施顺序变化必须更新本页及对应 design gate。
- 本页只维护未关闭工作的分派信息，不维护已关闭切片、测试编号、实现细节或提交台账。
- 分派者关闭或拆分任务前，必须复查本页、对应 plan、相关 ADR 和实际代码；不得仅因测试绿色、最终文件存在或局部实现看似可用而关闭整个工作流。
