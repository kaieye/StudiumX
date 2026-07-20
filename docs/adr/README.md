# 架构 ADR 索引

本目录记录已经实施、且有代码、测试和 Git 提交证据的架构决定。ADR（Architecture Decision Record，架构决策记录）说明系统为什么采用某项重要做法、已经落地到什么范围，以及它**没有**授权做什么。

## 先从这里读

- 想快速了解现状：阅读下方的“已实施决定”表。
- 想知道某项做法的原因、边界和测试入口：打开对应 ADR。
- 想知道接下来还准备做什么：以本目录 ADR 的「明确不包含 / non-claims / 延期」段落为准。当前**无开放 local-data 实现切片**；唯一延期项为 C-6 destructive Memory migration（见 [ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md) 第 3 节），不可分派为实现。
- 下一步工作必须遵循：独立 ADR + design gate 获得 scope / owner / API 批准 → 单独立项实施；design gate / dry-run / preflight 本身不授权直接修改 writer 或 destructive path。
- 想研究已关闭工作的历史决定：以本目录 ADR 为准（C-4P6 运维步骤见 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)）；延期前提见 [ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md)。

## 按问题查阅

| 你关心的问题 | 建议先读 |
| --- | --- |
| SQLite 分析索引损坏后能否隔离、重建或回退读取 | ADR-0001 |
| canonical teaching data 的永久保留边界，以及 logical JSONL 如何分区、分段和生成会话摘要 | ADR-0002 |
| 关键 JSON 不可读时如何从 `.bak` 验证恢复 | ADR-0003 |
| 哪些 writer 已使用 durable publish，以及受控 `write_workspace_file` 的 P8 S1–S4 closure 到哪里 | ADR-0004、ADR-0035 |
| 已覆盖持久化链如何关联 trace，同时保持日志安全 | ADR-0005 |
| Memory 数据如何按范围隔离，以及能否迁移旧数据 | ADR-0006、ADR-0038 |
| 新持久化 conversation/history 如何先经脱敏 | ADR-0007 |
| 哪些本地数据能力仍未完成 / 延期 | 当前无开放实现切片；C-6 destructive 延期见 ADR-0038 |
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
| C-4P6 Phase 0 platform profile 与 settlement failure matrix | ADR-0020、ADR-0035 |
| Agent run 与 Teaching Session 如何分离 | ADR-0021 |
| 能力就绪如何只读投影且不进 prompt 旁路 | ADR-0022 |
| Coordinator host sole-writer 与 blocking CI 边界 | ADR-0023 |
| 工具调用如何 typed 分类 effect 并产出 ToolOutcome | ADR-0024 |
| 教学配置如何分层解析且不落密钥 | ADR-0025 |
| Course 如何持久化 Session 顺序而不以 SQLite 为真相 | ADR-0026 |
| Doctor / Inspector 如何只读诊断且不自动修复 | ADR-0027 |
| 教学审计如何用 ID correlation 与安全元数据 | ADR-0028 |
| 学习路径如何只读投影分支而不改 outcome 历史 | ADR-0029 |
| 长 Session 如何从 ledger 排名 resume 候选 | ADR-0030 |
| 诊断模式如何查看 events/effects/projection | ADR-0031 |
| 只读工具如何保守并行 | ADR-0032 |
| 配置写如何用 fingerprint 乐观并发 | ADR-0033 |
| 支持包如何预览并经同意后脱敏导出 | ADR-0034 |
| C-4 P6/P8/P9 受限 close-out 范围 | ADR-0035 |
| mission_update 的 actionId / private receipt 与 exact retry | ADR-0036 |
| Direct-UI lesson generation 的 actionId / receipt / exact-retry 边界 | ADR-0037 |
| Memory readonly dry-run 与 destructive 延期边界 | ADR-0038 |
| Codex Rust 教学化借鉴结项与信号触发 P2 边界 | ADR-0039 |
| 教学对话 prompt cache 稳定前缀与 turn-tail 合同 | ADR-0040 |
| 工具合同与纯 workspace-write Policy | ADR-0044 |
## 已实施决定

