# 架构 ADR 索引

本目录主要记录已经实施、且有代码、测试和 Git 提交证据的架构决定。少数条目为 **Proposed / 设计 gate only**（正文与索引表会标明 **未实施**，例如 [ADR-0123](0123-runtime-session-store.md)），**不**表示生产 schema 或写路径已落地。少数条目仍为 **provisional / 实施中**；[ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md) 的 shell/sandbox 则已于 2026-07-25 完成 A–F 合格交付，Windows OS helper 为可选延期。ADR（Architecture Decision Record，架构决策记录）说明系统为什么采用某项重要做法、已经落地到什么范围，以及它**没有**授权做什么。

## 先从这里读

- 想快速了解现状：阅读下方的“已实施决定”表。
- 想知道某项做法的原因、边界和测试入口：打开对应 ADR。
- 想知道接下来还准备做什么：以本目录 ADR 的「明确不包含 / non-claims / 延期」段落为准。当前**无开放 local-data / destructive writer 实现切片**；唯一延期项为 C-6 destructive Memory migration（见 [ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md) 第 3 节），不可分派为实现。[ADR-0094](0094-study-task-timer-planning-design-gate.md) 为 study-planning Phase 0 产品冻结；路径 / wire / Store 合同见 [ADR-0117](0117-study-planning-store-paths-and-wire.md)；renderer cutover 权威切分见 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)（已实施沉淀；§18 仍以路线图为准）；Phase 7 高级排程与 §18 residual 政策见 [ADR-0130](0130-study-planning-phase7-and-completion-residual.md)。
- 下一步工作必须遵循：独立 ADR + design gate 获得 scope / owner / API 批准 → 单独立项实施；design gate / dry-run / preflight 本身不授权直接修改 writer 或 destructive path。
- 想研究已关闭工作的历史决定：以本目录 ADR 为准（C-4P6 运维步骤见 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)）；延期前提见 [ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md)。

## 按问题查阅

| 你关心的问题 | 建议先读 |
| --- | --- |
| SQLite 分析/列表投影损坏后能否隔离、重建或回退读取；分层写/读权威；PR 验收闸与 P2 边界 | ADR-0001、[ADR-0124](0124-database-layered-authority-and-pr-gates.md) |
| canonical teaching data 的永久保留边界，以及 logical JSONL 如何分区、分段和生成会话摘要 | ADR-0002 |
| 关键 JSON 不可读时如何从 `.bak` 验证恢复 | ADR-0003 |
| 哪些 writer 已使用 durable publish，以及受控 `write_workspace_file` 的 P8 S1–S4 closure 到哪里 | ADR-0004、ADR-0035 |
| 已覆盖持久化链如何关联 trace，同时保持日志安全 | ADR-0005 |
| Memory 数据如何按范围隔离，以及能否迁移旧数据 | ADR-0006、ADR-0038 |
| MCP 的 v1 用户配置、runtime reliability、result safety、OAuth、import/export、多来源 precedence/auto-connect 与完整 marketplace lifecycle 与 P2-6 旧禁令关系 | [ADR-0127](0127-user-configurable-mcp-design-gate.md)（v1 policy）+ [ADR-0128](0128-user-configurable-mcp-implementation.md)（v1 实现 / 仍默认 off·manual 基线）+ [ADR-0132](0132-mcp-zcode-parity-and-trust-lifecycle.md)（全面对齐 policy / 分阶段 trust lifecycle）+ [ADR-0133](0133-mcp-runtime-reliability-implementation.md)（Phase A）+ [ADR-0134](0134-mcp-result-safety-and-local-artifacts.md)（Phase B）+ [ADR-0135](0135-mcp-oauth-pkce-and-secret-token-lifecycle.md)（Phase C）+ [ADR-0136](0136-mcp-config-import-export-and-sync-contract.md)（Phase D）+ [ADR-0137](0137-mcp-multi-source-precedence-and-auto-connect.md)（Phase E multi-source / controlled auto-connect；root 默认 off）；F–H 见 0138/0140；体验默认见 **ADR-0141**（允许主流 auto-connect/marketplace） |
| Windows / 跨平台 I/O 如何按 Codex 式 profile 分层，memory 与聊天热路径如何迁移 | [ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)（**已实施 / 分 phase 结项**；历史 dual-profile；**默认写模型**见 [ADR-0131](0131-pathname-default-durable-io.md)；**shell 产品面**见 [ADR-0152](0152-workspace-shell-and-codex-aligned-approval.md)/[0153](0153-codex-sandbox-dual-axis-and-agent-shell.md)（A–F 已合格完成）） |
| 默认 durable 写盘模型（pathname temp+rename；native 非默认） | [ADR-0131](0131-pathname-default-durable-io.md)（**已实施** 2026-07-22；完成记录见 ADR-0131 §4–5） |
| Agent shell / 工作区命令 / sandbox 双轴的审批、边界与合格状态 | [ADR-0152](0152-workspace-shell-and-codex-aligned-approval.md)（审批轴地基）+ [ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md)（双轴；A–F 已于 2026-07-25 合格完成；Windows helper 可选延期） |

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
| 不可信 workspace 配置如何拒绝敏感 endpoint（baseUrl denylist） | ADR-0071 |
| 校/团 managed secret-free overlay 如何插入层序（caller inject） | ADR-0086 |
| TeachingConfig overlay 纯解析如何从 resolver 旁路 peel | ADR-0090 |
| Agent loop fallback / legacy request 纯助手如何旁路 peel | ADR-0100 |
| Agent loop budgetStopReasonFromError 纯助手如何旁路 peel | ADR-0103 |
| Agent loop applyToolsSchemaGuard pure-ish 如何旁路 peel | ADR-0106 |
| teaching-ipc-commands turn-review IPC parser 如何旁路 peel | ADR-0119 |
| teaching-ipc-commands agent-conversation IPC parser 如何旁路 peel | ADR-0120 |

