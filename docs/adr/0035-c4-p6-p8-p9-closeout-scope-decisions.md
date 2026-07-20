# ADR-0035：C-4 P6 / P8 / P9 的范围结项决定

- **状态：**已采纳（2026-07-20）
- **范围：**只结项本 ADR 明确列出的 C-4P6、C-4P8 Windows strict proposal 与 C-4P9 durable-extension 工作线；不扩张任何现有 writer、wire、IPC、schema 或 canonical authority。

## 决定

### C-4P6：以受限 macOS/APFS profile 结项

`P6-macOS-local-APFS-strict-candidate` 的已实施有序 settlement/reconcile、fresh-process crash/restart 验证和 operations runbook 作为该工作线的 close-out evidence 被接受。验证入口是：

```sh
node scripts/verify-c4p6-host-native.mjs
pnpm exec vitest run --project integration \
  tests/integration/learning-outcome-committer-process.integration.test.ts
```

该结项只适用于 verifier 输出的本机 internal APFS repository 与 fixture volume。它不宣称跨文件 transaction、共同原子性、Windows strict、网络/可移动存储、reboot durability 或 power-loss durability。未知 publish 后状态仍按既有 `reconciliation_required` / `review_required` fail closed；不新增 public IPC result。

已结项 profile 的权威范围以本 ADR、[ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) 与 [ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md) 为准；运维步骤见下文「C-4P6 运维 runbook」。若要扩大到新的 OS、filesystem、durability claim、writer 或 public result，必须新建 ADR，并重新提供匹配声明的 host-native/operations evidence。

### C-4P8：Windows strict proposal 以“不支持”结项

当前 Windows/NTFS strict proposal 结项为 **unsupported / no-go**。已审计的 public Win32 API 不提供在实际 publish 点施加 expected final-leaf `FILE_ID_INFO` 的原子 compare-and-publish precondition；inspect-then-publish 仍有不可接受的 race。因此不实现替代的 pathname fallback、preflight-only CAS 或 strict-success result。

此决定不移除已经批准的 Windows direct-path non-CAS scope，也不把它重新命名为 strict。未来只有在独立 ADR 中给出受审计的 publish-point identity primitive、HANDLE-relative/reparse proof、flush/close contract，以及目标 Windows host-native evidence 后，才能开启新工作线。

### C-4P9：不扩张现有 fixed-file audit boundary

C-4P9 的 V1 fixed-file audit scope 以 [ADR-0019](0019-session-audit-v1-wire-contract-and-limited-authority.md) 和已实施的 append/dedupe boundary 结项；不批准将其扩张为 strict durable profile、generic JSONL、rotation、repair、cross-process multi-writer、archive transaction、IPC/UI 或 public result surface。

现有 audit 仍是 per-conversation、append-only、ordered-best-effort 的 session evidence：进程内同路径 queue 不是跨进程 exclusion，directory-sync warning 不是 strict/power-loss proof，audit outcome 也不决定 JSON、Markdown 或 learning-work ledger 的 authority。该边界不要求新增 writer 行为或 caller disposition。

若产品需要上述任何扩张，必须由新的 ADR 先定义 profile、single-/multi-writer protocol、failure/recovery matrix、archive caller disposition、privacy/operations owner 和所声明 profile 的 host-native evidence；不得把本结项解释为这些能力已经实现。

## 后果

1. 当前无开放 local-data 实现切片；P6、P8、P9 不再作为可分派实现工作（本 ADR 结项边界为准）。
2. 已结项 plan / capability audit / standalone operations 文档删除；长期有效决定、边界与运维步骤仅以本 ADR 及相关 ADR 为准。
3. 已有实现不因本 ADR 获得任何更强的 durability、transaction、CAS、recovery、retention 或 public API 声明。

## C-4P6 运维 runbook

> **Scope:** `P6-macOS-local-APFS-strict-candidate` only. This runbook is Phase-4 operational material absorbed into this ADR; it does not claim a transaction, Windows strict support, reboot durability, or power-loss durability.

