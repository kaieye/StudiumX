# ADR-0020：C-4P6 Phase 0 platform profile 与 outcome settlement failure matrix 冻结

- **状态：** 已采纳（Phase 0 decision freeze；**无生产行为变更**；不关闭 C-4P6）
- **范围：** learning-outcome durable settlement 的首个目标 platform profile、I/O participant inventory、crash/failure/public-result matrix、manifest vs pathname publisher 边界、Windows/downgrade 限制与后续 phase 的停止条件
- **证据提交：** 本 ADR（决策记录）；实现与 tests 仍以 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADR-0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md) 为准

## 背景

C-4P6 已有 S1 生产基础（有序 publish + 受控 reconcile）与 S2…S194 tests-only residual，但关闭条件要求在**明确声明的 platform profile** 上补齐每个 durable 边界的 I/O、crash/recovery 与 public-result 语义。在未冻结 profile/matrix 前，任何 writer、schema、IPC 或“局部补测”都不得被解释为 close-out。

本 ADR 只冻结 Phase 0 决策与当前可审计基线。它不新增 public result，不引入跨文件 transaction，也不将 mock/unit residual 升级为 host-native / power-loss 证明。

## 决定

### 1. 首个目标 platform profile

| profile ID | 范围 | 允许的承诺 | 当前状态 |
|---|---|---|---|
| **P6-macOS-local-APFS-strict-candidate** | macOS（本机审计宿主：Darwin arm64 / macOS 26.x）、本地 APFS 卷、Node 22.x / Electron main、workspace 位于本机可写目录 | 仅当每个 canonical participant 的 **file sync + parent-directory sync + close** 在该 profile 上被 host-native 证据证明后，才允许宣称 **strict durable settlement success**。 | **已选为首个目标**；capability/matrix 已冻结，**strict 证据未关闭**。 |
| **P6-Linux-local-posix-strict-candidate** | Linux local POSIX FS（hosted 证据可参考既有 C-4P8 Ubuntu path，但不自动继承给 P6） | 同上；须单独 host-native crash/restart 证据。 | 候选；未在本 Phase 0 关闭。 |
| **P6-Windows-degraded-non-strict** | Windows + Node directory `fsync` 不可用（生产路径显式 skip / warn） | **禁止** parent-directory durable closure 与 power-loss/strict claim。outcome settlement 可运行，但 post-publish unknown 必须走既有保守 public result（见下），不得因“文件最终存在”报 strict success。 | **非目标 strict profile**；与 [C-4P8](0004-shared-durable-publish-and-partial-consumer-migration.md) Windows direct-path non-CAS 及 directory-fsync 限制一致。 |
| **P6-unsupported** | 网络盘、可移动盘、容器卷、未知 FS、无法 containment 的 root | 不提供 P6 durability claim。 | 产品 fail-closed / 禁用策略**尚未**单独批准；在批准前不得 marketing 为 supported。 |

**明确否决：**

- 不得以 “Node 能运行” 或任意 desktop OS 作为默认 strict profile。
- 不得把 C-4P8 Windows direct-path、generic `replaceDurably` 的 Windows directory-fsync warning，或 immutable-record 的 Windows directory-sync skip 解释为 P6 strict / power-loss 证据。
- 不得把 ADR-0004 的 S1 或 S2…S194 tests-only residual 解释为完整 settlement durability 或 Windows power-loss closure。

### 2. Canonical participants 与 publisher 边界（冻结）

一次 record-writing settlement 的有序 durable 边界为：

1. **stage**（非 authority）：`learning-records/.learning-outcome-committer-stage/<recordId>.<operationId>.md`，`open('wx')` + write + file `sync` + `close`
2. **immutable Learning record**：`learning-records/outcome-<sessionId>.md`，`link(stage, record)` no-replace；parent directory **required** sync（生产 `win32` 默认路径 skip；注入 operations 保持严格）
3. **`outcome.json`**：pathname `replaceDurably()`（tmp `wx` + write + file sync + close → rename → parent directory sync，Windows default 路径 warning/skip）
4. **Session manifest `session.json`**：**ledger-owned** `durableAtomicReplaceFile`（`.manifest-stage-*` + rename + ledger `syncDirectory`，其 unsupported 集合可把 directory sync 标为 unsupported 并继续；见 inventory）
5. **settlement marker `outcome-settlement.json`**：pathname `replaceDurably()`，语义同 outcome
6. **catalog observation**：只读 projection；失败不得反向改写 canonical

