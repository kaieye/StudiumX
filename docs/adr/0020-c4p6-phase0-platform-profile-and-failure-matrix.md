# ADR-0020：C-4P6 Phase 0 platform profile 与 outcome settlement failure matrix 冻结

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** learning-outcome durable settlement 的首个目标 platform profile、I/O participant inventory、crash/failure/public-result matrix、manifest vs pathname publisher 边界、Windows/downgrade 限制与后续 phase 的停止条件。
- **取代：** 无
- **被取代：** 部分结项（受限 macOS/APFS profile 的 C-4P6 close-out 已由 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) 接受；本 ADR 是 Phase 0 决策冻结历史基线，**无生产行为变更**）。
- **相关：** [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)、[ADR-0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md)、[ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)
- **证据：** `src/main/learning-outcome-committer.ts`、`src/main/persistence/durable-file.ts`、`src/main/learning-session-ledger.ts`；完整 inventory 与 failure matrix 见 `docs/adr/evidence/ADR-0020.md`。

## 背景

C-4P6 已有 S1 生产基础（有序 publish + 受控 reconcile）与 S2…S194 tests-only residual，但关闭条件要求在**明确声明的 platform profile** 上补齐每个 durable 边界的 I/O、crash/recovery 与 public-result 语义。在未冻结 profile/matrix 前，任何 writer、schema、IPC 或“局部补测”都不得被解释为 close-out。

本 ADR 只冻结 Phase 0 决策与当前可审计基线。它不新增 public result，不引入跨文件 transaction，也不将 mock/unit residual 升级为 host-native / power-loss 证明。

## 决定

### 1. 首个目标 platform profile

| profile ID | 范围 | 允许的承诺 | 当前状态 |
|---|---|---|---|
| **P6-macOS-local-APFS-strict-candidate** | macOS（Darwin arm64 / macOS 26.x）、本地 APFS 卷、Node 22.x / Electron main、workspace 位于本机可写目录 | 仅当每个 canonical participant 的 **file sync + parent-directory sync + close** 在该 profile 上被 host-native 证据证明后，才允许宣称 **strict durable settlement success**。 | **已选为首个目标**；受限 close-out 证据已按 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) 接受（不宣称跨文件 transaction、Windows strict、reboot/power-loss）。 |
| **P6-Linux-local-posix-strict-candidate** | Linux local POSIX FS（hosted 证据可参考既有 C-4P8 Ubuntu path，但不自动继承给 P6） | 同上；须单独 host-native crash/restart 证据。 | 候选；未在本 Phase 0 关闭。 |
| **P6-Windows-degraded-non-strict** | Windows + Node directory `fsync` 不可用（生产路径显式 skip / warn） | **禁止** parent-directory durable closure 与 power-loss/strict claim；outcome settlement 可运行，但 post-publish unknown 必须走既有保守 public result。 | **非目标 strict profile**；与 C-4P8 Windows direct-path non-CAS 及 directory-fsync 限制一致。 |
| **P6-unsupported** | 网络盘、可移动盘、容器卷、未知 FS、无法 containment 的 root | 不提供 P6 durability claim。 | 产品 fail-closed / 禁用策略**尚未**单独批准。 |

**明确否决：** 不得以「Node 能运行」或任意 desktop OS 作为默认 strict profile；不得把 C-4P8 Windows direct-path、generic `replaceDurably` 的 Windows directory-fsync warning，或 immutable-record 的 Windows directory-sync skip 解释为 P6 strict / power-loss 证据；不得把 ADR-0004 的 S1 或 S2…S194 tests-only residual 解释为完整 settlement durability 或 Windows power-loss closure。

### 2. Canonical participants 与 publisher 边界（冻结）

