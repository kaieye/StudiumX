# ADR-0127：用户可配置 MCP 接入（推翻「默认禁止任意 MCP」产品地板）— Design gate

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-22
- **范围：** 正式记录产品方决策——允许**终端用户**在本地以 **opt-in** 方式配置并连接**其自行指定**的 MCP 服务器（「任意」= 服务器地址/启动命令由用户选择，而非平台预置闭集）；定义信任模型、effect 映射、settlement 不变量、与既有 ADR 的废止/收窄关系、以及实现门槛。
- **取代：** 部分 [ADR-0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md)（P2-6 原「通用 MCP 永不实施」默认禁令）、[ADR-0046](0046-teaching-footprint-ladder.md)（层 4 由「远期默认延期」升为「用户 opt-in 可配置面」）。
- **被取代：** 部分被 [ADR-0132](0132-mcp-zcode-parity-and-trust-lifecycle.md) 取代；本 ADR 的 v1 用户配置、effect lattice、secret isolation 与 settlement 边界仍有效；其中默认 off、无 auto-connect、无 marketplace、workspace/plugin MCP 仅草稿等产品禁令已不再约束后续阶段。
- **相关：** [`AGENTS.md`](../../AGENTS.md)、[`SECURITY.md`](../../SECURITY.md)、[`docs/tools/TOOL_CONTRACT.md`](../tools/TOOL_CONTRACT.md)、[ADR-0022](0022-teaching-capability-catalog-read-only-readiness.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md)、[ADR-0042](0042-extension-manifest-minimal.md)、[ADR-0046](0046-teaching-footprint-ladder.md)、[ADR-0048](0048-tool-contract-and-write-policy.md)、[ADR-0063](0063-declarative-tool-policy.md)、[ADR-0073](0073-teaching-feature-registry.md)、[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0128](0128-user-configurable-mcp-implementation.md)、[ADR-0132](0132-mcp-zcode-parity-and-trust-lifecycle.md)、[ADR-0137](0137-mcp-multi-source-precedence-and-auto-connect.md)、[ADR-0138](0138-mcp-filesystem-workspace-root-injection.md)、[ADR-0140](0140-mcp-marketplace-local-catalog.md)、[ADR-0141](0141-mcp-product-experience-parity-policy.md)
- **证据：** [ADR-0128](0128-user-configurable-mcp-implementation.md)（运行时 client、IPC、UI、registry 与 transport 实现合同）；落地状态见 `docs/adr/evidence/ADR-0127.md`。

> **取代说明（2026-07-22；2026-08-18 更新）：** 本文中下列“禁止 / 不得 / 不开放”表述**已被后续 ADR 取代，不得再作为现行禁令引用**：MCP marketplace / 远程目录（[ADR-0132](0132-mcp-zcode-parity-and-trust-lifecycle.md)/[0140](0140-mcp-marketplace-local-catalog.md)/[0141](0141-mcp-product-experience-parity-policy.md)）、auto-connect / 默认自动连接 / 冷启动连接（[ADR-0137](0137-mcp-multi-source-precedence-and-auto-connect.md)/0141）、ExtensionManifest `mcpServers` 只可导入草稿 / install 不得 connect（0141 §2.2）、workspace 文件作为配置来源 / workspace 不可作 authority（0137/0141 §2.3）、filesystem MCP workspace-root access（[ADR-0138](0138-mcp-filesystem-workspace-root-injection.md)/0141）。正文 §2.2 Marketplace 行、§2.3 第 3–4 点与 §1.1 术语表按上述新 ADR 口径解释。本文**继续有效**的合同：effect lattice、approval、secret isolation、settlement sole-writer、`expectedRevision`、`toolsReplayed:false` 与无默认 remote telemetry。

## 背景

历史产品地板与多份 ADR（含 ADR-0039 P2-6、ADR-0042/0046、ADOPTION 复读 non-claims）将下列能力标为**默认禁止 / 不可分派**：MCP marketplace / 远程插件自动信任；**默认**任意 MCP 加载 / auto-connect；将 MCP 当作无审批、无 effect 分类的旁路工具面。

产品方（2026-07-22）明确要求：**允许用户自行接入 MCP**——即用户可配置其选择的 MCP server，而不是仅限平台预置的单一教学 Adapter。本 ADR 负责决策冻结与边界立法，解决「政策层绝对禁止」与「产品要开放用户配置面」之间的冲突；生产实现由 ADR-0128 约束。它**不**把「用户说接了也不适配」当作安全边界，也**不**授权「无审批、无 lattice 的 YOLO MCP」。

## 决定

### 1. 废止 / 收窄

1. **废止**产品地板中「**禁止用户配置任意 MCP server**」的绝对禁令。
2. **收窄** [ADR-0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md) §4 P2-6：原「无真实 Adapter 与威胁模型则**永不实施**」对**通用用户配置面**不再适用；改为通用用户配置面**可以**立项，但必须满足硬门槛与独立实现 ADR；P2-6 中「Adapter 不得成为 settlement / grounding / IPC 旁路」**继续有效**，并扩展到**所有** MCP tool 结果。
3. **收窄** [ADR-0046](0046-teaching-footprint-ladder.md) 层 4：由「默认延期、仅远期」改为「**用户 opt-in 可配置**；默认关闭；成本/隐私/失败边界仍强制审查」。
4. **不废止**下列禁令（继续有效）：MCP **marketplace** / 远程目录自动信任 / 默认 phone-home 式插件源；默认 ShellTool / 任意 OS shell 产品路径；YOLO / DangerFullAccess / always-approve 标签与语义；将 MCP 结果升格为 LearningSession / Evidence / Outcome **settlement authority**；默认远程 telemetry / OTEL / Statsig / Mixpanel。

