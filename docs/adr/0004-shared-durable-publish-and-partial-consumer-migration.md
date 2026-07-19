# ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer

- **状态：** 已实施（部分 consumer migration；包含 C-4P6-S1 的受限基础、C-4P6-S2/C-4P6-S3/C-4P6-S4/C-4P6-S5/C-4P6-S6/C-4P6-S7/C-4P6-S8/C-4P6-S9/C-4P6-S10/C-4P6-S11/C-4P6-S12/C-4P6-S13/C-4P6-S14/C-4P6-S15/C-4P6-S16/C-4P6-S17/C-4P6-S18 tests-only evidence、C-4P8-S1/S2/S3 foundation、C-4P8-S4 受控 `write_workspace_file` 文本文件 create / restricted-overwrite closure、经明确批准的 Windows direct-path non-CAS profile，以及 C-4P9-S2 audit 专用 durable append、P9-S3/P9-S4/P9-S5/P9-S6/P9-S7/P9-S8/P9-S9/P9-S10/P9-S11/P9-S12/P9-S13/P9-S14/P9-S15/P9-S16/P9-S17/P9-S18/P9-S19 tests-only evidence）
- **范围：** C-4、C-4P0、C-4P1、C-4P2A、C-4P2B、C-4P3、C-4P4、C-4P5、C-4P6-S1、C-4P6-S2（tests-only evidence）、C-4P6-S3（tests-only evidence）、C-4P6-S4（tests-only evidence）、C-4P6-S5（tests-only evidence）、C-4P6-S6（tests-only evidence）、C-4P6-S7（tests-only evidence）、C-4P6-S8（tests-only evidence）、C-4P6-S9（tests-only evidence）、C-4P6-S10（tests-only evidence）、C-4P6-S11（tests-only evidence）、C-4P6-S12（tests-only evidence）、C-4P6-S13（tests-only evidence）、C-4P6-S14（tests-only evidence）、C-4P6-S15（tests-only evidence）、C-4P6-S16（tests-only evidence）、C-4P6-S17（tests-only evidence）、C-4P6-S18（tests-only evidence）、C-4P7、C-4P8-S1、C-4P8-S2、C-4P8-S3、C-4P8-S4、Windows direct-path non-CAS profile、C-4P9-S2、C-4P9-S3（tests-only evidence）、C-4P9-S4（tests-only evidence）、C-4P9-S5（tests-only evidence）、C-4P9-S6（tests-only evidence）、C-4P9-S7（tests-only evidence）、C-4P9-S8（tests-only evidence）、C-4P9-S9（tests-only evidence）、C-4P9-S10（tests-only evidence）、C-4P9-S11（tests-only evidence）、C-4P9-S12（tests-only evidence）、C-4P9-S13（tests-only evidence）、C-4P9-S14（tests-only evidence）、C-4P9-S15（tests-only evidence）、C-4P9-S16（tests-only evidence）、C-4P9-S17（tests-only evidence）、C-4P9-S18（tests-only evidence）、C-4P9-S19（tests-only evidence）
- **证据提交：** `ca73537`、`5c0dd96`、`34c48f4`、`b8eb3ab`、`70afe1d`、`99bf6fe`、`f8ad99c`、`278f141`、`7292bf4`、`e02a086`、`9847842`、`1334513`、`0d55fd8`、`80f2fd0`、`e2ce36c`、`b46c8b2`、`bdcd6cb`、`56eabe6`、`54506d5`、`ed8d88a`、`9c452f3`、`0bbfdef`、`e84c813`、`4b30220`、`5f47382`、`c286a42`、`ab723a6`、`47393f9`、`c97146e`、`e821c69`、`ebd084c`、`5f931c9`、`145b671`、`816e403`、`d26bb83`、`bee173f`、`e743a3e`、`dcb9bae`、`a631a31`、`9d54c5e`、`6bfffc5`、`4603601`、`60b6791`、`bab5d1e`、`2aec1bc`、`5e35703`、`e1f0563`、`be460a4`、`f90a863`、`8779879`、`3568673`、`5fb4f04`、`07ecb54`、`85840ae`、`8848af7`、`14fa960`、`54cec58`、`94e686f`、`529febd`

## 决定

以共享 durable-file capability 承担经过审查的关键文件 replace / publish 语义，并逐项迁移 consumer；每个 consumer 保留自身的 canonical authority、路径约束和错误语义。C-4 的完成含义是“共享原语及下列 consumer 已迁移”，**不是所有 writer 已迁移**，也不构成跨文件事务。

`C-4P6-S1` 已实施的范围仅为 **严格有序发布与受控恢复基础**。它不是完整的 C-4P6；不提供跨文件事务或共同原子性，也不构成完整 durable closure。

## 已迁移 consumer 与验证入口