一次 record-writing settlement 的有序 durable 边界为：① **stage**（非 authority）：`learning-records/.learning-outcome-committer-stage/<recordId>.<operationId>.md`，`open('wx')` + write + file `sync` + `close`；② **immutable Learning record**：`learning-records/outcome-<sessionId>.md`，`link(stage, record)` no-replace，parent directory **required** sync（生产 `win32` 默认路径 skip；注入 operations 保持严格）；③ **`outcome.json`**：pathname `replaceDurably()`（tmp `wx` + write + file sync + close → rename → parent directory sync，Windows default 路径 warning/skip）；④ **Session manifest `session.json`**：**ledger-owned** `durableAtomicReplaceFile`（`.manifest-stage-*` + rename + ledger `syncDirectory`，其 unsupported 集合可把 directory sync 标为 unsupported 并继续）；⑤ **settlement marker `outcome-settlement.json`**：pathname `replaceDurably()`，语义同 outcome；⑥ **catalog observation**：只读投影，失败不得反向改写 canonical。Recordless（`needs_practice` / `not_evidenced`）仅发布 **marker**；authority 见 ADR-0018。

**关键事实差距的冻结结论：** `session.json` 是 ledger 在同一 writer lock 内 `complete()` / `durableAtomicReplaceFile`，不是 committer 的 pathname `replaceDurably` 路径，Phase 1+ 必须把 ledger 的 stage/rename/file+dir sync/close 纳入同一 failure matrix；outcome/marker 为 pathname-based 共享 primitive，record stage/publish 为 committer 本地 `open`/`link` + required parent sync，Phase 1 目标是统一 Session-directory / records-directory containment contract，禁止 capability 失败后的未约束 pathname fallback；Windows generic-replace warning 与 immutable-record directory-sync skip 都是 **non-strict / no parent-directory durability proof**，在 P6-Windows-degraded 上允许运行与既有 learner-safe result、**禁止** strict success claim，post-publish I/O 不明仍映射既有 `retryable_failure: reconciliation_required` 或 `conflict: review_required`；**Phase 0 决定不需要新 public result**——保持现有 IPC enum，若未来 profile 证明需要 caller-visible `possibly_published` 或改变 retry 语义，必须先走独立 API/ADR compatibility gate。

### 3. Crash / failure / public-result matrix（最低关闭范围）

**Public result 契约（不变）：** success = `committed` | `already_committed`；`insufficient_evidence`（`not_evidenced` only）；`conflict: review_required`；`retryable_failure: reconciliation_required | temporarily_unavailable`；`non_retryable_failure: invalid_session | invalid_request | read_only | not_found`。Commit 错误映射（当前）：`writeAttempted === true` 的未知 I/O → `reconciliation_required`；写前未知 → `temporarily_unavailable`。Reconcile 状态：`settled` | `repaired` | `pending` | `review_required` | `read_only` | `not_found`。

**record-writing 有序 durable points：** 无 stage → 正常开始或输入错误；仅 stage → `reconciliation_required`（若已 writeAttempted），**不 promote stage / 不 re-evaluate / 不新 ID**；record 已发布、outcome/manifest/marker 缺 → **可能已发布**，以合法 immutable record 为 authority 按序补 outcome → matching Session complete → marker；record+outcome、Session/marker 缺 → complete matching Session 再补 marker，不得以 outcome 单独报 settled；record+outcome+completed Session、marker 缺 → 只补 matching marker，不 re-evaluate / 新 record；全部一致 → `committed` / retry → `already_committed`；任一 invalid / symlink-escape / digest 冲突 / 读写未知 → conflict 或 `reconciliation_required`，`review_required` + 最小 privacy-safe diagnostic。**禁止：** rollback、delete canonical、re-evaluate、新 operation/outcome ID、rewrite/delete/伪造 participant。

**recordless：** marker 前失败 → 非确定 completion，`pending`（无 marker、Session active、无 outcome），**禁止**写 record/outcome/completed Session；合法 marker（`record: null`）→ `committed` 或 `insufficient_evidence`（`not_evidenced`），`settled` 不补写其它 participant，**禁止** promote / fabricate formal record；marker 与 Session completed / outcome 存在 / writing kind / 非空 record 冲突 → conflict / `review_required`，禁止从 marker 合成缺失 formal participant。