Recordless（`needs_practice` / `not_evidenced`）仅发布 **marker**；authority 见 [ADR-0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md)。

**关键事实差距的冻结结论：**

| 问题 | Phase 0 结论 |
|---|---|
| `session.json` 如何在 outcome 顺序中获得与 record/outcome/marker 一致的 durability evidence？ | Manifest **不是** committer 的 pathname `replaceDurably` 路径；它是 **ledger 在同一 writer lock 内** 的 `complete()` / `durableAtomicReplaceFile`。Phase 1+ 必须把 ledger 的 stage/rename/file+dir sync/close 纳入**同一** failure matrix，而不是假设与 marker 同质。 |
| pathname `replaceDurably()` 与 Session/record directory capability 如何对齐？ | 当前 outcome/marker 为 **pathname-based** 共享 primitive；record stage/publish 为 committer 本地 `open`/`link` + required parent sync；manifest 为 ledger identity-checked stage/rename。Phase 1 的目标是统一 **Session-directory / records-directory containment contract**，禁止 capability 失败后的未约束 pathname fallback。 |
| Windows generic-replace warning vs immutable-record directory-sync skip 的产品语义？ | 二者都是 **non-strict / no parent-directory durability proof**。在 P6-Windows-degraded 上：允许运行与既有 learner-safe result；**禁止** strict success claim；post-publish I/O 不明仍映射既有 `retryable_failure: reconciliation_required` 或 `conflict: review_required`，**不**新增 `possibly_published` public status（须另走 API/ADR gate）。 |
| close / directory-sync / reread / cleanup 在“可能已发布”窗口的唯一 recovery？ | 见第 3 节 matrix：一旦 publish 可能发生，停止下游 canonical write；public 使用既有 `reconciliation_required`（commit 路径、writeAttempted）或 reconcile 的 `settled` / `repaired` / `pending` / `review_required` / `read_only` / `not_found`；**禁止** rollback、delete canonical、re-evaluate、新 operation/outcome ID。 |
| 是否需要新 public result？ | **Phase 0 决定：否。** 保持现有 IPC enum。若未来 profile 证明需要 caller-visible `possibly_published` 或改变 retry 语义，必须先独立 API/ADR compatibility gate。 |

### 3. I/O participant inventory（当前实现，非新 API）

代码入口：`src/main/learning-outcome-committer.ts`、`src/main/persistence/durable-file.ts`、`src/main/learning-session-ledger.ts`。