| 切片 | 已迁移范围 | 主要验证入口 |
| --- | --- | --- |
| C-4P0 `5c0dd96` | canonical `.studiumx/progress.json` review publish | `tests/unit/teaching-workspace-review-durable.unit.test.ts` |
| C-4P1 `34c48f4` | conversation archive canonical JSON / Markdown publish | `tests/unit/agent-conversation-archive-durable.unit.test.ts` |
| C-4P2A `b8eb3ab` | workspace `MISSION.md` | `tests/unit/teaching-workspace-mission-durable.unit.test.ts` |
| C-4P2B `70afe1d` | workspace `assets/lesson.css` | `tests/unit/teaching-workspace-lesson-style-durable.unit.test.ts` |
| C-4P3 `99bf6fe` | cross-workspace change history `history.json` | `tests/unit/teaching-workspace-change-history-durable.unit.test.ts`、`tests/integration/teaching-workspace-change-audit.integration.test.ts` |
| C-4P4 `f8ad99c` | `.agent-sessions/session-open-state.v1.json` sidecar | `tests/unit/agent-conversation-session-tree-durable.unit.test.ts` |
| C-4P5 `278f141` | `TeachingWorkspaceDocuments` allowlisted workspace Markdown | `tests/unit/teaching-workspace-documents-durable.unit.test.ts`、`tests/integration/teaching-workspace-documents.integration.test.ts` |
| C-4P6-S1 `7292bf4`、`e02a086` | learning-outcome 的严格有序 publish、受控 reconcile 与失败关闭基础 | `tests/unit/learning-outcome-committer.unit.test.ts`、`tests/unit/teaching-workspace-outcome-commit.unit.test.ts`；相关提交覆盖 41 项单元检查和 14 项集成检查 |
| C-4P6-S2 `9847842` | **tests-only evidence**：仅覆盖单一 `after_outcome_publish` crash window 的重启恢复；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、28 tests passed；另通过 typecheck、security check、diff check |
| C-4P6-S3 `1334513` | **tests-only evidence**：现有 settlement-marker durable rename 返回 `EIO` 后，immutable record、`outcome.json` 与已 `completed` 的 manifest 存在而 marker 为 `ENOENT`；重启 reconcile 以 immutable record authority 仅发布 marker，evaluator / `createId` 不重跑，record/outcome/manifest 不重写；第二次 reconcile 与同 operation replay 的四份 canonical bytes 稳定。该提交只扩展同一个既有 unit `it`，不是新增 test count；无 production/API/schema/path/order 变化 | 同一 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；仍为 1 file、28 tests passed；另通过 typecheck、security check、diff check |
| C-4P6-S4 `e821c69` | **tests-only evidence**：新增独立 `it`，仅覆盖已有 `after_settlement_marker` 的一次中断；marker 的 canonical rename 在当前平台 capability policy 规定的 durable primitive 完成后可见，且未到达 `before_catalog_reconcile`；restart `reconcile()` 返回 `settled` 而不是 `repaired`，recovery 不调用 evaluator / `createId`，不产生 durable write / rename / publish，immutable record、outcome、completed manifest、marker 四份 canonical bytes 稳定；同 operation replay 返回 `already_committed`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、29 tests passed |
| C-4P6-S5 `ebd084c` | **tests-only evidence**：新增独立 `it`，仅覆盖已有 `before_catalog_reconcile` 的一次中断；`injectedPoints` 完整有序前缀为 `after_stage_flush` → `after_record_publish` → `after_outcome_publish` → `after_settlement_marker` → `before_catalog_reconcile`；初次 commit 返回 `retryable_failure/reconciliation_required` 且四份 durable 产物已存在；restart `reconcile()` 返回 `settled` 而不是 `repaired`，recovery 不调用 evaluator / `createId`，不产生 durable write / rename / publish，四份 canonical bytes 稳定；同 operation replay 返回 `already_committed`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、30 tests passed |
| C-4P6-S6 `145b671` | **tests-only evidence**：新增独立 `it`，仅覆盖 `after_stage_flush` 中断；stage 保留而 record/outcome/marker 缺失，manifest 保持 active；restart reconcile 为 `pending` 且无 durable write；同 operation re-commit fail closed 于既有 exclusive stage，不 promote incomplete projections；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、31 tests passed |
| C-4P6-S7 `d26bb83` | **tests-only evidence**：新增独立 `it`，仅覆盖 `after_record_publish` 中断；immutable record 已存在而 outcome/marker 缺失、manifest 仍 active；restart `reconcile()` 返回 `repaired`（authority-first，不重跑 evaluator / `createId`），随后 manifest → marker；第二次 reconcile 为 `settled`，同 operation 为 `already_committed`，四份 canonical bytes 稳定；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、32 tests passed |
| C-4P6-S8 `e743a3e` | **tests-only evidence**：新增独立 `it`，仅覆盖 malformed `outcome-settlement.json`；restart `reconcile()` 为 `review_required` 且 diagnostics 含 `invalid_settlement_marker`；不 rewrite durable bytes、不调用 evaluator / `createId`；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、33 tests passed |
| C-4P6-S9 `a631a31` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 `outcome.json` 与 immutable record authority 分叉；restart `reconcile()` 为 `review_required` 且 diagnostics 含 `conflicting_outcome`；不 rewrite durable bytes、不调用 evaluator / `createId`；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、34 tests passed |
| C-4P6-S10 `6bfffc5` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 completed `session.json` `outcomeRef` 与 immutable record authority 分叉（record / outcome.json / marker 匹配）；restart `reconcile()` 为 `review_required` 且 diagnostics 含 `conflicting_outcome`；不 rewrite durable bytes、不调用 evaluator / `createId`；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、35 tests passed |
| C-4P6-S11 `4603601` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 `outcome.json` 为 non-file symlink；restart `reconcile()` 为 `review_required`；不 rewrite record/manifest/marker、不修复 symlink、不调用 evaluator / `createId`；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、36 tests passed |
| C-4P6-S12 `60b6791` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 `outcome-settlement.json` 为 non-file symlink；restart `reconcile()` 为 `review_required` 且 diagnostics 含 `invalid_settlement_marker`；不 rewrite record/outcome/manifest，不把 symlink 修复为 regular file；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、37 tests passed；另通过 typecheck、security check、diff check |
| C-4P6-S13 `e1f0563` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 `session.json` 为 non-file symlink；restart `reconcile()` 为 `review_required`；不 rewrite record/outcome/marker，不把 symlink 修复为 regular file；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、38 tests passed；另通过 typecheck、security check、diff check |
| C-4P6-S14 `f90a863` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 `outcome.json` 为 directory（非 symlink）；restart `reconcile()` 为 `review_required`；不 rewrite record/manifest/marker、不修复 directory、不调用 evaluator / `createId`；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、39 tests passed |
| C-4P6-S15 `5fb4f04` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 `outcome-settlement.json` 为 directory（非 symlink）；restart `reconcile()` 为 `review_required` 且 diagnostics 含 `invalid_settlement_marker`；不 rewrite record/outcome/manifest、不修复 directory、不调用 evaluator / `createId`；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、40 tests passed |
| C-4P6-S16 `85840ae` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 `session.json` 为 directory（非 symlink）；restart `reconcile()` 为 `review_required`；不 rewrite record/outcome/marker、不修复 directory、不调用 evaluator / `createId`；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、41 tests passed |
| C-4P6-S17 `14fa960` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 canonical learning record 为 directory（非 symlink）；restart `reconcile()` 为 `review_required` 且 diagnostics 含 `missing_record`；不 rewrite outcome/manifest/marker、不修复 directory、不调用 evaluator / `createId`；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、42 tests passed |
| C-4P6-S18 `94e686f` | **tests-only evidence**：新增独立 `it`，仅覆盖 settled 后 canonical learning record 为 non-file symlink；restart `reconcile()` 为 `review_required` 且 diagnostics 含 `missing_record`；不 rewrite outcome/manifest/marker、不修复 symlink、不调用 evaluator / `createId`；同 operation commit 为 `conflict/review_required`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、43 tests passed |
| C-4P6-S19 `f9e263f` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 canonical learning record 为 regular file 但 content 无效的 fail-closed residual：restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 content、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、44 tests passed |
| C-4P6-S20 `412acc5` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 normalizeMarker 失败的 settlement marker residual：restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、45 tests passed |
| C-4P6-S21 `9e47eed` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record metadata residual（metadata `schemaVersion` 1→2）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 metadata、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、46 tests passed |
| C-4P6-S22 `a947d4c` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record metadata identity residual（`recordId` 非 canonical，`schemaVersion` 仍为 1）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 metadata、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、47 tests passed |
| C-4P6-S23 `a6d693f` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record assessment residual（`assessment.contentSha256` 非 64-hex，`schemaVersion`/`recordId` 仍合法）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、48 tests passed |
| C-4P6-S24 `2fdf59f` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record assessment path residual（`assessment.relativePath` 为空串，`schemaVersion`/`recordId`/`assessment.contentSha256` 仍合法）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment path、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、49 tests passed |
| C-4P6-S25 `e7440cc` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record body prefix residual（metadata JSON 仍合法，markdown `# Learning outcome:` 前缀与 outcomeKind 不一致）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 body、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、50 tests passed |
| C-4P6-S26 `80788b1` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 canonical learning-record `evidenceEventIds` residual（其它 metadata/body 仍合法，仅 `evidenceEventIds: []`）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、51 tests passed |
| C-4P6-S27 `fdc2d22` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record `evaluatorVersion` residual（其它 metadata/body 仍合法，仅 `evaluatorVersion: null`）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evaluatorVersion、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、52 tests passed |
| C-4P6-S28 `eb2fbf6` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 mismatched 的 canonical learning-record `sessionId` residual（path/recordId/body 仍对应当前 session，仅 metadata `sessionId` 与 path session 不一致）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 sessionId、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、53 tests passed |
| C-4P6-S29 `74120a7` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-canonical 的 canonical learning-record `operationId` residual（其它 metadata/body 仍合法，仅 stored `operationId` 为 upper/mixed case，使 `requireOperationId` 规范化后与 stored 不一致）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 operationId、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、54 tests passed |
| C-4P6-S30 `3d74522` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 zero 的 canonical learning-record `evaluatorVersion` residual（其它 metadata/body 仍合法，仅 `evaluatorVersion: 0`）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evaluatorVersion、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、55 tests passed |
| C-4P6-S31 `cc50e40` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 string 的 canonical learning-record `evaluatorVersion` residual（其它 metadata/body 仍合法，仅 `evaluatorVersion: "1"`）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evaluatorVersion、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、56 tests passed |
| C-4P6-S32 `b7087f2` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-integer 的 canonical learning-record `evaluatorVersion` residual（其它 metadata/body 仍合法，仅 `evaluatorVersion: 1.5`）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evaluatorVersion、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、57 tests passed |
| C-4P6-S33 `a85718a` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-writing 的 canonical learning-record `outcomeKind` residual（其它 metadata/body 仍合法，仅 `outcomeKind` 与 body heading 为 `not_evidenced`）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、58 tests passed |
| C-4P6-S34 `6f550b2` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-writing 的 canonical learning-record `outcomeKind` residual（其它 metadata/body 仍合法，仅 `outcomeKind` 与 body heading 为 `needs_practice`）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、59 tests passed |
| C-4P6-S35 `65527ef` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 unknown 的 canonical learning-record `outcomeKind` residual（其它 metadata/body 仍合法，仅 `outcomeKind` 与 body heading 为 `unknown_kind`）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、60 tests passed |
| C-4P6-S36 `8467c76` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 negative 的 canonical learning-record `evaluatorVersion` residual（其它 metadata/body 仍合法，仅 `evaluatorVersion: -1`）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evaluatorVersion、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、61 tests passed |
| C-4P6-S37 `dd4ce9a` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed empty canonical learning-record `outcomeId` residual：`outcomeId: ""` 使 `text()`/`readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、62 tests passed |
| C-4P6-S38 `11299c2` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 64-char non-hex assessment `contentSha256` residual：`g`×64 使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、63 tests passed |
| C-4P6-S39 `20da409` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed null assessment residual：`assessment: null` 使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、64 tests passed |
| C-4P6-S40 `e71a7c2` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 64-char uppercase-hex assessment `contentSha256` residual：`A`×64 使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、65 tests passed |
| C-4P6-S41 `0cf87ef` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed non-array `evidenceEventIds` residual：`evidenceEventIds: null` 使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、66 tests passed |
| C-4P6-S42 `96b63ac` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed blank evidenceEventIds item residual：`evidenceEventIds:[""]` 使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、67 tests passed |
| C-4P6-S43 `307c34a` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed empty `recordId` residual：`recordId:""` 使 `text()`/`readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、68 tests passed |
| C-4P6-S44 `659f9ac` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed empty `operationId` residual：`operationId:""` 使 `text()`/`readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、69 tests passed |
| C-4P6-S45 `802b62e` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed array assessment residual：`assessment:[]` 使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、70 tests passed |
| C-4P6-S46 `f990f7f` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed missing assessment key residual：删除 `assessment` key 使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、71 tests passed |
| C-4P6-S47 `bcea176` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed non-string evidenceEventIds item residual：`evidenceEventIds:[1]` 使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、72 tests passed |
| C-4P6-S48 `df111a0` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed whitespace-only evidenceEventIds item residual：`evidenceEventIds:[" "]` 使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、73 tests passed |
| C-4P6-S49 `f6b13e1` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed whitespace-only `outcomeId` residual：`outcomeId:" "` 使 `text()`/`readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、74 tests passed |
| C-4P6-S50 `d59da4e` | **tests-only evidence**：仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed boolean assessment residual：`assessment:false` 使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、75 tests passed |
| C-4P7 `0d55fd8` | private `MusicCookieStore` cookie state | `tests/unit/music-cookie-store-durable.unit.test.ts` |
| C-4P8-S1 `80f2fd0`、`e2ce36c` | workspace descriptor foundation：可信既有 workspace root 绑定、descriptor-bound parent traversal 与 final-leaf inspection | 下列 C-4P8 最终定向验证 |
| C-4P8-S2 `b46c8b2`、`bdcd6cb` | internal descriptor-bound atomic `createNoOverwrite` foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S3 `56eabe6`、`54506d5` | internal descriptor-bound restricted-overwrite foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S4 `0bbfdef`、`e84c813` | 受控 `write_workspace_file` 文本文件 create / restricted-overwrite handler integration、稳定结果和同 toolCallId journal replay | `tests/unit/workspace-write-tool.unit.test.ts` 与下列最终定向验证 |
| C-4P9-S2 `4b30220`、`5f47382` | 固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit 专用 framed、legacy-compatible、fixed-file durable append；不 rotation、不迁移其它 JSONL | 下列 C-4P9-S2/S3/S4 验证命令 |
| C-4P9-S3 `c286a42` | **tests-only historical evidence**：补齐 P9-S2 的 partial-write 与 archive-level failure/retry 定向证据：fixed-file non-rotating audit append 的 partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory `open`/`sync`/`close`、conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；无生产语义改动 | 2 个 unit 文件、61 tests passed；另有当时本主会话的 typecheck、security check、diff check |
| C-4P9-S4 `ab723a6` | **tests-only evidence**：仅覆盖 archive save 层首个 audit write 注入 `EIO`、audit 0 bytes 时的 short-circuit/retry；JSON/Markdown 保留、ledger 未执行，clean retry 后每个 canonical audit row 恰一条、ledger 恰一条；无生产语义改动 | `tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、27 tests passed |
| C-4P9-S5 `47393f9` | **tests-only evidence**：仅修改测试，未修改 production code；Sol review approved。对 audit directory 与 conversation parent directory 的 `open`/`sync` 做 capability symmetry 定向证据：五个 allowlist code `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 各覆盖两层、两种操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 返回 `EINVAL` 仍 fatal；无 production/API/schema/order 变化 | 单独：`tests/unit/agent-conversation-session-audit.unit.test.ts`，1 file、51 tests passed；与 archive durable 共同运行，2 files、78 tests passed；另通过 typecheck、security check、diff check |
| C-4P9-S6 `5f931c9` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，加强 ledger-own failure residual：audit 在 ledger 失败后保留期望 header 与 canonical entry IDs 且不 rollback；retry 保持 exact audit bytes、不写 audit、恰一条 ledger 行；随后 idempotent save 保持 audit 与 ledger bytes 不变；无生产语义改动 | `tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、27 tests passed |
| C-4P9-S7 `816e403` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 concurrent identical same-save residual：per-path queue 线性化，两路并发 append 同一 record 时仅一个 open lifecycle、一个 session header、entry IDs 唯一，exact bytes 与单次顺序 write 一致；无生产语义改动 | `tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、52 tests passed |
| C-4P9-S8 `bee173f` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 on-disk 同 identity 但 trace 分叉时 fail closed：throw `Conversation session audit contains divergent duplicate records.`，poisoned bytes 不变，无额外 write/rewrite；无生产语义改动 | `tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、53 tests passed |
| C-4P9-S9 `dcb9bae` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 concurrent same-ID 但 canonical body 分叉：per-path queue 线性化下一路成功、一路 reject `conflicts with its canonical record`，winner bytes 与单次顺序 write 一致；无生产语义改动 | `tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、54 tests passed |
| C-4P9-S10 `9d54c5e` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，将 Markdown write-failure 并入 4-case matrix 并补齐 file sync / file close / rename short-circuit residual：JSON 保留、Markdown 仍 `ENOENT`、不 append audit/ledger；无生产语义改动 | `tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、30 tests passed |
| C-4P9-S11 `bab5d1e` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，补齐 Markdown-phase directory close residual：第二次 directory close 失败时 JSON 与 Markdown 均已发布、不 append audit/ledger、无 temporary leftover；无生产语义改动 | `tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、31 tests passed |
| C-4P9-S12 `2aec1bc` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，补齐 Markdown-phase directory fsync residual：第二次 directory sync 失败时 JSON 与 Markdown 均已发布、不 append audit/ledger、无 temporary leftover；无生产语义改动 | `tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、32 tests passed |
| C-4P9-S13 `5e35703` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，补齐 Markdown-phase directory open residual：第二次 directory open 失败时 JSON 与 Markdown 均已发布、不 append audit/ledger、无 temporary leftover、save 不报告成功；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、33 tests passed；另通过 typecheck、security check、diff check |
| C-4P9-S14 `be460a4` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，补齐 JSON-phase directory open residual：第一次 directory open 失败时 JSON 已发布、Markdown 仍缺失、不 append audit/ledger、无 temporary leftover、save 不报告成功；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、34 tests passed；另通过 typecheck、security check、diff check |
| C-4P9-S15 `8779879` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file open fail-closed residual：对 audit 目标 open 注入 `EIO` 与 allowlist 五码均 fatal、不 capability downgrade、无 write、无 warning、无 audit 文件创建；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、60 tests passed |
| C-4P9-S16 `07ecb54` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file sync fail-closed residual：对 audit 目标 sync 注入 `EIO` 与 allowlist 五码均 fatal、不 capability downgrade、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、66 tests passed |
| C-4P9-S17 `8848af7` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file close fail-closed residual：对 audit 目标 close 注入 `EIO` 与 allowlist 五码均 fatal、不 capability downgrade、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、72 tests passed |
| C-4P9-S18 `54cec58` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file lstat fail-closed residual：对 audit 目标 lstat 注入 `EIO`/`EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR`/`EACCES` 均 fatal、不 open、不 capability downgrade、无 warning、无 audit 文件创建；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、79 tests passed |
| C-4P9-S19 `529febd` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file stat fail-closed residual：对已 open 的 audit 目标 `stat` 注入 `EIO`/`EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR`/`EACCES` 均 fatal、不 write、不 capability downgrade、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、86 tests passed |
| C-4P9-S20 `8091193` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit incomplete write/read transfer fail-closed residual：`bytesWritten`/`bytesRead` 为 `0` 或 `NaN` 时分别 throw incomplete-transfer errors；不 capability downgrade、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、90 tests passed |
| C-4P9-S21 `9309b81` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file open/sync/close `EACCES` fail-closed residual：fatal、不 capability downgrade；open 失败不创建文件、不启动 directory open；无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、93 tests passed |
| C-4P9-S22 `79e9d8d` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`（含 test-only `mkdir` 观测 instrumentation），补齐 audit directory mkdir fail-closed residual：对 audit directory `mkdir` 注入 `EIO`/`EACCES` 均 fatal、不 lstat、不 open、不 capability downgrade、无 warning、无 audit 文件创建；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、95 tests passed |
| C-4P9-S23 `c3f9be5` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit/parent directory open fatal fail-closed residual：对 directory `open:r` 注入 `EACCES`/`EPERM`/`EIO`/unknown 均 fatal、不 capability downgrade、不继续 directory sync、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、103 tests passed |
| C-4P9-S24 `8a27fc9` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit/parent directory sync fatal fail-closed residual：对 directory `sync` 注入 `EACCES`/`EPERM`/`EIO`/unknown 在 audit-directory 与 parent-directory 均 fatal、不 capability downgrade、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、107 tests passed |
| C-4P9-S25 `fc765d2` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 post-open audit target non-file fail-closed residual：handle `stat` 报告 non-file 时 reject、不 capability downgrade、不 read/write、不启动 directory durability、无 warning；test-only `statPlan`；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、108 tests passed |
| C-4P9-S26 `c3c8db5` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit directory mkdir fatal residual matrix：对 `mkdir` 注入 `EIO`/`EACCES`/`EPERM`/`ENOSPC`/`EINVAL`/unknown 均 fatal、不 capability downgrade、不 lstat/open/write/sync、无 warning、无 audit 文件创建；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、112 tests passed |
| C-4P9-S27 `4e3ce10` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file write fatal residual matrix：对首个 audit file `write` 注入 `EIO`/`EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR`/`EACCES`/`EPERM`/`ENOSPC` 均 fatal、不 capability downgrade、不启动 directory open/sync、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、121 tests passed |
| C-4P9-S28 `46a46ad` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file write unknown error residual：首个 audit file `write` 注入 non-errno unknown Error 时 fatal、不 capability downgrade、不启动 directory open/sync、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、122 tests passed |
| C-4P9-S29 `abe159d` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file open fatal residual matrix 扩到 `EPERM`/`ENOSPC`：open 失败 fatal、不 capability downgrade、不 write、不启动 directory open、无 warning、无 audit 文件创建；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、124 tests passed |
| C-4P9-S30 `905ffb9` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file sync fatal residual matrix 扩到 `EPERM`/`ENOSPC`：sync 失败 fatal、不 capability downgrade、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、126 tests passed |
| C-4P9-S31 `6620564` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file close fatal residual matrix 扩到 `EPERM`/`ENOSPC`：close 失败 fatal、不 capability downgrade、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、128 tests passed |
| C-4P9-S32 `b06d862` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file lstat fatal residual matrix 扩到 `EPERM`/`ENOSPC`：lstat 失败 fatal、不 capability downgrade、不 open/write、不启动 directory open、无 warning、无 audit 文件创建；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、130 tests passed |
| C-4P9-S33 `3776a25` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file stat fatal residual matrix 扩到 `EPERM`/`ENOSPC`：stat 失败 fatal、不 capability downgrade、不 write、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、132 tests passed |
| C-4P9-S34 `4ca4b62` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file sync unknown non-errno error residual：sync 返回未知 Error 时 fatal、不 capability downgrade、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、133 tests passed |
| C-4P9-S35 `cefb92f` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file open unknown non-errno error residual：open 返回未知 Error 时 fatal、不 capability downgrade、不启动 directory open、无 warning、无 audit 文件创建；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、134 tests passed |
| C-4P9-S36 `683599b` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file close unknown non-errno error residual：close 返回未知 Error 时 fatal、不 capability downgrade、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、135 tests passed |
| C-4P9-S37 `dddc2cc` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file lstat unknown non-errno error residual：lstat 返回未知 Error 时 fatal、不 open/write、不 capability downgrade、无 warning、无 audit 文件创建；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、136 tests passed |
| C-4P9-S38 `ac2f27f` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file stat unknown non-errno error residual：stat 返回未知 Error 时 fatal、不 write、不 capability downgrade、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、137 tests passed |
| C-4P9-S39 `7b5a4e6` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file read unknown non-errno error residual：seeded non-empty audit 后 continuation read 返回未知 Error 时 fatal、不 write、不 capability downgrade、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、138 tests passed |
| C-4P9-S40 `fca501c` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file read errno residual matrix：read 返回 `EIO`/`EINVAL`/`EACCES`/`EPERM`/`ENOSPC` 时 fatal、不 write、不 capability downgrade、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、143 tests passed |
| C-4P9-S41 `570a372` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file read partial-then-stall residual：read 先推进 1 byte 再返回 0 时 fail closed、不 write、不 capability downgrade、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、144 tests passed |
| C-4P9-S42 `1383428` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file write partial-then-stall residual：write 先推进 1 byte 再返回 0 时 fail closed、不 capability downgrade、不启动 directory open、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、145 tests passed |
| C-4P9-S43 `8570645` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit negative transfer residual counts：read/write 返回 `-1` 时 fail closed、不 capability downgrade、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、147 tests passed |
| C-4P9-S44 `e06a117` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit write multi-byte partial-then-stall residual：首次 `bytesWritten: 2` 后 `0` 时 fail closed、不 capability downgrade、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、148 tests passed |
| C-4P9-S45 `33a914a` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit exact-read multi-byte partial-then-stall residual：首次 `bytesRead: 2` 后 `0` 时 fail closed、不 write、不 capability downgrade、无 warning；无生产语义改动 | `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、149 tests passed |

共享原语和关键状态备份的验证也由 `tests/unit/durable-file.unit.test.ts` 覆盖。

## C-4P6-S2：outcome publish crash-recovery tests-only evidence

`9847842`（`test(data): cover outcome publish crash recovery`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，且 Sol final review approved；没有 production/API/schema/path/order 变化。它只覆盖单一 `after_outcome_publish` crash window，不是 manifest capability-policy alignment、其它 crash windows / failure matrix、跨文件 transaction、rollback/delete/migration/API/operations validation 或完整 C-4P6 closure。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；record 与 matching outcome 存在，manifest 为 `active` / `outcomeRef: null`，marker 缺失，且未继续 manifest、marker 或 catalog-success。
- 重启后的 reconcile 使用 immutable record authority，返回 `repaired`，不重新运行 evaluator、不重写 outcome，并按 manifest → marker 发布。第二次 reconcile 返回 `settled`，record/outcome/manifest/marker 四份 bytes 稳定；同一 operation 返回 `already_committed`，四份 bytes 仍稳定。
- 实际验证：`pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 28 tests passed）；`pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 均通过。

## C-4P6-S3：settlement-marker final rename EIO 的 tests-only evidence

`1334513`（`test(data): cover outcome marker recovery`）仅扩展 `tests/unit/learning-outcome-committer.unit.test.ts` 中同一个既有 unit `it`；没有 production/API/schema/path/order 变化，也没有新增 test count。它只记录 settlement-marker durable rename 返回 `EIO` 的单一 failure/restart/reconcile 场景：

- 初次 commit 返回 `retryable_failure/reconciliation_required`；immutable record、`outcome.json` 与已 `completed` 的 manifest 存在，settlement marker 为 `ENOENT`，且 evaluator 只运行一次。
- 重启后的 reconcile 以 immutable record authority 仅发布缺失 marker；不重新运行 evaluator 或 `createId`，不重写 record、outcome 或 manifest。
- 第二次 reconcile 返回 `settled`；同 operation replay 返回 `already_committed`；record/outcome/manifest/marker 四份 canonical bytes 在两次检查中保持稳定。

实际验证仍为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 28 tests passed，不是新增 test count）；`pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 均通过。S3 不是泛化 `after_manifest_publish` 证据、完整 manifest failure matrix、生产功能或完整 C-4P6 closure。

