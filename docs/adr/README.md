# 架构 ADR 索引

本目录记录已经实施、且有代码、测试和 Git 提交证据的架构决定。ADR（Architecture Decision Record，架构决策记录）说明系统为什么采用某项重要做法、已经落地到什么范围，以及它**没有**授权做什么。

## 先从这里读

- 想快速了解现状：阅读下方的“已实施决定”表。
- 想知道某项做法的原因、边界和测试入口：打开对应 ADR。
- 想知道接下来还准备做什么：阅读[本地数据待办](../local-data-todo.md)。它记录未完成范围及待批准的后续工作；其中不应被视为已实现功能，除非相应条目明确标明已实施的受限切片。
- 下一步工作必须遵循：待办页 → 对应 design gate 获得 scope / owner / API 批准 → 单独立项实施；design gate 本身不授权直接修改 writer。
- 想研究已关闭或未完成工作的历史方案：从 ADR 或待办页进入 `docs/plans/` 中对应文档，并以文档的状态字段为准。

## 按问题查阅

| 你关心的问题 | 建议先读 |
| --- | --- |
| SQLite 分析索引损坏后能否隔离、重建或回退读取 | ADR-0001 |
| canonical teaching data 的永久保留边界，以及 logical JSONL 如何分区、分段和生成会话摘要 | ADR-0002 |
| 关键 JSON 不可读时如何从 `.bak` 验证恢复 | ADR-0003 |
| 哪些 writer 已使用 durable publish，以及受控 `write_workspace_file` 的 P8 S1–S4 closure 到哪里 | ADR-0004、[本地数据待办](../local-data-todo.md) |
| 已覆盖持久化链如何关联 trace，同时保持日志安全 | ADR-0005 |
| Memory 数据如何按范围隔离，以及能否迁移旧数据 | ADR-0006 |
| 新持久化 conversation/history 如何先经脱敏 | ADR-0007 |
| 哪些本地数据能力仍未完成 | [本地数据待办](../local-data-todo.md) |
| P0 教学 Session 如何成为 canonical 事实，而非 Agent run 或 Lesson 目录 | ADR-0008 |
| Lesson 回答、检索练习与 conversation 互动如何成为可追溯 Evidence | ADR-0009 |
| 为什么 Lesson 生成不会再自动写正式 Learning record | ADR-0010 |
| 谁可以从 Evidence 写入正式 outcome / Learning record | ADR-0011 |
| 后续教学动作如何避免由自由文本 prompt 决定 | ADR-0012 |
| 教学 context 与资源如何受 provenance 和预算约束 | ADR-0013 |
| 如何将运行时教学事实安全地呈现给学习者 | ADR-0014 |
| 教学运行事件如何保持版本化和封闭 payload | ADR-0015 |
| OutcomeEvaluator 如何仅信任绑定且校验过的 assessment artifact | ADR-0016 |
| Win/Mac P0 发布如何证明完成，以及 audit skip 政策 | ADR-0017 |
| Recordless outcome（`needs_practice` / `not_evidenced`）以什么为 settlement authority | ADR-0018 |
| Session audit JSONL 的 V1 wire、exact-retry 与有限 authority 边界 | ADR-0019 |
| C-4P6 Phase 0 platform profile 与 settlement failure matrix | ADR-0020、ADR-0021 |
| Direct-UI lesson generation 的 actionId / receipt / exact-retry 边界 | ADR-0023 |

## 已实施决定