| participant | 路径（相对 workspace） | 机制 | open/sync/close owner | containment 现状 | platform downgrade |
|---|---|---|---|---|---|
| records dir / stage dir | `learning-records/`、`.../.learning-outcome-committer-stage/` | `mkdir` recursive | committer | 读路径：`lstat`+`realpath` 校验 records dir；写路径主要为 pathname | 无 directory capability handle |
| record stage file | `learning-records/.learning-outcome-committer-stage/<recordId>.<operationId>.md` | `open wx` 0600 → write → file sync → close | committer `durableStage` | no-clobber；预存在 stage 不覆盖 | 无 |
| immutable record | `learning-records/outcome-<sessionId>.md` | `link(stage,record)`；EEXIST 且 content match 则 parent sync + unlink stage | committer `publishImmutable` | no-replace；读侧 regular-file + parent revalidate | **生产 win32：parent directory sync skip**；注入 ops 严格 |
| outcome envelope | `learning-sessions/<sessionId>/outcome.json` | `replaceDurably` pathname | durable-file | pathname；mkdir parent | **生产 win32：directory fsync warning + skip**；注入 ops 上 unsupported errno 可 warn skip，其它 fatal |
| session manifest | `learning-sessions/<sessionId>/session.json` | ledger `durableAtomicReplaceFile`（manifest stage → rename → `syncDirectory`） | ledger | directory identity capture/assert + realpath containment | ledger `directorySync` 可在 EISDIR/EPERM/EINVAL/ENOTSUP/**EACCES** 上标 unsupported 并 **return**（比 durable-file allowlist 更宽） |
| settlement marker | `learning-sessions/<sessionId>/outcome-settlement.json` | `replaceDurably` pathname | durable-file | 同 outcome | 同 outcome |
| writer lock | ledger filesystem lock under sessions root | lock acquire/release + dir sync | ledger | workspace-scoped queue + lock file | 同 ledger directory sync |
| catalog | learning asset catalog | read-only observation | committer `catalogHas` | n/a | catalog 失败不得改 canonical；commit 成功路径若 catalog 观察失败仍受既有 error mapping 约束 |

**Directory-sync allowlist 不对齐（已记录，Phase 1 必须处理或显式产品接受）：**

- `durable-file.syncDirectory` 生产 win32：直接 skip + 固定 warning。
- `durable-file` 注入路径 / 非 win32：仅 `EINVAL|ENOSYS|ENOTSUP|EOPNOTSUPP|EISDIR` 可 warn-skip；`EPERM` 等 fatal。
- committer `syncDirectoryRequired`（immutable record）：生产 win32 skip；否则任何 sync/close 失败 fatal（无 soft allowlist）。
- ledger `syncDirectory`：`EISDIR|EPERM|EINVAL|ENOTSUP|EACCES` → settlement.directorySync=`unsupported` 后 return。

Phase 0 **不**修改上述实现对齐；只冻结“它们当前不同，且 Windows skip 不能构成 strict profile”。

### 4. Crash / failure / public-result matrix（最低关闭范围）

#### 4.1 Public result 契约（不变）

Learner-safe / IPC 结果保持：

- success：`committed` | `already_committed`
- `insufficient_evidence`（`not_evidenced` only）
- `conflict: review_required`
- `retryable_failure: reconciliation_required | temporarily_unavailable`
- `non_retryable_failure: invalid_session | invalid_request | read_only | not_found`

Commit 错误映射（当前）：`writeAttempted === true` 的未知 I/O → `reconciliation_required`；写前未知 → `temporarily_unavailable`；ledger/identity/corrupt → conflict 或 non-retryable 既有码。

Reconcile 状态：`settled` | `repaired` | `pending` | `review_required` | `read_only` | `not_found`。

#### 4.2 record-writing：有序 durable points

| 可观察状态 | 是否可能已发布 | commit public（写中断） | restart 后 `reconcile()` 唯一允许动作 | 禁止 |
|---|---|---|---|---|
| 无 stage | 否 | 既有输入/暂时失败 | 正常开始或输入错误 | 伪造 participant |
| 仅 stage | 否（stage 非 authority） | `reconciliation_required` 若已 writeAttempted | 不 promote stage；不 re-evaluate；不新 ID；Session 保持 active（cleanup 仅可处理可归属 non-authority stage，且 cleanup 失败不得 false success / canonical delete） | promote stage |
| record 已发布，outcome/manifest/marker 缺 | **是（record）** | `reconciliation_required` | 以 **合法 immutable record** 为 authority，按序补 outcome → matching Session complete → marker | 覆盖 record；冲突 participant rewrite |
| record+outcome，Session/marker 缺 | 是 | `reconciliation_required` | complete matching Session，再补 marker | 以 outcome 单独报 settled |
| record+outcome+completed Session，marker 缺 | 是 | `reconciliation_required` | 只补 matching marker | re-evaluate / 新 record |
| 全部一致 | 是 | `committed` / retry → `already_committed` | `settled`；catalog 仅观察 | 第二 record / duplicate completion |
| 任一 invalid / symlink-escape / digest 冲突 / 读写未知 | 可能 | conflict 或 `reconciliation_required` | `review_required`；最小 privacy-safe diagnostic | rewrite、delete、rollback、re-evaluate |

#### 4.3 recordless

| 可观察状态 | commit public | `reconcile()` | 禁止 |
|---|---|---|---|
| marker 前失败 | 非确定 completion | `pending`（无 marker、Session active、无 outcome） | 写 record/outcome/completed Session |
| 合法 marker（`record: null`） | `committed` 或 `insufficient_evidence`（`not_evidenced`） | `settled`；不补写其它 participant | promote / fabricate formal record |
| marker 与 Session completed / outcome 存在 / writing kind / 非空 record 冲突 | conflict | `review_required` | 从 marker 合成缺失 formal participant |

#### 4.4 每个 phase 的最低失败处置（严格 profile 目标）

| phase | 严格成功 | 失败最低要求 |
|---|---|---|
| root / capability 获取 | 已验证 contained parent capability | fail closed，不 publish |
| inspect/validate | regular file/dir、identity、schema、digest | review / 既有 controlled failure；不 rewrite |
| stage | wx write + file sync + close | 不进入 record publish |
| record publish | no-replace + parent durability 结束 | 可能已发布 → 停下游；reconcile/review；不 rollback record |
| outcome publish | replace + parent durability + 可证明 envelope | 不写 Session/marker；未知不报 settled |
| Session complete | ledger matching outcomeRef + file/parent/close 明确 | 不写 marker；未知留给 reconcile/review |
| marker publish | replace + parent durability + close | 不返回确定 committed/insufficient 直至可证明 |
| catalog | 观察 only | 不触发 canonical rewrite |

### 5. 测试与证据边界（Phase 0 冻结，非 release gate）

| 层级 | 当前状态 | 可否关闭 C-4P6 |
|---|---|---|
| 定向 unit | `tests/unit/learning-outcome-committer.unit.test.ts` 历史基线 219 passed（S2…S194 residual） | **否** |
| 定向 integration / IPC | ADR-0011 所列 integration + cutover checkers | **否** |
| host-native crash/restart on P6-macOS-local-APFS-strict-candidate | **未交付** | 关闭前 **必须** |
| Windows power-loss / strict directory durability | **未交付且非本 profile 目标** | 不得宣称 |
| operations runbook 演练 | **未交付** | 关闭前 **必须**（Phase 4） |

历史命令（定向，非 full suite）：

```sh
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
pnpm exec vitest run --project integration tests/integration/learning-outcome-commit.integration.test.ts tests/integration/teaching-app-learning-outcome-commit.integration.test.ts
pnpm run check:learning-outcome-evaluator
node scripts/check-learning-record-evidence-gate.mjs
node scripts/check-teaching-app-commit-cutover.mjs
```

### 6. 后续 phase 授权边界与停止条件

在本 ADR 下：

- **Phase 1 已落地（见后果补充）：** containment / 单文件 durable publish 对齐；**不得** retroactively 扩大为 schema、canonical path、public IPC enum、writer ownership、delete/rollback 变更。
- **允许** Phase 2 补全 crash/reconcile 证据（含 ledger manifest 窗口），仍禁止跨文件 transaction。
- **允许** Phase 3 仅对该 profile 收集 host-native 证据；Windows strict 仍归 C-4P8 / 独立 blocker。
- **允许** Phase 4 operations readiness。

**立即停止并回到 design/API gate 的条件：**

- 需要新 public result、改变 retry 语义、schema/path/IPC、delete/retention、跨文件 transaction、catalog authority 反转，或无法在目标 profile 证明 parent traversal/directory durability 却仍想宣称 strict success。

## 后果

- C-4P6 **仍未关闭**。本 ADR 关闭 Phase 0 “决策与基线冻结”门；Phase 1 实现对齐见下文补充，不改变本 matrix 的 profile / public-result 边界。
- ADR-0004 的 S1 / S2…S194 措辞保持：tests-only residual ≠ close-out。

### Phase 1 实现对齐（2026-07-20，非 close-out）

在本 ADR 授权范围内已落地：

- 共享 soft-unsupported directory-sync allowlist：`EINVAL|ENOSYS|ENOTSUP|EOPNOTSUPP|EISDIR`（`settlement-directory-sync.ts`）。
- committer `outcome.json` / `outcome-settlement.json` 经 Session parent real-dir containment 后再 `replaceDurably`；containment 失败 fail-closed，无 pathname fallback。
- `durable-file.syncDirectory` 与 ledger soft path 对齐上述 allowlist；ledger **不再** soft-downgrade `EPERM|EACCES`。
- immutable record `syncDirectoryRequired` 仍 strict（仅生产 win32 skip）。
- unit：`settlement-durable-io` + committer 219 + durable-file + ledger 定向 suite 绿。

**仍未交付：** host-native crash/restart、power-loss、operations runbook、C-4P6 关闭。

## 不包含

- 不关闭 C-4P6；不加 host-native 测试、不写 operations runbook。
- 不批准 Windows strict P6 profile，不批准 unsupported 环境的产品 fail-closed 策略细节。
- 不把 catalog、stage、UI 或 “最终文件存在” 提升为 authority。

## 相关 ADR / 文档

- [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)
- [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)
- [ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)
- [ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)
- [ADR-0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md)
- [本地数据待办](../local-data-todo.md)
- [C-4P6 关闭计划](../plans/local-data-learning-outcome-durable-settlement-design.md)（仅保留 Phase 1+ 未决项）