## C-4P6-S4：settled outcome recovery 的 tests-only evidence

`e821c69`（`test(data): cover settled outcome recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化，也不表示 S4 改了生产逻辑。它严格限于已有 `after_settlement_marker` 的一个独立中断：marker 的 canonical rename 在当前平台 capability policy 规定的 durable primitive 完成后可见，且测试确认未到达 `before_catalog_reconcile`。

- restart `reconcile()` 直接返回 `settled`，不是 `repaired`。
- recovery 不调用 evaluator 或 `createId`，不执行 durable write / rename / publish；immutable record、`outcome.json`、`completed` manifest 与 marker 四份 canonical bytes 稳定。
- 同 operation replay 返回 `already_committed`，recovery 仍不产生 durable operation，四份 canonical bytes 继续稳定。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 29 tests passed）。S4 不是完整 C-4P6、完整 catalog/manifest/crash matrix、transaction、rollback、delete、migration、API、operations validation 或 Windows native fsync/power-loss closure。



## C-4P6-S5：pre-catalog-reconcile interruption 的 tests-only evidence

`ebd084c`（`test(data): cover pre-catalog outcome recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化，也不表示 S5 改了生产逻辑。它严格限于已有 `before_catalog_reconcile` 的一个独立中断：marker 已发布，且 `inject` 在 catalog read 前抛出。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；immutable record、`outcome.json`、已 `completed` 的 manifest 与 marker 四份 durable 产物已存在；`injectedPoints` 完整有序前缀包含 `before_catalog_reconcile`。
- restart `reconcile()` 直接返回 `settled`，不是 `repaired`。
- recovery 不调用 evaluator 或 `createId`，不执行 durable write / rename / publish；四份 canonical bytes 稳定。
- 第二次 reconcile 仍为 `settled`；同 operation replay 返回 `already_committed`，四份 canonical bytes 继续稳定。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 30 tests passed）。S5 不是完整 C-4P6、完整 catalog/manifest/crash matrix、transaction、rollback、delete、migration、API、operations validation 或 Windows native fsync/power-loss closure。


## C-4P6-S6：post-stage-flush interruption 的 tests-only evidence

`145b671`（`test(data): cover post-stage-flush outcome recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于已有 `after_stage_flush` 的一个独立中断：stage 已 flush，immutable record 及后续 projection 尚未发布。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；仅 `after_stage_flush` 被 inject。
- stage 保留；record/outcome/marker 为 `ENOENT`；manifest 保持 crash 前 active 字节。
- restart `reconcile()` 返回 `pending`，无 durable write。
- 同 operation re-commit fail closed 于既有 exclusive-create stage，再次返回 `retryable_failure/reconciliation_required`，不 promote incomplete projections。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 31 tests passed）。S6 不是完整 C-4P6 或 stage cleanup/repair 生产功能。

## C-4P6-S7：after-record-publish interruption 的 tests-only evidence

`d26bb83`（`test(data): cover after-record-publish recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于已有 `after_record_publish` 的一个独立中断：immutable record 已 publish，outcome / manifest / marker 尚未发布。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；`injectedPoints` 为 `['after_stage_flush', 'after_record_publish']`；evaluation 仅一次。
- record 已存在；outcome / marker 为 `ENOENT`；manifest 保持 crash 前 active 字节；ledger 仍 `active` / `outcomeRef: null`。
- restart `reconcile()` 返回 `repaired`（authority-first，不重跑 evaluator / `createId`），不重写 record；随后 manifest → marker。
- 第二次 reconcile 为 `settled`；同 operation 为 `already_committed`；record / outcome / manifest / marker 四份 canonical bytes 稳定。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 32 tests passed）。S7 不是完整 C-4P6 或 stage cleanup/repair 生产功能。

## C-4P6-S8：malformed settlement marker 的 tests-only evidence

`e743a3e`（`test(data): cover invalid settlement marker residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 committed 后将 `outcome-settlement.json` poison 为 malformed JSON：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `invalid_settlement_marker`。
- 不 rewrite marker / record / outcome / manifest；recovery 不调用 evaluator / `createId`；无 durable write。
- 同 operation `commit` 返回 `conflict/review_required`。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 33 tests passed）。S8 不是完整 C-4P6 或 authority/conflict matrix。

## C-4P6-S9：conflicting outcome projection 的 tests-only evidence

`a631a31`（`test(data): cover conflicting outcome projection residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后仅 poison `outcome.json` 为与 immutable record 不匹配的 valid-looking projection：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `conflicting_outcome`。
- 不 rewrite poisoned outcome / record / manifest / marker；recovery 不调用 evaluator / `createId`；无 durable write。
- 同 operation `commit` 返回 `conflict/review_required`。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 34 tests passed）。S9 不是完整 C-4P6 或 authority/conflict matrix。

## C-4P6-S10：conflicting completed session outcomeRef 的 tests-only evidence

`6bfffc5`（`test(data): cover conflicting manifest outcomeRef residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后仅 poison completed `session.json` 的 `outcomeRef` 身份字段（record / `outcome.json` / settlement marker 保持匹配）：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `conflicting_outcome`。
- 不 rewrite poisoned manifest、record、outcome 或 marker；recovery 不调用 evaluator / `createId`；无 durable write。
- 同 operation `commit` 返回 `conflict/review_required`，不 false success。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 35 tests passed）。S10 不是完整 C-4P6 或 authority/conflict matrix。

## C-4P6-S11：invalid non-file outcome.json symlink 的 tests-only evidence

`4603601`（`test(data): cover invalid outcome symlink residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 `outcome.json` 替换为 non-file symlink（record / completed manifest / settlement marker 保持匹配）：

- restart `reconcile()` 返回 `review_required`。
- 不 rewrite record、manifest 或 marker；不把 symlink 修复为 regular file；recovery 不调用 evaluator / `createId`；无 durable write。
- 同 operation `commit` 返回 `conflict/review_required`，不 false success。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 36 tests passed）。S11 不是完整 C-4P6 或 authority/conflict matrix。


## C-4P6-S12：invalid non-file settlement-marker symlink 的 tests-only evidence

`60b6791`（`test(data): cover invalid settlement marker symlink residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 `outcome-settlement.json` 替换为指向 workspace 外的 non-file symlink，而 immutable record、`outcome.json` 与 completed `session.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`，diagnostics 含 `invalid_settlement_marker`；recovery 不 rewrite 任何 durable authority bytes，不把 symlink 修复为 regular file，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S12 invalid settlement-marker symlink residual: 1 file, 37 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。


## C-4P6-S13：invalid non-file session.json manifest symlink 的 tests-only evidence

`e1f0563`（`test(data): cover invalid session manifest symlink residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 `session.json` 替换为指向 workspace 外的 non-file symlink，而 immutable record、`outcome.json` 与 `outcome-settlement.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`；recovery 不 rewrite 任何 durable authority bytes，不把 symlink 修复为 regular file，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S13 invalid session.json manifest symlink residual: 1 file, 38 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。

## C-4P6-S14：invalid outcome.json directory 的 tests-only evidence

`f90a863`（`test(data): cover invalid outcome directory residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 `outcome.json` 替换为 directory（非 symlink），而 immutable record、completed `session.json` 与 `outcome-settlement.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`；recovery 不 rewrite 任何 durable authority bytes，不把 directory 修复为 regular file，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S14 invalid outcome.json directory residual: 1 file, 39 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。

## C-4P6-S15：invalid settlement-marker directory 的 tests-only evidence

`5fb4f04`（`test(data): cover invalid settlement marker directory residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 `outcome-settlement.json` 替换为 directory（非 symlink，可含 junk 内容），而 immutable record、`outcome.json` 与 completed `session.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`，diagnostics 含 `invalid_settlement_marker`；recovery 不 rewrite 任何 durable authority bytes，不把 directory 修复为 regular file，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S15 invalid settlement-marker directory residual: 1 file, 40 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。

## C-4P6-S16：invalid session.json directory 的 tests-only evidence

`85840ae`（`test(data): cover invalid session manifest directory residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 `session.json` 替换为 directory（非 symlink，可含 junk 内容），而 immutable record、`outcome.json` 与 `outcome-settlement.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`；recovery 不 rewrite 任何 durable authority bytes，不把 directory 修复为 regular file，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S16 invalid session.json directory residual: 1 file, 41 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。

## C-4P6-S17：invalid canonical learning-record directory 的 tests-only evidence

`14fa960`（`test(data): cover invalid learning record directory residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 canonical `learning-records/outcome-<sessionId>.md` 替换为 directory（非 symlink，可含 junk 内容），而 `outcome.json`、completed `session.json` 与 `outcome-settlement.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`；recovery 不 rewrite 任何 durable authority bytes，不把 directory 修复为 regular file，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S17 invalid canonical learning-record directory residual: 1 file, 42 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。

## C-4P6-S18：invalid canonical learning-record non-file symlink 的 tests-only evidence

`94e686f`（`test(data): cover invalid learning record symlink residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 canonical `learning-records/outcome-<sessionId>.md` 替换为 non-file symlink，而 `outcome.json`、completed `session.json` 与 `outcome-settlement.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`；recovery 不 rewrite 任何 durable authority bytes，不把 symlink 修复为 regular file，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S18 invalid canonical learning-record non-file symlink residual: 1 file, 43 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。

## C-4P6-S19：invalid canonical learning-record content 的 tests-only evidence

`f9e263f`（`test(data): cover invalid learning record content residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 canonical `learning-records/outcome-<sessionId>.md` 保持为 regular file 但覆写为 invalid content（缺少 metadata / 无法通过 parse-validation），而 `outcome.json`、completed `session.json` 与 `outcome-settlement.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`；recovery 不 rewrite 任何 durable authority bytes，不把 invalid content 修复为 valid record，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S19 invalid canonical learning-record content residual: 1 file, 44 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。