| ADR | 主题 | 已实施范围 |
| --- | --- | --- |
| [ADR-0001](0001-rebuildable-sqlite-projection.md) | C-1 可重建 SQLite projection 与 no-FTS 边界 | SQLite 仅作为可再建 analytics 投影并保留 canonical 文件回退；FTS、查询/搜索面与 query-facing corpus 均未获授权。 |
| [ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md) | C-2 canonical 永久保留、分区、分段与摘要 projection | canonical teaching data 永久保留；UTC 月分区、无损 sealed JSONL 分段和显式会话摘要 projection 已实施。physical retention / recovery 未获批准；相邻 agent-artifact 年龄/大小删除路径已移除。 |
| [ADR-0003](0003-critical-json-backups-and-verified-recovery.md) | C-3 关键 JSON 备份与恢复 | `.bak` 备份及 verified read recovery。 |
| [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) | C-4 durable publish | 共享 durable publish 原语及已迁移的部分 consumer。C-4P6 仅有 S1 的严格有序 publish / 受控恢复生产基础；S2…S194 是 tests-only historical evidence（定向 unit 历史基线：219 passed），完整 P6 未关闭，不能推断跨文件 transaction / common atomicity、完整 manifest failure matrix 或 Windows power-loss closure。P8-S1…S4 的受控 `write_workspace_file` 文本文件 scope 已关闭，含获批的 Windows direct-path non-CAS profile；P9 仅有 S2 audit 专用 durable append，S3…S45 均为 tests-only evidence，完整 P9 仍未关闭。C-4 始终是 partial writer migration，不表示所有 writer、CAS/lost-update protection、Windows strict/fully cross-platform durable publish 或 metadata full preservation。 |
| [ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md) | C-5 trace correlation | main 生成的 trace correlation 与安全日志边界。 |
| [ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md) | C-6 Memory | scope 分区及 aggregate-only readonly migration preflight。 |
| [ADR-0007](0007-persisted-user-history-redaction.md) | C-7 历史数据脱敏 | 新持久化 conversation/history projection 的脱敏边界。 |
| [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md) | P0 LearningSession ledger | 独立的 canonical LearningSession、幂等 receipt、恢复与 legacy projection；领域基线，发布证明见 ADR-0017。 |
| [ADR-0009](0009-typed-lesson-interaction-evidence.md) | P0 typed Evidence | Lesson / conversation 互动的原始可追溯 Evidence、原子 receipt 与 preview 绑定；不是 outcome 或 record。 |
| [ADR-0010](0010-evidence-gated-learning-record-cutover.md) | P0 Learning record cutover | 切断 Lesson 生成自动写正式 Learning record；`learningRecordNote` 仅为待验证 evidence/rubric。 |
| [ADR-0011](0011-evidence-gated-learning-outcome-settlement.md) | P0 outcome settlement | Evidence-gated 的 canonical outcome / Learning record 结算、有序发布、reconcile 和窄 IPC sole-writer 边界。 |
| [ADR-0012](0012-deterministic-next-teaching-step-planner.md) | P0 next teaching step | 由 outcome / Evidence 导出的确定性 typed 教学动作，而非自由文本推断。 |
| [ADR-0013](0013-budgeted-provenance-aware-teaching-context.md) | P0 teaching context | provenance allowlist、预算化 context 装配及最小 resource grounding。 |
| [ADR-0014](0014-learner-safe-teaching-turn-presentation.md) | P0 learner presentation | 教学事实的 learner-safe 四阶段投影、redaction 和 a11y 边界。 |
| [ADR-0015](0015-canonical-teaching-event-protocol.md) | P1 canonical teaching events | 版本化封闭 event envelope、event bus 与 legacy adapter 边界。 |
| [ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md) | P0 assessment evaluator | 仅信任绑定、publisher-owned、digest 校验的 assessment artifact，并对不可信输入保守失败。 |
| [ADR-0017](0017-win-mac-p0-release-proof-and-audit-policy.md) | P0 Win/Mac release proof | clean-checkout audit、Win/Mac skip 预算、runtime gates 与真实 Electron longitudinal/crash Golden；Linux 产品船与 C-4 完整 migration 不在此声明。 |
| [ADR-0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md) | P0 recordless settlement | `needs_practice` / `not_evidenced` 仅以 `record: null` 的 settlement marker 为 authority；不写 record/outcome/completed Session，且不 promote。 |
| [ADR-0019](0019-session-audit-v1-wire-contract-and-limited-authority.md) | C-4P9 audit V1 contract | per-conversation audit JSONL 的 V1 wire/identity/exact-retry 与有限 authority；不授权 generic JSONL、rotation、repair 或跨进程 multi-writer。 |
| [ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md) | C-4P6 Phase 0 freeze + Phase 1 pointer | 首个目标 macOS APFS strict-candidate profile、I/O inventory、crash/public-result matrix 与 Windows non-strict 边界；后续受限 close-out 见 ADR-0021。 |
| [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) | C-4 P6/P8/P9 scope close-out | P6 仅以 macOS internal APFS runtime-adjacent evidence 结项；P8 Windows strict 以 unsupported/no-go 结项；P9 保持既有 fixed-file audit boundary，不扩张为 strict/generic/cross-process/transaction/public surface。 |
| [ADR-0023](0023-direct-ui-lesson-generation-action-correlation.md) | C-5I direct-UI lesson generation correlation | 仅 direct-UI `generateLesson` / `generateLessonStream`：caller UUID v4 `actionId`、private receipt、HMAC requestTag、status poll 与 fail-closed dispositions；agent path 隔离；不覆盖 mission、C-5H、全局 projection recovery 或 content dedupe。 |

