# C-4P6 Learning outcome durable settlement：剩余关闭工作

> **状态：未关闭。** Phase 0 已写入 [ADR-0020](../adr/0020-c4p6-phase0-platform-profile-and-failure-matrix.md)；Phase 1 containment / 单文件 durable publish 对齐已落地（见下）。已实施 production / tests-only 历史证据以 [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 为准；authority 语义以 [ADR-0011](../adr/0011-evidence-gated-learning-outcome-settlement.md) / [ADR-0018](../adr/0018-recordless-learning-outcome-marker-only-settlement-authority.md) 为准。本文**只**保留 Phase 3–4 尚未关闭的实现与证据门。Phase 2 实现/unit/process 证据见下。

## 1. 关闭定义（仍有效）

C-4P6 在**已批准 profile** 上完成每个 durable 边界的可验证 I/O、crash/recovery 与 public-result 语义之前保持未关闭。仅有定向 unit/integration、静态 checker、提交记录或“最终文件存在”均不足。

**不在范围：**跨文件 transaction / post-publish rollback / delete-retention；新增 writer；改 assessment/Evidence/IPC public enum（除非独立 ADR/API gate）；将 Windows/网络盘等自动标为 strict-supported。

## 2. 已冻结基线（指针）

| 主题 | 权威 |
|---|---|
| 首个目标 profile、participant inventory、directory-sync 不对齐、public-result 不扩展 | [ADR-0020](../adr/0020-c4p6-phase0-platform-profile-and-failure-matrix.md) |
| 共享 durable publish；P6 S1 生产 / S2…S194 tests-only | [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) |
| Evidence 门控、有序 publish、reconcile、sole-writer | [ADR-0011](../adr/0011-evidence-gated-learning-outcome-settlement.md) |
| Recordless marker-only authority | [ADR-0018](../adr/0018-recordless-learning-outcome-marker-only-settlement-authority.md) |

**首个目标 profile：** `P6-macOS-local-APFS-strict-candidate`。
**Windows：** `P6-Windows-degraded-non-strict` only；directory-fsync skip/warning **不是** strict/power-loss 证据。
**Public IPC：** 不新增 `possibly_published`；未知 post-publish 继续用既有 `reconciliation_required` / `review_required`。

## 3. 不可变约束（摘要）

1. Authority 不倒置：record-writing 以合法 immutable record 为恢复依据；recordless 只接受 `record: null` marker。
2. identity 不重建：不 re-evaluate、不新 operation/outcome ID、不合并不同 attempt。
3. 未知即未结算：publish 后 I/O 不明不得确定成功 / 自动 retry publish / rollback。
4. 最小修复：只补齐可由 authority 唯一导出的缺失 participant；不覆盖冲突、不改 immutable record、不删 canonical。
5. 路径安全与隐私：containment / regular-file / no-follow；IPC/log 无 path、digest、assessment 内容。
6. 平台声明以证据为准：不得用 mock 或 POSIX 结论推导 Windows strict。

## 4. 剩余分阶段任务

### Phase 1 — Containment 与单文件 durable publish contract — **已落地（实现 + unit）**

**交付（2026-07-20，branch `database`；非 C-4P6 关闭）：**

| 工件 | 变更 |
|---|---|
| `src/main/persistence/settlement-directory-sync.ts` | 共享 soft-unsupported allowlist：`EINVAL\|ENOSYS\|ENOTSUP\|EOPNOTSUPP\|EISDIR`；生产 Windows skip 仅 default open + `allowWindowsProductionSkip` |
| `src/main/persistence/settlement-durable-io.ts` | Session parent real-dir containment；`replaceContainedSettlementFile`；失败后无 pathname fallback |
| `learning-outcome-committer` `durableReplace` | 绝对路径 → workspace-relative → `replaceContainedSettlementFile` |
| `durable-file.syncDirectory` | 委托 `syncSettlementDirectory` |
| ledger `syncDirectory` | 委托 `syncSettlementDirectory`（共享 soft allowlist + production Windows skip）；**移除** `EPERM|EACCES` soft-downgrade |
| immutable record `syncDirectoryRequired` | **保持 strict**（仅生产 win32 skip；无 soft allowlist） |
| tests | `tests/unit/settlement-durable-io.unit.test.ts`；既有 committer **219** / durable-file / ledger unit 绿 |

**明确未交付（仍属 Phase 2–4）：** host-native crash/restart、power-loss、operations runbook、C-4P6 close-out。无 schema / public IPC / transaction / delete 变更。

### Phase 2 — Crash/reconcile 完整化 — **实现 + unit/process 证据已落地（非 C-4P6 关闭）**

**交付（2026-07-20，branch `database`）：**

| 工件 | 变更 |
|---|---|
| `learning-outcome-committer.reconcileLocked` | 无合法 record 时 best-effort 清理 **可归属 non-authority stage**（`learning-outcome-<sessionId>-*.*.md`）；settled/repaired 路径同样清理；**从不 promote stage** |
| stage cleanup failure | soft：保留 residual、`pending`；**不** delete record/outcome/manifest/marker，**不** false success |
| unit | after-stage-flush restart 可 cleanup 后成功 commit；cleanup failure 保持 pending；recordless marker-pre-fail → pending → commit；recordless conflict → `review_required`；committer **222** passed |
| fresh-process | `tests/integration/learning-outcome-committer-process.integration.test.ts` + `scripts/fixtures/learning-outcome-committer-process-worker.ts`：跨进程 after-stage-flush cleanup+commit；after-record-publish repair；无 duplicate record |

**已有基线保留：** record-writing 有序 repair、invalid residual fail-closed、catalog observe-only、idempotent same-operation replay（既有 unit 矩阵）。

**明确未交付（仍属 Phase 3–4）：** host-native APFS power-loss / runtime-adjacent profile 证据、operations runbook、C-4P6 close-out。无 schema / public IPC / transaction / canonical delete 变更。

### Phase 3 — Host-native profile 证据 — **已有 macOS runtime-adjacent evidence（非 close-out）**

1. 在 `P6-macOS-local-APFS-strict-candidate` 上跑真实 FS 与 runtime-adjacent crash/restart；记录 OS/FS/Node/Electron/volume。
   - 执行入口：`node scripts/verify-c4p6-host-native.mjs`。该 verifier 只接受 macOS 内置 APFS volume，并以 `ELECTRON_RUN_AS_NODE` 运行 fresh-process crash/restart fixture；保存其 JSON profile 输出作为 release evidence。
2. Windows **不**在本 phase 关闭 strict；若测 degraded 行为，只能验证 non-strict contract 与“无 strict marketing”。
3. power-loss 结论仅在获批真实模型测试后写入。

### Phase 4 — Operations 与 close-out 审核 — **runbook 已交付；acceptance 仍缺**

1. runbook：fresh install、upgrade、partial settlement、crash/restart、disk-full、permission/lock、并发 retry、损坏 residual、catalog rebuild、人工 review；privacy-safe diagnostics。
   - 运维入口：[C-4P6 durable settlement runbook](../operations/c4p6-learning-outcome-durable-settlement-runbook.md)。operations/support/release owner 仍须接受该 runbook 与 profile evidence。
2. 若 Phase 1+ 无 schema/API/path 变更，显式记录“不需要 migration”；否则先 migration gate。
3. decision/implementation/operations owner 审核后更新 ADR-0004 / 本地数据待办；**仅此时**可关闭 C-4P6 并删除本文件。

## 5. 风险与停止条件

| 风险 | 缓解 |
|---|---|
| Pathname TOCTOU / symlink escape | Phase 1 Session parent containment 已落地；host-native + crash 仍属 Phase 2/3 |
| Manifest 与 committer publisher 异质 | 同一 matrix；未通过不得把 marker 当完整 settlement |
| Directory-sync allowlist 分裂 | soft set 已对齐 durable-file/ledger；record 仍 strict；Windows 仍 non-strict |
| 误将 unit residual 当运维证据 | Phase 3/4 host-native + operations |
| 需要新 public result | 先独立 ADR/API gate |

发现需改 schema/IPC/writer ownership/delete/catalog authority，或目标 profile 无法证明 directory durability 却要宣称 strict → **停止**当前切片。

## 6. 当前下一项

**Phase 3：**在 `P6-macOS-local-APFS-strict-candidate` 上补 host-native / runtime-adjacent crash-restart 与 profile 记录；Windows 仅 degraded non-strict。不得扩展 public IPC enum，不得引入 transaction/delete。

在 Phase 3–4 验收完成前，C-4P6 保持未关闭；本计划文件不得删除。
