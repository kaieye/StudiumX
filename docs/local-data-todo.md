# 本地数据：未关闭工作的分派入口

> **用途。** 本文只记录尚未关闭或尚未批准的本地数据工作。已结项的 C-4P6/P8/P9 scope decisions 见 [ADR-0021](adr/0021-c4-p6-p8-p9-closeout-scope-decisions.md)。
>
> **已完成内容。** 已实施决定、受限 production scope 和验证入口以 [ADR 索引](adr/README.md)为准。本页不维护已关闭切片、实现细节、测试编号或提交台账，也不把局部 durable、trace 或 readonly preflight 误作完整 close-out、action identity、receipt 或 transaction。

## 1. 当前状态快照

| 工作流 | 状态 | 当前可分派范围 | 既有边界 |
| --- | --- | --- | --- |
| C-5H workspace user mutation correlation | **未批准、未实现** | 先作 mission-first 的产品/API/privacy/operations 决策。 | [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md)；trace 不是 caller action identity 或 receipt。 |
| C-6 controlled legacy Memory migration | **真实 destructive migration 未关闭、未批准** | 仅治理、capability 与 recovery 设计；获单独批准时才可讨论 readonly dry-run intent/receipt preview。 | [ADR-0006](adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md)；readonly preflight 不构成 destructive authorization。 |

## 2. 全局不变量、分派规则与完成定义

### 2.1 不变量

1. canonical JSON、Markdown、JSONL、immutable Learning record 与 Memory 文件仍是事实来源。projection、partition、sealing、summary、`.bak`、journal、marker 和 private receipt 不得删除、覆盖或取代它们。
2. `possibly_published`、provider outcome unknown、损坏、identity conflict、越界路径和无法证明的 I/O 结果，均不得自动 retry、rollback、delete 或报告成功；获批 contract 必须给出唯一 disposition。
3. [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 的局部 durable scope、[ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md) 的 trace、[ADR-0006](adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) 的 readonly preflight，都不得被复用为 actionId、receipt、dedupe、transaction 或 destructive authorization。
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


### C-6：controlled legacy Memory migration

- **设计门：**[C-6 controlled migration 设计门](plans/local-data-memory-controlled-migration-design.md)。[ADR-0006](adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) 的 readonly aggregate preflight 不构成 destructive operation 的身份、同意或 recovery authority。
- **真实迁移的批准前提：**
  1. main-only trusted identity/scope authorization 与一次性、显式、可取消的 confirmation binding；不能从 preflight、startup、后台任务、settings、renderer path input 或自动 retry 推断 consent；
  2. descriptor-relative no-follow copy、exclusive destination create、durable publish、descriptor-bound delete 和 directory sync capability；不支持的平台必须 fail closed，不得退回 unrestricted path I/O；
  3. non-overwrite duplicate policy、private hold/backup 的 ownership/retention/cleanup/legal hold、delete 不可逆性与 partial-delete 的人工恢复责任；source 与 scoped target 同时存在或 source 不唯一时停止，不 merge/overwrite；
  4. 明确多文件 phase contract：copy → file `fsync` → internal checksum verify → durable hold publish/directory sync → explicit confirmation → fresh revalidation → durable non-overwrite scoped publish/directory sync → legacy delete → final receipt；receipt 只记录实际可证明 phase，不声称整体 atomicity；
  5. data-minimal audit/diagnostics、fuzz/fixture security tests 与 operations runbook，覆盖 unsafe/deep/symlink/unknown partition、scope mismatch、source drift、external edit、concurrency、disk-full、每阶段 crash、partial copy/delete、retry/idempotency 与 legacy tolerant read。
- **批准前唯一可讨论的最小切片：**main-only readonly dry-run intent/receipt preview：每次重新做 trusted-scope validation 和 readonly discovery，只给短期 aggregate-only intent state；不 copy、不创建 hold、不 publish、不 delete、不新增 renderer path input，并证明 canonical Memory bytes、mtime 与目录布局不变。
- **验收：**只有 destructive consent、capability、duplicate/hold/delete/recovery authority、每 phase crash behavior、non-leaking diagnostics 和人工恢复责任全部批准且验证后，才可开始真实 migration；不得启动、后台或自动迁移，也不得加入 candidate 明细或可枚举 source 列表。

## 4. 依赖与冲突检查

| 需求 | 未满足的依赖/约束 |
| --- | --- |
| P5H exact retry | 产品/API/privacy 对 mission actionId、receipt 与 recovery 的决定；不得复用 C-5I lesson receipt 语义。 |
| C-6 destructive migration | governance/explicit confirmation、descriptor-bound copy/delete/durability capability 与 recovery ownership。 |

任何工作流都不得通过复用既有 durable、trace 或 preflight 跨越上表依赖。若一个候选任务同时触及两个工作流，必须拆分为独立 proposal；没有获批的共同 protocol 时，不得称为 transaction 或统一 idempotency。

## 5. 更新与交接规则

- 新的长期有效、已采纳决定必须新增递增编号 ADR；已实施 scope、边界或验证入口变化必须更新对应 ADR；未关闭范围、blocker、依赖或实施顺序变化必须更新本页及对应 design gate。
- 本页只维护未关闭工作的分派信息，不维护已关闭切片、测试编号、实现细节或提交台账。
- 分派者关闭或拆分任务前，必须复查本页、对应 plan、相关 ADR 和实际代码；不得仅因测试绿色、最终文件存在或局部实现看似可用而关闭整个工作流。