## C-4P6-S20：well-formed invalid settlement marker 的 tests-only evidence

`412acc5`（`test(data): cover invalid normalized settlement marker residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 `outcome-settlement.json` 覆写为 well-formed JSON 但 `schemaVersion` 非权威版本（`{"schemaVersion":2}`），canonical record / outcome.json / completed session.json 保持匹配。restart `reconcile()` 返回 `review_required`，diagnostics 含 `invalid_settlement_marker`；recovery 不 rewrite durable authority bytes，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S20 well-formed invalid settlement marker residual: 1 file, 45 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。

## C-4P6-S21：well-formed invalid canonical learning-record metadata 的 tests-only evidence

`9e47eed`（`test(data): cover invalid learning record metadata residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 canonical `learning-records/outcome-<sessionId>.md` 保持为 regular file，但将其 metadata 中 `schemaVersion` 从权威 `1` 改为 `2`（well-formed metadata 但 `readCanonicalRecord` schema 校验失败），而 `outcome.json`、completed `session.json` 与 `outcome-settlement.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`；recovery 不 rewrite 任何 durable authority bytes，不把 invalid metadata 修复为 valid record，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S21 well-formed invalid canonical learning-record metadata residual: 1 file, 46 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。

## C-4P6-S22：well-formed invalid canonical learning-record metadata identity 的 tests-only evidence

`a947d4c`（`test(data): cover invalid learning record metadata identity residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable settlement 后将 canonical `learning-records/outcome-<sessionId>.md` 保持为 regular file，且 `schemaVersion` 仍为权威 `1`，但将其 metadata 中 `recordId` 改为非 canonical 值（`readCanonicalRecord` identity 校验失败），而 `outcome.json`、completed `session.json` 与 `outcome-settlement.json` 保持匹配 authority。restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`；recovery 不 rewrite 任何 durable authority bytes，不把 invalid metadata identity 修复为 valid record，不调用 evaluator / `createId`；同 operation commit 返回 `conflict/review_required`。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S22 well-formed invalid canonical learning-record metadata identity residual: 1 file, 47 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称**完整 C-4P6 closure，也不覆盖 manifest publisher capability matrix 或其它 crash window。


## C-4P6-S23：well-formed invalid canonical learning-record assessment 的 tests-only evidence

`a6d693f`（`test(data): cover invalid learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record assessment residual：保持 `schemaVersion:1` 与 canonical `recordId`，仅将 `assessment.contentSha256` 改为非 64-hex；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 record，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S23 well-formed invalid canonical learning-record assessment residual: 1 file, 48 tests passed
```


## C-4P6-S24：well-formed invalid canonical learning-record assessment path 的 tests-only evidence

`2fdf59f`（`test(data): cover invalid learning record assessment path residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record assessment path residual：保持 `schemaVersion:1`、canonical `recordId` 与 64-hex `assessment.contentSha256`，仅将 `assessment.relativePath` 改为空串；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 record，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S24 well-formed invalid canonical learning-record assessment path residual: 1 file, 49 tests passed
```


## C-4P6-S25：well-formed invalid canonical learning-record body prefix 的 tests-only evidence

`e7440cc`（`test(data): cover invalid learning record body prefix residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record body prefix residual：metadata JSON 仍合法/canonical，仅将 markdown 必选 body 前缀与 `outcomeKind` 不一致；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 record，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S25 well-formed invalid canonical learning-record body prefix residual: 1 file, 50 tests passed
```

## C-4P6-S26：well-formed empty canonical learning-record evidenceEventIds 的 tests-only evidence

`80788b1`（`test(data): cover empty learning record evidence residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 canonical learning-record `evidenceEventIds` residual：其它 metadata 字段与 body prefix 仍合法/canonical，仅将 `evidenceEventIds` 置为 `[]`；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 evidence，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S26 well-formed empty canonical learning-record evidenceEventIds residual: 1 file, 51 tests passed
```

## C-4P6-S27：well-formed invalid canonical learning-record evaluatorVersion 的 tests-only evidence

`fdc2d22`（`test(data): cover invalid learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record `evaluatorVersion` residual：其它 metadata 字段与 body prefix 仍合法/canonical，仅将 `evaluatorVersion` 置为 `null`；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 evaluatorVersion，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S27 well-formed invalid canonical learning-record evaluatorVersion residual: 1 file, 52 tests passed
```

## C-4P6-S28：well-formed mismatched canonical learning-record sessionId 的 tests-only evidence

`eb2fbf6`（`test(data): cover mismatched learning record sessionId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 mismatched 的 canonical learning-record `sessionId` residual：path/recordId/body 仍对应当前 session，仅 metadata `sessionId` 与 path session 不一致；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 sessionId，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S28 well-formed mismatched canonical learning-record sessionId residual: 1 file, 53 tests passed
```




## C-4P6-S29：well-formed non-canonical canonical learning-record operationId 的 tests-only evidence

`74120a7`（`test(data): cover non-canonical learning record operationId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-canonical 的 canonical learning-record `operationId` residual：其它 metadata/body 仍合法，仅 stored `operationId` 为 upper/mixed case，使 `requireOperationId` 规范化后与 stored 不一致；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 operationId，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S29 well-formed non-canonical canonical learning-record operationId residual: 1 file, 54 tests passed
```

## C-4P6-S30：well-formed zero canonical learning-record evaluatorVersion 的 tests-only evidence

`3d74522`（`test(data): cover zero learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 zero 的 canonical learning-record `evaluatorVersion` residual：其它 metadata/body 仍合法，仅 `evaluatorVersion: 0`，使 `number()`/`readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 evaluatorVersion，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S30 well-formed zero canonical learning-record evaluatorVersion residual: 1 file, 55 tests passed
```

## C-4P6-S31：well-formed string canonical learning-record evaluatorVersion 的 tests-only evidence

`cc50e40`（`test(data): cover string learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 string 的 canonical learning-record `evaluatorVersion` residual：其它 metadata/body 仍合法，仅 `evaluatorVersion: "1"`，使 `number()`/`readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 evaluatorVersion，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S31 well-formed string canonical learning-record evaluatorVersion residual: 1 file, 56 tests passed
```

## C-4P6-S32：well-formed non-integer canonical learning-record evaluatorVersion 的 tests-only evidence

`b7087f2`（`test(data): cover non-integer learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-integer 的 canonical learning-record `evaluatorVersion` residual：其它 metadata/body 仍合法，仅 `evaluatorVersion: 1.5`，使 `number()`/`readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite outcome/manifest/marker，不修复 evaluatorVersion，不调用 evaluator/`createId`；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S32 well-formed non-integer canonical learning-record evaluatorVersion residual: 1 file, 57 tests passed
```


## C-4P6-S33：well-formed non-writing canonical learning-record outcomeKind 的 tests-only evidence

`a85718a`（`test(data): cover non-writing learning record outcomeKind residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-writing 的 canonical learning-record `outcomeKind` residual：其它 metadata/body 仍合法，仅将 metadata `outcomeKind` 与 body heading 设为 `not_evidenced`，使 `writesLearningRecord(kind)` 为 false 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S33 well-formed non-writing canonical learning-record outcomeKind residual: 1 file, 58 tests passed
```


## C-4P6-S34：well-formed needs_practice canonical learning-record outcomeKind 的 tests-only evidence

`6f550b2`（`test(data): cover needs_practice learning record outcomeKind residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-writing 的 canonical learning-record `outcomeKind` residual：其它 metadata/body 仍合法，仅将 metadata `outcomeKind` 与 body heading 设为 `needs_practice`，使 `writesLearningRecord(kind)` 为 false 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S34 well-formed needs_practice canonical learning-record outcomeKind residual: 1 file, 59 tests passed
```


## C-4P6-S35：unknown canonical learning-record outcomeKind 的 tests-only evidence

`65527ef`（`test(data): cover unknown learning record outcomeKind residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 unknown 的 canonical learning-record `outcomeKind` residual：其它 metadata/body 仍合法，仅将 metadata `outcomeKind` 与 body heading 设为 `unknown_kind`，使 `outcomeKind()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S35 unknown canonical learning-record outcomeKind residual: 1 file, 60 tests passed
```


## C-4P6-S36：well-formed negative canonical learning-record evaluatorVersion 的 tests-only evidence

`8467c76`（`test(data): cover negative learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 negative 的 canonical learning-record `evaluatorVersion` residual：其它 metadata/body 仍合法，仅 `evaluatorVersion: -1`，使 `number()`/`readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evaluatorVersion、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S36 well-formed negative canonical learning-record evaluatorVersion residual: 1 file, 61 tests passed
```

## C-4P6-S37：well-formed empty canonical learning-record outcomeId 的 tests-only evidence

`dd4ce9a`（`test(data): cover empty learning record outcomeId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 canonical learning-record `outcomeId` residual：其它 metadata/body 仍合法，仅 `outcomeId: ""`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S37 well-formed empty canonical learning-record outcomeId residual: 1 file, 62 tests passed
```

## C-4P6-S38：well-formed 64-char non-hex assessment contentSha256 的 tests-only evidence

`11299c2`（`test(data): cover non-hex learning record assessment sha residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 64-char non-hex 的 assessment `contentSha256` residual：其它 metadata/body 仍合法，仅 `contentSha256` 为 `g`×64，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S38 well-formed 64-char non-hex assessment contentSha256 residual: 1 file, 63 tests passed
```

## C-4P6-S39：well-formed null assessment 的 tests-only evidence

`20da409`（`test(data): cover null learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 null 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: null`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S39 well-formed null assessment residual: 1 file, 64 tests passed
```

## C-4P6-S40：well-formed 64-char uppercase-hex assessment contentSha256 的 tests-only evidence

`e71a7c2`（`test(data): cover uppercase learning record assessment sha residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 64-char uppercase-hex 的 assessment `contentSha256` residual：其它 metadata/body 仍合法，仅 `contentSha256` 为 `A`×64，使 `isVerifiedAssessment` 拒绝（regex 要求 lowercase）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S40 well-formed 64-char uppercase-hex assessment contentSha256 residual: 1 file, 65 tests passed
```

## C-4P6-S41：well-formed non-array evidenceEventIds 的 tests-only evidence

`0cf87ef`（`test(data): cover non-array learning record evidence residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-array 的 `evidenceEventIds` residual：其它 metadata/body 仍合法，仅 `evidenceEventIds: null`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S41 well-formed non-array evidenceEventIds residual: 1 file, 66 tests passed
```

## C-4P6-S42：well-formed blank evidenceEventIds item 的 tests-only evidence

`96b63ac`（`test(data): cover blank learning record evidence item residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 blank 的 evidenceEventIds item residual：其它 metadata/body 仍合法，仅 `evidenceEventIds:[""]`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S42 well-formed blank evidenceEventIds item residual: 1 file, 67 tests passed
```

## C-4P6-S43：well-formed empty recordId 的 tests-only evidence

`307c34a`（`test(data): cover empty learning record recordId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 canonical learning-record `recordId` residual：其它 metadata/body 仍合法，仅 `recordId: ""`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 recordId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S43 well-formed empty recordId residual: 1 file, 68 tests passed
```

## C-4P6-S44：well-formed empty operationId 的 tests-only evidence

`659f9ac`（`test(data): cover empty learning record operationId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 canonical learning-record `operationId` residual：其它 metadata/body 仍合法，仅 `operationId: ""`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 operationId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S44 well-formed empty operationId residual: 1 file, 69 tests passed
```

## C-4P6-S45：well-formed array assessment 的 tests-only evidence

`802b62e`（`test(data): cover array learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 array 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: []`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S45 well-formed array assessment residual: 1 file, 70 tests passed
```

## C-4P6-S46：well-formed missing assessment key 的 tests-only evidence

`f990f7f`（`test(data): cover missing learning record assessment key residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing assessment key residual：其它 metadata/body 仍合法，仅删除 `assessment` key，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S46 well-formed missing assessment key residual: 1 file, 71 tests passed
```

## C-4P6-S47：well-formed non-string evidenceEventIds item 的 tests-only evidence

`bcea176`（`test(data): cover non-string learning record evidence item residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-string 的 evidenceEventIds item residual：其它 metadata/body 仍合法，仅 `evidenceEventIds:[1]`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S47 well-formed non-string evidenceEventIds item residual: 1 file, 72 tests passed
```

## C-4P6-S48：well-formed whitespace-only evidenceEventIds item 的 tests-only evidence

`df111a0`（`test(data): cover whitespace learning record evidence item residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 evidenceEventIds item residual：其它 metadata/body 仍合法，仅 `evidenceEventIds:[" "]`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S48 well-formed whitespace-only evidenceEventIds item residual: 1 file, 73 tests passed
```

## C-4P6-S49：well-formed whitespace-only outcomeId 的 tests-only evidence

`f6b13e1`（`test(data): cover whitespace learning record outcomeId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 canonical learning-record `outcomeId` residual：其它 metadata/body 仍合法，仅 `outcomeId: " "`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S49 well-formed whitespace-only outcomeId residual: 1 file, 74 tests passed
```

## C-4P6-S50：well-formed boolean assessment 的 tests-only evidence

`d59da4e`（`test(data): cover boolean learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 boolean 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: false`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S50 well-formed boolean assessment residual: 1 file, 75 tests passed
```

## C-4P6-S51：well-formed whitespace-only operationId 的 tests-only evidence

`2d5d84b`（`test(data): cover whitespace learning record operationId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 canonical learning-record `operationId` residual：其它 metadata/body 仍合法，仅 `operationId: " "`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 operationId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S51 well-formed whitespace-only operationId residual: 1 file, 76 tests passed
```

## C-4P6-S52：well-formed number assessment 的 tests-only evidence

