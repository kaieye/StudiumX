# ADR-0127：用户可配置 MCP 接入（推翻「默认禁止任意 MCP」产品地板）— Design gate

- **状态：** 已采纳（设计 gate；生产实现已由 [ADR-0128](0128-user-configurable-mcp-implementation.md) 完成 A–F，并保持本 ADR 的默认 off、无 marketplace、effect lattice 与 settlement 边界）
- **日期：** 2026-07-22
- **范围：** 正式记录产品方决策——允许**终端用户**在本地以 **opt-in** 方式配置并连接**其自行指定**的 MCP 服务器（「任意」= 服务器地址/启动命令由用户选择，而非平台预置闭集）；定义信任模型、effect 映射、settlement 不变量、与既有 ADR 的废止/收窄关系、以及实现门槛。
- **相关：**
  - 产品地板：[`AGENTS.md`](../../AGENTS.md)（本 ADR 采纳后须同步地板措辞）
  - 信任边界：[`SECURITY.md`](../../SECURITY.md)
  - 工具合同：[`docs/tools/TOOL_CONTRACT.md`](../tools/TOOL_CONTRACT.md)
  - [ADR-0022](0022-teaching-capability-catalog-read-only-readiness.md)（capability fail-closed）
  - [ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)（effect lattice / ToolOutcome）
  - [ADR-0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md)（P2-6 原「默认不排期」；本 ADR **收窄/取代**其中「通用 MCP 永不实施」之默认禁令，**不**自动批准无门槛实现）
  - [ADR-0042](0042-extension-manifest-minimal.md)（manifest `mcpServers` 字段；原禁 auto-connect）
  - [ADR-0046](0046-teaching-footprint-ladder.md)（Footprint Ladder 层 4 由「远期默认延期」升为「用户 opt-in 可配置面」）
  - [ADR-0048](0048-tool-contract-and-write-policy.md) / [ADR-0063](0063-declarative-tool-policy.md)（policy / 禁 YOLO）
  - [ADR-0073](0073-teaching-feature-registry.md)（原禁止 `mcp_marketplace` feature id；本 ADR **不**开放 marketplace）
  - [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md) / [ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)（settlement sole-writer）
- **证据提交：** 本 ADR（决策记录）+ [ADR-0128](0128-user-configurable-mcp-implementation.md)（运行时 client、IPC、UI、registry 与 transport 实现合同）

## 1. 背景与动机

历史产品地板与多份 ADR（含 ADR-0039 P2-6、ADR-0042/0046、ADOPTION 复读 non-claims）将下列能力标为**默认禁止 / 不可分派**：

- MCP marketplace / 远程插件自动信任
- **默认**任意 MCP 加载 / auto-connect
- 将 MCP 当作无审批、无 effect 分类的旁路工具面

产品方（2026-07-22）明确要求：**允许用户自行接入 MCP**——即用户可配置其选择的 MCP server，而不是仅限平台预置的单一教学 Adapter。

本 ADR 负责决策冻结与边界立法，解决「政策层绝对禁止」与「产品要开放用户配置面」之间的冲突；生产实现由 ADR-0128 约束。它**不**把「用户说接了也不适配」当作安全边界，也**不**授权「无审批、无 lattice 的 YOLO MCP」。

### 1.1 术语（冻结）

| 术语 | 含义 |
| --- | --- |
| **用户配置 MCP** | 用户在本地设置/配置中**显式添加**的 MCP server（stdio 命令行、SSE/HTTP URL 等，以实现 ADR 锁定传输子集） |
| **任意（本 ADR）** | 服务器**身份由用户指定**，平台**不**维护「仅允许名单内教学 Adapter」作为唯一合法源 |
| **MCP marketplace** | 远程浏览/一键安装/自动信任第三方 server 目录的产品面——**本 ADR 仍不开放** |
| **MCP tool 调用** | 模型或宿主经 MCP 协议调用远端/子进程 tool；必须进入既有 tool dispatch / effect / approval 路径 |
| **教学 Adapter（旧 P2-6）** | 闭集、可验收的教学场景接入；仍可作为**一等推荐形态**，但**不再**是「唯一允许的 MCP 形态」 |

## 2. 决定（产品决策冻结）

### 2.1 废止 / 收窄