### 2. 新的产品地板（目标态措辞；仅 v1 基线语义仍有效，marketplace/auto-connect 禁令已按文首取代说明失效）

| 边界 | 新含义（v1） |
| --- | --- |
| 用户配置 MCP | **允许**用户 opt-in 添加/启用/禁用其指定的 MCP server；**默认不连接**任何 MCP |
| Marketplace | v1 **仍禁止**作为默认产品面；后续产品政策见 ADR-0132/0140/0141 |
| Effect lattice | 每个 MCP-exposed tool **必须**映射到 `read` / `workspace_write` / `external_write` / `privileged`；未知映射 **fail-closed** 或强制 `privileged` + 交互审批，**禁止**静默当 `read` |
| Settlement | MCP 输出**不是** teaching 真相；不得绕过 `TeachingTurnCoordinator` / ledger / `expectedRevision` |
| 扩展面 | TeachingCommand 闭集 + skill-pack verifier **仍在**；MCP 是**并行、显式 opt-in** 的工具来源，不是替换 TeachingCommand 权威 |

### 3. 默认与同意

1. **出厂默认：MCP 总开关 = off**；无用户配置条目时运行时**零** MCP 连接。
2. 添加并启用 server = **显式同意**外连或拉起本地子进程；UI 必须展示传输类型与命令/URL 摘要（脱敏）。总开关和 server 开关的单击动作本身即为明确 opt-in，**立即提交，不再增加二次确认，也不显示切换成功提示卡**；保存/连接失败仍须显示错误，显式“测试连接”可显示进度与结果。
3. ~~ExtensionManifest 中的 `mcpServers` **不得** auto-connect；最多作为「用户一键导入草稿」，导入后仍由用户通过 server 开关明确启用~~ **（v1 范围；已被 [ADR-0141](0141-mcp-product-experience-parity-policy.md) §2.2 取代：install 流程可选「安装并连接/启用」；未启用则禁止连接仍成立。见文首取代说明）**。
4. ~~工作区不可信配置（workspace 文件）**不得**静默注册 MCP server；若允许工作区建议列表，必须经用户确认并记入 user-scoped 配置~~ **（v1 范围；已被 [ADR-0137](0137-mcp-multi-source-precedence-and-auto-connect.md) 取代：workspace 只读 `.agents/mcp.json` / `mcp.json` / `zcode.json` 可作为真实配置来源并按 precedence 生效，UI 可展示并一键启用。见文首取代说明）**（对齐 denylist / untrusted layer 精神，ADR-0071）。

## 不变量（仍有效）

1. Renderer 不直连 MCP 并持有可写教学权威；Agent loop 不绕过 dispatcher 直接 callTool；Fork 路径默认 `toolsReplayed: false`。
2. Effect 映射默认保守：新发现且无注解的 tool → **`privileged`** 或**拒绝注册**；网络类 tool 不得标为纯 `read` 除非实现 ADR 证明无副作用且仍按 untrusted external content 处理；写工作区必须走 workspace path containment。
3. 预算与 schema 面积：单 turn 可注入的 MCP tool schema 有硬上限（count + bytes），超限 fail-closed 或分页，**禁止**静默截断导致模型以为工具可用却调用失败无说明；tool result 遵守既有 result budget / spill（ADR-0041/0056）。
4. MCP tool 结果最多成为 Evidence 候选的输入材料或 conversation tool 轨迹，**不得**直接 commit Learning record / outcome；OutcomeEvaluator 仍只信任既有 assessment 绑定规则（ADR-0016）；Coordinator sole-writer 与 `expectedRevision` **不变**。
5. 配置持久化 secret-free 为主（token 走 secret storage，不得进 workspace 明文）；变更有乐观并发 / 备份精神（ADR-0003/0033）；Doctor / support-bundle 导出脱敏命令行 token 与绝对家目录。
6. **禁止** feature id：`mcp_marketplace`、`yolo`、`danger_full_access`、`code_mode` 作为开放默认；UI **禁止** YOLO / always-approve 文案。

## 后果

1. 代理与贡献者**不得再**以「产品地板绝对禁止任意 MCP」拒绝设计与实现 ADR 的起草；但**仍必须**拒绝无门槛的「先接上再说」PR。
2. 「任意 MCP」在产品语言中应表述为 **用户可配置 MCP（opt-in）**，避免与 marketplace 混淆。
3. 生产实现已由 ADR-0128 交付；运行时仍以根 `enabled:false` 为出厂默认，且不会因工作区文件或导入草稿静默连接。
4. 若产品方撤回本决策，须新 ADR 废止本文件并恢复地板措辞。

## 验证

- 实现合同与验证入口：`docs/adr/evidence/ADR-0127.md`、[ADR-0128](0128-user-configurable-mcp-implementation.md)
- 落地状态（A–F）：`docs/adr/evidence/ADR-0127.md`

## 非目标

本 ADR **不**：实现任何 MCP client、SDK 接线、产品 UI、preload/IPC 或 registry 动态注册代码（由 ADR-0128 承担）；开放 **MCP marketplace**、远程推荐目录、自动更新 server 二进制、默认 phone-home 插件源（后续产品政策见 ADR-0132/0141）；授权默认 ShellTool、OS sandbox 产品声明、或把 stdio MCP 宣传为「安全沙箱」；授权 YOLO / always-approve / DangerFullAccess；授权 MCP 结果写入 LearningSession ledger、Outcome 或绕过 `expectedRevision`；授权 fork 默认 `toolsReplayed: true`、自动 memory/dream/静默改 learner-profile；授权默认远程 telemetry 或把 MCP 调用用量强制升格 teaching canonical；批准 Windows strict file-ID CAS、C-6 destructive Memory migration 或 product `autoDrain: true`；声称「用户不会乱接」或「接了也不适配」为已接受的安全控制。
