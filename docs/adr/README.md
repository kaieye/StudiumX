# 架构 ADR 索引

本目录是 StudiumX 的架构决策记录（Architecture Decision Record，ADR）入口。每份 ADR 记录一个**已采纳（或已提出）的架构决定**：为什么采用、边界是什么、以及它**没有**授权做什么。已实施的决定应可追溯到代码、测试与 Git 提交证据；少数条目为 **Proposed / design gate only**（索引表会标明），不代表生产 schema 或写路径已落地。

**完整机器维护索引见 [`INDEX.md`](INDEX.md)**：每份 ADR 一行（编号 / 决策状态 / 实施状态 / 领域 / 一句话决定 / 被取代）。本 README 只承担导航与约定，不再保存每份 ADR 的长摘要、测试结果或历史 evidence。

## 状态定义

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| **决策状态** | `proposed` | 已提出，尚未批准；不代表已实施 |
| | `accepted` | 决定已采纳 |
| | `superseded` | 已被后继 ADR 取代（原编号与文件保持可访问） |
| | `rejected` | 明确不采纳 |
| **实施状态** | `not_started` | 未开始实施 |
| | `partial` | 部分实施（正文标注已落地范围） |
| | `complete` | 已实施并有代码/测试证据 |
| | `not_applicable` | 纯政策/决定，无实现面 |

## 先从这里读

- 想快速了解现状：读 [`INDEX.md`](INDEX.md)，或按下方「按领域导航」查阅。
- 想了解某项做法的原因、边界和验证入口：打开对应 ADR。
- 想研究已关闭工作的历史决定：以本目录 ADR 为准。C-4 P6/P8/P9 受限结项见 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)；四源改进借鉴 ADOPTION 结项见 [ADR-0121](0121-improvements-adoption-closeout.md)。
- 想确认某能力是否已授权：以各 ADR 的「不变量 / 非目标 / non-claims」段落为准，不要以 `docs/improvements/` 或旧 backlog 为准。

## 按领域导航