| ADR | 主题 | 已实施范围 |
| --- | --- | --- |
| [ADR-0001](0001-rebuildable-sqlite-projection.md) | C-1 可重建 SQLite projection 与 no-FTS 边界 | SQLite 仅作为可再建 analytics 投影并保留 canonical 文件回退；FTS、查询/搜索面与 query-facing corpus 均未获授权。 |
| [ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md) | C-2 canonical 永久保留、分区、分段与摘要 projection | canonical teaching data 永久保留；UTC 月分区、无损 sealed JSONL 分段和显式会话摘要 projection 已实施。physical retention / recovery 未获批准；相邻 agent-artifact 年龄/大小删除路径已移除。 |
| [ADR-0003](0003-critical-json-backups-and-verified-recovery.md) | C-3 关键 JSON 备份与恢复 | `.bak` 备份及 verified read recovery。 |
| [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) | C-4 durable publish | 共享 durable publish 原语及已迁移的部分 consumer。C-4 始终是 **partial writer migration**。C-4P6 历史仅有 S1 生产基础 + S2…S194 tests-only residual；[ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) 以受限 macOS internal APFS runtime-adjacent evidence 结项该工作线，**不**宣称跨文件 transaction / common atomicity、完整 manifest failure matrix 或 power-loss durability。P8-S1…S4 受控 `write_workspace_file` 文本文件 scope 已关闭（含获批 Windows direct-path non-CAS profile）；Windows strict 以 unsupported/no-go 结项（ADR-0035）。P9 以 fixed-file audit boundary（S2 生产 + S3…S45 tests-only residual + ADR-0019 V1）结项，ADR-0035 明确不扩张为 strict/generic/cross-process/transaction/public surface。不表示所有 writer、CAS/lost-update protection、fully cross-platform durable publish 或 metadata full preservation。 |
| [ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md) | C-5 trace correlation | main 生成的 trace correlation 与安全日志边界。 |
| [ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md) | C-6 Memory | scope 分区及 aggregate-only readonly migration preflight；后续 dry-run 见 ADR-0038。 |
| [ADR-0007](0007-persisted-user-history-redaction.md) | C-7 历史数据脱敏 | 新持久化 conversation/history projection 的脱敏边界。 |
| [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md) | P0 LearningSession ledger | 独立的 canonical LearningSession、幂等 receipt、恢复与 legacy projection；领域基线，发布证明见 ADR-0017。 |
| [ADR-0009](0009-typed-lesson-interaction-evidence.md) | P0 typed Evidence | Lesson / conversation 互动的原始可追溯 Evidence、原子 receipt 与 preview 绑定；不是 outcome 或 record。 |
| [ADR-0010](0010-evidence-gated-learning-record-cutover.md) | P0 Learning record cutover | 切断 Lesson 生成自动写正式 Learning record；`learningRecordNote` 仅为待验证 evidence/rubric。 |
| [ADR-0011](0011-evidence-gated-learning-outcome-settlement.md) | P0 outcome settlement | Evidence-gated 的 canonical outcome / Learning record 结算、有序发布、reconcile 和窄 IPC sole-writer 边界。 |
| [ADR-0012](0012-deterministic-next-teaching-step-planner.md) | P0 next teaching step | 由 outcome / Evidence 导出的确定性 typed 教学动作，而非自由文本推断。 |
| [ADR-0013](0013-budgeted-provenance-aware-teaching-context.md) | P0/P1 teaching context | provenance allowlist、预算化 context、ProjectionReport、multi-adapter ResourceGrounder（含 external_untrusted 边界）。 |
| [ADR-0014](0014-learner-safe-teaching-turn-presentation.md) | P0/P1 learner presentation | 教学事实的 learner-safe 四阶段投影、redaction、a11y 边界，与封闭 TeachingCommand composer 目录。 |
| [ADR-0015](0015-canonical-teaching-event-protocol.md) | P1 canonical teaching events | 版本化封闭 event envelope、event bus 与 legacy adapter 边界。 |
| [ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md) | P0 assessment evaluator | 仅信任绑定、publisher-owned、digest 校验的 assessment artifact，并对不可信输入保守失败。 |
| [ADR-0017](0017-win-mac-p0-release-proof-and-audit-policy.md) | P0 Win/Mac release proof | clean-checkout audit、Win/Mac skip 预算、runtime gates 与真实 Electron longitudinal/crash Golden；Linux 产品船与 C-4 完整 migration 不在此声明。 |
| [ADR-0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md) | P0 recordless settlement | `needs_practice` / `not_evidenced` 仅以 `record: null` 的 settlement marker 为 authority；不写 record/outcome/completed Session，且不 promote。 |
| [ADR-0019](0019-session-audit-v1-wire-contract-and-limited-authority.md) | C-4P9 audit V1 contract | per-conversation audit JSONL 的 V1 wire/identity/exact-retry 与有限 authority；不授权 generic JSONL、rotation、repair 或跨进程 multi-writer。 |
| [ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md) | C-4P6 Phase 0 freeze + Phase 1 pointer | 首个目标 macOS APFS strict-candidate profile、I/O inventory、crash/public-result matrix 与 Windows non-strict 边界；后续受限 close-out 见 ADR-0035。 |
| [ADR-0021](0021-agent-run-state-machine-separate-from-session.md) | P1 Agent run 状态机 | 显式 run lifecycle 与 LearningSession 分离；非法转换拒绝；恢复/取消幂等。 |
| [ADR-0022](0022-teaching-capability-catalog-read-only-readiness.md) | P1 CapabilityCatalog | 只读 readiness 快照；disabled/unconfigured 不进 prompt；执行仍由 effect policy 复核。 |
| [ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md) | P1 Coordinator host + blocking CI | 多 workspace 薄 host、commit sole-writer 路径；最小 typecheck/security/P0 teaching CI。 |
| [ADR-0024](0024-typed-tool-dispatcher-effect-policy.md) | P1 Typed ToolDispatcher / Effect Policy | effect 分类与前置授权、严格参数解析、status 为真源的 ToolOutcome；未知工具 fail closed 为 privileged。 |
| [ADR-0025](0025-teaching-config-resolver-secret-free-layers.md) | P1 TeachingConfigResolver | default/user/workspace/session_override 分层；普通 snapshot 无密钥；字段来源可解释。 |
| [ADR-0026](0026-course-definition-durable-session-order.md) | P1 CourseDefinition store | per-Course durable 顺序与 status；文件系统仍为 Lesson 发现源；read 无副作用。 |
| [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md) | P1 Doctor + Workspace Inspector | 只读结构化诊断；repair 仅推荐且 v1 不自动执行；不阻断只读打开。 |
| [ADR-0028](0028-teaching-audit-correlation-safe-metadata.md) | P1 Audit correlation / privacy | session/turn/operation ID correlation；allowlist 安全元数据；纯函数导出脱敏。 |
| [ADR-0029](0029-learning-branch-projection.md) | P2 Learning Branch Projection | 只读分支投影；primary + non-canonical alternate；不改 outcome 历史。 |
| [ADR-0030](0030-session-resume-picker.md) | P2 Session Resume Picker | 对 ledger scan 的排名 resume 候选；无 learner content。 |
| [ADR-0031](0031-advanced-tech-inspector.md) | P2 Advanced Tech Inspector | 默认 learner_hidden；diagnostic 模式组装脱敏 sections。 |
| [ADR-0032](0032-conservative-parallel-read-tools.md) | P2 Parallel Read Tools | 仅 effect=read 有界并行；write/privileged denied。 |
| [ADR-0033](0033-config-optimistic-concurrency.md) | P2 Config Optimistic Concurrency | expectedFingerprint CAS；冲突不静默覆盖。 |
| [ADR-0034](0034-redacted-support-bundle.md) | P2 Redacted Support Bundle | 预览 + consent-gated 导出；无 raw prompt/secret/完整绝对路径。 |
| [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) | C-4 P6/P8/P9 scope close-out | P6 仅以 macOS internal APFS runtime-adjacent evidence 结项；P8 Windows strict 以 unsupported/no-go 结项；P9 保持既有 fixed-file audit boundary，不扩张为 strict/generic/cross-process/transaction/public surface。 |
| [ADR-0036](0036-mission-update-action-receipt-correlation.md) | C-5H mission_update action/receipt | renderer opaque actionId、workspace-private receipt、main-keyed requestTag、typed disposition 与 final-only exact retry；不含 style/agent/CAS UI。 |
| [ADR-0037](0037-direct-ui-lesson-generation-action-correlation.md) | C-5I direct-UI lesson generation correlation | 仅 direct-UI `generateLesson` / `generateLessonStream`：caller UUID v4 `actionId`、private receipt、HMAC requestTag、status poll 与 fail-closed dispositions；agent path 隔离；不覆盖 mission、C-5H、全局 projection recovery 或 content dedupe。 |
| [ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md) | C-6 readonly dry-run + destructive deferral | 采纳 main-only readonly dry-run intent/receipt preview；readonly preflight/dry-run 不构成 destructive authorization；真实 copy/hold/publish/delete 延期且当前不可分派为实现。 |
| [ADR-0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md) | Codex Rust 教学化借鉴结项 | 教学闭环优先、不扩张通用 coding agent；P0/P1/已实施 P2 不得重开；P2-6 MCP 与 P2-7 Helper Isolation 仅信号触发且默认不排期。 |
| [ADR-0040](0040-teaching-prompt-cache-contract.md) | Teaching prompt cache contract | 会话稳定 system prefix 与按轮次注入 user turn-tail；动态页面、记忆、画像和技能正文不进入稳定前缀。 |
| [ADR-0044](0044-tool-contract-and-write-policy.md) | Tool contract + pure write policy | Registered tool inventory is checked against the effect lattice; workspace write decisions are pure and advisory. |
| [ADR-0043](0043-agent-runtime-wire-and-turn-orchestrator.md) | Agent runtime wire + teaching-turn orchestrator | Closed runtime event wire, pure status aggregation, and injectable build→loop→finalize skeleton; no ledger settlement authority. |
## C-4P6 历史 evidence 与受限结项边界

