# MCP 与 Zcode 对齐目标及实施缺口

- **状态：** 对齐目标 / 设计输入；本文不代表下列目标已经交付，也不单独授权生产实现。
- **日期：** 2026-07-22
- **参照实现：** `ref_project/Zcode`，已解包的 Zcode Desktop **3.3.3**（构建时间 **2026-07-08**）。
- **当前基线：** StudiumX 的用户可配置 MCP 已按 ADR-0127、ADR-0128 落地 v1 骨架，并按 ADR-0132 路线图交付 **Phase A–D（产品字母）/ 历史草案 A–D**：runtime reliability（list 分页 / disconnect diagnostics）、result safety + artifact/trace、OAuth PKCE token lifecycle，以及 import/export（ADR-0136 合同，不声称 auto-connect）。默认关闭，使用 `userData` canonical config、main-process session manager、ToolRegistry/effect/approval 接线、Settings、Doctor 和 support-bundle 脱敏。
- **目的：** 将 Zcode 中已观察到、且对成熟 MCP 客户端体验/兼容性/运维有价值的能力写成 StudiumX 的后续**对齐目标**。其中包含当前产品地板或 ADR 明确排除的能力；这些能力被记录为必要的目标，但实施前必须先通过新的 ADR 明确修改对应产品政策、威胁模型、审批和隐私合同。

> 本文是差距清单和路线图输入，不应被解释为放松现有 settlement sole-writer、effect lattice、expectedRevision、`toolsReplayed:false`、本地优先或 secret-free IPC 的授权。

---

## 1. 现状结论

StudiumX 已经具备完整的 MCP v1 接入骨架，并非“尚未实现 MCP”。现有实现包括：

- 官方 MCP TypeScript SDK `1.29.0`；stdio、Streamable HTTP、SSE transport；
- `{userData}/mcp/config.v1.json` 持久化、CAS、备份恢复、`safeStorage` secret ref；
- user / 显式绑定 workspace scope、根开关和单 server 开关；
- `mcp__{server}__{tool}` 动态命名、静态工具冲突拒绝、registry 注入；
- 默认 `privileged` 的 effect map、既有审批和 ToolOutcome 路径；
- 工具数量、schema、描述预算，超时和 abort signal；
- `teach:mcp-*` secret-free IPC，Form/JSON Settings UI，测试连接、runtime 状态；
- Doctor `mcp_status` 与 support-bundle 的 command/secret 脱敏；
- config、effect、secret、session、tool naming、UI 的定向 unit coverage。

核心实现锚点：

```text
src/main/mcp/session-manager.ts
src/main/mcp/transports/sdk-client.ts
src/main/mcp/tool-bridge.ts
src/main/mcp/config-store.ts
src/main/mcp/host.ts
src/main/mcp/ipc-gateway.ts
src/shared/mcp/*
src/renderer/src/views/settings/sections/UserMcp*.tsx
```

Zcode 对照锚点：

```text
ref_project/Zcode/Contents/Resources/glm/zcode.cjs
  Wke / qmn / Gmn / Wmn / Vmn / listMcpServers
ref_project/Zcode/Contents/Resources/app/out/host/index.js
  listMcpServerStatuses / appendWorkspaceToFilesystemMcpServers
ref_project/Zcode/Contents/Resources/app/out/host/chunk-AFMTI2HI.js
  mcp server/status/OAuth schemas and McpSync channel
ref_project/Zcode/Contents/Resources/app/out/main/chunk-ZU5ISUQC.js
  MCP config load/save/migration IPC
ref_project/Zcode/Contents/Resources/glm/packages/zcode-guide-plugin/skills/diagnosing-mcp/SKILL.md
```

---

## 2. 目标能力矩阵

