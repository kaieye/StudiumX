# ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-19
- **范围：** 用共享 durable-file capability 承担经过审查的关键文件 replace / publish 语义，并逐项迁移 consumer；C-4 是部分 writer 迁移，不是全部 writer。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0001](0001-rebuildable-sqlite-projection.md)、[ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)、[ADR-0019](0019-session-audit-v1-wire-contract-and-limited-authority.md)、[ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md)、[ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)、[ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)、[ADR-0131](0131-pathname-default-durable-io.md)
- **证据：** `docs/adr/evidence/ADR-0004.md`（逐切片 commit 与测试基线）；`tests/unit/durable-file.unit.test.ts`、`tests/unit/workspace-write-tool.unit.test.ts`、`tests/unit/learning-outcome-committer.unit.test.ts`、`tests/unit/agent-conversation-session-audit.unit.test.ts`

## 背景

关键本地数据 writer 曾分别实现 publish、append、path containment 与失败处理，容易让局部成功被误解为统一 durability、跨文件 transaction 或所有平台同等保证。需要一个共享 capability，同时仍让每个 consumer 明确自己的 canonical authority、路径限制、平台 profile 与恢复语义；未被审查和验证的 writer 不能因共享实现存在而自动获得该保证。

## 决定

以共享 durable-file capability 承担经过审查的关键文件 replace / publish 语义，并逐项迁移 consumer；每个 consumer 保留自身的 canonical authority、路径约束和错误语义。C-4 的完成含义是“共享原语及下列 consumer 已迁移”，**不是所有 writer 已迁移**，也不构成跨文件事务。

各子工作线现状：

- **C-4P6**：仅有 S1（learning-outcome 严格有序 publish、受控 reconcile 与失败关闭基础）的生产实现；S2…S194 为 tests-only evidence。受限 macOS/APFS profile 已由 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) 结项。
- **C-4P8**：受控 `write_workspace_file` 文本文件 create / restricted-overwrite scope 已关闭（含获批的 Windows direct-path non-CAS profile）；**Windows strict 以 ADR-0035 结项为 no-go / unsupported**。
- **C-4P9**：仅有 S2 的 audit 专用 fixed-file durable append 生产实现，S3…S45 为 tests-only evidence；fixed-file audit boundary 已由 ADR-0035 结项且不扩张。
- **部分 consumer migration 本身仍是本 ADR 的历史边界**：未被审查的 writer 未迁移。

## 不变量

1. 新 consumer 必须逐项审查并单独迁移；共享原语、既有测试或某一 consumer 的 close-out 都不授权扩大到其它 writer。
2. 每个 consumer 拥有自身的 canonical authority、路径约束、错误结果与恢复顺序；失败、可能已发布或无法证明的状态不得被通用地自动 retry、rollback、delete 或报为成功。
3. **不提供**跨文件 transaction / common atomicity、rollback 与 delete 语义；不把 directory-sync warning 或本机测试计数误读为 strict / power-loss proof。
4. P6 受限 profile、P8 Windows strict no-go 与 P9 fixed-file 不扩张已由 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) 结项，不是当前可分派的 local-data 实现切片。
5. 跨 consumer 的平台能力分层 / Windows memory 扩展见 [ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)；默认写模型见 [ADR-0131](0131-pathname-default-durable-io.md)。两者**不**改写本 ADR 的 P8 历史 evidence，也**不**重开 Windows strict。
6. 任何更强 durability、transaction、generic JSONL、Windows strict、IPC/UI 或 public-result 扩张，都必须由**新 ADR** 重新定义 profile 与证据门槛。

## 后果

- 未审查 writer 保持既有 durable-file 合同，不因共享原语自动获得新保证。
- `write_workspace_file` 的对外稳定 code（`request_rejected`、`path_rejected`、`containment_unavailable`、`target_exists`、`target_changed`、`prepublication_failed`、`possibly_published`）与 same-`toolCallId` replay 语义继续有效；`possibly_published` 不得解释为“未执行”，失败不得自动 retry/rollback/delete。
- Windows direct-path profile 是经批准的**较弱**合同：root-constrained pathname 写、exact reread，非 descriptor-bound / 非 CAS / 非 atomic exchange；代码、测试与产品文字不得把它称为 strict containment 或 Windows durable publish。

## 验证

- 共享原语：`pnpm exec vitest run --project unit tests/unit/durable-file.unit.test.ts`
- 已迁移 consumer 与 P6/P8/P9 逐切片验证入口、提交与历史测试基线：见 `docs/adr/evidence/ADR-0004.md`
- 结项权威与运维步骤：`docs/adr/evidence/ADR-0004.md` 及 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)

## 非目标

- 不迁移所有 writer，或把任意 writer 都接到此 tool / durable operation。
- 不提供跨文件 transaction、共同原子性、CAS 或 lost-update protection。
- 不授权 IPC、renderer/UI、prompt 或 approvalMode 语义的变更；不提供 generic JSONL、rotation、repair、migration、backup、retention 或 schema change。
- 不宣称 POSIX-equivalent Windows strict containment/CAS、所有 Linux filesystem/kernel 或 fully cross-platform support。
- 不提供完整 metadata preservation。