> 本节保存 ADR-0004 的历史 evidence 范围；**当前工作线 close-out** 以 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) 为准，不再作为开放实现 todo。

- **已实施生产基础：**仅 S1（`7292bf4` / `e02a086`）的严格有序 publish、受控 reconcile 与失败关闭基础；历史验证为 41 项 unit 和 14 项 integration，不是完整 P6 矩阵。
- **tests-only historical evidence：**S2 `9847842` 是单一 `after_outcome_publish` restart/reconcile；S3 `1334513` 是 settlement-marker durable-rename `EIO` 后仅补 marker，不能扩大为泛化 `after_manifest_publish`。S4…S194（`e821c69`…`c1fb162`）累积有序发布、marker/record/manifest residual、failure 注入及 commit 前 session/event validation 的 fail-closed 覆盖；没有 production/API/schema/path/order 改动。定向 unit 历史基线为 **1 file、219 tests passed**，不是 full suite。
- **受限 close-out（ADR-0035）：**`P6-macOS-local-APFS-strict-candidate` 以 macOS internal APFS runtime-adjacent host-native / fresh-process crash-restart 与 operations runbook 作为该工作线结项证据被接受。Phase 0 profile/matrix 冻结于 [ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md)。
- **明确非声明（out-of-scope，非开放 todo）：**跨文件 transaction / common atomicity、rollback、delete；完整 manifest `open`/`write`/`fsync`/`close` failure matrix；Windows strict / power-loss durability；网络/可移动存储或 reboot durability；新 public IPC result。扩大到新 OS/filesystem/durability claim/writer/public result 须**新建 ADR**，不得把 residual 当作当前可分派实现切片。