## C-4P6 历史 evidence 边界

> 本节保存 ADR-0004 的历史 evidence 范围；当前 close-out status 以 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) 为准。

- **已实施：**仅 S1（`7292bf4` / `e02a086`）的严格有序 publish、受控 reconcile 与失败关闭基础；历史验证为 41 项 unit 和 14 项 integration，不是完整 P6 矩阵。
- **tests-only historical evidence：**S2 `9847842` 是单一 `after_outcome_publish` restart/reconcile；S3 `1334513` 是 settlement-marker durable-rename `EIO` 后仅补 marker，不能扩大为泛化 `after_manifest_publish`。S4…S194（`e821c69`…`c1fb162`）累积有序发布、marker/record/manifest residual、failure 注入及 commit 前 session/event validation 的 fail-closed 覆盖；没有 production/API/schema/path/order 改动。定向 unit 历史基线为 **1 file、219 tests passed**，不是 full suite。
- **仍阻塞：**manifest capability-policy 和完整 `open` / `write` / `fsync` / `close` failure matrix；其它 crash/failure windows；跨文件 transaction / common atomicity、rollback、delete；migration、API、operations validation；以及 Windows power-loss / native durable-closure 证据。

所以 C-4P6 未关闭。不得从这些证据推断跨文件原子性、完整 host-native settlement 或 Windows power-loss closure。Phase 0 profile/matrix 已冻结于 [ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md)；Phase 1 containment/directory-sync 对齐已落地但仍属 unit residual。权威范围与剩余 design gate 见 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[P6 剩余计划](../plans/local-data-learning-outcome-durable-settlement-design.md) 和[本地数据待办](../local-data-todo.md)。

## C-4P8 S1–S4 已关闭 scope：证据与实际验证入口

ADR-0004 记录的 C-4P8 已在**受控 `write_workspace_file` 文本文件 create / restricted-overwrite scope**关闭：S1 `80f2fd0` / `e2ce36c`、S2 `b46c8b2` / `bdcd6cb`、S3 `56eabe6` / `54506d5`，以及 S4 handler/API integration `0bbfdef` / `e84c813`。这不是所有 workspace writer 或完整 C-4 的 closure。

- 请求仍是 `{path, content, overwrite?}`。`overwrite` 缺省或为 `false` 时使用 S2 no-clobber create：目标不存在时创建，目标已存在时返回 `target_exists`，不覆盖已有内容。`overwrite: true` 时，目标不存在仍使用 S2 create；目标已存在且是 `nlink = 1` 的 regular file 才使用 S3 restricted overwrite。directory、symlink、hardlink、FIFO、device、socket 和其它 non-regular target 均返回 `path_rejected`，不运行任一 publisher。预检时 absent 但发布时已有目标出现返回 `target_exists`；原本合格的 regular target 在 S3 前消失、类型改变或不再满足条件返回 `target_changed`。
- tool-facing stable code 为 `request_rejected`、`path_rejected`、`containment_unavailable`、`target_exists`、`target_changed`、`prepublication_failed`、`possibly_published`；不暴露 raw internal、absolute path、payload/content 或 temporary name。
- runtime registry 以 profile-aware capability 为 gate：POSIX 需要 descriptor-relative durable capability；Windows 使用经明确批准、参考 codex-rust 的 root-constrained direct-path profile，因而可暴露 `write_workspace_file`。其它不可用 host 返回稳定 availability `{ available: false, code: 'containment_unavailable', message: '当前平台无法安全发布工作区文件。' }` 并不注册 write definition/handler。Windows profile 不是 descriptor/HANDLE-bound containment、target-ID CAS、atomic exchange 或 directory-fsync durability；只读工具和既有三个 `settings.tools.approvalMode` 语义不变。
- 任何失败（包括 `target_exists`、`target_changed`、`prepublication_failed` 和 `possibly_published`）都不得自动 retry、rollback 或删除 canonical target。`possibly_published` 在 POSIX 通过 descriptor-bound canonical regular leaf、在 Windows direct-path profile 通过再次 realpath-contained 的 direct-path read 做完整字节确认：exact 时返回 `possiblyPublished: true`、`canonicalRead: 'exact'`、`retryable: false`；否则返回 `possibly_published`、`retryable: false`，且不得将其解释为“未执行”。相同 `toolCallId` replay journal 中的记录结果，不会第二次 publish。