`05c852e`（`test(data): cover number learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 number 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: 1`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S52 well-formed number assessment residual: 1 file, 77 tests passed
```

## C-4P6-S53：well-formed whitespace-only recordId 的 tests-only evidence

`eee9b34`（`test(data): cover whitespace learning record recordId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 canonical learning-record `recordId` residual：其它 metadata/body 仍合法，仅 `recordId: " "`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 recordId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S53 well-formed whitespace-only recordId residual: 1 file, 78 tests passed
```

## C-4P6-S54：well-formed string assessment 的 tests-only evidence

`1a481c4`（`test(data): cover string learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 string 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: "not-an-assessment-object"`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S54 well-formed string assessment residual: 1 file, 79 tests passed
```

## C-4P6-S55：well-formed whitespace-only sessionId 的 tests-only evidence

`1c2585f`（`test(data): cover whitespace learning record sessionId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 canonical learning-record `sessionId` residual：其它 metadata/body 仍合法，仅 `sessionId: " "`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 sessionId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S55 well-formed whitespace-only sessionId residual: 1 file, 80 tests passed
```

## C-4P6-S56：well-formed whitespace-only assessment relativePath 的 tests-only evidence

`4ba78fc`（`test(data): cover whitespace assessment relativePath residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 assessment `relativePath` residual：其它 metadata/body 仍合法，仅 `assessment.relativePath: " "`，使 `text()` 返回 null 且 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment path、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S56 well-formed whitespace-only assessment relativePath residual: 1 file, 81 tests passed
```

## C-4P6-S57：well-formed missing assessment contentSha256 key 的 tests-only evidence

`685b54b`（`test(data): cover missing assessment contentSha256 residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing assessment `contentSha256` key residual：其它 metadata/body 仍合法，仅删除 `assessment.contentSha256`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S57 well-formed missing assessment contentSha256 key residual: 1 file, 82 tests passed
```

## C-4P6-S58：well-formed null evidenceEventIds item 的 tests-only evidence

`421f5a0`（`test(data): cover null learning record evidence item residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 null 的 evidenceEventIds item residual：其它 metadata/body 仍合法，仅 `evidenceEventIds:[null]`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S58 well-formed null evidenceEventIds item residual: 1 file, 83 tests passed
```

## C-4P6-S59：well-formed missing assessment relativePath key 的 tests-only evidence

`e986993`（`test(data): cover missing assessment relativePath residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing assessment `relativePath` key residual：其它 metadata/body 仍合法，仅删除 `assessment.relativePath` 并保留 `contentSha256`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S59 well-formed missing assessment relativePath key residual: 1 file, 84 tests passed
```

## C-4P6-S60：well-formed empty assessment contentSha256 的 tests-only evidence

`bc43e30`（`test(data): cover empty assessment contentSha256 residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 assessment `contentSha256` residual：其它 metadata/body 仍合法，仅 `assessment.contentSha256: ""`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S60 well-formed empty assessment contentSha256 residual: 1 file, 85 tests passed
```

## C-4P6-S61：well-formed missing schemaVersion key 的 tests-only evidence

`7a6c057`（`test(data): cover missing learning record schemaVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing `schemaVersion` key residual：其它 metadata/body 仍合法，仅删除 `schemaVersion`，使严格 schemaVersion 校验失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 schemaVersion、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S61 well-formed missing schemaVersion key residual: 1 file, 86 tests passed
```

## C-4P6-S62：well-formed empty-object assessment 的 tests-only evidence

`8b31234`（`test(data): cover empty-object learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty-object `assessment` residual：其它 metadata/body 仍合法，仅将 `assessment` 替换为 `{}`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S62 well-formed empty-object assessment residual: 1 file, 87 tests passed
```

## C-4P6-S63：well-formed missing outcomeId key 的 tests-only evidence

`2b951b0`（`test(data): cover missing learning record outcomeId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing `outcomeId` key residual：其它 metadata/body 仍合法（含仍嵌入 outcome id 的 canonical `recordId`），仅删除 `outcomeId`，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S63 well-formed missing outcomeId key residual: 1 file, 88 tests passed
```

## C-4P6-S64：well-formed missing operationId key 的 tests-only evidence

`71e7927`（`test(data): cover missing learning record operationId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing `operationId` key residual：其它 metadata/body 仍合法，仅删除 `operationId`，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 operationId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S64 well-formed missing operationId key residual: 1 file, 89 tests passed
```

## C-4P6-S65：well-formed missing sessionId key 的 tests-only evidence

`4145db8`（`test(data): cover missing learning record sessionId residual`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing `sessionId` key residual：其它 metadata/body 仍合法，仅删除 `sessionId`，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 sessionId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S66 初版。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S65 well-formed missing sessionId key residual: 1 file, 90 tests passed
```

## C-4P6-S66：well-formed missing evidenceEventIds key 的 tests-only evidence

`4145db8` 引入 well-formed missing `evidenceEventIds` key residual；`c3efedc`（`test(data): harden missing evidenceEventIds residual asserts`）仅收紧断言：去除 matchObject 重复 key，并将 poisoned text 对 evidence id 的期望改为 `not.toContain`（删除 key 后 metadata 不再含该 id）。`stringArray(undefined)` throw → catch → invalid → `missing_record`；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S66 well-formed missing evidenceEventIds key residual: 1 file, 91 tests passed
```

## C-4P6-S67：well-formed missing evaluatorVersion key 的 tests-only evidence

`7d5754e`（`test(data): cover missing learning record evaluatorVersion residual`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing `evaluatorVersion` key residual：其它 metadata/body 仍合法，仅删除 `evaluatorVersion`，使 `number()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evaluatorVersion、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S68。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S67/S68 missing evaluatorVersion + outcomeKind key residuals: 1 file, 93 tests passed
```

## C-4P6-S68：well-formed missing outcomeKind key 的 tests-only evidence

`7d5754e` 同提交补齐 settled 后 well-formed 但 missing `outcomeKind` key residual：其它 metadata/body 仍合法，仅删除 `outcomeKind`，使 `outcomeKind()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S68 well-formed missing outcomeKind key residual: 1 file, 93 tests passed
```

## C-4P6-S69：well-formed missing recordId key 的 tests-only evidence

`12abeab`（`test(data): cover missing recordId and null schemaVersion residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing `recordId` key residual：其它 metadata/body 仍合法，仅删除 `recordId`，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 recordId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S70。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S69/S70 missing recordId + null schemaVersion residuals: 1 file, 95 tests passed
```

## C-4P6-S70：well-formed null schemaVersion 的 tests-only evidence

`12abeab` 同提交补齐 settled 后 well-formed 但 `schemaVersion: null` residual：其它 metadata/body 仍合法，仅将 `schemaVersion` 设为 `null`，使严格 schemaVersion 校验失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 schemaVersion、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S70 well-formed null schemaVersion residual: 1 file, 95 tests passed
```

## C-4P6-S71：well-formed string schemaVersion 的 tests-only evidence

`c0d1a20`（`test(data): cover string schemaVersion and whitespace assessment sha residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `schemaVersion: "1"` residual：其它 metadata/body 仍合法，仅将 schemaVersion 设为字符串，使严格 equality 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S72。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S71/S72 string schemaVersion + whitespace assessment contentSha256 residuals: 1 file, 97 tests passed
```

## C-4P6-S72：well-formed whitespace-only assessment contentSha256 的 tests-only evidence

`c0d1a20` 同提交补齐 settled 后 well-formed 但 whitespace-only `assessment.contentSha256` residual：其它 metadata/body 仍合法，仅将 contentSha256 设为 `"   "`，使 `text()` 返回 null / `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S72 whitespace-only assessment contentSha256 residual: 1 file, 97 tests passed
```

## C-4P6-S73：well-formed boolean schemaVersion 的 tests-only evidence

`6af9dbc`（`test(data): cover boolean schemaVersion and null assessment sha residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `schemaVersion: true` residual：其它 metadata/body 仍合法，仅将 schemaVersion 设为 boolean，使严格 equality 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S74。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S73/S74 boolean schemaVersion + null assessment contentSha256 residuals: 1 file, 99 tests passed
```

## C-4P6-S74：well-formed null assessment contentSha256 的 tests-only evidence

`6af9dbc` 同提交补齐 settled 后 well-formed 但 `assessment.contentSha256: null` residual：其它 metadata/body 仍合法，仅将 contentSha256 设为 `null`，使 `text()` 返回 null / `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S74 null assessment contentSha256 residual: 1 file, 99 tests passed
```

## C-4P6-S75：well-formed non-integer numeric schemaVersion 的 tests-only evidence

`e49f745`（`test(data): cover float schemaVersion and null assessment path residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `schemaVersion: 1.5` residual：其它 metadata/body 仍合法，仅将 schemaVersion 设为非整数 number，使严格 equality 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S76。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S75/S76 non-integer schemaVersion + null assessment relativePath residuals: 1 file, 101 tests passed
```

## C-4P6-S76：well-formed null assessment relativePath 的 tests-only evidence

`e49f745` 同提交补齐 settled 后 well-formed 但 `assessment.relativePath: null` residual：其它 metadata/body 仍合法，仅将 relativePath 设为 `null`，使 `text()` 返回 null / `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S76 null assessment relativePath residual: 1 file, 101 tests passed
```

## C-4P6-S77：well-formed number assessment contentSha256 的 tests-only evidence

`6b31876`（`test(data): cover number assessment sha and boolean path residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `assessment.contentSha256: 1` residual：其它 metadata/body 仍合法，仅将 contentSha256 设为 number，使 `text()` 返回 null / `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S78。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S77/S78 number assessment contentSha256 + boolean assessment relativePath residuals: 1 file, 103 tests passed
```

## C-4P6-S78：well-formed boolean assessment relativePath 的 tests-only evidence

`6b31876` 同提交补齐 settled 后 well-formed 但 `assessment.relativePath: true` residual：其它 metadata/body 仍合法，仅将 relativePath 设为 boolean，使 `text()` 返回 null / `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S78 boolean assessment relativePath residual: 1 file, 103 tests passed
```

## C-4P6-S79：well-formed boolean assessment contentSha256 的 tests-only evidence

`15eab32`（`test(data): cover boolean assessment sha and number path residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `assessment.contentSha256: true` residual：其它 metadata/body 仍合法，仅将 contentSha256 设为 boolean，使 `text()` 返回 null / `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S80。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S79/S80 boolean assessment contentSha256 + number assessment relativePath residuals: 1 file, 105 tests passed
```

## C-4P6-S80：well-formed number assessment relativePath 的 tests-only evidence

`15eab32` 同提交补齐 settled 后 well-formed 但 `assessment.relativePath: 1` residual：其它 metadata/body 仍合法，仅将 relativePath 设为 number，使 `text()` 返回 null / `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S80 number assessment relativePath residual: 1 file, 105 tests passed
```

## C-4P6-S81：well-formed short lowercase-hex assessment contentSha256 的 tests-only evidence

`a040d22`（`test(data): cover short assessment sha and array schemaVersion residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 63-char lowercase-hex `assessment.contentSha256` residual：其它 metadata/body 仍合法，仅将 contentSha256 截为 63 位 hex，使 `/^[a-f0-9]{64}$/` 因长度失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S82。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S81/S82 short assessment contentSha256 + array schemaVersion residuals: 1 file, 107 tests passed
```

## C-4P6-S82：well-formed array schemaVersion 的 tests-only evidence

`a040d22` 同提交补齐 settled 后 well-formed 但 `schemaVersion: []` residual：其它 metadata/body 仍合法，仅将 schemaVersion 设为空数组，使严格 equality 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S82 array schemaVersion residual: 1 file, 107 tests passed
```

## C-4P6-S83：well-formed long lowercase-hex assessment contentSha256 的 tests-only evidence

`23d404c`（`test(data): cover long assessment sha and object schemaVersion residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 65-char lowercase-hex `assessment.contentSha256` residual：其它 metadata/body 仍合法，仅将 contentSha256 扩为 65 位 hex，使 `/^[a-f0-9]{64}$/` 因长度失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S84。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S83/S84 long assessment contentSha256 + object schemaVersion residuals: 1 file, 109 tests passed
```

## C-4P6-S84：well-formed object schemaVersion 的 tests-only evidence

`23d404c` 同提交补齐 settled 后 well-formed 但 `schemaVersion: {}` residual：其它 metadata/body 仍合法，仅将 schemaVersion 设为空对象，使严格 equality 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S84 object schemaVersion residual: 1 file, 109 tests passed
```

## C-4P6-S85：well-formed leading metadata garbage 的 tests-only evidence

`a5f4993`（`test(data): cover leading metadata garbage and missing suffix residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 metadata 前存在 leading garbage residual：JSON/body 仍在，但 prefix 不在 byte 0，使 `start !== 0` 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S86。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S85/S86 leading metadata garbage + missing metadata suffix residuals: 1 file, 111 tests passed
```

## C-4P6-S86：well-formed missing metadata suffix 的 tests-only evidence

`a5f4993` 同提交补齐 settled 后 missing metadata suffix residual：prefix 仍在 byte 0，但 suffix 被移除，使 `end < 0` 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S86 missing metadata suffix residual: 1 file, 111 tests passed
```

## C-4P6-S87：well-formed malformed metadata JSON 的 tests-only evidence

`d141920`（`test(data): cover malformed metadata JSON and missing body newline residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 metadata JSON 截断/畸形 residual：prefix/suffix 仍在，但 JSON.parse 抛错，catch 返回 invalid；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S88。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S87/S88 malformed metadata JSON + missing body newline residuals: 1 file, 113 tests passed
```

## C-4P6-S88：well-formed missing newline after metadata suffix 的 tests-only evidence

`d141920` 同提交补齐 settled 后 metadata suffix 与 body heading 之间缺少必需换行 residual：metadata 字段与 heading 文本仍在，但 `startsWith(...SUFFIX\n# Learning outcome...)` 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S88 missing newline after metadata suffix residual: 1 file, 113 tests passed
```

## C-4P6-S89：well-formed null outcomeId 的 tests-only evidence

`55f3c58`（`test(data): cover null outcomeId and false schemaVersion residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `outcomeId: null` residual：其它 metadata/body 仍合法，仅将 outcomeId 设为 null，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S90。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S89/S90 null outcomeId + false schemaVersion residuals: 1 file, 115 tests passed
```

## C-4P6-S90：well-formed false schemaVersion 的 tests-only evidence

`55f3c58` 同提交补齐 settled 后 well-formed 但 `schemaVersion: false` residual：其它 metadata/body 仍合法，仅将 schemaVersion 设为 boolean false，使严格 equality 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S90 false schemaVersion residual: 1 file, 115 tests passed
```