权威范围与运维步骤见 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) 与 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)（含 C-4P6 运维 runbook）；当前无开放 P6 实现切片。

## C-4P8 S1–S4 已关闭 scope：证据与实际验证入口

ADR-0004 记录的 C-4P8 已在**受控 `write_workspace_file` 文本文件 create / restricted-overwrite scope**关闭：S1 `80f2fd0` / `e2ce36c`、S2 `b46c8b2` / `bdcd6cb`、S3 `56eabe6` / `54506d5`，以及 S4 handler/API integration `0bbfdef` / `e84c813`。这不是所有 workspace writer 或完整 C-4 的 closure。

- 请求仍是 `{path, content, overwrite?}`。`overwrite` 缺省或为 `false` 时使用 S2 no-clobber create：目标不存在时创建，目标已存在时返回 `target_exists`，不覆盖已有内容。`overwrite: true` 时，目标不存在仍使用 S2 create；目标已存在且是 `nlink = 1` 的 regular file 才使用 S3 restricted overwrite。directory、symlink、hardlink、FIFO、device、socket 和其它 non-regular target 均返回 `path_rejected`，不运行任一 publisher。预检时 absent 但发布时已有目标出现返回 `target_exists`；原本合格的 regular target 在 S3 前消失、类型改变或不再满足条件返回 `target_changed`。
- tool-facing stable code 为 `request_rejected`、`path_rejected`、`containment_unavailable`、`target_exists`、`target_changed`、`prepublication_failed`、`possibly_published`；不暴露 raw internal、absolute path、payload/content 或 temporary name。
- runtime registry 以 profile-aware capability 为 gate：POSIX 需要 descriptor-relative durable capability；Windows 使用经明确批准、参考 codex-rust 的 root-constrained direct-path profile，因而可暴露 `write_workspace_file`。其它不可用 host 返回稳定 availability `{ available: false, code: 'containment_unavailable', message: '当前平台无法安全发布工作区文件。' }` 并不注册 write definition/handler。Windows profile 不是 descriptor/HANDLE-bound containment、target-ID CAS、atomic exchange 或 directory-fsync durability；只读工具和既有三个 `settings.tools.approvalMode` 语义不变。
- 任何失败（包括 `target_exists`、`target_changed`、`prepublication_failed` 和 `possibly_published`）都不得自动 retry、rollback 或删除 canonical target。`possibly_published` 在 POSIX 通过 descriptor-bound canonical regular leaf、在 Windows direct-path profile 通过再次 realpath-contained 的 direct-path read 做完整字节确认：exact 时返回 `possiblyPublished: true`、`canonicalRead: 'exact'`、`retryable: false`；否则返回 `possibly_published`、`retryable: false`，且不得将其解释为“未执行”。相同 `toolCallId` replay journal 中的记录结果，不会第二次 publish。