1. **废止**产品地板中「**禁止用户配置任意 MCP server**」的绝对禁令。
2. **收窄** [ADR-0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md) §4 P2-6：
   - 原「无真实 Adapter 与威胁模型则**永不实施**」对**通用用户配置面**不再适用；
   - 改为：通用用户配置面**可以**立项，但必须满足本 ADR §3–§5 的硬门槛与独立实现 ADR；
   - P2-6 中「Adapter 不得成为 settlement / grounding / IPC 旁路」**继续有效**，并扩展到**所有** MCP tool 结果。
3. **收窄** [ADR-0046](0046-teaching-footprint-ladder.md) 层 4：由「默认延期、仅远期」改为「**用户 opt-in 可配置**；默认关闭；成本/隐私/失败边界仍强制审查」。
4. **不废止**下列禁令（继续有效）：
   - MCP **marketplace** / 远程目录自动信任 / 默认 phone-home 式插件源
   - 默认 ShellTool / 任意 OS shell 产品路径
   - YOLO / DangerFullAccess / always-approve 标签与语义
   - 将 MCP 结果升格为 LearningSession / Evidence / Outcome **settlement authority**
   - 默认远程 telemetry / OTEL / Statsig / Mixpanel

### 2.2 新的产品地板（目标态措辞）

| 边界 | 新含义 |
| --- | --- |
| 用户配置 MCP | **允许**用户 opt-in 添加/启用/禁用其指定的 MCP server；**默认不连接**任何 MCP |
| Marketplace | **仍禁止**作为默认产品面 |
| Effect lattice | 每个 MCP-exposed tool **必须**映射到 `read` / `workspace_write` / `external_write` / `privileged`；未知映射 **fail-closed** 或强制 `privileged` + 交互审批（实现 ADR 二选一并冻结，**禁止**静默当 `read`） |
| Settlement | MCP 输出**不是** teaching 真相；不得绕过 `TeachingTurnCoordinator` / ledger / `expectedRevision` |
| 扩展面 | TeachingCommand 闭集 + skill-pack verifier **仍在**；MCP 是**并行、显式 opt-in** 的工具来源，不是替换 TeachingCommand 权威 |

### 2.3 默认与同意

1. **出厂默认：MCP 总开关 = off**；无用户配置条目时运行时**零** MCP 连接。
2. 添加并启用 server = **显式同意**外连或拉起本地子进程；UI 必须展示传输类型与命令/URL 摘要（脱敏）。总开关和 server 开关的单击动作本身即为明确 opt-in，**立即提交，不再增加二次确认，也不显示切换成功提示卡**；保存/连接失败仍须显示错误，显式“测试连接”可显示进度与结果。
3. ExtensionManifest 中的 `mcpServers` **不得** auto-connect；最多作为「用户一键导入草稿」，导入后仍由用户通过 server 开关明确启用（收窄 ADR-0042：未启用则禁止连接，允许草稿导入）。
4. 工作区不可信配置（workspace 文件）**不得**静默注册 MCP server；若允许工作区建议列表，必须经用户确认并记入 user-scoped 配置（对齐 denylist / untrusted layer 精神，ADR-0071）。

## 3. 威胁模型（design gate 必附；实现不得删减）

### 3.1 资产

- 工作区教学文件、LearningSession / Evidence / Outcome
- Provider API keys（safeStorage）
- 学习者作答与 conversation
- 本机网络身份与任意可达内网资源

### 3.2 对手与滥用

| 场景 | 风险 | 缓释（硬要求） |
| --- | --- | --- |
| 用户粘贴恶意 server 命令/URL | 数据外传、本地命令执行 | 添加页展示 transport 与命令/URL；保存和启用必须来自用户动作；stdio 使用 argv、无 shell 解释层；无「静默更新」命令 |
| 恶意 tool 描述注入模型 | 诱导调用敏感 tool | tool schema 进模型前经预算与消毒；高危 effect 强制审批 |
| MCP 伪造成绩/掌握结论 | 污染 teaching 真相 | **禁止** MCP 写 ledger/outcome；结果仅作 tool 证据投影 |
| 供应链（依赖方 MCP 实现） | 非我方代码 | 文档声明：用户自担所连 server 信任；产品不做「已审计」背书 |
| 与 provider 请求耦合 | 密钥进 MCP 环境 | **禁止**把 provider API key 注入 MCP server 环境变量默认集 |
| 并行写 / 外部写 | 工作区破坏、外泄 | `workspace_write` / `external_write` 保持 concurrency=1 与既有 path containment 精神 |