| 能力 | StudiumX 当前 | Zcode 参照 | 对齐目标 |
| --- | --- | --- | --- |
| stdio / HTTP / SSE | 已实现 | 已实现 | 保持并提高互操作性 |
| 用户 Settings 配置 | 已实现 | 已实现 | 扩展 import/export、来源和诊断 |
| 默认关闭 / 手动试连 | 已实现 + 可选 auto-connect（ADR-0137/0141） | 默认 auto-connect | 产品化冷启动/workspace 自动连接与可观测恢复 |
| user / workspace scope | 多来源 foundation（user/workspace/env/plugin） | user/workspace/plugin/env/CLI/desktop-managed | 完整来源与 precedence 模型（CLI：`STUDIUMX_MCP_CLI_JSON` / session `cliServers` 已接线；desktop-managed 可选） |
| secret 隔离 | 已实现 + OAuth token lifecycle | 有 credential/OAuth | 保持；UI/可撤销/审计完善 |
| 动态 tool registry | 已实现 + 分页/stale/refresh | 已实现 | 保持 |
| effect / approval | 已实现，默认 privileged；可选 `honorRemoteReadOnlyHint` | 有 MCP permission metadata | lattice 保留；opt-in readOnlyHint→read（ADR-0141） |
| 预算 / cancellation | 结构化结果/artifact/trace 已实现 | 有 result/model budget、image handling、trace | 保持；压力/e2e 可选 |
| runtime status | 扩展生命周期 + 有界 diagnostics | connecting/connected/disabled/disconnected/failed/OAuth | 完整可执行诊断与 UI 表面 |
| workspace / plugin config | foundation 已实施（非唯一写权威） | 自动读取并连接 | managed policy / 撤销 UX 产品化 |
| config migration/sync | import/export + McpSync **wire** | load/save/migrate/McpSync | McpSync **网络客户端**与冲突产品化 |
| plugin / marketplace MCP | 本地 lifecycle foundation | 有 plugin/marketplace | 远程 catalog / install→connect / UI（ADR-0141 合法方向） |
| filesystem server workspace injection | 已实施受控注入开关 | 自动追加 workspace path | 保持独立 grant；审计/恢复 UX |

---

## 3. 必须先解决的政策差异

> **2026-07-23：** 下表历史冲突已由 [ADR-0132](../adr/0132-mcp-zcode-parity-and-trust-lifecycle.md) 与 **[ADR-0141](../adr/0141-mcp-product-experience-parity-policy.md)** 解决。体验层不再以“永久禁止 auto-connect/marketplace”为权威；硬安全见 ADR-0141 §2.6。