| 校/团 managed 配置如何从 userData 根 fail-closed 加载并在 CAS 重解析保真 | ADR-0092 |
| 学习任务 / 计时器 / 学习规划的 Phase 0 design gate | ADR-0094 |
| Study planning canonical 路径 / wire v1 / Store 命令信封 / V1 迁移 | ADR-0117 |
| Study planning renderer cutover / dual-write + sole-read / TimerSession analytics authority | [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md) |
| 学习规划 Phase 7 高级排程与 §18 是否算完成 | [ADR-0130](0130-study-planning-phase7-and-completion-residual.md)（决策 + residual；非产品全量交付声明）；cutover 事实见 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md) |
| Course 如何持久化 Session 顺序而不以 SQLite 为真相 | ADR-0026 |
| Doctor / Inspector 如何只读诊断且不自动修复 | ADR-0027 |
| 教学审计如何用 ID correlation 与安全元数据 | ADR-0028 |
| 学习路径如何只读投影分支而不改 outcome 历史 | ADR-0029 |
| 长 Session 如何从 ledger 排名 resume 候选 | ADR-0030 |
| 诊断模式如何查看 events/effects/projection | ADR-0031 |
| 只读工具如何保守并行 | ADR-0032 |
| 配置写如何用 fingerprint 乐观并发 | ADR-0033 |
| 支持包如何预览并经同意后脱敏导出 | ADR-0034 |
| 本地 turn/tool 相关、crash marker 与导出 fail-closed 脱敏 | ADR-0066 |
| Support-bundle 通用 path/secret 如何切到共享 observability/redact | ADR-0107 |
| C-4 P6/P8/P9 受限 close-out 范围 | ADR-0035 |
| mission_update 的 actionId / private receipt 与 exact retry | ADR-0036 |
| Direct-UI lesson generation 的 actionId / receipt / exact-retry 边界 | ADR-0037 |
| Memory readonly dry-run 与 destructive 延期边界 | ADR-0038 |
| Codex Rust 教学化借鉴结项与信号触发 P2 边界 | ADR-0039 |
| TeachingSessionProtocol 进程内会话门面 | ADR-0040 |
| 工具 risk annotations 与结果字节预算 | ADR-0041 |
| 最小 ExtensionManifest（本地安装优先） | ADR-0042 |
| Doctor 配置定位路径与结构化修复建议 | ADR-0043 |
| 教学对话 prompt cache 稳定前缀与 turn-tail 合同 | ADR-0044 |
| 上下文投影阶梯、SECURITY 与 PR/pre-push 质量门 | ADR-0045 |
| Teaching capability 如何按 Footprint Ladder 扩张、保持临时 chat 子集与 TeachingCommand 单源 | ADR-0046 |
| Agent runtime wire 与 teaching-turn orchestrator | ADR-0047 |
| Agent runtime wire 迁入 src/shared/protocol（S-01） | ADR-0070 |
| 工具合同与纯 workspace-write Policy | ADR-0048 |
| write_workspace_file 本轮 pre-image 与「撤销本轮写入」 | ADR-0049 |
| 词法记忆检索与教学合成记忆 remember/forget | ADR-0050 |
| 工具结果 turn 聚合预算与 spill-to-preview | ADR-0056 |
| 单 run tools/schema 指纹守卫（静默扩 schema fail-closed） | ADR-0060 |
| 工具如何声明 isReadOnly / maxConcurrency / supportsCancel（不放开写并行） | ADR-0061 |
| Child agent 工具面如何相对父 allow-list 子集证明、拒绝放大 | ADR-0065 |
| Agent stream presentation 如何适配多回调且异常不回灌 loop | ADR-0062 |
| 声明式 tool-policy（allow/prompt/forbidden，按工具名/effect/路径前缀，禁 shell argv / YOLO） | ADR-0063 |
| ContextCompactor 切点、不足缩减守卫与审计字段 | ADR-0064 |
| LiveAgent Phase A（研究索引 → ADR，非第二套 ADOPTION backlog） | [ADR-0143](0143-context-file-touch-ledger.md) / [0144](0144-ask-authoritative-deadline.md) / [0145](0145-compaction-pressure-single-flight.md)（**已实施**）；历史研究清单已结项，后续工作以这些 ADR 与 ADR-0121 为准 |
| [ADR-0146](0146-optional-fuzzy-edit-workspace-file.md) | 可选 fuzzy `edit_workspace_file`（LiveAgent Phase B） | **已实施**（2026-07-24）：`edit-match.ts` + `workspace-edit.ts`（从 `workspace.ts` peel，ADR-0075）；Exact→EOL/BOM→尾空白→缩进；`matchStrategy`；同 path 围栏 / write-policy / 三态审批 / write-rewind；不以 Shell/apply_patch 作本编辑路径（shell 另见 0152/0153）。 |
| Busy 输入有界队列、steer≠abort、revision / toolsReplayed / 无启动自动 memory 契约 | ADR-0055 |
| AgentSessionFacade 有状态门面与 busy 队列 drain | ADR-0058 |
| Cancel 时 tool 成对闭合与 renderer busy-ack 入队 banner | ADR-0067 |
| Mid-run agent chat steer/follow-up IPC（autoDrain 仍关） | ADR-0082 |
| Agent session 队列只读投影（纯 snapshot，autoDrain 仍关） | ADR-0089 |
| Agent session 队列只读投影 product IPC（autoDrain 仍关） | ADR-0091 |
| Product autoDrain 评估（决策 keep false / 无翻转） | ADR-0096 |
| Agent session 队列只读 renderer consumer（Doctor diagnostics） | ADR-0098 |
| Product TeachingDoctor IPC（crash-marker facts assemble + run） | ADR-0084 |
| Settings 只读 TeachingDoctor UI 面板 | ADR-0095 |
| TeachingDoctor multi-collector pure facts assemble（product-run deps） | ADR-0093 |
| TeachingDoctor config facts collector（product gateway 注入） | ADR-0099 |
| TeachingDoctor catalog drift facts collector（product gateway 注入） | ADR-0102 |
| TeachingDoctor session/outcome crash-window scan collectors（product gateway 注入） | ADR-0104 |
| TeachingDoctor source-gap facts collector（workspace summary projection + gateway 注入） | ADR-0105 |
| Provider finish/stop 透传与 length 截断拒 tool | ADR-0051 |
| GitHub Actions SHA pin / Dependabot(actions) / OSV fail-open / critical npm exact pin | ADR-0054 |
| Provider 有界 jittered retry 与局部重试边界 | ADR-0057（全局 run budget 已由 ADR-0171 取代） |
| Provider 错误 UX 与 recovery taxonomy（quota ≠ rate_limit） | ADR-0052 |
| Provider overflow 模式库与静默 overflow 启发式 | ADR-0125 |
| 根 AGENTS.md、security suite 闭环与测试教条分层 | ADR-0053 |
| Node engines / .nvmrc 与本地 SOURCE_REV 构建身份 | ADR-0072 |
| 教学产品 FeatureRegistry（stage 元数据，非第二套授权） | ADR-0073 |
| Blocking CI fan-in（skip=fail）与 clean-worktree / format 子集 | ADR-0074 |
| 工具如何依赖 WorkspaceHost 端口而非 raw path mix-in / 反向 agent-loop | ADR-0078 |
| 生产 TS 模块尺寸目标、历史巨石 peel 纪律与 warning-only 检查 | ADR-0075 |
| 记忆注入 prompt 前如何消毒（控制字符 / 路径 / 密钥形态） | ADR-0076 |
| 教学安全 post-turn review 候选（仅人批，无自动 apply） | ADR-0077 |
| Workspace-contained tool-policy FS loader（可选 .studiumx/tool-policy.json，fail-closed，禁 argv/YOLO） | ADR-0079 |
| 主对话路径如何可选注入 workspace tool-policy（缺文件 default-equivalent） | ADR-0083 |
| 次级 agent-run 路径（delegation + lesson-plan）如何可选注入 workspace tool-policy | ADR-0088 |
| catalog/read 探针（capability + connector）如何可选注入 workspace tool-policy | ADR-0101 |
| write first-touch capture 如何记录已知 permissionDecision 审计字段 | ADR-0108 |
| 如何 pure merge 多层 tool-policy 文档（most-restrictive-wins，无 UI） | ADR-0112 |
| 如何多相对路径装载并 merge tool-policy（主文件 + course overlay，主对话注入） | ADR-0115 |
| 次级路径（delegation / lesson-plan / catalog）如何共享 multi-path tool-policy inject | ADR-0118 |
| WorkspaceHost 薄端口 + 轻量 import 方向门（S-02，无 monolith peel） | ADR-0078 |
| finalize 后可选 review 候选钩子（人批 only，不改 settlement） | ADR-0080 |
| 非 recall 路径记忆注入消毒（lesson prompts + memory tools） | ADR-0081 |
| 教学 turn-review 人批决策 + 只读投影（无 auto-apply） | ADR-0085 |
| 教学 turn-review 人批投影 + 决策 product IPC（无 auto-apply） | ADR-0087 |
| Settings 薄面板如何投影/人批 turn-review 候选（无 auto-apply、无 main 队列） | ADR-0097 |
| 人批后如何投影 consent-gated handoff intents（无 auto-apply、无 durable store） | ADR-0109 |
| 人批后 handoff intents 如何经闭集 product IPC 投影（无 auto-apply、无 durable store） | ADR-0110 |
| Settings 在人批后如何展示 pure handoff intents（无 consent 导航、无 auto-apply） | ADR-0111 |
| 最近一次 teaching-turn review bundle 如何 durable 缓存（投影 only，无 auto-apply） | ADR-0113 |
| 最近一次 review last-bundle 如何经闭集 product IPC 读写 + Settings 演示往返（无 auto-apply） | ADR-0114 |
| finalize 后可选 durable save last-bundle（默认 off；source finalize_hook；无 auto-apply） | ADR-0116 |
| Token/tool/turn 细粒度 usage 观测账本与可选 SQLite 投影边界 | ADR-0122 |
| 可选 runtime session store（仅设计；非写权威） | ADR-0123 |
| Database 分层权威、P2 边界、验收总闸、切片状态 | ADR-0124 |
## 已实施决定