### Ownership and stop conditions

| Responsibility | Required owner action |
| --- | --- |
| Release owner | Runs the host-native verifier before a release that claims the candidate profile. Captures its one-line JSON profile record with the release evidence. |
| Operations owner | Accepts the incident/recovery steps below and records the escalation contact before any close-out review. |
| Support owner | Collects only stable status/stage/error category; never collect assessment content, record text, operation/outcome IDs, paths, hashes, or raw error messages. |

Stop automatic processing and retain all existing canonical files whenever the outcome is `reconciliation_required`, `review_required`, an identity conflict, a path/regular-file failure, an unknown I/O outcome, a lock/permission failure, or a corrupt residual. Do **not** retry with a new identity, overwrite an immutable record, delete canonical files, or claim success from final-file presence.

### Pre-release host-native evidence

On the release candidate machine, from the repository root with dependencies installed:

```sh
pnpm run build:contained-durable-replace
node scripts/verify-c4p6-host-native.mjs
```

The verifier refuses non-macOS, non-APFS, and non-internal volumes. It reports the OS release, architecture, Node, Electron, filesystem and storage classification, then runs the fresh-process crash/restart matrix under Electron's embedded Node runtime. Archive its JSON output and the command result with the release record.

The verifier covers an intentional process termination after stage flush and after immutable-record publish, then a fresh process reconcile/replay. It does **not** simulate reboot, device removal, filesystem corruption, or power loss. Those claims remain prohibited unless separately approved and evidenced.

### Installation, upgrade and downgrade

1. **Fresh install:** create/open the workspace using the normal main-process flow; do not seed settlement markers, ledgers, records, or stage files manually.
2. **Upgrade:** deploy the release normally. The current Phase-1/2 changes add no public IPC/schema/path migration; no migration action is required. Existing settlement state must be reconciled by the owned committer rather than rewritten.
3. **Downgrade:** do not use a downgrade as a recovery mechanism. If an older build cannot interpret observed state, stop and escalate; preserve the workspace and record the version boundary without copying content into diagnostics.

### Incident playbooks

#### Crash or restart during settlement

1. Restart the application; do not delete `.learning-outcome-committer-stage` residuals.
2. Let the normal committer/reconcile path inspect the immutable record and marker authority.
3. If it returns `pending`, retain residuals and retry only the same user operation through the normal UI/main flow. If it returns `repaired`, verify only the stable state and continue. If it returns `review_required` or `reconciliation_required`, stop and escalate.
4. Never create a new operation/outcome ID to force a retry, and never promote a stage file manually.

#### Disk full, permission denied, sharing/lock failure

1. Return/record a stable failure category; do not infer whether a post-publish write succeeded.
2. Restore capacity or access outside the application. Do not remove records, markers, ledger entries, or stage files to make space.
3. Retry only after the prerequisite is resolved and only with the original operation identity. Any unknown post-publish result stays in review/reconciliation.

#### Corrupt residual, identity conflict, or catalog mismatch

1. Preserve the workspace in place and stop automatic settlement for the affected session.
2. Capture data-minimal incident facts: release version, profile class, stable state/result, and event time. Exclude user data and filesystem locators.
3. Escalate to the operations owner for authority-guided manual review. The catalog is observe-only; it must not be used to synthesize a record, outcome, marker, or repair.

#### Concurrent retry

Use only the standard main-process path. If a concurrent call cannot prove the original identity or reports an unavailable writer/lock, stop rather than requeueing an altered request. No cross-process transaction or lock guarantee is asserted by this runbook.

### Close-out checklist

- [x] Host-native verifier output is recorded for every profile claimed as supported.
- [x] Operations, support and release owners have accepted this runbook and its escalation route.
- [x] No schema/API/path migration was introduced; if that changes, an independent migration gate is approved first.
- [x] Matrix evidence covers the claimed runtime-adjacent crash/restart behavior; any untested reboot/power-loss claim is removed.
- [x] ADR-0004 and ADR-0020 are reviewed together with this ADR before changing P6 status.