最终本地验证在 macOS 构建 native addon，并运行五个定向 unit 文件共 **123 tests passed**，另通过 typecheck、workspace write tool check、agent-operation idempotency check、workspace path target check、security check 和 diff check；这不是 full suite 声明。完整命令、五个文件名、scope 限制和 Linux host-native 记录见 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)。

Linux 的现有 hosted 证据由 `ed8d88a` / `9c452f3` 记录：2026-07-19 的 GitHub-hosted `ubuntu-24.04` x64、Node `22.23.1` run 对 S2/S3 native branch 进行了本机构建和四个 P8 定向 unit files 验证（**4 passed / 96 passed**、没有 skipped）。它不是所有 Linux filesystem/kernel、Windows 或 fully cross-platform support 的声明。

## C-4P9-S2 实施与 P9-S3…S45 tests-only evidence（完整 close-out 未关闭）

ADR-0004 记录的 C-4P9 已实施范围仍仅为 S2：固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit 专用 framed、legacy-compatible、fixed-file durable append。V1 wire、identity、exact-retry 与有限 authority 见 [ADR-0019](0019-session-audit-v1-wire-contract-and-limited-authority.md)。S3 的 `c286a42`（`test(data): cover audit durable append recovery`）是严格 **tests-only historical evidence slice**：它保留 fixed-file non-rotating audit append 的 partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory `open`/`sync`/`close`、conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；两份定向 unit 文件共 **61 tests passed**。S4 的 `ab723a6`（`test(data): cover audit pre-write short-circuit`）是严格 **tests-only evidence slice**，仅补齐 archive save 层首个 audit write 注入 `EIO` 且 audit 为 0 bytes 时的 short-circuit/retry：JSON/Markdown 保留、ledger 未执行；clean retry 后每个 canonical audit row 恰一条、ledger 恰一条。S4 的验证入口及结果为：

```sh
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts
# 1 file, 27 tests passed
```

P9-S5 的 `47393f9` 仅修改测试，未修改 production code；Sol review approved。它覆盖 audit directory 与 conversation parent directory 的 `open`/`sync` capability symmetry：5 个 allowlist code × 2 个目录 × 2 个操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 的 `EINVAL` 仍 fatal。当前 S5 本切片为 1 file、51 tests passed；与 archive durable 共同运行是 2 files、78 tests passed；另通过 typecheck、security check、diff check。S5 不改变 production/API/schema/order，也不是完整 suite或完整 capability matrix，不关闭 C-4P9；不应推断 crash/power-loss、all filesystems、cross-process、all JSONL、跨文件 transaction、rotation、repair/migration、ledger authority/save-order 改造或 IPC/UI 已交付。 其后 P9-S6…P9-S45 继续补充 audit file/directory/transfer residual 的 tests-only evidence（最新定向约 149 tests passed）；仍不关闭 C-4P9，也不授权 generic JSONL migration、rotation、repair 或 IPC/UI。逐条证据见 ADR-0004 与 [C-4P9 设计文档](../plans/local-data-session-audit-durable-append-design.md)。

## 维护约定

- 已实施且会长期影响架构的决定，新增一份编号递增的 ADR；不要为了记录小进度而新建 ADR。
- 已实施决定的范围、边界或验证入口变化时，更新对应 ADR；未完成范围、前置条件和实施顺序变化时，更新[本地数据待办](../local-data-todo.md)及其 design gate。不要把后者的内容提前记为 ADR 已实施事实，也不要把 ADR 的受限切片扩大为完整 closure。
- ADR 中的 Git 提交 hash 是验证线索。若合并主线时使用 rebase 或 squash 导致 hash 改变，应将其更新为主线中可追溯的提交或合并记录。
- ADR 记录的是已获采纳的决定；尚未批准的建议、设计门和实施顺序统一维护在[本地数据待办](../local-data-todo.md)。
