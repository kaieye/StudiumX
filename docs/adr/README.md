# 架构 ADR 索引

本目录是 StudiumX 的**当前有效架构决策集**（Architecture Decision Record）。每份 ADR 只记录仍有效、跨模块且需要长期维护的决定；实施历史、迁移过程和删除映射由 Git、PR 与 issue 保存，不保留 superseded stub。

当前 ADR 已按 canonical 集重新连续编号。编号只表达本目录的导航顺序，不再承担历史身份；后续新增从当前最大编号递增，删除或合并时可在一次治理整理中重新编号并同步全部引用。

## 当前 canonical ADR

| 编号 | 领域 | 决策 |
| --- | --- | --- |
| [ADR-0001](0001-teaching-authority-and-session-ledger.md) | Teaching authority | 工作区文件与 LearningSession ledger 是 AI 教学决策事实权威，并与可同步用户状态分离。 |
| [ADR-0002](0002-evidence-gated-outcome-settlement.md) | Settlement | Outcome 由 Evidence 门控，并由 coordinator host 作为 sole-writer 结算。 |
| [ADR-0003](0003-teaching-turn-context-and-capabilities.md) | Teaching turn | 规划、上下文装配与能力发现保持只读、可解释且无教学写入权。 |
| [ADR-0004](0004-agent-run-and-conversation-serialization.md) | Agent runtime | AgentRun 与 LearningSession 分离，同一 conversation 的 turn 串行化。 |
| [ADR-0005](0005-tool-effects-approval-and-write-policy.md) | Tool policy | 工具统一经过 effect、approval、trust、path fence 与写入策略。 |
| [ADR-0006](0006-secret-free-configuration.md) | Configuration | 公共配置 secret-free，敏感值仅在主进程临近使用点解析。 |
| [ADR-0007](0007-local-observability-and-diagnostics.md) | Observability | usage、Doctor 与支持包保持本地、只读/脱敏且不成为教学权威。 |
| [ADR-0008](0008-teaching-prompt-cache.md) | Prompt cache | 稳定 system prefix 与 turn-scoped dynamic context 分离。 |
| [ADR-0009](0009-consent-gated-memory.md) | Memory | memory 的写入、删除与注入均由人明确同意。 |
| [ADR-0010](0010-agent-recovery-and-resource-boundaries.md) | Recovery | 重试、续接与资源限制保持真实状态且不自动重放 effect。 |
| [ADR-0011](0011-study-planning-authority.md) | Study planning | 学习规划持久化独立于 Evidence 与 Outcome 权威。 |
| [ADR-0012](0012-file-authority-projections-and-durable-publish.md) | Persistence | 文件权威、可重建 projection 与 atomic durable publish 分层。 |
| [ADR-0013](0013-mcp-runtime-trust-and-secrets.md) | MCP | MCP 动态工具、OAuth 与 secret 进入统一 trust/effect 边界。 |
| [ADR-0014](0014-teaching-kernel-and-skill-authority.md) | Teaching kernel | Kernel 保持核心教学权威，Skill 只能提供受限扩展。 |
| [ADR-0015](0015-shell-sandbox-dual-axis.md) | Shell security | workspace shell 的 approvalMode 与 sandboxMode 是独立双轴。 |
| [ADR-0016](0016-mind-map-repository-and-ai-boundary.md) | Mind map | 导图由 revisioned repository 单写，AI 输出仅是用户草稿。 |
| [ADR-0017](0017-mind-map-portable-media-interchange.md) | Mind map / persistence | 导图媒体在显式交换时以内嵌 `.sxmind` 或 Markdown/OPML sidecar 迁移，并经严格校验与回滚。 |

## Proposed / 设计门禁

当前无 proposed ADR。proposed ADR 必须提供 `Owner`、`任务`、`复核期限`（`YYYY-MM-DD`）与`处置条件`；复核期不得超过 30 天，届时接受、删除或移回外部 issue。

## 治理

以下内容不新建 ADR：小型实现选择、UI 文案、IPC 接线、模块 peel、阶段进度、测试清单、CI/PR/发布流程和未排期 roadmap。它们分别由代码与测试、产品文档、[CONTRIBUTING](../../CONTRIBUTING.md)、workflow 或 issue 维护。

全局产品红线集中在 [AGENTS](../../AGENTS.md)、[SECURITY](../../SECURITY.md) 与 [TOOL_CONTRACT](../tools/TOOL_CONTRACT.md)；ADR 只保留与本领域直接相关的架构边界，不复制整份红线清单。

## 如何新增或修改 ADR

1. **编号与路径：** 使用下一个连续编号和 `NNNN-kebab-title.md`；第一行必须是 `# ADR-NNNN：标题`。完全被取代的 ADR 直接删除，不保留 stub。
2. **元数据：** 必须包含 `状态`、`日期`、`领域`；`取代`可选且最多一个直接前序 ADR。proposed 额外包含 `Owner`、`任务`、`复核期限`、`处置条件`。
3. **正文：** 按 `背景 → 决定 → 边界与后果 → 实施锚点` 组织；实施锚点最多 3 个链接，单文件不超过 60 行。
4. **校验：** 运行 `node scripts/check-adr.mjs --strict`，并执行受影响领域的文档契约与安全门禁。
