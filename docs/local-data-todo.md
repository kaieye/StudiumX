# 本地数据：未关闭工作的分派入口

> **用途。** 本文只记录尚未关闭或尚未批准的本地数据工作：先确认 blocker、依赖和验收门，再进入对应 design gate；design gate 获批后才可另立实现任务。
>
> **已完成内容。** 已实施决定、受限 production scope 和验证入口以 [ADR 索引](adr/README.md)为准。本页不维护已关闭切片、实现细节、测试编号或提交台账，也不把局部 durable、trace 或 readonly preflight 误作完整 close-out、action identity、receipt 或 transaction。

## 1. 当前状态快照

| 工作流 | 状态 | 当前可分派范围 | 既有边界 |
| --- | --- | --- | --- |
| C-4P8 Windows strict durable profile | **未关闭：capability feasibility blocker** | 仅 strict profile 的平台/原语审计与设计。 | [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)；既有较弱 profile 不是 strict 关闭证据。 |
| C-4P6 learning-outcome durable settlement | **未关闭**（Phase 0+1+2 已落地） | Phase 3：host-native APFS profile 证据；Phase 4 ops/runbook。 | [ADR-0020](adr/0020-c4p6-phase0-platform-profile-and-failure-matrix.md)、[ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0011](adr/0011-evidence-gated-learning-outcome-settlement.md)、[ADR-0018](adr/0018-recordless-learning-outcome-marker-only-settlement-authority.md)；不得声称 transaction 或完整 settlement。 |
| C-4P9 session-audit durable append | **未关闭** | 每次仅分解并批准一个 generic JSONL、repair、rotation、跨文件或 operations contract。 | [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0019](adr/0019-session-audit-v1-wire-contract-and-limited-authority.md)；不得把 audit scope 扩大为 generic JSONL 或 transaction。 |
| C-5H workspace user mutation correlation | **未批准、未实现** | 先作 mission-first 的产品/API/privacy/operations 决策。 | [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md)；trace 不是 caller action identity 或 receipt。 |
| C-5I direct-UI lesson generation correlation | **NO-GO：未批准、未实现** | 先作 direct-UI action/retry/provider/receipt 决策。 | [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md)；不得把现有标识或 artifact 能力当 retry 证明。 |
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

### C-4P8：Windows strict durable profile

- **硬 blocker：**需要可审计的 Windows/NTFS publish primitive，在**实际 publish 点**施加 expected-target identity precondition（S3）。只在 publish 前读取 file ID 不能消除 inspect-to-publish race，不能关闭该 blocker。
- **当前 capability audit：**[Windows strict durable profile capability audit](plans/windows-strict-durable-profile-capability-audit.md) 审计到的 Win32 public primitives 没有可在 publish 点接受 expected `FILE_ID_INFO` 的 compare-and-publish precondition；因此 `P8-Windows-NTFS-strict` 仍为 **unsupported**，现有 native `ENOTSUP` fail-closed 行为不得替换为 pathname fallback 或 preflight-only check。
- **依赖与顺序：**
  1. 明确目标 Windows/NTFS（及支持的 storage）、Node/Electron/runtime 范围、strict 的可观察承诺和不支持时的 fail-closed result；
  2. 审计 HANDLE-relative、reparse-point/junction-safe parent traversal、final-leaf inspection，以及 atomic no-overwrite/restricted-overwrite（或 exchange）的 native API；
  3. 证明或否定 S3 identity-precondition primitive，并定义 metadata、file/parent-directory flush、close error 语义；
  4. 定义 reparse/leaf replacement、sharing/antivirus/lock、rename、flush/close、crash 的 adversarial matrix 与 host-native CI/reboot/power-loss 验证。
- **可分派的下一项：**在第 1 项获 owner 批准后，单独进行 native capability/audit 原型与 negative tests；原型未证明 S3 precondition 时，结论必须是“不支持 strict profile”，不得用降级实现关闭。
- **验收：**只有 end-to-end strict containment、publish-point identity precondition、获批的 atomic publish contract、目录 durability/error semantics 和目标 Windows host-native evidence 全部成立，才可关闭；否则保留为 blocker。

### C-4P6：learning-outcome durable settlement close-out