### 3.3 非目标（威胁模型外）

- 不声称对恶意 MCP server 提供 Docker 级 OS isolation（与 SECURITY non-claim 一致）
- 不声称用户「不会接乱七八糟的 MCP」构成控制措施——**控制措施必须是技术门禁 + 明确同意**

## 4. 架构约束（实现必须遵守）

### 4.1 调用路径

```text
用户 opt-in 配置
  → MCP session 管理器（main 进程）
  → tools/list 发现（预算上限）
  → 每 tool 生成 registry 条目 + effectClass 映射
  → 既有 Typed Tool Dispatcher / permission gate / budget
  → ToolOutcome（audit-safe）
  → （可选）learner-safe 投影
```

禁止：

- Renderer 直连 MCP 并持有可写教学权威
- Agent loop 绕过 dispatcher 直接 callTool
- Fork 路径默认 toolsReplayed: true 以「重放」MCP 副作用

### 4.2 Effect 映射策略（冻结原则；细则实现 ADR 锁定）

| 原则 | 要求 |
| --- | --- |
| 默认保守 | 新发现且无注解的 tool → **`privileged`** 或 **拒绝注册**（实现 ADR 选一种并测试锁定） |
| 可声明降级 | server 或本地 policy 可声明 hint，但 **hint 不可越过** path containment / secret / settlement |
| 网络类 | 任何可达网络的 tool 不得标为纯 `read` 除非实现 ADR 证明无副作用且仍按 untrusted external content 处理 |
| 写工作区 | 必须走 workspace path containment；禁止「MCP 自己说路径安全」 |
| 与 shell 的关系 | MCP **不是** ShellTool 产品声明；stdio transport 拉起用户指定命令 ≠ 向模型暴露通用 shell 词表 |

### 4.3 预算与 schema 面积

- 单 turn 可注入的 MCP tool schema 有硬上限（count + bytes）；超限 fail-closed 或分页，**禁止**静默截断导致模型以为工具仍可用却调用失败无说明
- Tool result 遵守既有 result budget / spill（ADR-0041 / 0056 精神）
- 临时 chat 与 teaching chat **共享**用户 MCP 注入（ADR-0128 §5.4）；差距仅限教学产物写工具，**废止**「临时必须严格小于 teaching 且不含 MCP」

### 4.4 Settlement 与证据

- MCP tool 结果最多成为 **Evidence 候选的输入材料**或 conversation tool 轨迹，**不得**直接 commit Learning record / outcome
- OutcomeEvaluator 仍只信任既有 assessment 绑定规则（ADR-0016）
- Coordinator sole-writer 与 expectedRevision **不变**

### 4.5 配置持久化

- 用户 MCP 配置为 **secret-free 为主** 的 JSON（命令、URL、headers 中的 token 若存在须走 secret storage，不得进 workspace 明文）
- 变更应有乐观并发 / 备份精神（对齐 ADR-0003 / 0033，细则实现 ADR）
- Doctor / support-bundle 导出须脱敏命令行中的 token 与绝对家目录（ADR-0034 / 0066）

### 4.6 Feature 与命名

- **禁止** feature id：mcp_marketplace、yolo、danger_full_access、code_mode 作为开放默认
- 允许 feature id 示例（实现时注册）：user_mcp_servers（stage 可由 experimental → stable）
- UI **禁止** YOLO / always-approve 文案；可有 per-tool / per-server 会话授权，语义走既有 grants + policy lattice

## 5. 实现门槛（全部满足前禁止合并生产路径）

下列任一项未完成，**不得**合并启用产品路径的 MCP client：

1. **实现 ADR**：[ADR-0128](0128-user-configurable-mcp-implementation.md)（传输子集、配置 schema、IPC、effect 映射、失败码、分 phase 测试计划）
2. **威胁模型**在实现 ADR 中可测试的检查表（至少：根/server 未启用不连接、密钥不注入、settlement 不写、unknown tool 不静默 read）
3. **pnpm run check:security** 与 tool-contract 相关门禁扩展（未知 MCP tool 不得绕过 inventory 精神；动态工具须有可审计注册表快照）
4. **定向 unit**：opt-in 默认 off；workspace 文件不能静默启用；审批 short-circuit；结果不进 outcome writer
5. **文档**：SECURITY.md / AGENTS.md / TOOL_CONTRACT.md 同步（动态工具章节）
6. **模块尺寸**：遵守 ADR-0075；禁止塞进 teaching-turn-coordinator 巨石而不 peel