下列对齐目标与当前 `AGENTS.md`、ADR-0127、ADR-0128 的边界存在直接冲突。既然它们被列为必要目标，后续实施必须先新增一份**替代/修订 ADR**，并同步更新产品地板、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`、feature registry 与测试门禁。

| 当前限制 | 新对齐目标 | 新 ADR 必须冻结的内容 |
| --- | --- | --- |
| 默认 off、无 auto-connect | 对所有受配置来源的 server 自动连接 | 连接触发时机、首次同意、后台重试、网络和子进程成本、可撤销开关 |
| workspace 文件不可成为 MCP 启用权威 | `.zcode` / `zcode.json` / `.agents/mcp.json` 等 workspace config 可定义 MCP | trust model、目录向下 merge、同名覆盖、工作区切换与撤销 |
| 无 MCP marketplace / 无自动信任第三方 server | plugin marketplace、server discover/install/update/uninstall | 包签名、作者身份、版本锁定、审核/撤销、二进制 provenance、离线缓存 |
| 不自动扩大 workspace access | filesystem MCP 自动或受策略地注入 workspace root | 路径范围、符号链接、跨 workspace、server argv 变形、审计与恢复 |
| 默认 privileged，远端 metadata 不降权 | 使用 remote annotations 辅助风险/审批 | 远端声明的信任级别、何时可影响 effect、哪些声明仅作显示、不可降级边界 |

在新 ADR 采纳前，本仓库不得把本节的目标表述为“已上线”，也不得通过临时 feature flag、隐藏 Settings、未登记 MCP、脚本或 shell path 绕过当前约束。

---

## 4. P0：协议互操作性与运行可靠性

### 4.1 OAuth / 动态认证

**状态（2026-07）：** ADR-0135 Phase C **已实施** user-configured HTTP/SSE authorization-code + PKCE、main-owned callback/deep-link、safeStorage token、refresh/revoke、secret-free Settings/IPC。stdio 永不进 OAuth。勿将此写成 auto-connect 或 marketplace 已上线。

**对齐目标（Phase C 合同）**

1. 支持 OAuth authorization-code + PKCE、redirect/deep-link callback、refresh token；
2. 令 `safeStorage` 成为 token 的唯一 durable authority；
3. runtime 状态支持 `authorization_required`、`authorizing`、`authorized`、`authorization_failed`；
4. Settings 支持授权、取消授权、重新授权；
5. renderer 永不接收 access token、refresh token 或完整 token-bearing URL；
6. 授权完成后精确失效对应 server session，并由受控重连路径重建。

**模块**

```text
src/main/mcp/oauth-authorization-manager.ts
src/main/mcp/oauth-pkce.ts
src/main/mcp/oauth-state-store.ts
src/main/mcp/oauth-callback.ts
src/main/mcp/oauth-deep-link-bridge.ts
src/main/mcp/oauth-token-store.ts
src/shared/mcp/oauth-types.ts
```

**验收**

- state/PKCE 不匹配 fail-closed；
- token 只进入 platform secret storage；
- callback、日志、Doctor、bundle 均不含 token；
- refresh 失败会回到可见的 `authorization_required`；
- OAuth 不改变 effect、approval 或 settlement 路径。

### 4.2 `tools/list` 分页与动态 tool refresh

**状态（2026-07）：** ADR-0133 Phase A **已实施** paged `tools/list`、inventory stale、disconnect/manual refresh 与 secret-free diagnostics（细节以 ADR-0133 为准）。

1. 逐页读取 `tools/list`，直到 cursor 为空；
2. 在 fetch 过程中累计执行现有 `maxToolsPerServer`、global tool、per-tool schema、global schema 硬预算；
3. 订阅/处理 tool list change notification；
4. 将 server snapshot 标为 stale；当前 run 不中途扩 schema，下一 run 或用户显式刷新才重新 materialize；
5. UI 显示“已发现 / 已注册 / 因预算拒绝”的工具数。

### 4.3 断连、失效与受控重连

**状态（2026-07）：** 状态面含 `disconnected` / `retry_wait` / `failed`；transport close 会使 session stale；重连仅显式 refresh / 下一 run snapshot / 受控 `autoConnectNow`；stdio stderr `pipe` + 有界脱敏 diagnostics。**禁止**无限后台重连循环。

**历史差距（已部分闭合）**

早期仅有 `disabled | idle | connecting | connected | error` 与 `stderr: ignore`。

**对齐目标**

1. 状态扩展为 `disconnected`、`retry_wait`、`failed`、授权相关状态；
2. transport-level disconnect 或可恢复 call error 必须使 session stale，不允许无限复用已失效 client；
3. 重连按显式策略进行：下一 run、显式刷新、或经批准的 background policy；
4. retry 必须有次数/时间硬上限、指数退避、取消传播和可见状态；
5. 采集有限、脱敏、仅本地的 stderr/handshake summary；
6. server crash、timeout、connection closed、DNS/TLS/HTTP error 必须映射为稳定错误码和修复提示。

### 4.4 MCP result normalizer、媒体与 artifact

**状态（2026-07）：** ADR-0134 Phase B **已实施**（`result-normalizer.ts`、`artifact-writer.ts`、`trace-store.ts`、typed shared result model）。结果仍不是 teaching evidence。

**对齐目标（已闭合的合同）**

1. 在 bridge 前归一化 tool result；
2. text 按 inline/model budget 截断；
3. structured content 使用安全 JSON 序列化并提供截断标记；
4. image/base64 或超大 resource 进入本地受控 artifact，模型只获得摘要和安全引用；
5. resource link 默认不得自动 fetch；
6. 结果先过 MCP 专属预算，再过既有 ToolRegistry result budget；
7. 不把结果自动升级为 Evidence、Outcome 或 canonical teaching record。

**模块**

```text
src/main/mcp/result-normalizer.ts
src/main/mcp/artifact-writer.ts
src/shared/mcp/result-types.ts
```

---

## 5. P1：可观测性、风险元数据和诊断

### 5.1 摄取 MCP tool annotations 与 provenance

**状态（2026-07）：** annotations 供 UI/审计；IPC 白名单投影。effect 默认 privileged + overrides；**可选** root `honorRemoteReadOnlyHint` 将非 destructive 的 `readOnlyHint` 映射为 `read`（ADR-0141）。plugin identity 签名供应链仍可增强。

当前 listed/tool inventory 在 name/description/schema 之外可附带 annotations。对齐后应保留 MCP 的 `readOnlyHint`、`destructiveHint`、`idempotentHint` 等 annotations，以及 server 来源、配置层级、plugin identity、版本和签名/provenance。

目标规则：

- annotations 可用于 UI、审计、并发/重试建议；
- `idempotentHint` 可以影响受控 retry 资格；
- 远端的 `readOnlyHint` **不得无条件将** StudiumX tool 从 `privileged` 降为 `read`；
- 任何 effect 降级都必须由新 ADR 定义可信来源、用户同意、可审计 policy 和回退规则；
- destructive declaration 至少应提高提示/审批的显著度。

### 5.2 trace 与 audit correlation

对齐目标是使每次 MCP call 可关联到 run、turn、tool call、server、raw tool name、注册名、耗时、取消、重试、结果大小和截断状态。

必须遵守：

- 不记录 secret、header、env 或完整敏感 arguments；
- 输入/输出最多记录脱敏摘要和大小；
- trace 不得成为新的远程 telemetry；
- MCP handler 仍不得 import ledger writer/outcome committer；
- fork/replay 仍保持 `toolsReplayed:false`，除非新的、独立的 replay ADR 明确改变此不变量。

### 5.3 Settings / Doctor 诊断闭环

**状态（2026-07）：** Doctor `mapMcpFacts` 已输出 inventory 聚合计数与 `authorizationState`（secret-free）；**不**输出 refresh generation/retry 内部字段。Settings 有 test/refresh/authorize 与 import risk badges。后续仍可加强 stderr 摘要与多来源优先级展示。

目标 UI/Doctor 信息：

- server 连接状态、最近连接/失败时间、耗时和重试次数；
- transport、scope、来源、优先级、是否被覆盖；
- discovered / registered / rejected tool counts；
- name conflict、schema budget、scope mismatch、secret unresolved 的具体解释；
- OAuth 授权 CTA；
- 脱敏 stderr / handshake 摘要；
- “测试连接”“刷新状态”“重新授权”“查看本地诊断”的明确操作；
- support-bundle 继续只包含 redacted status，不包含 command token、secret、OAuth token 或原始敏感 payload。

---

## 6. P1：完整配置生态、迁移和同步

### 6.1 多来源配置与 precedence

Zcode 参照包含 user、workspace、plugin、environment、CLI、desktop-managed server map，并有同名覆盖/回退规则。StudiumX 的对齐目标是引入明确、可解释、可审计的层级：

```text
CLI / session override
→ environment
→ user configuration
→ workspace configuration
→ plugin / marketplace-provided defaults
→ system defaults
```

实现前的新 ADR 必须冻结：

- 同名 server 的 winner 和 shadowed entry 展示；
- `enabled` 的合并语义；
- workspace directory walk 的边界；
- `.zcode/config.json`、`zcode.json`、`.agents/mcp.json` 等兼容输入格式；
- config schema 严格校验、未知字段处理、legacy field migration；
- 不同 source 对 command/url/header/env/OAuth 的覆盖权限；
- source 被删除或 plugin 被卸载后如何关闭 session 与清理 secret；
- workspace trust 与首次连接/自动连接的关系。

### 6.2 批量 import / export / migration

即使多来源配置尚未完成，也应实现可控的迁移能力：

1. 导入 `mcpServers`、`mcp.servers` 等常见形状；
2. 支持多 server 预览、逐项选择、schema/secret 风险提示；
3. 导入是 draft，用户确认后才进入 canonical config；
4. 导出默认不含 secret，使用占位符或省略敏感字段；
5. 为 legacy config 保留原始文件、不就地破坏，并生成可审计 migration report；
6. 支持 user-directory load/save 与旧 common MCP 配置迁移；
7. 为跨设备/跨端目标建立 `McpSync` 合同、版本和冲突规则。

### 6.3 workspace-root 注入到 filesystem MCP

Zcode 会识别 filesystem server 并向其 command args 追加 workspace path。StudiumX 的对齐目标不是无条件字符串拼接，而是提供受控形式：

1. 将“允许向此 server 暴露哪个 workspace root”作为单独授权；
2. 允许的根必须经过 canonical path、symlink containment、workspace trust 检查；
3. 注入规则必须基于 server identity/manifest，而不是模糊 argv 匹配；
4. 注入后的 effective command 需要在 UI/Doctor 中以脱敏方式可见；
5. workspace 切换、server disable、scope 变化后立即 drop/rebuild session；
6. 若采用自动 injection，必须由新 ADR 明确审批与撤销机制。

---

## 7. P2：插件、marketplace 和 server 生命周期

Zcode 提供 plugin-provided MCP servers、plugin namespace 与 marketplace 相关能力。StudiumX 的对齐目标是将其从“配置字符串”提升为完整 lifecycle：

```text
discover → inspect → install → verify → grant trust → configure
→ connect → update → revoke → uninstall → cleanup
```

### 7.1 Plugin-provided MCP

目标：

- plugin manifest 可以声明 MCP servers；
- server 名称稳定 namespace，例如 `plugin:<plugin-id>:<server-id>`；
- plugin template variables 仅在受信任 plugin context 内扩展；
- 将 plugin root、workspace root、user config value 的变量能力分级；
- plugin disabled/uninstalled/updated 后，MCP sessions、tools、OAuth tokens、artifacts 和 cached schemas 均按生命周期清理；
- 由 verifier/manifest contract 限定可执行文件、hash、签名、权限和 update channel。

### 7.2 Marketplace

目标：

- 可浏览、发现、安装、更新、禁用和卸载 MCP plugin/server；
- 每个条目显示 publisher、签名、版本、更新历史、权限、网络 endpoints、command、所需 secret/OAuth scope；
- 支持版本 pin、撤销名单、紧急禁用、离线 cache、hash verification；
- 安装前展示 effect 和 filesystem/network access 预览；
- 信任授予、连接授权、tool effect approval 三者分离，不能用一次“安装”替代后续审批；
- 禁止隐式 shell escalation、未验证下载、静默更新或绕过 ToolOutcome 的 tool call。

### 7.3 Auto-connect

目标：

- 对 user、workspace、plugin、environment、CLI 等已解析来源的 server 支持 session start auto-connect；
- 有全局开关、per-source/per-server override、网络/子进程资源上限和 failure backoff；
- auto-connect 只建立协议连接和工具发现，不授权副作用工具调用；
- connection、OAuth、tool invocation 是三个不同的同意/审批层；
- 自动连接产生的 server/tool 变化要在 Settings、Doctor、audit 中可见；
- 任一 source 失去信任、被卸载或被覆盖时，session 必须立即撤销。

---

## 8. 明确不变的底线

即使完成本路线图，以下不变量仍必须保持，除非未来另有明确的高层产品决策：

1. 文件与 canonical learning records 仍是教学真相源；MCP server、SQLite、agent run 不是 teaching authority。
2. `TeachingTurnCoordinator` / host 仍是 outcome settlement sole-writer；MCP 不得直接写 ledger、outcome 或 learning record。
3. 所有 MCP tools 均经过 ToolRegistry → Dispatcher → effect lattice → permission gate → ToolOutcome；不存在 UI 直通任意 `callTool` IPC。
4. `expectedRevision` 不得放宽；fork/replay 默认仍为 `toolsReplayed:false`。
5. 默认远程 telemetry 不得因 MCP marketplace、OAuth 或诊断而引入。
6. secrets、OAuth tokens、headers、env、command 中 token 不得进入 renderer、日志、Doctor 或 support bundle。
7. MCP tool result 不是自动证据，不自动写 learner profile、memory、outcome 或 skill。
8. 不允许以“always approve”“YOLO”“danger full access”等语义替代 effect/permission gate。
9. MCP 连接、安装、配置、tool invocation、workspace-root access 必须拥有可区分、可撤销、可审计的状态。

---

## 9. 分阶段实施建议与验收

> **权威阶段字母以 ADR-0132 及实现合同为准**（产品 A–H），勿把历史草案字母与 shipping 混读：
> - **已落地（代码 + ADR）：** 产品 Phase **A–D** — ADR-0133…0136。
> - **E–H + 体验政策（2026-07-23）：** foundation 已落地；**[ADR-0141](../adr/0141-mcp-product-experience-parity-policy.md) 放宽体验层限制**（auto-connect / marketplace / install→connect / 远程 catalog / McpSync 客户端均为合法产品方向）。硬安全（secret、settlement、非 teaching evidence）不变。

| 产品阶段（ADR-0132） | 交付 | 实现 ADR | 状态（2026-07-23） |
| --- | --- | --- | --- |
| A | runtime reliability / list pagination / disconnect diagnostics | ADR-0133 | **已实施** |
| B | result normalizer / artifacts / local trace | ADR-0134 | **已实施** |
| C | OAuth PKCE / main-only tokens | ADR-0135 | **已实施** |
| D | import/export + McpSync wire types | ADR-0136 | **已实施** |
| E | multi-source + auto-connect | ADR-0137 + **0141** | **foundation 已实施**；0141 允许根开启后默认 auto-connect 与冷启动/workspace 自动连接 |
| F | workspace-root injection separate grant | ADR-0138 | **已实施**（schema + `resolveInjectedStdioServer` + session wire + Settings 开关） |
| G | plugin trust / lifecycle | ADR-0139 | **已实施 foundation**（parse/namespace/templates + `PluginMcpRegistry`；无远程下载） |
| H | marketplace | ADR-0140 + **0141** | **本地 store foundation 已实施**；0141 **开放**远程 catalog、install→connect、marketplace UI 为合法产品面 |

| 历史草案字母（旧表） | 大致映射 | 备注 |
| --- | --- | --- |
| 旧 A–B | 产品 A | runtime reliability 同批 |
| 旧 C | 产品 B | result safety |
| 旧 D | 产品 C | OAuth |
| 旧 E | 产品 D | import/export（已实施，非 multi-source） |
| 旧 F–H | 产品 E–H | multi-source / auto-connect / workspace-root / plugin+marketplace |

每个阶段至少执行：

```bash
pnpm typecheck
pnpm run check:security
pnpm run check:tool-contract
pnpm run check:teaching-evidence
pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts
```

并按触及的路径补充 IPC、OAuth、support-bundle、provider privacy、registry/dispatcher、agent loop 和 lifecycle 定向测试。真实模型 API 不应进入默认 PR CI。

---

## 10. 当前测试缺口

现有 unit 已覆盖 config schema、secret merge、effect map、fake transport session、tool naming、Doctor facts（含 autoConnect / inventory / OAuth 投影）、Settings UI、result normalizer/artifact/trace、OAuth PKCE/callback/token store，以及 **MCP 不 import ledger/outcome committer** 的静态 invariant（`tests/unit/mcp-settlement-isolation.unit.test.ts`）。后续至少新增：

1. `mcp-ipc-gateway` payload、channel whitelist 和 secret non-echo tests（OAuth authorize/revoke + test/refresh listed-tools 投影与 annotations 白名单）— **unit 已加强**；
2. SDK stdio/HTTP/SSE transport tests：headers、abort、timeout、pagination、close、error content；
3. tool list change、disconnect、retry、stale session、workspace switch lifecycle tests；
4. （result normalizer 已有 unit；补 e2e 级 huge payload / multi-artifact 压力可选）；
5. （OAuth 组件 unit 已有；补 authorize→callback→refresh→revoke 集成路径）；
6. import/export + multi-source + McpSync **本地** envelope import/export 已接线；跨设备网络 McpSync 服务仍 open；
7. plugin/marketplace：foundation + Settings UI + catalogUrls 已实施；**无官方默认 catalog**（用户可自配 URL）。远程签名供应链可继续增强；
8. end-to-end: Settings/config source → host → session → registry → approval → ToolOutcome；
9. Doctor：`effectiveSourceCount` / `sourceWarningCount` / `marketplaceEmergencyDisabled` / runtime `diagnosticsLineCount` 聚合投影 unit（2026-07-23 接线）；继续强化 invariant：`toolsReplayed:false` 保持，`expectedRevision` 不被 MCP 扩权。

---

## 11. 决策记录与文档更新清单

实施与产品化过程中应完成：

- [x] 新 ADR：体验政策见 **ADR-0141**（放宽 auto-connect / marketplace 等）；
- [ ] 更新 ADR-0127、ADR-0128，并在 `docs/adr/README.md` 标明 superseded/缩窄关系（与 0141 交叉引用）；
- [ ] 更新根 `AGENTS.md` 产品地板，避免与 ADR-0141 体验层冲突（硬安全段保持）；
- [ ] 更新 `SECURITY.md`：workspace config、plugin trust、marketplace、OAuth、auto-connect、filesystem root injection；
- [ ] 更新 `docs/tools/TOOL_CONTRACT.md`：MCP provenance、remote annotations、auto-connect 与 root injection 的 effect/approval 语义；
- [ ] 更新 feature registry 和 blocking checks；
- [x] 分阶段可回滚：产品 A–H foundation 已按 ADR-0133…0140 落地；**剩余为 ADR-0141 下的产品化**（远程 catalog UI、冷启动默认 auto-connect 策略打磨、McpSync 客户端、诊断/Settings UX），不把 marketplace 远程下载与 settlement 扩权混入同一 PR。

---

## 12. 最终目标

目标不是仅复制 Zcode 的 UI 或配置格式，而是让 StudiumX 成为一个具备以下能力的成熟 MCP client：

- 能发现、安装、配置、迁移、同步和撤销多来源 MCP servers；
- 能自动连接、完成 OAuth、稳定重连并展示清晰健康状态；
- 能对动态工具、分页、变更通知、多模态结果和大结果进行可靠处理；
- 能将 plugin、marketplace、workspace access、tool annotations 纳入可验证的 provenance、effect 与审批模型；
- 同时持续保持教学 canonical authority、settlement sole-writer、secret isolation、本地优先和不可绕过的 tool permission 体系。

### Residual closed 2026-07-23 (post-0141 productization)
- Optional `honorRemoteReadOnlyHint` effect mapping (opt-in).
- Budgeted reconnect (max attempts + backoff) when smart-connect on.
- McpSync pure parse/merge preview + Settings import path; no network sync server.
- Marketplace catalogUrls Settings + refresh IPC.

> **CLI 层：** 进程环境 `STUDIUMX_MCP_CLI_JSON` 或 host `setCliServers` 提供 session 覆盖，precedence 最高。无官方 catalog。