最终本地验证在 macOS 构建 native addon，并运行五个定向 unit 文件共 **123 tests passed**，另通过 typecheck、workspace write tool check、agent-operation idempotency check、workspace path target check、security check 和 diff check；这不是 full suite 声明。完整命令、五个文件名、scope 限制和 Linux host-native 记录见 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)。

Linux 的现有 hosted 证据由 `ed8d88a` / `9c452f3` 记录：2026-07-19 的 GitHub-hosted `ubuntu-24.04` x64、Node `22.23.1` run 对 S2/S3 native branch 进行了本机构建和四个 P8 定向 unit files 验证（**4 passed / 96 passed**、没有 skipped）。它不是所有 Linux filesystem/kernel、Windows 或 fully cross-platform support 的声明。

## C-4P9 fixed-file audit 历史 evidence 与边界结项

> 历史 evidence 见下；**当前工作线边界**以 [ADR-0019](0019-session-audit-v1-wire-contract-and-limited-authority.md) 与 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) 结项，不作为开放实现 todo。

ADR-0004 记录的 C-4P9 **已实施生产范围**为 S2：固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit 专用 framed、legacy-compatible、fixed-file durable append。V1 wire、identity、exact-retry 与有限 authority 见 ADR-0019。

- **tests-only historical residual：**S3 `c286a42`（`test(data): cover audit durable append recovery`）保留 fixed-file non-rotating audit append 的 partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory `open`/`sync`/`close`、conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；两份定向 unit 文件共 **61 tests passed**。S4 `ab723a6`（`test(data): cover audit pre-write short-circuit`）仅补齐 archive save 层首个 audit write 注入 `EIO` 且 audit 为 0 bytes 时的 short-circuit/retry：JSON/Markdown 保留、ledger 未执行；clean retry 后每个 canonical audit row 恰一条、ledger 恰一条。S4 验证入口：