| 领域 | 当前 canonical 决策 | 说明 |
| --- | --- | --- |
| 教学权威与可同步状态 | [ADR-0167](0167-teaching-authority-and-syncable-user-state.md) | 教学决策事实 vs 可同步用户产品状态的双平面边界 |
| LearningSession / Evidence / Outcome / settlement | [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[0009](0009-typed-lesson-interaction-evidence.md)、[0010](0010-evidence-gated-learning-record-cutover.md)、[0011](0011-evidence-gated-learning-outcome-settlement.md)、[0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)、[0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md)、[0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md) | ledger 是教学事实源；`TeachingTurnCoordinator`/host 是 outcome settlement sole-writer；`expectedRevision`、`toolsReplayed:false` 不变量 |
| 教学计划与 turn | [0012](0012-deterministic-next-teaching-step-planner.md)、[0013](0013-budgeted-provenance-aware-teaching-context.md)、[0014](0014-learner-safe-teaching-turn-presentation.md)、[0015](0015-canonical-teaching-event-protocol.md) | 确定性下一步、预算化上下文、学习者安全呈现、封闭事件协议 |
| 工具 contract / effect / approval | [0024](0024-typed-tool-dispatcher-effect-policy.md)、[0048](0048-tool-contract-and-write-policy.md)、[0041](0041-tool-annotations-and-result-budget.md)、[0056](0056-tool-result-turn-budget-and-spill.md)、[0060](0060-tools-schema-session-fingerprint.md)、[0061](0061-tool-capabilities.md)、[0063](0063-declarative-tool-policy.md)、[0112](0112-tool-policy-multi-document-merge.md)、[0115](0115-tool-policy-multi-path-load-merge.md) | effect lattice、TOOL_CONTRACT、审批与路径围栏；声明式 tool-policy（无 YOLO） |
| Agent run / 上下文治理 | [0021](0021-agent-run-state-machine-separate-from-session.md)、[0047](0047-agent-runtime-wire-and-turn-orchestrator.md)、[0055](0055-busy-input-queue-and-replay-contracts.md)、[0058](0058-agent-session-facade.md)、[0064](0064-context-compactor-cutpoints-and-reduction-guard.md)、[0143](0143-context-file-touch-ledger.md)、[0144](0144-ask-authoritative-deadline.md)、[0145](0145-compaction-pressure-single-flight.md)、[0170](0170-agent-conversation-host-serialization-design-gate.md)、[0171](0171-continuous-agent-runs-and-context-governance.md) | 连续运行、资源边界、取消与 context governance 不退化；无默认低位的累计 quota |
| Database / 投影权威 | [0001](0001-rebuildable-sqlite-projection.md)、[0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)、[0003](0003-critical-json-backups-and-verified-recovery.md)、[ADR-0122](0122-usage-ledger-as-canonical-observability.md)（usage 观测账本）、[0124](0124-database-layered-authority-and-pr-gates.md) | 文件/ledger 是写权威；SQLite 是可重建投影；usage 观测与教学 outcome 正交 |
| Durable publish / C-4 | [0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) | 共享 durable publish 原语 + 部分 consumer 迁移；P6/P8/P9 受限结项 |
| Memory | [0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md)、[0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md)、[0050](0050-lexical-memory-search-and-synthetic-memory.md)、[0076](0076-memory-injection-sanitize.md) | 分区/只读 preflight；词法检索 + 人批 remember/forget；无自动 memory/dream、无 FTS 产品搜索面 |
| MCP | [0127](0127-user-configurable-mcp-design-gate.md)–[0142](0142-mcp-product-surface-settings-only.md) | v1 用户配置 + 分阶段实现；产品面 = Settings list/editor/import/OAuth（[ADR-0142](0142-mcp-product-surface-settings-only.md)，2026-08-18 修订：marketplace UI 为设计 non-claim，非永久禁止）；secret/token 永不进 public DTO/Doctor/bundle；MCP 非 teaching evidence / settlement authority |
| Study planning | [0094](0094-study-task-timer-planning-design-gate.md)、[0117](0117-study-planning-store-paths-and-wire.md)、[0129](0129-study-planning-renderer-cutover-and-sole-authority.md)、[0130](0130-study-planning-phase7-and-completion-residual.md) | Phase 0 冻结；canonical 路径/wire；renderer cutover；Phase 7 与 §18 residual 政策 |
| Platform / shell / sandbox | [0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)、[0131](0131-pathname-default-durable-io.md)、[0152](0152-workspace-shell-and-codex-aligned-approval.md)、[0153](0153-codex-sandbox-dual-axis-and-agent-shell.md) | 平台能力分层 + 显式较弱 Windows profile；默认 pathname durable 写；双轴审批 + `workspaceShell` 默认开；禁止 YOLO / 虚假 Docker·VM 完备宣称 |
| Provider | [0051](0051-provider-finish-reason-and-length-tool-rejection.md)、[0052](0052-provider-error-and-recovery-taxonomy.md)、[0057](0057-provider-bounded-retry-and-shared-budget.md)、[0125](0125-provider-overflow-patterns-and-silent-heuristics.md) | finish reason、recovery taxonomy、有界重试；原共享 run budget 已由 [ADR-0171](0171-continuous-agent-runs-and-context-governance.md) 取代 |
| Doctor / 可观测性 | [0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[0034](0034-redacted-support-bundle.md)、[0066](0066-local-observability-and-crash-marker.md)、[0107](0107-support-bundle-common-redact-switch.md) | 只读诊断、同意后脱敏导出、本地可观测性；无默认远程 telemetry |
| 教学 Skill / Kernel | [0151](0151-teaching-kernel-and-skill-orchestration.md)、[0154](0154-spaced-review-scheduler-and-review-due-planner-action.md)、[0155](0155-fill-quiz-settlement-via-sidecar-v2.md)、[0156](0156-skill-orchestration-conversation-continuity.md)、[0163](0163-teaching-capability-selection-and-plan-preview.md)、[0164](0164-unified-teaching-chain-and-skill-admission.md)、[0168](0168-pi-compatible-explicit-skill-invocation.md) | 双平面编排、间隔复习投影、fill 结算、显式 Skill 调用 |
| Turn review / handoff | [0077](0077-teaching-turn-review-candidates.md)、[0080](0080-teaching-turn-review-finalize-wire.md)、[0085](0085-teaching-turn-review-human-approve-projection.md)–[0116](0116-teaching-turn-review-last-bundle-finalize-save.md) | 人批 only、无 auto-apply、consent-gated handoff |
| 配置 / secret-free | [0025](0025-teaching-config-resolver-secret-free-layers.md)、[0033](0033-config-optimistic-concurrency.md)、[0071](0071-workspace-config-denylist.md)、[0086](0086-managed-config-overlay-layer.md)、[0092](0092-managed-config-fs-loader.md) | 分层解析、无密钥快照、denylist、managed overlay fail-closed |
| 安全 / CI / 发布 | [0017](0017-win-mac-p0-release-proof-and-audit-policy.md)、[0045](0045-context-hygiene-ladder-and-quality-gates.md)、[0053](0053-agents-md-security-suite-and-testing-doctrine.md)、[0054](0054-actions-sha-pin-dependabot-osv-fail-open.md)、[0072](0072-node-engines-and-source-rev-build-identity.md)、[0074](0074-blocking-ci-fan-in-and-worktree-gates.md) | 发布证明、领域门禁优先、供应链 pin、blocking CI 窄而硬 |
| 模块尺寸 / 结构 | [0075](0075-module-size-policy-and-giant-peel.md)、[0078](0078-workspace-host-port.md) | 巨石按触达 peel，保留 sole-writer/ledger |
| 思维导图 | [0172](0172-mind-map-and-ai-assist.md)、[0173](0173-mind-map-schema-v2-and-revisioned-repository.md) | 原生导图 + AI 辅助生成；导图是用户内容非教学权威 |
| Web 远程控制 | [0169](0169-web-remote-control-lan-and-self-hosted-relay.md) | 默认关 / loopback；无默认云 relay；远程工具仍走 effect + approval |
| Adoption / 借鉴结项 | [0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md)、[0121](0121-improvements-adoption-closeout.md) | 已结项工作线不再作为开放 backlog |

## Proposed / Superseded / 历史

- **Proposed（未实施设计）**：[0157](0157-learning-outcome-strength-and-consolidation.md)、[0158](0158-model-assisted-grading-candidate.md)、[0159](0159-learning-objectives-and-mastery-projection.md)、[0160](0160-teaching-turn-behavior-contract.md)、[0161](0161-today-learning-queue-projection.md)、[0162](0162-local-learning-effectiveness-analytics.md)、[0123](0123-runtime-session-store.md)。
- **Superseded / 部分被取代**：以各 ADR 元数据「被取代」为准；例如 [ADR-0057](0057-provider-bounded-retry-and-shared-budget.md) 的共享 run budget 由 [ADR-0171](0171-continuous-agent-runs-and-context-governance.md) 取代，[ADR-0127](0127-user-configurable-mcp-design-gate.md) 部分被 [ADR-0132](0132-mcp-zcode-parity-and-trust-lifecycle.md) 取代，[ADR-0152](0152-workspace-shell-and-codex-aligned-approval.md) 部分被 [ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md) 取代。
- **C-4 P6/P8/P9 历史 evidence**：以 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) 与 [ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md) 为准；不再在 README 保存测试计数或本机运行日志。
- **四源改进借鉴 ADOPTION 结项**：原 `docs/improvements/{ADOPTION,pi,codex,grok,hermes}.md` 统一 backlog 已全部可实现切片落地（ADR-0051–0116、0118–0120）。长期边界、命名冻结、明确不采纳与信号触发 residual 见 [ADR-0121](0121-improvements-adoption-closeout.md)。`docs/improvements/` 目录已清空，不建议重建为第二套 backlog；未来新增借鉴跟踪以 ADR 形式记录。

## 如何新增或修改 ADR

1. **编号与路径**：新增一份编号递增（`ADR-NNNN`）的 ADR 文件，文件名 `NNNN-kebab-title.md`；第一行必须是 `# ADR-NNNN：标题`。现有 ADR 编号与路径**永久稳定**，不因被取代而删除或重命名。
2. **元数据**：标题下使用统一元数据——`决策状态` / `实施状态` / `日期` / `范围` / `取代` / `被取代` / `相关` / `证据`（状态值见上表；`取代`、`被取代` 为 `ADR-NNNN` 或 `无`）。
3. **正文**：按 `背景 → 决定 → 不变量 → 后果 → 验证 → 非目标` 组织；只记录决定、理由、边界与后果，不放实施流水账、PR 序列、测试通过数量或本机日志。跨 ADR 的全局红线用链接引用 `AGENTS.md` / `SECURITY.md` / `docs/tools/TOOL_CONTRACT.md`，不要逐字复制。
4. **Supersession**：当新 ADR 部分或全部取代旧 ADR 时，旧 ADR 不删除：元数据填 `被取代`，正文开头用 2～5 行说明哪些决定仍有效、哪些已失效；当前有效决定由后继 ADR 清楚表达。
5. **维护**：已实施且会长期影响架构的决定新增 ADR；不建议仅为记录小进度而新建 ADR（轻量决策用 PR / commit 描述记录即可）。已实施决定的范围、边界或验证入口变化时更新对应 ADR；新的开放/延期工作必须新增独立 ADR（含 design gate 前提），不得把 ADR 的受限切片扩大为完整 closure。
6. **索引**：新增/修改后运行 `node scripts/check-adr.mjs --index` 重新生成 `INDEX.md`，并运行 `node scripts/check-adr.mjs` 做结构检查（编号一致、元数据、链接、围栏、状态值）。

## 维护约定

- ADR 中的 Git 提交 hash 是验证线索；合并主线使用 rebase/squash 导致 hash 变化时应更新为可追溯提交。
- ADR 记录的是已获采纳的决定；尚未批准的建议不得记为已实施事实。当前无独立 local-data 待办页：开放实现须先有新 ADR 批准，延期项以各 ADR 的 non-claims / 延期段落为准（C-6 destructive 见 [ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md)）。
- 已结项 plan 应删除，不保留无用指针 stub；不要创建第二套具有架构权威的 todo/backlog 文档。
- 架构变更（settlement、effect、prompt-cache、隐私边界）必须新增或更新 ADR，并链入本 README 或 `INDEX.md`。