## C-4P6-S91：well-formed null operationId 的 tests-only evidence

`7ea4ac3`（`test(data): cover null operationId and null sessionId residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `operationId: null` residual：其它 metadata/body 仍合法，仅将 operationId 设为 null，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S92。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S91/S92 null operationId + null sessionId residuals: 1 file, 117 tests passed
```

## C-4P6-S92：well-formed null sessionId 的 tests-only evidence

`7ea4ac3` 同提交补齐 settled 后 well-formed 但 `sessionId: null` residual：其它 metadata/body 仍合法，仅将 sessionId 设为 null，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S92 null sessionId residual: 1 file, 117 tests passed
```

## C-4P6-S93：well-formed null recordId 的 tests-only evidence

`995545a`（`test(data): cover null recordId and number outcomeId residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `recordId: null` residual：其它 metadata/body 仍合法，仅将 recordId 设为 null，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S94。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S93/S94 null recordId + number outcomeId residuals: 1 file, 119 tests passed
```

## C-4P6-S94：well-formed number outcomeId 的 tests-only evidence

`995545a` 同提交补齐 settled 后 well-formed 但 `outcomeId: 42` residual：其它 metadata/body 仍合法，仅将 outcomeId 设为 number，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S94 number outcomeId residual: 1 file, 119 tests passed
```

## C-4P6-S95：well-formed number operationId 的 tests-only evidence

`e90301a`（`test(data): cover number operationId and boolean sessionId residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `operationId: 7` residual：其它 metadata/body 仍合法，仅将 operationId 设为 number，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S96。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S95/S96 number operationId + boolean sessionId residuals: 1 file, 121 tests passed
```

## C-4P6-S96：well-formed boolean sessionId 的 tests-only evidence

`e90301a` 同提交补齐 settled 后 well-formed 但 `sessionId: true` residual：其它 metadata/body 仍合法，仅将 sessionId 设为 boolean true，使 `text()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S96 boolean sessionId residual: 1 file, 121 tests passed
```

## C-4P6-S97：well-formed null outcomeKind 的 tests-only evidence

