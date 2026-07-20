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

已结项 profile 的权威范围以本 ADR、[ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) 与 [ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md) 为准；运维参考见 [C-4P6 runbook](../operations/c4p6-learning-outcome-durable-settlement-runbook.md)。若要扩大到新的 OS、filesystem、durability claim、writer 或 public result，必须新建 ADR，并重新提供匹配声明的 host-native/operations evidence。

### C-4P8：Windows strict proposal 以“不支持”结项

当前 Windows/NTFS strict proposal 结项为 **unsupported / no-go**。已审计的 public Win32 API 不提供在实际 publish 点施加 expected final-leaf `FILE_ID_INFO` 的原子 compare-and-publish precondition；inspect-then-publish 仍有不可接受的 race。因此不实现替代的 pathname fallback、preflight-only CAS 或 strict-success result。

此决定不移除已经批准的 Windows direct-path non-CAS scope，也不把它重新命名为 strict。未来只有在独立 ADR 中给出受审计的 publish-point identity primitive、HANDLE-relative/reparse proof、flush/close contract，以及目标 Windows host-native evidence 后，才能开启新工作线。

### C-4P9：不扩张现有 fixed-file audit boundary

C-4P9 的 V1 fixed-file audit scope 以 [ADR-0019](0019-session-audit-v1-wire-contract-and-limited-authority.md) 和已实施的 append/dedupe boundary 结项；不批准将其扩张为 strict durable profile、generic JSONL、rotation、repair、cross-process multi-writer、archive transaction、IPC/UI 或 public result surface。

现有 audit 仍是 per-conversation、append-only、ordered-best-effort 的 session evidence：进程内同路径 queue 不是跨进程 exclusion，directory-sync warning 不是 strict/power-loss proof，audit outcome 也不决定 JSON、Markdown 或 learning-work ledger 的 authority。该边界不要求新增 writer 行为或 caller disposition。

若产品需要上述任何扩张，必须由新的 ADR 先定义 profile、single-/multi-writer protocol、failure/recovery matrix、archive caller disposition、privacy/operations owner 和所声明 profile 的 host-native evidence；不得把本结项解释为这些能力已经实现。

## 后果

1. `docs/local-data-todo.md` 不再列出 P6、P8 或 P9，因为它只记录仍可分派的开放工作。
2. 已结项 plan / capability audit 文档删除；长期有效决定与边界仅以本 ADR 及相关 ADR 为准。
3. 已有实现不因本 ADR 获得任何更强的 durability、transaction、CAS、recovery、retention 或 public API 声明。