| ADR | 主题 | 已实施范围 |
| --- | --- | --- |
| [ADR-0001](0001-rebuildable-sqlite-projection.md) | C-1 可重建 SQLite 投影、分层权威与 no-FTS 默认 | 写权威在文件；list/analytics 可为优选读路径；库可丢弃重建；analytics 库 FTS/query corpus 默认未获授权；含 rebuild 默认全量 + OPT-2 骨架 + backup/export 可丢弃声明（2026-07-21）。 |
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
| [ADR-0014](0014-learner-safe-teaching-turn-presentation.md) | P0/P1 learner presentation | canonical learner-safe snapshot 的 closed IPC → 默认 App → Reader 接线、`contrast_and_retry` / `review_due` CAS 动作、四阶段教学投影与 a11y 边界；Agent reasoning 在独立过程面板原样展示，但不构成教学 authority。 |
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
| [ADR-0071](0071-workspace-config-denylist.md) | S-04 Workspace/project config denylist | workspace 层拒绝 `provider.providers.*.baseUrl`；`workspace_denylist` 诊断；user/default 仍可设置；session_override 信任进程内覆盖。 |
| [ADR-0086](0086-managed-config-overlay-layer.md) | S-11 Managed config overlay | `default < managed < user < workspace < session_override`；caller inject；secret-free；fingerprint CAS 语义不变；无 FS/MDM。 |
| [ADR-0090](0090-teaching-config-overlay-parse-peel.md) | S-03 residual overlay-parse peel | 纯 	eaching-config-overlay-parse；resolver 保留 merge/fingerprint/公共导出；层序/denylist/secret 不变；巨石仍 residual。 |
| [ADR-0100](0100-agent-loop-fallback-peel.md) | S-03 residual agent-loop fallback peel | 纯 `agent-loop-fallback`（safeFallbackText + legacyRequestFromMessages）；loop 保留 retry/budget/schema/tool-budget；无行为变更；巨石仍 residual。 |
| [ADR-0103](0103-agent-loop-budget-reason-peel.md) | S-03 residual agent-loop budget-reason peel | 纯 `budgetStopReasonFromError` → `agent-loop-budget-reason`；不 peel retry/schema/tool-budget；无行为变更；巨石仍 residual。 |
| [ADR-0106](0106-agent-loop-schema-guard-peel.md) | S-03 residual agent-loop schema-guard peel | pure-ish `applyToolsSchemaGuard` → `agent-loop-schema-guard`；emit 语义字节等价；不 peel retry/tool-budget；无行为变更；巨石仍 residual。 |
| [ADR-0119](0119-teaching-ipc-commands-turn-review-peel.md) | S-03 residual teaching-ipc turn-review peel | turn-review IPC parse 簇 → `teaching-ipc-commands-turn-review`；shell re-export；parser 语义字节等价；不 peel conversation/workspace 簇；巨石仍 residual。 |
| [ADR-0120](0120-teaching-ipc-commands-agent-conversation-peel.md) | S-03 residual teaching-ipc agent-conversation peel | agent-conversation（+ rewind/archive）IPC parse 簇 → `teaching-ipc-commands-agent-conversation`；shell re-export；parser 语义字节等价；不 peel chat/workspace/doctor 簇；巨石仍 residual。 |
| [ADR-0092](0092-managed-config-fs-loader.md) | S-11 managed config FS loader + CAS preserve | userData 根 fail-closed loader；inject helper；optimistic writer 重解析保真 managed；无 MDM/remote。 |
| [ADR-0026](0026-course-definition-durable-session-order.md) | P1 CourseDefinition store | per-Course durable 顺序与 status；文件系统仍为 Lesson 发现源；read 无副作用。 |
| [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md) | P1 Doctor + Workspace Inspector | 只读结构化诊断；repair 仅推荐且 v1 不自动执行；不阻断只读打开。 |
| [ADR-0028](0028-teaching-audit-correlation-safe-metadata.md) | P1 Audit correlation / privacy | session/turn/operation ID correlation；allowlist 安全元数据；纯函数导出脱敏。 |
| [ADR-0029](0029-learning-branch-projection.md) | P2 Learning Branch Projection | 只读分支投影；primary + non-canonical alternate；不改 outcome 历史。 |
| [ADR-0030](0030-session-resume-picker.md) | P2 Session Resume Picker | 对 ledger scan 的排名 resume 候选；无 learner content。 |
| [ADR-0031](0031-advanced-tech-inspector.md) | P2 Advanced Tech Inspector | 默认 learner_hidden；diagnostic 模式组装脱敏 sections。 |
| [ADR-0032](0032-conservative-parallel-read-tools.md) | P2 Parallel Read Tools | 仅 effect=read 有界并行；write/privileged denied。 |
| [ADR-0033](0033-config-optimistic-concurrency.md) | P2 Config Optimistic Concurrency | expectedFingerprint CAS；冲突不静默覆盖。 |
| [ADR-0034](0034-redacted-support-bundle.md) | P2 Redacted Support Bundle | 预览 + consent-gated 导出；无 raw prompt/secret/完整绝对路径。 |
| [ADR-0107](0107-support-bundle-common-redact-switch.md) | Support-bundle common redact switch | 通用 path/secret 切到 `observability/redact`；deep JSON / denied-field / stable-id 仍本地；无 auto-repair/upload。 |
| [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) | C-4 P6/P8/P9 scope close-out | P6 仅以 macOS internal APFS runtime-adjacent evidence 结项；P8 Windows strict 以 unsupported/no-go 结项；P9 保持既有 fixed-file audit boundary，不扩张为 strict/generic/cross-process/transaction/public surface。 |
| [ADR-0036](0036-mission-update-action-receipt-correlation.md) | C-5H mission_update action/receipt | renderer opaque actionId、workspace-private receipt、main-keyed requestTag、typed disposition 与 final-only exact retry；不含 style/agent/CAS UI。 |
| [ADR-0037](0037-direct-ui-lesson-generation-action-correlation.md) | C-5I direct-UI lesson generation correlation | 仅 direct-UI `generateLesson` / `generateLessonStream`：caller UUID v4 `actionId`、private receipt、HMAC requestTag、status poll 与 fail-closed dispositions；agent path 隔离；不覆盖 mission、C-5H、全局 projection recovery 或 content dedupe。 |
| [ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md) | C-6 readonly dry-run + destructive deferral | 采纳 main-only readonly dry-run intent/receipt preview；readonly preflight/dry-run 不构成 destructive authorization；真实 copy/hold/publish/delete 延期且当前不可分派为实现。 |
| [ADR-0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md) | Codex Rust 教学化借鉴结项 | 教学闭环优先、不扩张通用 coding agent；P0/P1/已实施 P2 不得重开；P2-6 通用 MCP 默认禁令由 [ADR-0127](0127-user-configurable-mcp-design-gate.md) 收窄为用户 opt-in 可配置（design gate）；P2-7 Helper Isolation 仍信号触发且默认不排期。 |
| [ADR-0121](0121-improvements-adoption-closeout.md) | 四源改进借鉴 ADOPTION 结项 | Phase0–2 可实现项已落地；`docs/improvements/` 清空；defer/residual 仅信号触发；命名冻结 + 假升级清单。 |
| [ADR-0040](0040-teaching-session-protocol-facade.md) | TeachingSessionProtocol 进程内会话门面 | 稳定 create/resume/send/cancel/compact/fork/steer/checkpoint/usage 内部协议 + runtime facade。 |
| [ADR-0041](0041-tool-annotations-and-result-budget.md) | 工具 annotations 与 result budget | risk annotations + 默认 32KiB 硬字节预算；dispatcher/registry 成功路径强制截断。 |
| [ADR-0042](0042-extension-manifest-minimal.md) | 最小 ExtensionManifest | 本地安装优先的声明式 manifest 类型；marketplace/auto-trust 未授权。 |
| [ADR-0043](0043-doctor-config-locator-and-fix-suggestion.md) | Doctor 配置定位与 fix suggestion | configPath + 结构化 fixSuggestion；autoRepair 仍禁用。 |
| [ADR-0044](0044-teaching-prompt-cache-contract.md) | Teaching prompt cache contract | 会话稳定 system prefix 与动态 user turn-tail；唯一全文例外为经验证的 app-shipped Teaching Kernel，当前阶段非 kernel 正文受全局预算约束并仅进入 turn-tail。 |
| [ADR-0045](0045-context-hygiene-ladder-and-quality-gates.md) | Context hygiene ladder + quality gates | 默认 provider 投影阶梯（hygiene → compact）与可选 durable boundary；SECURITY.md、PR impact 门、workflow concurrency、check:prepush。 |
| [ADR-0046](0046-teaching-footprint-ladder.md) | Teaching Capability Footprint Ladder | 能力优先走 skill/host/受 gating tool，MCP 远期，core tool 最后；临时与教学工具面差距仅限教学文件生成（可共享 MCP；见 ADR-0128）；TeachingCommand 由单一 registry 派生；用户 Markdown slash 不在范围内。 |
| [ADR-0047](0047-agent-runtime-wire-and-turn-orchestrator.md) | Agent runtime wire + teaching-turn orchestrator | Closed runtime event wire, pure status aggregation, and injectable build→loop→finalize skeleton; no ledger settlement authority. |
| [ADR-0048](0048-tool-contract-and-write-policy.md) | Tool contract + pure write policy | Registered tool inventory is checked against the effect lattice; workspace write decisions are pure and advisory. |
| [ADR-0049](0049-write-rewind-journal.md) | Write rewind journal | `write_workspace_file` first-touch pre-image under `.studiumx/checkpoints/<runId>/`；IPC/UI「撤销本轮写入」与 conversation checkpoint 分离；不削弱 durable publish。 |
| [ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md) | Lexical memory search + synthetic memory | main-only 词法检索（零 LLM、无 FTS）；`memory_search` / 人批 `remember`·`forget`；turn-tail 仅 title+scope 索引。 |
| [ADR-0056](0056-tool-result-turn-budget-and-spill.md) | Tool-result turn budget + spill | 单 turn 聚合 char 预算；超限 spill 至 `.studiumx/tool-results/<runId>/`；模型侧 preview + 相对路径；与 ADR-0041 per-tool 32KiB 分层。 |
| [ADR-0059](0059-read-parallel-tool-batch-in-agent-loop.md) | Read-parallel tool batch in agent loop | 主 loop/recovery 混合批：连续 pure-read 有界并行；write/privileged 串行；A-02/B-04 不变量保留。 |
| [ADR-0060](0060-tools-schema-session-fingerprint.md) | Tools/schema session fingerprint guard | 单 run 内 tools/schema 确定性指纹；静默 expansion/schema 变更 fail closed；合法 narrow 须 `tools_schema_narrowed` 审计。 |
| [ADR-0061](0061-tool-capabilities.md) | ToolCapabilities 元数据 + TOOL_CONTRACT | `isReadOnly`/`maxConcurrency`/`supportsCancel` 由 effect lattice 派生；写类硬钳 concurrency 1；不放开写并行；不替代 effect/permission 授权。 |
| [ADR-0066](0066-local-observability-and-crash-marker.md) | 本地可观测性 + crash marker + 导出脱敏 | 进程内 turn/tool 相关 ID；appData crash marker 供 doctor 下次启动可见；fail-closed path/secret 脱敏；无默认远程 telemetry / auto-upload。 |
| [ADR-0065](0065-child-capability-subset.md) | Child capability subset 证明 | `assertChildCapabilitiesSubset` + `intersectChildToolsWithParent`；`childRegistryForProfile` 可选父 allow-list 相交 fail-closed；拒绝 child 放大父工具面。 |
| [ADR-0062](0062-agent-stream-presentation-adapter.md) | Agent stream presentation 适配层 | `agent-stream-events` 单一 sink + safePresent；EventBus 出站回调 exception isolation；不推倒 timeline；presentation 异常不回灌 agent loop。 |
| [ADR-0063](0063-declarative-tool-policy.md) | Declarative tool-policy (non-shell argv) | Pure evaluateToolPolicy + registry gate: forbidden short-circuits full_access; prompt forces interactive; allow defers approvalMode; optional journal permissionDecision; no argv/prefix_rule/YOLO. |
| [ADR-0064](0064-context-compactor-cutpoints-and-reduction-guard.md) | ContextCompactor cut-points + reduction guard | 导出切点策略；不足缩减 fail closed 保留 transcript；审计 cutIndex/消息计数/outcomeCode；不换引擎、不默认 durable rewrite |
| [ADR-0055](0055-busy-input-queue-and-replay-contracts.md) | Busy 输入队列 + 回放/revision 契约 | agent-input-queue + agent-busy-input-policy；cancel clearOnCancel；A-08 expectedRevision / toolsReplayed:false / 无启动自动 memory 契约测试。 |
| [ADR-0058](0058-agent-session-facade.md) | AgentSessionFacade + B-01 drain | run 作用域 prompt/steer/followUp/abort/snapshot/drain；子 run 默认隔离队列；gateway product invoker 经 `facade.prompt` 驱动 live `agentChatStream`；autoDrain 关 + mid-run steer IPC residual；**不**替换 TeachingSessionProtocol。 |
| [ADR-0067](0067-cancel-tool-pair-close-and-busy-ack.md) | Cancel tool-pair close + renderer busy-ack | cancel 闭合 unpaired tool_calls；shared busy-ack 常量；renderer 本地 FIFO + banner；gateway façade 生命周期 attach。 |
| [ADR-0082](0082-agent-chat-steer-followup-ipc.md) | Agent chat mid-run steer/follow-up IPC | steerAgentChatStream / followUpAgentChatStream → façade; product autoDrain false; renderer FIFO residual; steer ≠ abort / no YOLO. |
| [ADR-0084](0084-teaching-doctor-product-ipc.md) | TeachingDoctor product IPC | runTeachingDoctor 组装 processCrashMarker + pure doctor + export-safe report；无 auto-repair/upload/clear；UI 面板 residual。 |
| [ADR-0093](0093-teaching-doctor-multi-collector-facts.md) | TeachingDoctor multi-collector facts | 纯 assembleTeachingDoctorFacts + product-run factsCollectors deps；store 仍为 processCrashMarker SoT；IPC 闭集不变；Settings UI / 真实 workspace collectors residual。 |
| [ADR-0095](0095-teaching-doctor-settings-ui.md) | TeachingDoctor Settings 只读 UI | Settings section doctor + thin panel 调用 runTeachingDoctor；展示 export-safe report；无 auto-repair/upload/clear；IPC 闭集不变。 |
| [ADR-0099](0099-teaching-doctor-config-facts-collector.md) | TeachingDoctor config facts collector | createTeachingDoctorConfigFactsCollector + gateway `factsCollectors` 注入 settings load；fail-soft；secrets/绝对路径不进 facts；IPC 闭集不变；session/outcome FS collectors residual。 |
| [ADR-0102](0102-teaching-doctor-catalog-drift-collector.md) | TeachingDoctor catalog drift facts collector | createTeachingDoctorCatalogDriftFactsCollector + gateway `factsCollectors` 注入 active workspace + `planLessonIndexReconciliation`；relative-only path hard-cap；无 workspace → skipped；fail-soft；IPC 闭集不变；session/outcome residual。 |
| [ADR-0104](0104-teaching-doctor-session-outcome-scan-collectors.md) | TeachingDoctor session/outcome crash-window scan collectors | createTeachingDoctorSessionOutcomeScanFactsCollector + gateway `factsCollectors` 注入 active workspace + `createLearningSessionLedger(...).scan()` 一次加载；pure maps session/outcome facts；无 workspace → skipped；**不** reconcile；fail-soft；IPC 闭集不变。 |
| [ADR-0105](0105-teaching-doctor-source-gap-collector.md) | TeachingDoctor source-gap facts collector | createTeachingDoctorSourceGapFactsCollector + gateway `factsCollectors` append；active workspace summary 投影（resources/referenceCount/assetsReady）；无 path；无 workspace → skipped；非完整 GroundingPack；fail-soft；IPC 闭集不变。 |
| [ADR-0094](0094-study-task-timer-planning-design-gate.md) | Study task/timer planning Phase 0 design gate | 六层模型 / TimerSession 与教学 Session 分界 / StudyPlanningStore sole-writer 原则与产品默认 **decision freeze**；**无生产行为变更**；不授权 writer 实现或路径冻结；后续 Phase1+ 须独立 ADR |
| [ADR-0089](0089-agent-session-queue-projection.md) | Agent session queue projection | Pure main-side queue snapshot DTO；默认省略 free-text；可选 hard-cap preview；product autoDrain 仍 false；IPC residual。 |
| [ADR-0091](0091-agent-session-queue-projection-ipc.md) | Agent session queue projection IPC | `projectAgentSessionQueue` → façade.projectQueue；fail-closed parser；默认省略 free-text；product autoDrain 仍 false；renderer consumer residual。 |
| [ADR-0096](0096-agent-session-autodrain-product-evaluation.md) | Product autoDrain evaluation (keep false) | B-02 residual：**决策 product 继续 `autoDrain: false`**；记录 wiring / 只读队列 IPC / 翻转前置条件；无生产行为变更；可选只读 renderer consumer residual。 |
| [ADR-0070](0070-agent-runtime-wire-shared-protocol.md) | Agent runtime wire → shared/protocol | S-01：canonical wire types/serializers 在 src/shared/protocol；main 兼容 re-export；settlement / TeachingEvent 大迁移不在本切片。 |
| [ADR-0051](0051-provider-finish-reason-and-length-tool-rejection.md) | Provider finish reason + length tool rejection | `ChatAdapterResult.finishReason` 透传；ledger 不再伪造 stop；`length`+toolCalls 零 handler。 |
| [ADR-0054](0054-actions-sha-pin-dependabot-osv-fail-open.md) | Actions SHA pin + dependabot(actions) + OSV fail-open + critical npm exact pin | 外部 Actions 全 commit SHA；Dependabot 仅 github-actions；OSV 扫描 fail-open；allowlist critical npm exact pin（`check:pinned-critical-deps`，不进 Blocking CI / 不替换 teaching 门）。 |
| [ADR-0057](0057-provider-bounded-retry-and-shared-budget.md) | Provider bounded retry + local retry boundary | A-05：`provider-retry.ts` full-jitter；loop 对 retryable 错误有界重试；`auto_retry_*` 诊断；billing/auth/length/overflow 永不重试。原 shared run budget 已由 [ADR-0171](0171-continuous-agent-runs-and-context-governance.md) 取代；完整资源治理迁移仍以 ADR-0171 的部分实施状态为准。 |
| [ADR-0052](0052-provider-error-and-recovery-taxonomy.md) | Provider error UX + recovery taxonomy | UX 四类保留；`quota exceeded`/billing → `insufficient_balance` 不再进 `rate_limit`；`classifyProviderRecovery` 纯函数导出 retryable/shouldCompress/shouldFallback（未接线 retry）。 |
| [ADR-0125](0125-provider-overflow-patterns-and-silent-heuristics.md) | Provider overflow patterns + silent heuristics | 见上表 ADAPT-P1；扩展 0052 的 context_overflow 文本/静默检测，不改变 flags。 |
| [ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md) | Codex 式平台能力分层与 consumer 迁移 | **已实施（分 phase）**：PlatformIoProfile registry + chat hot-path degrade + Windows memory `windows_direct_path_non_cas` 读写；doctor/Settings 诚实投影；outcome/audit Windows 保持 unavailable。不重开 Windows strict；不引入 danger-full-access。**本 ADR 不承担 shell 产品面**（见 0152/0153；A–F 已合格完成）。**默认写模型**由 [ADR-0131](0131-pathname-default-durable-io.md) supersede。 |
| [ADR-0127](0127-user-configurable-mcp-design-gate.md) | 用户可配置 MCP v1 design gate | **部分被 ADR-0132 取代**：v1 user-config、effect lattice、secret/settlement 不变量保留；auto-connect、marketplace、workspace/plugin source 禁令不再适用于后续阶段。 |
| [ADR-0128](0128-user-configurable-mcp-implementation.md) | 用户可配置 MCP v1 实现合同 | **已实施 v1 / 部分被 ADR-0132 扩展**：`UserMcpConfigV1`、stdio/HTTP/SSE、`mcp__server__tool`、默认 privileged、IPC、Settings、Doctor；后续 lifecycle 不受旧的 no-marketplace/no-auto-connect 限制。 |
| [ADR-0132](0132-mcp-zcode-parity-and-trust-lifecycle.md) | MCP 与 Zcode 对齐、trust lifecycle | **已采纳 design gate / 分阶段实施**：v1 仍默认 off/manual（ADR-0128）；A–D **已实施**（0133–0136）；E foundation [0137](0137-mcp-multi-source-precedence-and-auto-connect.md)；F [0138](0138-mcp-filesystem-workspace-root-injection.md)；G [0139](0139-mcp-plugin-lifecycle.md)；H [0140](0140-mcp-marketplace-local-catalog.md)。**不**将 auto-connect/marketplace 写成静默默认。 |
| [ADR-0133](0133-mcp-runtime-reliability-implementation.md) | MCP runtime reliability（Phase A） | **已实施（Phase A）**：paged `tools/list`、inventory stale、disconnect/manual refresh、secret-free runtime diagnostics；不授权 OAuth、结果 artifact、config precedence、workspace-root capability、plugin 或 marketplace。 |
| [ADR-0134](0134-mcp-result-safety-and-local-artifacts.md) | MCP result safety / local artifacts（Phase B） | **已实施（Phase B）**：typed result normalizer、artifact spill、non-fetching resource link、bounded local trace；MCP result **不是** teaching evidence / outcome；不授权 OAuth 之外的 sources、workspace-root capability、plugin 或 marketplace。 |
| [ADR-0135](0135-mcp-oauth-pkce-and-secret-token-lifecycle.md) | MCP OAuth PKCE / secret token lifecycle（Phase C） | **已实施（Phase C）**：user-configured HTTP/SSE 的 authorization-code + PKCE、main-only callback/deep-link、safeStorage token、refresh/revoke、secret-free Settings/IPC；token/secret **永不**进 renderer；不授权 auto-connect、marketplace、plugin 或 workspace-root。 |
| [ADR-0136](0136-mcp-config-import-export-and-sync-contract.md) | MCP config import/export / McpSync wire（Phase D） | **已实施（Phase D）**：Claude/Cursor/`UserMcpConfigV1` 批量导入预览、用户确认后 CAS 写入、脱敏导出、migration report、未来 McpSync shared types；**无**网络 sync、无 auto-connect、无 marketplace、无多来源 precedence。 |
| [ADR-0137](0137-mcp-multi-source-precedence-and-auto-connect.md) | MCP multi-source + auto-connect（Phase E） | **已实施（Phase E）**：pure `source-resolver` / `source-types`、main `source-loaders`、`McpHost.applyEffectiveConfig` / `autoConnectNow`、`autoConnect` 默认 false；precedence CLI→env→user→workspace→plugin→system；workspace 只读 `.agents/mcp.json` / `mcp.json` / `zcode.json`；auto-connect 仅 discovery 非 tools/call；**无** app 冷启动无条件后台循环、无 marketplace install。 |
| [ADR-0138](0138-mcp-filesystem-workspace-root-injection.md) | MCP workspace-root injection（Phase F） | **已实施（Phase F）**：显式 `workspaceRootInjection: granted` 时向 stdio args 追加一次规范化 active workspace root；session 在 root 切换时重建；默认 off；不绕过 effect/settlement。 |
| [ADR-0139](0139-mcp-plugin-lifecycle.md) | MCP plugin trust / lifecycle（Phase G） | **已实施 foundation**：声明解析、namespace id、allowlist 模板、`PluginMcpRegistry` trust/revoke/cleanup；无远程下载。 |
| [ADR-0140](0140-mcp-marketplace-local-catalog.md) | MCP marketplace 本地目录 foundation（Phase H） | **已实施 foundation**（store/IPC/types）；**Settings 无市场 UI**（[ADR-0142](0142-mcp-product-surface-settings-only.md)）。远程 catalog 产品页非当前 shipping。 |
| [ADR-0141](0141-mcp-product-experience-parity-policy.md) | MCP 产品体验边界政策 | **已采纳硬安全 + foundation 授权**；**Settings 产品面收窄**见 [ADR-0142](0142-mcp-product-surface-settings-only.md)（list/editor only，无 marketplace 页）。 |
| [ADR-0142](0142-mcp-product-surface-settings-only.md) | MCP 产品面收窄（Settings 仅 list/editor） | **已采纳**：Settings MCP = list/editor/import/OAuth；marketplace 无 Settings UI；A–H foundation 可保留；硬安全不变。 |
| [ADR-0143](0143-context-file-touch-ledger.md) | 确定性 context file-touch ledger（LiveAgent Phase A） | **已实施**（core ledger，2026-07-24）：`context-file-ledger.ts` + agent-loop / projection 接线；失败剔除、`modified` 粘性、超预算丢弃；注入为 data not instructions；不进 summarizer；非 teaching-evidence / 不取代 LearningSessionLedger；learner UI residual。 |
| [ADR-0144](0144-ask-authoritative-deadline.md) | Ask 权威 deadline + 超时落定（LiveAgent Phase A） | **已实施**（2026-07-23）：权威 __deadlineAt；超时 → recommended/first；取消 → abort；超时禁止 auto-approve write/privileged/turn-review。 |
| [ADR-0145](0145-compaction-pressure-single-flight.md) | 压缩 pressure / 单飞 / mid-run 保护（LiveAgent Phase A） | **已实施**（2026-07-24）：pressure controller + compactor 接线；pre_send/post_tool + **mid_stream 标签**；single-flight **join 复用首次结果**；pressure ladder；reference-only；全局硬 run budget 优先规则已由 ADR-0171 取代。真 mid-token overflow 拦截未交付。 |
| [ADR-0147](0147-mcp-id-level-ops-and-live-getter.md) | MCP id 级 ops + live getter（LiveAgent Phase B） | **已实施**（2026-07-24）：`mcp-ops.ts` + config-store CAS + IPC getMcpSettings/applyMcpOps；secret-free public DTO；无 marketplace Settings 页。 |
| [ADR-0148](0148-presence-only-secret-boundary-sweep.md) | Presence-only 密钥边界扫尾（LiveAgent Phase B） | **已实施**（2026-07-24）：`secret-presence.ts` + MCP public DTO + Doctor facts + support-bundle deny（含 environment 走私字段）；presence 布尔保留；无默认远程 telemetry。 |
| [ADR-0149](0149-provider-custom-headers-reserved-blacklist.md) | Provider custom headers + 保留键黑名单（LiveAgent Phase B） | **已实施**（2026-07-24）：有序 customHeaders；Authorization/x-api-key/User-Agent 等保留键不可覆盖；诚实 StudiumX UA；CLI 伪装头拒绝；日志脱敏；settings normalize + request-builder/probe 接线。 |
| [ADR-0150](0150-skills-install-stage-then-swap.md) | Skills 安装 stage-then-swap（LiveAgent Phase B） | **已实施**（2026-07-24）：`skill-install-stage-swap.ts` + `installSkill`；`.staging` + rename + write guard；半成品不可见；仍 allowlist/verifier；无无校验市场。 |
| [ADR-0151](0151-teaching-kernel-and-skill-orchestration.md) | Teaching Kernel 与 Skill 编排权威边界 | **已实施（2026-07-27，Phase 0–6 closeout）**：双平面；app-shipped verified `teach` 永久 fail-closed；host registry + 纯 planner + continuity/gates + current-stage bodies + configured budget pressure + prompt body budgets；Phase 4–6 由 ADR-0163 收口；manifest schema v2 延期。 |
| [ADR-0152](0152-workspace-shell-and-codex-aligned-approval.md) | 工作区命令与 Codex 对齐三态审批 | **部分被 0153 supersede；审批轴仍有效**：审批三态 + `run_workspace_command` 形状保留；默认 `workspaceShell` 与主路径/安全闭环以 0153 为准。禁止 YOLO 标签。 |
| [ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md) | Codex 双轴 Sandbox + 主流 Agent Shell | **已实施（合格交付，2026-07-25；产品面于 2026-08-02 更新）**：A–F 已完成；工具调用应用级启用，`tools.enabled` 仅保留并归一化为 `true` 的兼容字段，Settings 无总开关；`workspaceShell` 默认开且仍可关闭。双轴/工作区信任/路径围栏/审批持续适用。Windows helper 可选延期；禁止 YOLO / 虚假 Docker·VM 完备宣称。 |
| [ADR-0154](0154-spaced-review-scheduler-and-review-due-planner-action.md) | 间隔复习调度投影与 planner `review_due` | **部分实施**（2026-07-27）：纯调度投影（固定阶梯 1/3/7/21/60 天）+ ledger scan 适配器 + planner 动作扩展（无 review 事实时决策表逐字节不变）+ bridge dueCount + Teaching Reader 受控复习入口；TodayQueue residual。调度器是可重建投影,非第二权威;不写 ledger/outcome；Pet 不新增功能。 |
| [ADR-0155](0155-fill-quiz-settlement-via-sidecar-v2.md) | fill 题结算（sidecar v2 + 归一化答案 digest） | **已实施**（2026-07-26）：冻结归一化契约贯穿 quiz.js/证据桥/evaluator；证据携带 `fill-<sha256>` 身份（无学习者明文）；sidecar schemaVersion 2（v1 保守语义原地保留）；`['submit']` 垃圾证据判 malformed。不放宽 0016 静态文法;HTML sidecar 变体 fill 仍 unsupported。 |
| [ADR-0156](0156-skill-orchestration-conversation-continuity.md) | Skill 编排跨轮续航（durable 会话状态 + priorState） | **已实施（核心）**（2026-07-26）：planner 可选 priorState（无则逐字节不变）；确定性 gate 判定（不可导出的 gate 诚实 fail）；`.agent-sessions/skill-orchestration/` 可重建状态（损坏→单轮降级）；bridge 真实 mission/resource/artifact/review 事实替换占位 seed；附带修复 artifact token 小写化休眠 bug。多选 UI 属 0151 Phase 4 residual。 |
| [ADR-0157](0157-learning-outcome-strength-and-consolidation.md) | 学习结果强度维度（provisional→consolidated） | **Proposed（设计草案,未实施 — 2026-07-26）**：established 细分当场/隔日复验强度;record immutable,强度由 RetentionProjection 派生。 |
| [ADR-0158](0158-model-assisted-grading-candidate.md) | 解释性证据的受限评分候选 | **Proposed（设计草案,未实施 — 2026-07-26）**：模型按 rubric 产出评分候选作辅助证据;单独永不产生 established;committer 确定性核心不动。 |
| [ADR-0159](0159-learning-objectives-and-mastery-projection.md) | LearningObjective 与掌握度投影 | **Proposed（设计草案,未实施 — 2026-07-26）**：CourseDefinition v2 目标声明;item↔objective 绑定;五态掌握投影;diagnose 前测复用全链结算。 |
| [ADR-0160](0160-teaching-turn-behavior-contract.md) | 教学行为合同（turn shape 检查） | **Proposed（设计草案,未实施 — 2026-07-26）**：恰一 Elicit 收尾等确定性后置检查 + recovery 软纠偏;kernel 版本化与本地教学回归;Mastery Policy ADR 化。 |
| [ADR-0161](0161-today-learning-queue-projection.md) | 今日学习队列投影 | **Proposed（设计草案,未实施 — 2026-07-26）**：到期复习 + planner 下一步 + Study task 的零写权聚合;三表面单源消费;复习 3–5 项/日上限。 |
| [ADR-0162](0162-local-learning-effectiveness-analytics.md) | 本地学习效果分析 | **Proposed（设计草案,未实施 — 2026-07-26）**：掌握进度/复习命中率/遗忘回退率等封闭指标目录,全部可由 ledger 重算;无 telemetry。 |
| [ADR-0163](0163-teaching-capability-selection-and-plan-preview.md) | 教学能力选择面与编排计划预览 | **已实施（2026-07-27）**：0151 Phase 4–6 收尾——只读 preview、host-owned preset、多选 chip/无障碍计划预览、严格 IPC、15 个 builtin skill 治理、本地 counts-only stage/conflict/prompt/gate/teaching-completeness 评估，以及明确同意后的 support-bundle 导出；无 phone-home，override 明确为未支持。 |
| [ADR-0164](0164-unified-teaching-chain-and-skill-admission.md) | 统一正式教学链路与 Skill 准入 / 产品面 | **已实施（2026-07-27）**：统一 Teaching Authority lifecycle；`teach` exactly-one；host-owned admission projection；primary strategy / workflow router cardinality；Capability Library 与 personal-file 非 authority 产品边界。限定 ADR-0163 的自由多选心智，8 仅作输入 ceiling。 |
| [ADR-0165](0165-teaching-capability-trigger-surface-deferral.md) | 教学能力触发按钮展示面延期 | **已实施（展示面回退,2026-07-30）**：将「教学意图与能力设置」触发按钮从两个 composer 工具栏注释下线（picker 逻辑保留），并移除输入框上方「教学内核已启用」chip；picker/planner/IPC/settlement/工具审批不变，slash 入口仍可用。 |
| [ADR-0166](0166-teaching-diagnostics-and-review-nav-deferral.md) | 教学诊断 / turn-review 设置导航延期 | **已实施（展示面回退,2026-07-31）**：将 Settings 导航中的「诊断（doctor）」与「复核（review）」两项从 `settingsNavItems` 注释下线；review 仅为 demo 脚手架、doctor 为小众排障工具。section 渲染分支、组件逻辑与单测全部保留，IPC / doctor / turn-review 投影语义不变，待未来展示面确定后重新挂载。 |
| [ADR-0167](0167-teaching-authority-and-syncable-user-state.md) | 教学权威与可同步用户状态边界 | **已采纳（2026-07-31）**：教学真相源仅约束 AI 根据进度/答题制定下一步计划的事实链路；等级/XP、偏好、规划与经同意的派生摘要可多端同步，但不得反向成为 teaching authority。 |
| [ADR-0168](0168-pi-compatible-explicit-skill-invocation.md) | Pi 兼容的显式 Skill 调用 | **已采纳（2026-08-01）**：`/skill:<id>` 是单轮用户授权 instruction overlay；main-only verified expansion、48k hard-cap fail-closed、虚拟 `skill://` location、脱敏 invocation evidence；不改变 planner authority、settlement、effect lattice 或默认 shell。 |
| [ADR-0169](0169-web-remote-control-lan-and-self-hosted-relay.md) | 移动端远程控制（LAN + 可选自建中继） | **已采纳（Phase 0/1 骨架实施中）**：默认关、默认 loopback；LAN 显式开启；无默认云 relay；pairing secret 不进 public DTO；远程工具仍走 effect lattice + approval。 |
| [ADR-0170](0170-agent-conversation-host-serialization-design-gate.md) | Agent conversation 主进程串行化与无感并发恢复 | **已实施（实现完成，2026-08-03）**：desktop renderer 窄 intent → main/host per-conversation lane；host 为唯一 FIFO auto-drainer，排队 sender 获自有 lifecycle start stream；canonical CAS/完整 transcript 前缀证明 fail-closed。§4.2 精确 cancel intent 已经 public IPC、严格 parser、preload、gateway 与 renderer 接线，只作用于匹配 active identity 的 lane；legacy steer/follow-up 拒绝 host-lane stream。legacy direct `agentChatStream` 仅兼容且不得与 migrated canonical lane 竞争；WRC 目前仅 authenticated pairing + 只读 catalog，无 WRC chat。8 个 ADR focused unit 为 91 passed / 2 skipped；`typecheck`、IPC/evidence/tool/security/provider-privacy、`check:blocking-ci` 与 diff 检查均通过。 |
| [ADR-0171](0171-continuous-agent-runs-and-context-governance.md) | 连续 Agent 运行与上下文治理 | **需修订（部分实施）**：反对不透明、低位、默认的累计 token / provider / tool calls、duration / iteration quota；允许可审计的高位 emergency fuse、用户显式资源预算与部署/组织策略，触发时报告 `resource_limit` / `suspended`，不得伪装为 provider quota 或学习成功。以 projection-only compaction、每个逻辑请求最多一次 overflow compact-and-retry 与语义活性守卫处理压力；无 host-owned continuation intent，启动恢复仅中断 / 人工复核，绝不重放工具或重发 provider 请求；任何新继续均经 canonical `expectedRevision` turn 与 settlement sole-writer。 |
| [ADR-0172](0172-mind-map-and-ai-assist.md) | 思维导图与 AI 辅助生成 | **已采纳（设计见 docs/mindmap/design.md，实施中）**：原生导图编辑（数据模型镜像 XMind content：sheet→rootTopic→topic 递归树）+ AI 辅助生成（复用 provider 基建，Zod 校验）；导图是用户内容非教学权威；durable 工作区写；`.xmind` 导入/导出用 fflate；渲染器自绘 SVG。切片 S1–S6 分派实施。 |
| [ADR-0053](0053-agents-md-security-suite-and-testing-doctrine.md) | 根 AGENTS.md + security suite + 测试教条 | SECURITY_CHECKS 纳入 external-content boundary；根 AGENTS / CONTRIBUTING 的命令图、红线、改哪测哪与 L0/L1/L2/L4 分层约定；不替代 ADR、不扩 Blocking CI。 |
| [ADR-0072](0072-node-engines-and-source-rev-build-identity.md) | Node engines / .nvmrc + SOURCE_REV 构建身份 | `.nvmrc`=22；`engines.node` `>=22 <25`；`readBuildIdentity` fail-closed；doctor 非阻塞展示；非 SBOM / 非签名 / 无 phone-home。 |
| [ADR-0073](0073-teaching-feature-registry.md) | Teaching FeatureRegistry（薄元数据） | 纯 `features.ts` stage 生命周期；非 CapabilityCatalog/Ladder 替换；禁止 shell/code_mode/YOLO bypass。 |
| [ADR-0074](0074-blocking-ci-fan-in-and-worktree-gates.md) | Blocking CI fan-in + worktree/format 轻门 | `blocking-required` skip=fail 聚合三 domain jobs；clean-worktree porcelain；format 子集（无全仓 prettier）；domain 门不被替换。 |
| [ADR-0075](0075-module-size-policy-and-giant-peel.md) | 模块尺寸政策 + 巨石按触达 peel | 目标 &lt;500–800；软/高告警 800/1000；legacy-giant allowlist；`check:module-size` 默认 exit 0；peel 保留 sole-writer/ledger；**不**进 Blocking CI、**不**本切片 peel。 |
| [ADR-0076](0076-memory-injection-sanitize.md) | Memory injection sanitize | 纯 `memory-sanitize`；recall→inject 边界 content 消毒；无 FTS5 / 无向量 / 无自动 memory phase。 |
| [ADR-0077](0077-teaching-turn-review-candidates.md) | Teaching-safe post-turn review candidates | 纯函数候选；人批门控；禁止自动 skill/profile；finalize 接线 residual；无 settlement 变更。 |
| [ADR-0079](0079-workspace-tool-policy-fs-loader.md) | Workspace tool-policy FS loader | Contained read of optional .studiumx/tool-policy.json; pure loadToolPolicyDocument; fail-closed null; no argv/YOLO; product auto-wire residual. |
| [ADR-0083](0083-workspace-tool-policy-product-inject.md) | Workspace tool-policy product inject | Primary conversation runtime loads optional workspace policy into buildToolContext; null omits field (default-equivalent); other call sites residual. |
| [ADR-0088](0088-workspace-tool-policy-secondary-inject.md) | Workspace tool-policy secondary inject | delegation-runtime + lesson-plan-production (grant-gated) optional load into buildToolContext; null omits field; catalogs deferred. |
| [ADR-0101](0101-workspace-tool-policy-catalog-inject.md) | Workspace tool-policy catalog inject | capability (option B preloaded) + connector-health (async evaluate) optional load into buildToolContext; null omits field; snapshot stays sync. |
| [ADR-0108](0108-write-capture-permission-decision-wire.md) | Write capture permissionDecision wire | registry sets ToolContext.lastJournalPermissionDecision after resolve; workspace capture passes through; pure gate+resolution mapping; journal audit only. |
| [ADR-0112](0112-tool-policy-multi-document-merge.md) | Tool-policy multi-document pure merge | `mergeToolPolicyDocuments` most-restrictive-wins；rules 拼接 + defaultDecision strictest；空输入 DEFAULT；无 UI / 无多文件 FS / 无 YOLO。 |
| [ADR-0115](0115-tool-policy-multi-path-load-merge.md) | Tool-policy multi-path load+merge | `loadAndMergeToolPolicyDocumentsFromWorkspace`：primary + optional course overlay；fail-soft per file；merge via 0112；仅 conversation inject；无 Granular UI。 |
| [ADR-0118](0118-tool-policy-secondary-multi-path-inject.md) | Tool-policy secondary multi-path inject | 次级 inject（delegation / lesson-plan / capability·connector catalog）改用 multi-path helper；grant/omit 门禁不变；primary-only ≡ 单文件；无 Granular UI。 |
| [ADR-0117](0117-study-planning-store-paths-and-wire.md) | Study planning store paths / wire v1 | 冻结 `.studiumx/study-planning/` 布局、`schemaVersion: 1`、Store 命令信封与错误码、V1→V2 dry-run/fail-closed 迁移；**本 ADR 无生产写路径**；实现须另 PR。 |
| [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md) | Study planning renderer cutover + sole-authority | **已实施沉淀**：dual-write 写 canonical + sole-read hydrate；TimerSession 为 segment-close analytics / live focus 秒权威；迁移 fail-closed 且不自动擦除 localStorage；sleep 用 renderer visibility/pagehide，main powerMonitor 延期；**不**宣称 §18 完成；**不**超出 ADR-0117 再冻路径。 |
| [ADR-0130](0130-study-planning-phase7-and-completion-residual.md) | Study planning Phase 7 高级排程 + §18 residual 政策 | **决策冻结**（2026-07-22）：STC-702 pure-sequence-first；STC-703 pure expand；STC-704 pure TZ/DST helpers （**旅行时区产品 2026-07-22 撤回**；allocation-from-plan 产品同步撤回）；**路线图完成 ≠ §18 产品完成**；V1 并存 / powerMonitor 等 residual 带触发条件 |
| [ADR-0131](0131-pathname-default-durable-io.md) | 默认 durable I/O = 可信 root pathname 写 | **已实施**（2026-07-22）：temp→write→可选 fsync→rename；native `contained_durable_replace` 已删且非默认；**不**宣称 CAS/power-loss；supersede ADR-0126 **默认** dual-profile 权威；workspace/memory/projection 统一 pathname。 |
| [ADR-0078](0078-workspace-host-port.md) | WorkspaceHost 薄端口 + 轻量 import 门 | S-02：src/main/workspace-host/* 委托 path-access/paths/access；依赖方向 tools→port→path；check:workspace-host-imports 可选、**不**进 Blocking CI；**不** peel teaching-workspace。 |
| [ADR-0080](0080-teaching-turn-review-finalize-wire.md) | Teaching-turn review finalize wire | Orchestrator 可选 post-finalize review hook；candidates only；hook 错误 fail-soft 保 settlement；无 coordinator/UI/auto-apply。 |
| [ADR-0081](0081-memory-sanitize-non-recall-paths.md) | Memory sanitize non-recall paths | ADR-0076 residual：lesson prompts + memory-tools 注入边界消毒；storage raw；无 FTS5 / 无自动 memory。 |
| [ADR-0085](0085-teaching-turn-review-human-approve-projection.md) | Teaching-turn review human-approve projection | 纯决策 + 只读投影 DTO；approved ids 非 apply plan；无 IPC/UI/auto-apply/settlement。 |
| [ADR-0087](0087-teaching-turn-review-human-approve-ipc.md) | Teaching-turn review human-approve product IPC | project/decide 两闭集 channel → pure ADR-0085；fail-closed parser；无 auto-apply/settlement；UI 面板 residual。 |
| [ADR-0097](0097-teaching-turn-review-settings-ui.md) | Teaching-turn review Settings thin UI | Settings section `review`；demo client bundle → projectTeachingTurnReview；可选 decide 再投影；approved ids 仅展示；无 auto-apply / main 持久化队列。 |
| [ADR-0109](0109-teaching-turn-review-post-approve-handoff.md) | Teaching-turn review post-approve handoff | 纯 handoff intents：approved ids → consent-gated routing DTO；无 auto-apply / durable store / IPC / settlement。 |
| [ADR-0110](0110-teaching-turn-review-handoff-ipc.md) | Teaching-turn review handoff product IPC | 闭集 `projectTeachingTurnReviewHandoff` → pure ADR-0109；fail-closed parser；无 auto-apply / durable store / settlement。 |
| [ADR-0111](0111-teaching-turn-review-settings-handoff-ui.md) | Teaching-turn review Settings handoff UI | 成功 project/decide 后客户端 pure handoff intents 只读展示；无 Apply / 无真实 consent 导航 / 无 durable store / 无 handoff IPC 依赖。 |
| [ADR-0113](0113-teaching-turn-review-last-bundle-store.md) | Teaching-turn review last-bundle durable store | 纯 snapshot DTO + caller-root contained FS；可重建投影缓存；无 auto-apply / 无 IPC 本切片 / 非 settlement SoT。 |
| [ADR-0114](0114-teaching-turn-review-last-bundle-ipc.md) | Teaching-turn review last-bundle product IPC | 闭集 get/save last-bundle → ADR-0113 pure+FS；Settings Load/Save 演示往返；无 auto-apply / 非 settlement SoT。 |
| [ADR-0116](0116-teaching-turn-review-last-bundle-finalize-save.md) | Teaching-turn review last-bundle finalize save | composition-edge factory；默认 off；source finalize_hook；fail-soft；无 auto-apply / 非 settlement SoT / 不改 IPC allowlist。 |
| [ADR-0098](0098-agent-session-queue-renderer-consumer.md) | Agent session queue 只读 renderer consumer | Doctor 面板底部只读 queue diagnostics；`projectAgentSessionQueue`；无 free-text；无 drain/steer；autoDrain 展示期望 false；local FIFO 不变。 |
| [ADR-0122](0122-usage-ledger-as-canonical-observability.md) | Usage ledger as canonical observability | 设计权威 + **DB-P0-3 最小实现已落地**（JSONL + optional SQLite projection）；与 LearningSession 正交、诊断级 retention、redaction；非「仅设计未实现」。 |
| [ADR-0123](0123-runtime-session-store.md) | Runtime session store (design only) | **Proposed / 未实施**：可选 disposable runtime 缓存形状 + 硬门槛；export/resume 仍文件权威；不 override DB-P2-3；无生产 schema/writer。 |
| [ADR-0124](0124-database-layered-authority-and-pr-gates.md) | Database 分层权威 + PR 验收闸 + P2 边界 | 写/读分层；六大 Gate；DB-P2-1…4 触发/won't-do；P0/P1/OPT 诚实状态；替代已删除的 `docs/improvements/database-*` 活草稿。 |
| [ADR-0125](0125-provider-overflow-patterns-and-silent-heuristics.md) | Provider overflow 模式库 + 静默启发式 | ADAPT-P1：provider-overflow-patterns pure 匹配；NON_OVERFLOW 排除 throttling；silent stop/length usage；overflow 仍 retryable:false shouldCompress:true。 |
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

``sh
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts
# 1 file, 27 tests passed
``

P9-S5 `47393f9` 仅修改测试，未改 production code。它覆盖 audit directory 与 conversation parent directory 的 `open`/`sync` capability symmetry：5 个 allowlist code × 2 个目录 × 2 个操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 的 `EINVAL` 仍 fatal。S5 本切片 1 file、51 tests passed；与 archive durable 共同运行 2 files、78 tests passed。其后 P9-S6…P9-S45 继续补充 audit file/directory/transfer residual 的 tests-only evidence（最新定向约 149 tests passed）；均不改变 production/API/schema/order。

- **边界结项（ADR-0035）：**V1 fixed-file audit scope 以 ADR-0019 与已实施 append/dedupe boundary 结项；**不**批准扩张为 strict durable profile、generic JSONL、rotation、repair、cross-process multi-writer、archive transaction、IPC/UI 或 public result surface。现有 audit 仍是 per-conversation、append-only、ordered-best-effort session evidence：进程内同路径 queue 不是跨进程 exclusion，directory-sync warning 不是 strict/power-loss proof，audit outcome 也不决定 JSON、Markdown 或 learning-work ledger 的 authority。
- **明确非声明（out-of-scope，非当前可分派实现）：**crash/power-loss、all filesystems、cross-process multi-writer、all JSONL、跨文件 transaction、rotation、repair/migration、ledger authority/save-order 改造或 IPC/UI。产品若需要上述任一扩张，须**新建 ADR** 定义 profile 与 evidence，不得把 residual tests 或本结项解释为这些能力已实现。

逐条历史证据见 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0019](0019-session-audit-v1-wire-contract-and-limited-authority.md) 与 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)。当前无开放 P9 实现切片。

## Hermes × Reasonix 结项（reason-hermes）

Hermes / Reasonix 合并借鉴清单（A–H 近端切片）已落地并沉淀为 ADR-0044–0050；B-01/A-08 运行时队列与契约见 ADR-0055；B-05 tools/schema 指纹见 ADR-0060；Slice I 与「明确不借」项保持延期/不借。近端清单源文件已删除，以本目录 ADR 与代码为准。

## 四源改进借鉴 ADOPTION 结项（pi / codex / grok / hermes）

原 `docs/improvements/{ADOPTION,pi,codex,grok,hermes}.md` 统一 backlog 已全部可实现切片落地（ADR-0051–0116、0118–0120；0117 为 study-planning 旁路）。长期边界、命名冻结、明确不采纳与信号触发 residual 见 **[ADR-0121](0121-improvements-adoption-closeout.md)**。`docs/improvements/` 目录已清空，不得重建为第二套 backlog。

Database 子系统：event density / backup-export / multi-workspace rebuild 默认与 OPT-2 骨架 / OPT-7 词法证据表，已分别并入 [ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)、[ADR-0001](0001-rebuildable-sqlite-projection.md)、[ADR-0034](0034-redacted-support-bundle.md)、[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)。分层权威、P2 边界、六大验收闸与 P0/P1/OPT 诚实状态见 [ADR-0124](0124-database-layered-authority-and-pr-gates.md)（已删除 `docs/improvements/database-*` 活草稿；契约测试锁定 ADR-0124）。ZCode/Marvis 对照摘要见 ADR-0124 §6。

## 维护约定

- 已实施且会长期影响架构的决定，新增一份编号递增的 ADR；不要为了记录小进度而新建 ADR。
- 已实施决定的范围、边界或验证入口变化时，更新对应 ADR；新的开放/延期工作必须新增独立 ADR（含 design gate 前提），不得把 ADR 的受限切片扩大为完整 closure。已结项 plan 应删除，不保留无用指针 stub。
- ADR 中的 Git 提交 hash 是验证线索。若合并主线时使用 rebase 或 squash 导致 hash 改变，应将其更新为主线中可追溯的提交或合并记录。
- ADR 记录的是已获采纳的决定；尚未批准的建议不得记为已实施事实。当前无独立 local-data 待办页：开放实现须先有新 ADR 批准，延期项以各 ADR 的 non-claims / 延期段落为准（C-6 destructive 见 ADR-0038）。Study-planning：Phase 0 见 [ADR-0094](0094-study-task-timer-planning-design-gate.md)；路径/wire/store 合同见 [ADR-0117](0117-study-planning-store-paths-and-wire.md)；renderer cutover 见 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)；Phase 7 / §18 residual 见 [ADR-0130](0130-study-planning-phase7-and-completion-residual.md)。