- **设计门：**[P6 剩余关闭工作](plans/local-data-learning-outcome-durable-settlement-design.md)。Phase 0 profile/matrix 已冻结于 [ADR-0020](adr/0020-c4p6-phase0-platform-profile-and-failure-matrix.md)。既有 authority、sole-writer 与受控 reconcile 以 [ADR-0011](adr/0011-evidence-gated-learning-outcome-settlement.md) 为准；recordless marker-only 见 [ADR-0018](adr/0018-recordless-learning-outcome-marker-only-settlement-authority.md)；局部 durable scope 不构成 P6 close-out，见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。
- **Phase 0 已关闭（决策 only，无生产变更）：**首个目标 `P6-macOS-local-APFS-strict-candidate`；Windows 为 degraded non-strict；pathname `replaceDurably` / ledger manifest / immutable record 的 publisher 边界与 directory-sync 不对齐已入库；不扩展 public IPC enum。
- **Phase 1 已落地（实现 + unit，非 close-out）：**共享 `settlement-directory-sync` allowlist；committer outcome/marker 经 `replaceContainedSettlementFile`；ledger 移除 EPERM/EACCES soft-downgrade；immutable record 仍 strict；`settlement-durable-io` unit + committer 219 / durable-file / ledger unit 绿。
- **Phase 2 已落地（实现 + unit/process，非 close-out）：**可归属 non-authority stage cleanup（不 promote）；cleanup failure soft/pending；recordless restart matrix；fresh-process integration worker；committer unit **222** + process integration **2** 绿。
- **Phase 3 已有 host-native evidence（非 close-out）：**`node scripts/verify-c4p6-host-native.mjs` 在 macOS internal APFS 上以 Electron embedded Node 运行 fresh-process crash/restart matrix，并输出 OS/FS/Node/Electron/volume profile；Windows strict/power-loss 仍非本项关闭条件（见 C-4P8）。
- **Phase 4 runbook 已交付（非 close-out）：**[operations runbook](operations/c4p6-learning-outcome-durable-settlement-runbook.md) 定义安装、restart、capacity、permission/lock、residual 与人工 review。
- **仍缺：**operations/support/release owner 对 runbook 和 profile evidence 的 acceptance，以及对 ADR-0004、ADR-0020、计划和本页的最终 close-out 审核。该入口不构成 reboot/power-loss 证据。
- **可分派的下一项：**Phase 3 host-native / runtime-adjacent crash-restart（对照 ADR-0020）；禁止 schema/IPC enum/transaction/delete。
- **验收：**Phase 3–4 对照 ADR-0020 matrix 与计划验收全部通过后，才可关闭 C-4P6 并删除计划文件。

### P9：session-audit durable append

- **设计门：**[P9 详细设计门](plans/local-data-session-audit-durable-append-design.md)。V1 wire/identity/exact-retry 与有限 authority 见 [ADR-0019](adr/0019-session-audit-v1-wire-contract-and-limited-authority.md)；局部 durable scope 见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。任何扩展不得改变既有 authority 或兼容边界，除非先获批准。
- **当前单一 proposal：**[fixed-file capability/result contract proposal](plans/c4p9-fixed-file-capability-result-proposal.md) 只准备 P9-2 的 internal disposition/failure matrix；它仍待 platform、single-writer、public-result 与 operations owner 批准，未授权 writer、IPC/UI、generic JSONL、rotation 或 repair 改动。
- **尚缺的批准输入（按顺序）：**
  1. **generic JSONL/rotation/repair：**先批准 generic API 和 audit compatibility contract，再定义 segment discovery、rotation trigger、repair authority/trigger、字节保留或损失政策、operator control 与 migration boundary；
  2. **capability/failure contract：**逐 I/O phase 给出 supported/degraded/fatal、possibly-appended、privacy-safe diagnostic 和唯一 recovery；
  3. **跨文件 authority：**任何超出 ordered best-effort 的承诺都必须先定义 JSON/Markdown/audit/ledger authority、partial-publish visibility、crash/retry、reconciliation、idempotency 和 final verification；
  4. **IPC/UI 与 operations：**先批准 repair/migration/rotation/conflict/durability-status surface、权限、stable states、observability、runbook、upgrade/rollback、capacity/retention、concurrency 与验收 owner；
  5. **Windows/power loss：**独立取得 Windows capability、file/directory flush/close、目标 filesystem 与 crash/reboot/power-loss 的实证。
- **可分派的下一项：**每次只选择一项 contract，先做 decision/failure matrix；不得将 generic migration、rotation、repair、IPC/UI 或跨文件语义顺带塞进 audit writer 改动。
- **验收：**所有扩大 scope 均有批准的 API/compatibility/operations contract 和相应 host-native evidence；不得以既有 audit 能力或局部测试替代这些证据。

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
| Windows strict P8 | 目标平台定义、native S3 identity-precondition primitive 与 host-native evidence。 |
| P6 manifest/settlement closure | 已批准的 session-directory capability、authority、逐 phase recovery 与 operations contract。 |
| P9 generic/repair/rotation 或跨文件语义 | audit compatibility、generic API、failure matrix、archive/ledger authority 与 operations approval。 |
| P5H/P5I exact retry | 产品/API/privacy 对 actionId、receipt、provider 与 recovery 的共同决定；每个 producer 保持独立 scope。 |
| C-6 destructive migration | governance/explicit confirmation、descriptor-bound copy/delete/durability capability 与 recovery ownership。 |

任何工作流都不得通过复用既有 durable、trace 或 preflight 跨越上表依赖。若一个候选任务同时触及两个工作流，必须拆分为独立 proposal；没有获批的共同 protocol 时，不得称为 transaction 或统一 idempotency。

## 5. 更新与交接规则

- 新的长期有效、已采纳决定必须新增递增编号 ADR；已实施 scope、边界或验证入口变化必须更新对应 ADR；未关闭范围、blocker、依赖或实施顺序变化必须更新本页及对应 design gate。
- 本页只维护未关闭工作的分派信息，不维护已关闭切片、测试编号、实现细节或提交台账。
- 分派者关闭或拆分任务前，必须复查本页、对应 plan、相关 ADR 和实际代码；不得仅因测试绿色、最终文件存在或局部实现看似可用而关闭整个工作流。