## 6. 明确不包含 / non-claims

本 ADR **不**：

1. 实现任何 MCP client、SDK 接线、产品 UI、preload/IPC 或 registry 动态注册代码
2. 开放 **MCP marketplace**、远程推荐目录、自动更新 server 二进制、默认 phone-home 插件源
3. 授权 **默认 ShellTool**、OS sandbox 产品声明、或把 stdio MCP 宣传为「安全沙箱」
4. 授权 YOLO / always-approve / DangerFullAccess 标签或语义
5. 授权 MCP 结果写入 LearningSession ledger、Outcome、或绕过 expectedRevision
6. 授权 fork 默认 toolsReplayed: true、或自动 memory/dream/静默改 learner-profile
7. 授权默认远程 telemetry / 将 MCP 调用用量强制升格 teaching canonical
8. 批准 Windows strict file-ID CAS、C-6 destructive Memory migration、或 product autoDrain: true
9. 把历史 ADR 正文中每一处「不引入 MCP」复读句自动改写完毕——**冲突时以本 ADR + 已更新的 AGENTS.md / SECURITY.md 为准**；实现 PR 可顺带修正过时复读，但不要求一次全文打扫
10. 声称「用户不会乱接」或「接了也不适配」为已接受的安全控制

## 7. 对既有文档的即时同步（本 gate 采纳时）

| 文档 | 同步动作 |
| --- | --- |
| AGENTS.md §1 产品地板 | 「无 MCP marketplace」行改为：允许用户 opt-in 配置 MCP（本 ADR）；**仍无** marketplace；实现前不可当已上线 |
| AGENTS.md §3 红线 3 | 禁止 marketplace / jiti 全权限 / code-mode；将「默认任意 MCP」改为「禁止未 opt-in、未过 lattice 的 MCP」 |
| SECURITY.md | 增补 MCP egress / 用户自担 server 信任；声明默认 off；settlement 不变量 |
| docs/adr/README.md | 索引本 ADR；更新「按问题查阅」中 MCP 相关行 |
| ADR-0039 / 0046 正文 | **不强制**本 PR 全文改写；以本 ADR 为**更新近**的 P2-6 / Ladder 层 4 权威 |

## 8. 后果

1. 代理与贡献者**不得再**以「产品地板绝对禁止任意 MCP」拒绝**设计与实现 ADR 的起草**；但**仍必须**拒绝无本 ADR 门槛的「先接上再说」PR。
2. 「任意 MCP」在产品语言中应表述为 **用户可配置 MCP（opt-in）**，避免与 marketplace 混淆。
3. 生产实现现已由 ADR-0128 交付；运行时仍以根 `enabled:false` 为出厂默认，且不会因工作区文件或导入草稿静默连接。
4. 若产品方撤回本决策，须新 ADR 废止本文件并恢复地板措辞。

## 9. 落地状态

| 顺序 | 切片 | 说明 |
| --- | --- | --- |
| 1 | **[ADR-0128](0128-user-configurable-mcp-implementation.md)** 核心与传输 | 已完成：schema、官方 SDK、stdio / Streamable HTTP / SSE、effect 映射 |
| 2 | 配置持久化 + secret 分离 | 已完成：userData 权威；env/header secret 仅在 main + safeStorage |
| 3 | Dispatcher / registry 动态工具 | 已完成：预算、runtime effect map、既有审批链 |
| 4 | Settings UI | 已完成：列表与详细添加/编辑页、Form/JSON、user/workspace scope；开关单击提交，无二次确认或切换成功卡 |
| 5 | Doctor / support-bundle 脱敏 | 已完成：连接状态 facts 与脱敏 |

---

**一句话：** 产品允许用户 **opt-in 自行配置 MCP server**（「任意」= 用户指定源）；设置页采用通用 MCP 客户端交互，开关单击即提交且不加成功提示卡；**仍禁止** marketplace、YOLO、settlement 旁路与默认自动连接，生产实现以 ADR-0128 为准。