**每个 phase 的最低失败处置（严格 profile 目标）：** root/capability 获取 → fail closed 不 publish；inspect/validate → review / 既有 controlled failure 不 rewrite；stage → 不进入 record publish；record publish（no-replace + parent durability 结束）→ 可能已发布则停下游、reconcile/review、不 rollback record；outcome publish → 不写 Session/marker、未知不报 settled；Session complete（ledger matching outcomeRef + file/parent/close 明确）→ 不写 marker、未知留给 reconcile/review；marker publish → 不返回确定 committed/insufficient 直至可证明；catalog → 不触发 canonical rewrite。

## 不变量

1. 本 ADR 只冻结 Phase 0 决策与基线；不新增 public result、不引入跨文件 transaction、不把 tests-only residual 升级为更强 host-native claim。
2. Directory-sync allowlist 不对齐是已记录的实现事实（`durable-file` 生产 win32 直接 skip + 固定 warning；注入路径非 win32 仅 `EINVAL|ENOSYS|ENOTSUP|EOPNOTSUPP|EISDIR` 可 warn-skip，`EPERM` 等 fatal；committer `syncDirectoryRequired` 生产 win32 skip 否则任何失败 fatal；ledger `syncDirectory` 在 `EISDIR|EPERM|EINVAL|ENOTSUP|EACCES` 上标 `unsupported` 后 return）；Windows skip **不构成** strict profile。
3. 受限 macOS/APFS profile 的 close-out 由 ADR-0035 结项；ADR-0004 的 S1 / S2…S194 tests-only residual 措辞保持。
4. 未知 publish 后状态仍按既有 `reconciliation_required` / `review_required` fail closed。
5. 立即停止并回到 design/API gate 的条件（仍适用）：需要新 public result、改变 retry 语义、schema/path/IPC、delete/retention、跨文件 transaction、catalog authority 反转，或无法在目标 profile 证明 parent traversal/directory durability 却仍想宣称 strict success。

## 后果

- C-4P6 工作线的**受限 macOS/APFS profile close-out** 见 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)；该结项**不是**当前可分派的开放实现 todo。
- 本 ADR **不**宣称跨文件 transaction、共同原子性、Windows strict、网络/可移动存储、reboot durability，或超出 ADR-0035 已接受 restricted profile 证据的 power-loss durability。
- 若要扩大到新的 OS、filesystem、durability claim、writer 或 public result，必须**新建 ADR** 并重新提供匹配声明的 host-native/operations evidence。

## 验证

- 定向 unit：`pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（历史基线 219 passed；S2…S194 residual）
- 定向 integration / IPC：`tests/integration/learning-outcome-commit.integration.test.ts`、`tests/integration/teaching-app-learning-outcome-commit.integration.test.ts`、`pnpm run check:learning-outcome-evaluator`、`node scripts/check-learning-record-evidence-gate.mjs`、`node scripts/check-teaching-app-commit-cutover.mjs`
- host-native crash/restart（已结项）：`node scripts/verify-c4p6-host-native.mjs` + process integration（见 ADR-0035）
- 完整 participant inventory、failure matrix 与 Phase 1 实现对齐：`docs/adr/evidence/ADR-0020.md`

## 非目标

- 不把 Phase 0 冻结本身等同于 unrestricted / multi-platform close-out；结项范围以 ADR-0035 的 restricted profile 为准。
- 不批准 Windows strict P6 profile，不批准 unsupported 环境的产品 fail-closed 策略细节。
- 不把 catalog、stage、UI 或「最终文件存在」提升为 authority。
- 不引入跨文件 transaction，不新增 public IPC result，不把 tests-only residual 升级为更强 host-native claim。