`69fc5be`（`test(data): cover null outcomeKind and missing body residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 `outcomeKind: null` residual：其它 metadata/body 仍合法，仅将 outcomeKind 设为 null，使 `outcomeKind()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S98。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S97/S98 null outcomeKind + missing body residuals: 1 file, 123 tests passed
```

## C-4P6-S98：well-formed missing body after metadata 的 tests-only evidence

`69fc5be` 同提交补齐 settled 后 metadata 合法但整段 markdown body 缺失 residual：metadata JSON 可 parse，但 `startsWith(...SUFFIX\n# Learning outcome: ${kind}\n)` 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S98 missing body after metadata residual: 1 file, 123 tests passed
```

## C-4P6-S99：well-formed empty-file learning-record 的 tests-only evidence

`c21dd08`（`test(data): cover empty-file record and number outcomeKind residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 zero-byte regular-file learning-record residual：无 metadata 可 parse，prefix/suffix scan 失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S100。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S99/S100 empty-file + number outcomeKind residuals: 1 file, 125 tests passed
```

## C-4P6-S100：well-formed number outcomeKind 的 tests-only evidence

`c21dd08` 同提交补齐 settled 后 well-formed 但 `outcomeKind: 3` residual：其它 metadata/body 仍合法，仅将 outcomeKind 设为 number，使 `outcomeKind()` 返回 null；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S100 number outcomeKind residual: 1 file, 125 tests passed
```

## C-4P6-S101：well-formed null settlement-marker outcomeId 的 tests-only evidence

`3084e41`（`test(data): cover null marker outcomeId and array marker residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 settlement marker `outcomeId: null` residual：`normalizeMarker` via `text()` 拒绝；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S102。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S101/S102 null marker outcomeId + array marker residuals: 1 file, 127 tests passed
```

## C-4P6-S102：well-formed array settlement-marker 的 tests-only evidence

`3084e41` 同提交补齐 settled 后 well-formed JSON array settlement marker residual：`normalizeMarker` 拒绝 non-object；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S102 array settlement-marker residual: 1 file, 127 tests passed
```

## C-4P6-S103：well-formed null settlement-marker operationId 的 tests-only evidence

`cf4c3a7`（`test(data): cover null marker operationId and record-presence residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 settlement marker `operationId: null` residual：`normalizeMarker` via `text()` 拒绝；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S104。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S103/S104 null marker operationId + record-presence mismatch residuals: 1 file, 129 tests passed
```

## C-4P6-S104：well-formed settlement-marker record-presence mismatch 的 tests-only evidence

`cf4c3a7` 同提交补齐 settled 后 writing `kind: "established"` 但 `record: null` residual：`normalizeMarker` 拒绝 record presence 与 kind 不一致；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S104 settlement-marker record-presence mismatch residual: 1 file, 129 tests passed
```

## C-4P6-S105：well-formed null settlement-marker sessionId 的 tests-only evidence

`4084509`（`test(data): cover null marker sessionId and empty-evidence residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 settlement marker `sessionId: null` residual：`normalizeMarker` via `text()` 拒绝；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S106。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S105/S106 null marker sessionId + empty writing evidence residuals: 1 file, 131 tests passed
```

## C-4P6-S106：well-formed empty settlement-marker evidence for writing kind 的 tests-only evidence

`4084509` 同提交补齐 settled 后 writing `kind: "established"` 但 `evidenceEventIds: []` residual：`normalizeMarker` 拒绝 recorded outcome 无 evidence；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S106 empty settlement-marker evidence for writing kind residual: 1 file, 131 tests passed
```

## C-4P6-S107：well-formed null settlement-marker evaluatorVersion 的 tests-only evidence

`a1a8272`（`test(data): cover null marker evaluatorVersion and record-identity residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 settlement marker `evaluatorVersion: null` residual：`normalizeMarker` via `number()` 拒绝；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S108。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S107/S108 null marker evaluatorVersion + record-identity mismatch residuals: 1 file, 133 tests passed
```

## C-4P6-S108：well-formed settlement-marker record identity mismatch 的 tests-only evidence

`a1a8272` 同提交补齐 settled 后 writing kind 但 `marker.record.recordId` 与 canonical Learning record identity 不一致 residual：`normalizeMarker` 拒绝；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S108 settlement-marker record identity mismatch residual: 1 file, 133 tests passed
```

## C-4P6-S109：well-formed non-canonical settlement-marker operationId 的 tests-only evidence

`db9e76c`（`test(data): cover non-canonical marker operationId and invalid record sha residuals`）修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 settlement marker non-canonical `operationId` residual：`normalizeMarker` via `requireOperationId` 拒绝；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。同提交亦引入 S110。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S109/S110 non-canonical marker operationId + invalid record contentSha256 residuals: 1 file, 135 tests passed
```

## C-4P6-S110：well-formed invalid settlement-marker record contentSha256 的 tests-only evidence

`db9e76c` 同提交补齐 settled 后 writing kind 但 `marker.record.contentSha256` 非合法 digest residual：`normalizeMarker` via `normalizeRecordRef` 拒绝；restart `reconcile()` → `review_required` + `invalid_settlement_marker`；不 rewrite authority、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
# P6-S110 invalid settlement-marker record contentSha256 residual: 1 file, 135 tests passed
```

## C-4P8：已关闭的受控 workspace-tool scope

C-4P8 的 S1 至 S4 已在**受控 `write_workspace_file` 文本文件 create / restricted-overwrite scope**关闭。S1 的 workspace descriptor foundation 证据为 `80f2fd0` / `e2ce36c`；S2 的 `b46c8b2` / `bdcd6cb` 和 S3 的 `56eabe6` / `54506d5` 仍是 POSIX descriptor-bound foundation；S4 的 handler/API integration 与定向测试为 `0bbfdef` / `e84c813`。2026-07-19 经明确批准后，Windows 另实现 root-constrained direct-path profile；它不把 Windows 冒充为该 descriptor-bound foundation。

### S4 请求、发布和稳定结果 contract

- 请求保持为 `{path, content, overwrite?}`。`overwrite` 缺省或为 `false` 时走 S2 no-clobber create：目标不存在时创建，目标已存在时返回 `target_exists`，不覆盖已有内容。`overwrite: true` 时，目标不存在仍走 S2 create；目标已存在且是 `nlink = 1` 的 regular file 才走 S3 restricted overwrite。directory、symlink、hardlink、FIFO、device、socket 和其它 non-regular target 均返回 `path_rejected`，不运行任一 publisher。
- `overwrite: true` 的竞争结果也属于稳定 contract：预检时 absent 但 S2 发布时已有目标出现，返回 `target_exists`；预检时为合格 regular file、但 S3 发布前目标消失、类型改变或不再满足 `nlink = 1` regular 条件，返回 `target_changed`。
- 对外稳定 code 仅为：`request_rejected`、`path_rejected`、`containment_unavailable`、`target_exists`、`target_changed`、`prepublication_failed`、`possibly_published`。结果不得暴露 raw internal error、absolute path、payload/content、descriptor path 或 temporary name。
- `possibly_published` 只以当前 profile 的 canonical regular leaf 完整字节 reread 确认：POSIX 使用 descriptor-bound read；Windows direct-path profile 使用再次进行 root/realpath containment 检查后的 direct-path read。字节完全一致时返回 `possiblyPublished: true`、`canonicalRead: 'exact'` 和 `retryable: false`；无法确认时返回 `code: 'possibly_published'` 与 `retryable: false`。
- 任何失败（包括 `target_exists`、`target_changed`、`prepublication_failed` 和 `possibly_published`）都不得自动 retry、rollback 或删除 canonical target；`possibly_published` 也不得被解释为“未执行”。
- journal 以同一 `toolCallId` replay 已记录结果；replay 不发生第二次 publish。该保证只覆盖此 tool 的记录/replay 边界，不扩大为全局 actionId、receipt 或跨工具 idempotency 协议。

POSIX 的 S3 仍是 descriptor-bound/no-follow、same-parent publication；restricted overwrite 只接受既有 `nlink = 1` regular leaf，采用 macOS `RENAME_SWAP` 或 Linux `RENAME_EXCHANGE`，不是 CAS，也不提供版本匹配、合并或 lost-update 防护。candidate 以 `0666 & umask` 创建，并采用旧 target normal mode `& 0777`；不承诺 special bits、owner/group、ACL、xattr、birth time 或其它 metadata 的完整保留。Windows S3 则是下文定义的 direct-path non-CAS profile，不能推断有 POSIX swap 的原子发布或 metadata-preservation 行为。

### Runtime 平台 capability 与产品边界

POSIX 和 Windows 使用**不同且显式命名的 capability profile**：

- **POSIX descriptor profile：**native addon 以 descriptor-relative/no-follow traversal 和 S2/S3 的 temporary + atomic publish 实现严格路径绑定；POSIX addon 不可加载时仍 fail closed，绝不退回 pathname write。
- **Windows direct-path profile（2026-07-19 经用户明确批准）：**参考 `codex-rust` 的分层方式：上层先把相对路径约束在可信 workspace root，并执行已有 symlink/realpath containment 检查；随后使用正常的 direct-path 文件 API。S2 使用 `wx` 的 no-clobber create，S3 仅对既有 `nlink = 1` regular target 以非创建式 `r+` handle truncate/write/sync。每次成功写入均进行 exact reread；任何不确定结果不 retry/rollback，而按现有 `possibly_published` 规则报告。

Windows profile **不是** descriptor-bound/HANDLE-relative traversal，也不是 target-file-ID compare-and-swap：external actor 若在检查与 direct-path open/write 之间替换 parent reparse point 或 final leaf，不属于它能证明安全的范围。它同样不提供 POSIX same-parent atomic exchange、directory `fsync` durability 或完整 metadata preservation。该限制是 Windows API audit 的结论，也是批准 direct-path S3 contract 的前提；代码、测试和产品文字均不得把它称为 strict containment、CAS 或 Windows durable publish。

- `getWorkspaceWriteToolAvailability()` 将两种可用 profile 映射为相同稳定的 `{ available: true }`；其它 host 仍返回 `{ available: false, code: 'containment_unavailable', message: '当前平台无法安全发布工作区文件。' }`，不携带本地路径、loader、errno、descriptor 或 temporary-name 细节。
- `buildDefaultRegistry()` 仍只在调用方已请求 workspace write、workspace read 已启用且当前 profile 可用时注册 `write_workspace_file`。不可用 host 的只读 workspace tools 保持注册，write definition 和 handler 均不存在；不会创建审批或 operation journal 条目。
- `settings.tools.approvalMode` 对已注册 writer 的语义不变。Windows direct-path writer 和 POSIX writer 都走既有审批、operation journal 与 same-`toolCallId` replay；后者仍避免第二次 publish。
- 直接调用内部 handler 时，profile 无法绑定或预条件不满足时仍只返回稳定、无本地细节的 error code。

### 2026-07-19 Windows host-native feasibility audit（阻塞证据，不是 Windows support）

在 Windows host（Windows SDK `10.0.26100.0`、Node `24.13.0`、VS 2022 Build Tools）实际重建当前 native addon；它能编译，但现有 `_WIN32` 分支仍明确拒绝 descriptor-relative traversal。审计当时没有据此打开 writer gate，也没有把“addon 可编译”误记为 Windows strict publish 证据；后续 direct-path profile 是单独、明确较弱的产品决定。

在 Microsoft SDK headers 和 Microsoft 文档允许的范围内，已核验 `NtCreateFile` 的 `RootDirectory`、`OBJ_DONT_REPARSE`、`FILE_OPEN_REPARSE_POINT` 与 `FILE_CREATE` 可用于 HANDLE-relative/no-follow traversal 与 S2 create-new；`GetFileInformationByHandleEx` 可提供 reparse、directory、link-count 和 file-ID 检查；`FlushFileBuffers` 可用于已打开 file/directory handle 的 flush。可是 `SetFileInformationByHandle(FileRenameInfo[/Ex])`、`ReplaceFileW` 以及相关 rename API 都没有“仅在期望 file ID 仍是当前 target 时替换”的 compare-and-swap / exchange parameter。持有 target handle 并拒绝 delete sharing 会阻止攻击者替换，却也会阻止替换发布；在 publish 前释放则重新引入 inspect-to-publish race。

对可替代机制的第二轮审计也没有得到例外：`CreateFileTransacted` / `MoveFileTransacted` 是 pathname-based TxF API，未提供 expected file-ID 参数，且 TxF 已被 Microsoft 标记为不建议新开发使用、未来版本可能不可用；`FileDispositionInfoEx`、`FileLinkInformation[Ex]`、`OpenFileById`、object-ID / CSV revision FSCTL 仅提供 delete/link、按 ID 打开或 metadata 查询/管理，均不是带 expected identity 的 replacement CAS。oplock、share mode 与 `LockFileEx` 也只是可被 break 的缓存/打开协调或 byte-range 锁，不能在任意并发 publisher 面前维持 namespace target identity。

因此，已审计的 Windows API 不能证明原先严格 S3 所要求的“existing single-link regular、target identity unchanged、atomic restricted overwrite”同时成立。尤其不能把“先以 HANDLE 检查，再以 handle-relative rename replace”描述为 target-changed-safe；它仍可能替换检查后被并发换入的 leaf。该结论保留不变。随后在 2026-07-19 获得明确授权后，产品选择的是一个**不同的** Windows direct-path non-CAS contract：允许 root-constrained pathname write，但不将它当作 strict containment 或 identity-safe replacement。

若未来要交付与 POSIX 相当的 Windows strict profile，仍需要可审计且能提供该原子 identity precondition 的 Windows/NTFS publish primitive；仅增加 HANDLE-relative S1/S2 不足以达到该标准。当前 Windows direct-path profile 是经批准的较弱合同，不修改下方既有 macOS/Linux descriptor 验证记录。

### 最终本地验证和 Linux host-native 记录

最终本地验证在 macOS 上构建 native addon，并实际执行以下五个 unit 文件，共 **123 tests passed**；另通过 typecheck、workspace write tool check、agent-operation idempotency check、workspace path target check、security check 和 diff check。这是定向验证记录，**不是 full suite** 声明。

```sh
pnpm run build:contained-durable-replace
pnpm exec vitest run --project unit tests/unit/contained-durable-directory.unit.test.ts tests/unit/workspace-contained-directory.unit.test.ts tests/unit/workspace-contained-create-no-overwrite.unit.test.ts tests/unit/workspace-contained-restricted-overwrite.unit.test.ts tests/unit/workspace-write-tool.unit.test.ts
pnpm run typecheck
pnpm run check:workspace-write-tool
pnpm run check:agent-operation-idempotency
node scripts/check-workspace-path-target.mjs
pnpm run check:security
git diff --check
```

`ed8d88a` / `9c452f3` 记录的现有 Linux host-native 证据来自 2026-07-19 的 [GitHub Actions run 29678781775](https://github.com/kaieye/StudiumX/actions/runs/29678781775)：GitHub-hosted `ubuntu-24.04` x64、Node `22.23.1`，本机构建 addon，并完成当时四个 P8 native 定向 unit files（**4 passed / 96 passed**、没有 skipped）。这证明该指定 Ubuntu host 上的 S2/S3 native branch 已有 hosted 证据；它不是所有 Linux filesystem/kernel、所有 Linux host、Windows 或 fully cross-platform 的声明。

### 固定 scope 与非目标

C-4P8 的关闭不改变 C-4 的 global partial-writer limitation，也不授权：

- 迁移所有 writer，或把任意 writer 都接到此 tool / durable operation；
- 跨文件 transaction、共同原子性、CAS 或 lost-update protection；
- IPC、renderer/UI、prompt 或 approvalMode 语义的变更；本轮仅增加 profile-aware registry eligibility，不把 Windows direct-path profile 伪装为 POSIX native capability；
- workspace registry、touch/save registry、conversation audit、generic JSONL、repair、migration、backup、retention 或 schema change；
- POSIX-equivalent Windows strict containment/CAS、所有 Linux filesystem/kernel，或 fully cross-platform support 的宣称；
- 完整 metadata preservation。

C-4P5 的 allowlisted Markdown service 是不同 consumer；其 allowlist/service contract 不由 C-4P8 继承或替代。

## C-4P9-S2 实施与 P9-S3/S4/S5/S6/S7/S8/S9/S10/S11/S12 evidence 验证入口

C-4P9 只实施了最小切片 S2；P9-S3、P9-S4、P9-S5、P9-S6、P9-S7 与 P9-S8 都是严格 tests-only evidence slice。S2 证据提交为 `4b30220`（`feat(data): add durable session audit append`）和 `5f47382`（`test(data): cover durable session audit append`）。S3 的 `c286a42`（`test(data): cover audit durable append recovery`）保留实际历史证据：partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory 与 conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；无生产语义改动。S4 的 `ab723a6`（`test(data): cover audit pre-write short-circuit`）仅覆盖 archive save 层首个 audit write 注入 `EIO` 且 audit 0 bytes：JSON/Markdown 保留、ledger 未执行；clean retry 后每个 canonical audit row 恰一条、ledger 恰一条。S5 的 `47393f9`（`test(data): cover audit directory capability symmetry`）仅修改测试，未修改 production code；Sol review approved。它对 audit directory 与 conversation parent directory 的 `open`/`sync` 做 capability symmetry 定向证据：五个 allowlist code 各覆盖两层、两种操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 的 `EINVAL` 仍 fatal。S5 无 production/API/schema/order 变化，不是完整 capability matrix，也不是生产功能。以下是受限 evidence 的实际验证命令和结果，不是完整 suite 的声明：

**P9-S3 的历史 evidence、P9-S4 的单一 pre-write short-circuit/retry evidence、P9-S5 的 directory capability symmetry evidence 与 P9-S6 的 ledger-own failure residual evidence 与 P9-S7 的 concurrent identical same-save evidence 与 P9-S8 的 divergent-trace conflict fail-closed evidence 与 P9-S9 的 concurrent same-ID body conflict fail-closed evidence 与 P9-S10 的 Markdown durable publish short-circuit residual evidence 与 P9-S11 的 Markdown-phase directory close residual evidence 与 P9-S12 的 Markdown-phase directory fsync residual evidence 与 P9-S13 的 Markdown-phase directory open residual evidence 与 P9-S14 的 JSON-phase directory open residual evidence 与 P9-S15 的 audit file open fail-closed residual evidence 与 P9-S16 的 audit file sync fail-closed residual evidence 与 P9-S17 的 audit file close fail-closed residual evidence 与 P9-S18 的 audit file lstat fail-closed residual evidence 与 P9-S19 的 audit file stat fail-closed residual evidence 与 P9-S20 的 audit incomplete write/read transfer fail-closed residual evidence 与 P9-S21 的 audit file open/sync/close EACCES fail-closed residual evidence 均已记录；C-4P9 仍未关闭。**

```sh
# P9-S3 historical evidence: 2 files, 61 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts
pnpm run typecheck
pnpm run check:security
git diff --check

# P9-S4: 1 file, 27 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts

# P9-S5 current slice: 1 file, 51 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts

# P9-S5 current slice with archive durable: 2 files, 78 tests passed

# P9-S6 ledger-own failure residual: 1 file, 27 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts

# P9-S7 concurrent identical same-save: 1 file, 52 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts

# P9-S8 divergent-trace conflict: 1 file, 53 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts

# P9-S9 concurrent same-ID body conflict: 1 file, 54 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts

# P9-S10 Markdown durable publish short-circuit: 1 file, 30 tests passed
# P9-S11 Markdown-phase directory close residual: 1 file, 31 tests passed
# P9-S12 Markdown-phase directory fsync residual: 1 file, 32 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts
pnpm run typecheck
pnpm run check:security
git diff --check
```

## C-4P9-S10：Markdown durable publish short-circuit residual 的 tests-only evidence

`9d54c5e`（`test(data): cover markdown publish short-circuit residual`）仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，将既有 Markdown write-failure short-circuit 并入 4-case matrix，并补齐 Markdown durable file sync / file close / rename 失败 residual：JSON 保留、Markdown 目标仍 `ENOENT`、不 append audit/ledger、无 temporary leftover。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts`（1 file / 30 tests passed）。S10 不是完整 C-4P1 short-circuit matrix 或 C-4P9 gate closure。

## C-4P9-S11：Markdown-phase directory close residual 的 tests-only evidence

`bab5d1e`（`test(data): cover markdown directory close residual`）仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，新增独立 `it`，补齐 Markdown-phase directory close residual：第二次 `close:conversation/...`（Markdown rename 之后）返回 `EIO` 时 JSON 与 Markdown 均已发布、不 append audit/ledger、无 temporary leftover、save 不报告成功。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts`（1 file / 31 tests passed）。S11 不是完整 C-4P1 short-circuit matrix 或 C-4P9 gate closure。

## C-4P9-S12：Markdown-phase directory fsync residual 的 tests-only evidence

`2aec1bc`（`test(data): cover markdown directory sync residual`）仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，新增独立 `it`，补齐 Markdown-phase directory fsync residual：第二次 `sync:conversation/...`（Markdown rename 之后）返回 `EIO` 时 JSON 与 Markdown 均已发布、不 append audit/ledger、无 temporary leftover、save 不报告成功。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts`（1 file / 32 tests passed）。S12 不是完整 C-4P1 short-circuit matrix 或 C-4P9 gate closure。


## C-4P9-S13：Markdown-phase directory open residual 的 tests-only evidence

`5e35703`（`test(data): cover markdown directory open residual`）仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，新增独立 `it`，补齐 Markdown-phase directory open residual：第二次 `open:r:conversation/...`（Markdown rename 之后）返回 `EIO` 时 JSON 与 Markdown 均已发布、不 append audit/ledger、无 temporary leftover、save 不报告成功。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts
# P9-S13 Markdown-phase directory open residual: 1 file, 33 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。


## C-4P9-S14：JSON-phase directory open residual 的 tests-only evidence

`be460a4`（`test(data): cover json directory open residual`）仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，新增独立 `it`，补齐 JSON-phase directory open residual：第一次 `open:r:conversation/...`（JSON rename 之后）返回 `EIO` 时 JSON 已发布、Markdown 仍缺失、不 append audit/ledger、无 temporary leftover、save 不报告成功。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts
# P9-S14 JSON-phase directory open residual: 1 file, 34 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。

## C-4P9-S15：audit file open fail-closed residual 的 tests-only evidence

`8779879`（`test(data): cover audit file open residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file open fail-closed residual：对 audit 目标 open 注入 `EIO` 以及 directory-fsync allowlist 五码（`EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR`）均保持 fatal、不 capability downgrade、无 write、无 warning、无 audit 文件创建。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S15 audit file open fail-closed residual: 1 file, 60 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。

## C-4P9-S16：audit file sync fail-closed residual 的 tests-only evidence

`07ecb54`（`test(data): cover audit file sync residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file sync fail-closed residual：对 audit 目标 sync 注入 `EIO` 以及 directory-fsync allowlist 五码（`EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR`）均保持 fatal、不 capability downgrade；事件含 `sync:${path}`；不启动 directory open；无 warning。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S16 audit file sync fail-closed residual: 1 file, 66 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。

## C-4P9-S17：audit file close fail-closed residual 的 tests-only evidence

`8848af7`（`test(data): cover audit file close residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file close fail-closed residual：对 audit 目标 close 注入 `EIO` 以及 directory-fsync allowlist 五码（`EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR`）均保持 fatal、不 capability downgrade；事件含 `close:${path}`；不启动 directory open；无 warning。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S17 audit file close fail-closed residual: 1 file, 72 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。

## C-4P9-S18：audit file lstat fail-closed residual 的 tests-only evidence

`54cec58`（`test(data): cover audit file lstat residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file lstat fail-closed residual：对 audit 目标 lstat 注入 `EIO`/`EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR`/`EACCES` 均保持 fatal、不 capability downgrade；事件含 `lstat:${path}`；不 open、不启动 directory open；无 warning；audit 文件未创建。ENOENT 仍是 empty-path 成功路径，不在本 residual 内。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S18 audit file lstat fail-closed residual: 1 file, 79 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。

## C-4P9-S19：audit file stat fail-closed residual 的 tests-only evidence

`529febd`（`test(data): cover audit file stat residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file open 后 `stat` fail-closed residual：对已 open 的 audit 目标 `stat` 注入 `EIO`/`EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR`/`EACCES` 均保持 fatal、不 capability downgrade；事件含 `stat:${path}`；open 已发生但无 write；不启动 directory open；无 warning。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S19 audit file stat fail-closed residual: 1 file, 86 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。

## C-4P9-S20：audit incomplete write/read transfer fail-closed residual 的 tests-only evidence

`8091193`（`test(data): cover audit incomplete write residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`（含 test-only `readPlan` 扩展），补齐 incomplete byte-transfer residual：

- write 返回 `bytesWritten` 为 `0` 或 `NaN` → throw `Conversation session audit could not be written completely.`
- read 返回 `bytesRead` 为 `0` 或 `NaN` → throw `Conversation session audit could not be read exactly.`
- 不 capability downgrade；事件含对应 `write:` / `read:`；不启动 directory open；无 warning

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S20 audit incomplete write/read transfer fail-closed residual: 1 file, 90 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。

## C-4P9-S21：audit file open/sync/close EACCES fail-closed residual 的 tests-only evidence

`9309b81`（`test(data): cover audit file EACCES residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file open/sync/close fail-closed matrices 扩展包含 `EACCES`：均 fatal、不 capability downgrade；open 失败时不创建 audit 文件、不启动 directory open；无 warning。与 lstat/stat `EACCES` residual 形成 file-path 权限失败对称。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S21 audit file open/sync/close EACCES fail-closed residual: 1 file, 93 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。

## C-4P9-S22：audit directory mkdir fail-closed residual 的 tests-only evidence

`79e9d8d`（`test(data): cover audit directory mkdir residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`（含 test-only `mkdir` 观测 instrumentation），补齐 audit directory mkdir fail-closed residual：对 audit directory `mkdir` 注入 `EIO`/`EACCES` 均 fatal、不 lstat、不 open、不 capability downgrade、无 warning、无 audit 文件创建。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S22 audit directory mkdir fail-closed residual: 1 file, 95 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。

## C-4P9-S23：audit/parent directory open fatal fail-closed residual 的 tests-only evidence

`c3f9be5`（`test(data): cover audit directory open fatal residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit directory 与 conversation parent directory open fatal fail-closed residual：对 directory `open:r` 注入 `EACCES`/`EPERM`/`EIO`/unknown 均 fatal、不 capability downgrade、不继续 directory sync、无 warning。file append 可能已完成，但 directory durability 失败仍 reject。无生产语义改动。

验证入口：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S23 audit/parent directory open fatal fail-closed residual: 1 file, 103 tests passed
pnpm run typecheck
pnpm run check:security
git diff --check
```

该切片**不宣称** C-4P9 已关闭，也不覆盖完整 capability matrix、generic JSONL、rotation 或 IPC/UI。


## C-4P9-S24：audit/parent directory sync fatal fail-closed residual 的 tests-only evidence

`8a27fc9`（`test(data): cover audit directory sync fatal residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit directory 与 conversation parent directory sync fatal fail-closed residual：对 directory `sync` 注入 `EACCES`/`EPERM`/`EIO`/unknown 均 fatal、不 capability downgrade、无 warning。file append 可能已完成，但 directory durability 失败仍 reject。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S24 audit/parent directory sync fatal fail-closed residual: 1 file, 107 tests passed
```


## C-4P9-S25：post-open audit target non-file fail-closed residual 的 tests-only evidence

`fc765d2`（`test(data): cover audit post-open non-file residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 post-open audit target non-file fail-closed residual：handle `stat` 报告 non-file 时 reject `not a regular file`、不 capability downgrade、不 read/write、不启动 directory durability、无 warning。使用 test-only `statPlan` instrumentation。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S25 post-open audit target non-file fail-closed residual: 1 file, 108 tests passed
```


## C-4P9-S26：audit directory mkdir fatal residual matrix 的 tests-only evidence

`c3c8db5`（`test(data): cover audit directory mkdir fatal residual matrix`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit directory mkdir fatal residual matrix：对 `mkdir` 注入 `EIO`/`EACCES`/`EPERM`/`ENOSPC`/`EINVAL`/unknown 均 fatal、不 capability downgrade、不 lstat/open/write/sync、无 warning、无 audit 文件创建。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S26 audit directory mkdir fatal residual matrix: 1 file, 112 tests passed
```

## C-4P9-S27：audit file write fatal residual matrix 的 tests-only evidence

`4e3ce10`（`test(data): cover audit file write fatal residual matrix`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file write fatal residual matrix：对首个 audit file `write` 注入 `EIO`/`EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR`/`EACCES`/`EPERM`/`ENOSPC` 均 fatal、不 capability downgrade、不启动 directory open/sync、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S27 audit file write fatal residual matrix: 1 file, 121 tests passed
```

## C-4P9-S28：audit file write unknown error residual 的 tests-only evidence

`46a46ad`（`test(data): cover audit file write unknown error residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file write unknown error residual：对首个 audit file `write` 注入 non-errno unknown Error 时 fatal、不 capability downgrade、不启动 directory open/sync、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S28 audit file write unknown error residual: 1 file, 122 tests passed
```

## C-4P9-S29：audit file open EPERM/ENOSPC residual 的 tests-only evidence

`abe159d`（`test(data): cover audit file open EPERM/ENOSPC residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file open fatal residual matrix 扩到 `EPERM`/`ENOSPC`：open 失败 fatal、不 capability downgrade、不 write、不启动 directory open、无 warning、无 audit 文件创建。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S29 audit file open EPERM/ENOSPC residual: 1 file, 124 tests passed
```




## C-4P9-S30：audit file sync EPERM/ENOSPC residual 的 tests-only evidence

`905ffb9`（`test(data): cover audit file sync EPERM/ENOSPC residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file sync fatal residual matrix 扩到 `EPERM`/`ENOSPC`：sync 失败 fatal、不 capability downgrade、不启动 directory open、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S30 audit file sync EPERM/ENOSPC residual: 1 file, 126 tests passed
```

## C-4P9-S31：audit file close EPERM/ENOSPC residual 的 tests-only evidence

`6620564`（`test(data): cover audit file close EPERM/ENOSPC residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file close fatal residual matrix 扩到 `EPERM`/`ENOSPC`：close 失败 fatal、不 capability downgrade、不启动 directory open、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S31 audit file close EPERM/ENOSPC residual: 1 file, 128 tests passed
```

## C-4P9-S32：audit file lstat EPERM/ENOSPC residual 的 tests-only evidence

`b06d862`（`test(data): cover audit file lstat EPERM/ENOSPC residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file lstat fatal residual matrix 扩到 `EPERM`/`ENOSPC`：lstat 失败 fatal、不 capability downgrade、不 open/write、不启动 directory open、无 warning、无 audit 文件创建。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S32 audit file lstat EPERM/ENOSPC residual: 1 file, 130 tests passed
```

## C-4P9-S33：audit file stat EPERM/ENOSPC residual 的 tests-only evidence

`3776a25`（`test(data): cover audit file stat EPERM/ENOSPC residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，将 audit file stat fatal residual matrix 扩到 `EPERM`/`ENOSPC`：stat 失败 fatal、不 capability downgrade、不 write、不启动 directory open、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S33 audit file stat EPERM/ENOSPC residual: 1 file, 132 tests passed
```


## C-4P9-S34：audit file sync unknown error residual 的 tests-only evidence

`4ca4b62`（`test(data): cover audit file sync unknown error residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file sync unknown non-errno error residual：sync 返回未知 Error 时 fatal、不 capability downgrade、不启动 directory open、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S34 audit file sync unknown error residual: 1 file, 133 tests passed
```


## C-4P9-S35：audit file open unknown error residual 的 tests-only evidence

`cefb92f`（`test(data): cover audit file open unknown error residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file open unknown non-errno error residual：open 返回未知 Error 时 fatal、不 capability downgrade、不启动 directory open、无 warning、无 audit 文件创建。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S35 audit file open unknown error residual: 1 file, 134 tests passed
```


## C-4P9-S36：audit file close unknown error residual 的 tests-only evidence

`683599b`（`test(data): cover audit file close unknown error residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file close unknown non-errno error residual：close 返回未知 Error 时 fatal、不 capability downgrade、不启动 directory open、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S36 audit file close unknown error residual: 1 file, 135 tests passed
```


## C-4P9-S37：audit file lstat unknown error residual 的 tests-only evidence

`dddc2cc`（`test(data): cover audit file lstat unknown error residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file lstat unknown non-errno error residual：lstat 返回未知 Error 时 fatal、不 open/write、不 capability downgrade、无 warning、无 audit 文件创建。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S37 audit file lstat unknown error residual: 1 file, 136 tests passed
```

## C-4P9-S38：audit file stat unknown error residual 的 tests-only evidence

`ac2f27f`（`test(data): cover audit file stat unknown error residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file stat unknown non-errno error residual：stat 返回未知 Error 时 fatal、不 write、不 capability downgrade、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S38 audit file stat unknown error residual: 1 file, 137 tests passed
```

## C-4P9-S39：audit file read unknown error residual 的 tests-only evidence

`7b5a4e6`（`test(data): cover audit file read unknown error residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file read unknown non-errno error residual：seeded non-empty audit 后 continuation read 返回未知 Error 时 fatal、不 write、不 capability downgrade、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S39 audit file read unknown error residual: 1 file, 138 tests passed
```

## C-4P9-S40：audit file read errno residual matrix 的 tests-only evidence

`fca501c`（`test(data): cover audit file read errno residual matrix`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file read errno residual matrix：read 返回 `EIO`/`EINVAL`/`EACCES`/`EPERM`/`ENOSPC` 时 fatal、不 write、不 capability downgrade、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S40 audit file read errno residual matrix: 1 file, 143 tests passed
```

## C-4P9-S41：audit file read partial-then-stall residual 的 tests-only evidence

`570a372`（`test(data): cover audit file read partial-then-stall residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file read partial-then-stall residual：read 先推进 1 byte 再返回 0 时 fail closed、不 write、不 capability downgrade、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S41 audit file read partial-then-stall residual: 1 file, 144 tests passed
```

## C-4P9-S42：audit file write partial-then-stall residual 的 tests-only evidence

`1383428`（`test(data): cover audit file write partial-then-stall residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file write partial-then-stall residual：write 先推进 1 byte 再返回 0 时 fail closed、不 capability downgrade、不启动 directory open、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S42 audit file write partial-then-stall residual: 1 file, 145 tests passed
```

## C-4P9-S43：audit negative transfer residual counts 的 tests-only evidence

`8570645`（`test(data): cover audit negative transfer residual counts`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit file read/write negative transfer residual：`bytesRead`/`bytesWritten` 返回 `-1` 时 fail closed、read residual 不 write、不 capability downgrade、不启动 directory open、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S43 audit negative transfer residual counts: 1 file, 147 tests passed
```

## C-4P9-S44：audit file write multi-byte partial-then-stall residual 的 tests-only evidence

`e06a117`（`test(data): cover multi-byte write partial-stall residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit write multi-byte partial-then-stall residual：首次 `bytesWritten: 2` 后 `0`，fail closed、不 capability downgrade、不启动 directory open、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S44 audit write multi-byte partial-then-stall residual: 1 file, 148 tests passed
```

## C-4P9-S45：audit file read multi-byte partial-then-stall residual 的 tests-only evidence

`33a914a`（`test(data): cover multi-byte read partial-stall residual`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 audit exact-read multi-byte partial-then-stall residual：首次 `bytesRead: 2` 后 `0`，fail closed、不 write、不 capability downgrade、不启动 directory open、无 warning。无生产语义改动。

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
# P9-S45 audit read multi-byte partial-then-stall residual: 1 file, 149 tests passed
```

## C-4P9-S9：concurrent same-ID body conflict 的 tests-only evidence

`dcb9bae`（`test(data): cover concurrent same-ID body conflict`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 concurrency residual：两路并发 append 同 conversation 但不同 canonical body 时 per-path queue 线性化，一路成功、一路 reject `conflicts with its canonical record`，winner bytes 与单次顺序 write 一致。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`（1 file / 54 tests passed）。S9 不是完整 concurrency matrix 或 C-4P9 gate closure。

## C-4P9-S8：divergent-trace conflict 的 tests-only evidence

`bee173f`（`test(data): cover audit divergent-trace conflict`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 trace conflict 不得误作 exact dedupe residual：on-disk 同 identity 但 `traceId` 分叉的两行，retry 同 record 必须 throw `Conversation session audit contains divergent duplicate records.`，poisoned bytes 不变，无额外 `write:`、无 rewrite。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`（1 file / 53 tests passed）。S8 不是完整 trace/legacy matrix 或 C-4P9 gate closure。

## C-4P9-S7：concurrent identical same-save 的 tests-only evidence

`816e403`（`test(data): cover concurrent identical audit saves`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 concurrent identical same-save residual：per-path queue 线性化，两路并发 append 同一 record 时仅一个 open lifecycle、一个 session header、entry IDs 唯一，exact bytes 与单次顺序 write 一致。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`（1 file / 52 tests passed）。S7 不是完整 concurrency matrix 或 C-4P9 gate closure。

## C-4P9-S6：ledger-own failure residual 的 tests-only evidence

`5f931c9`（`test(data): cover audit ledger failure recovery`）仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，加强既有 ledger-own failure residual：audit 在 ledger 失败后保留期望 header 与 canonical entry IDs 且不 rollback；retry 保持 exact audit bytes、不写 audit、恰一条 ledger 行；随后 idempotent save 保持 audit 与 ledger bytes 不变。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts`（1 file / 27 tests passed）。S6 不是完整 C-4P9、完整 residual matrix、generic JSONL、rotation、事务或 IPC/UI。

## C-4P9-S2 已实施的受限语义

- 仅替换固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit append boundary；不 rotation，且不调用或迁移到 generic `durable-jsonl`。
- 模块私有 queue 按**规范化绝对 audit path**串行化；同一路径在一个 descriptor 生命周期内完成 exact-byte read、canonical/legacy validate、dedupe/conflict 判定、framed append、file `fsync` 与 `close`。
- 缺失 canonical rows 才追加：保留已有 raw bytes，并仅在既有非空末字节不是 LF 时添加一个隔离 LF；legacy trace-free/malformed-trace rows 可兼容读取，既有 trace write-once 行不回填、不重写。
- file close 后按 audit directory、再 conversation parent directory 的子到父顺序确认 durability。directory `open`/`sync` 仅 `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 可降级为通用 warning；其它错误及任何 close failure 均 fatal。
- post-directory failure 会使 save reject 且不回滚；retry 先重新读取、dedupe exact rows，再允许既有 ledger flow 继续。

这不关闭 C-4P9，也不表示完整 capability matrix、generic JSONL migration、跨文件 transaction、ledger authority/save-order 改造、repair、rotation 或 IPC/UI 已交付。P9-S3 的历史定向 unit 结果仍必须记为 **61 tests passed**；P9-S5 本切片 **51**、P9-S7 **52**、P9-S8 **53**、P9-S9 **54**、P9-S10 archive durable **30**、P9-S11 archive durable **31**、P9-S12 archive durable **32** 都是各自切片时的定向计数，不要混用历史与当前数字。未完成工作仍见[本地数据待办](../local-data-todo.md)。