```sh
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts
# 1 file, 27 tests passed
```

P9-S5 `47393f9` 仅修改测试，未改 production code。它覆盖 audit directory 与 conversation parent directory 的 `open`/`sync` capability symmetry：5 个 allowlist code × 2 个目录 × 2 个操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 的 `EINVAL` 仍 fatal。S5 本切片 1 file、51 tests passed；与 archive durable 共同运行 2 files、78 tests passed。其后 P9-S6…P9-S45 继续补充 audit file/directory/transfer residual 的 tests-only evidence（最新定向约 149 tests passed）；均不改变 production/API/schema/order。

- **边界结项（ADR-0035）：**V1 fixed-file audit scope 以 ADR-0019 与已实施 append/dedupe boundary 结项；**不**批准扩张为 strict durable profile、generic JSONL、rotation、repair、cross-process multi-writer、archive transaction、IPC/UI 或 public result surface。现有 audit 仍是 per-conversation、append-only、ordered-best-effort session evidence：进程内同路径 queue 不是跨进程 exclusion，directory-sync warning 不是 strict/power-loss proof，audit outcome 也不决定 JSON、Markdown 或 learning-work ledger 的 authority。
- **明确非声明（out-of-scope，非当前可分派实现）：**crash/power-loss、all filesystems、cross-process multi-writer、all JSONL、跨文件 transaction、rotation、repair/migration、ledger authority/save-order 改造或 IPC/UI。产品若需要上述任一扩张，须**新建 ADR** 定义 profile 与 evidence，不得把 residual tests 或本结项解释为这些能力已实现。

逐条历史证据见 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0019](0019-session-audit-v1-wire-contract-and-limited-authority.md) 与 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)。当前无开放 P9 实现切片。

## 维护约定

- 已实施且会长期影响架构的决定，新增一份编号递增的 ADR；不要为了记录小进度而新建 ADR。
- 已实施决定的范围、边界或验证入口变化时，更新对应 ADR；新的开放/延期工作必须新增独立 ADR（含 design gate 前提），不得把 ADR 的受限切片扩大为完整 closure。已结项 plan 应删除，不保留无用指针 stub。
- ADR 中的 Git 提交 hash 是验证线索。若合并主线时使用 rebase 或 squash 导致 hash 改变，应将其更新为主线中可追溯的提交或合并记录。
- ADR 记录的是已获采纳的决定；尚未批准的建议不得记为已实施事实。当前无独立 local-data 待办页：开放实现须先有新 ADR 批准，延期项以各 ADR 的 non-claims / 延期段落为准（C-6 destructive 见 ADR-0038）。
