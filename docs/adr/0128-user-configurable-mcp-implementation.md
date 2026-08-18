# ADR-0128：用户可配置 MCP — 实现合同（传输 / 配置 / effect / IPC）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-22
- **范围：** 在 [ADR-0127](0127-user-configurable-mcp-design-gate.md) 决策冻结之上，锁定用户可配置 MCP 的 wire schema、路径、传输子集、tool 命名、effect 映射、IPC、registry/dispatcher/fingerprint 接线与安全不变量。
- **取代：** 无
- **被取代：** 部分被 [ADR-0132](0132-mcp-zcode-parity-and-trust-lifecycle.md) 与 [ADR-0141](0141-mcp-product-experience-parity-policy.md) 取代/扩展（marketplace、auto-connect、多来源、plugin lifecycle 等后续产品政策）；v1 默认 off/manual 行为保持为兼容基线。dispatcher/effect/approval、secret-free IPC、预算、settlement、replay 与 v1 schema 合同仍有效。
- **相关：** [ADR-0127](0127-user-configurable-mcp-design-gate.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0041](0041-tool-annotations-and-result-budget.md)、[ADR-0042](0042-extension-manifest-minimal.md)、[ADR-0046](0046-teaching-footprint-ladder.md)、[ADR-0056](0056-tool-result-turn-budget-and-spill.md)、[ADR-0060](0060-tools-schema-session-fingerprint.md)、[ADR-0063](0063-declarative-tool-policy.md)、[ADR-0132](0132-mcp-zcode-parity-and-trust-lifecycle.md)、[ADR-0134](0134-mcp-result-safety-and-local-artifacts.md)、[ADR-0135](0135-mcp-oauth-pkce-and-secret-token-lifecycle.md)、[ADR-0141](0141-mcp-product-experience-parity-policy.md)、`docs/tools/TOOL_CONTRACT.md`
- **证据：** `src/shared/mcp/*`（types/tool-name/effect-map/config-schema）、`src/main/mcp/*`（config-store/secret-env/session-manager/transports/tool-bridge/registry-inject/redact）、`src/shared/features.ts`、`tests/unit/mcp-*.unit.test.ts`；分阶段落地细节见 `docs/adr/evidence/ADR-0128.md`。

## 背景

[ADR-0127](0127-user-configurable-mcp-design-gate.md) 批准用户 opt-in 配置 MCP server；本 ADR 把它编码为可测试的 wire/路径/effect/IPC 合同。核心目标：用户可在 userData 配置中 opt-in 添加、启用、禁用、删除 MCP server（`user` 或绑定当前目录的 `workspace` scope）；启用后的 server 经 **main 进程** 会话管理，其 tools 进入既有 **ToolRegistry → Dispatcher → effect lattice → permission gate → ToolOutcome** 路径；默认 **MCP 总开关 off**，无启用条目时**零连接、零 MCP tool schema**；与 teaching settlement / ledger / `expectedRevision` / `toolsReplayed:false` **正交且不得旁路**。

## 决定

### 1. 配置合同（UserMcpConfigV1）

- **路径（冻结）：** 配置文件 `{userData}/mcp/config.v1.json`；备份 `.bak`（对齐 ADR-0003：写前备份 + 可读性校验）；**密钥不写入 config JSON**——`env` / `headers` 中标记为 secret 的值进 platform secret storage，config 仅存 **secret ref id**。
- **JSON 形状（冻结字段名）：** `schemaVersion: 1`、根 `enabled: false`、`servers[]`（每个含 `id`/`label`/`enabled`/`scope`/`workspaceRoot`/`transport`/`command`/`args`/`cwd`/`envSecretRefs`/`envPlain`/`url`/`headersSecretRefs`/`headersPlain`/`timeoutMs`/`toolEffectOverrides`/`createdAt`/`updatedAt`）、`fingerprint`（可选 CAS token）。
- **校验规则（fail-closed）：** `schemaVersion` 必须为 `1`，未知版本拒绝加载并保留文件；`id` 匹配 `^[a-z][a-z0-9_-]{0,63}$` 且配置内唯一；`transport` 接受 `stdio` / `http`（Streamable HTTP）/ `sse`，未知 fail-closed；`stdio` 用 `spawn(command, args, { shell: false })`，**禁止** shell 元字符解释层；`cwd` 允许 `null` 或绝对路径，**禁止** workspace-relative 静默扩权；`envPlain`/`headersPlain` **禁止**键名匹配 `/api[_-]?key|token|secret|password|authorization/i` 的明文值；`scope: workspace` 必须带用户明确选择的绝对 `workspaceRoot`；HTTP/SSE `url` 必须是 `http:`/`https:`；`toolEffectOverrides` 仅允许 `read` | `workspace_write` | `external_write` | `privileged`，非法值拒绝整个 server。
- **CAS / 并发：** 写配置使用 fingerprint / 乐观并发（对齐 ADR-0033）；读失败尝试 `.bak` 校验恢复，仍失败 → 空默认 + doctor fact，**不**半解析启用。

### 2. 传输与会话

- 实现：官方 `@modelcontextprotocol/sdk` `1.29.0`；`StdioClientTransport`、`StreamableHTTPClientTransport`、`SSEClientTransport` 统一由 `sdk-client.ts` 适配。
- 生命周期：仅在显式「测试连接」或 agent run snapshot 需要 tools/list 时懒连接；app quit、根/server disable、配置删除或运行定义变化时断开。
- 超时：`initialize` / `tools/list` / `tools/call` 均有硬超时（默认 30s / 30s / 60s，可配置上界封顶）。
- 崩溃：fail-closed——该 server tools 从注册表移除；模型侧工具调用返回 `failed` + 稳定错误码 `mcp_server_unavailable`。
- 日志：禁止记录 env 明文、header 明文、完整 tool arguments 中的疑似密钥；路径家目录脱敏。
- 环境变量消毒：`sanitizedEnv` = 最小继承集 + `envPlain` + 解析后的 secret refs。**硬禁止**默认注入任何 provider `apiKey` / TeachingSettings 密钥、`ELECTRON_*` 调试开关（除非 allowlist 证明必要）、未在 UI 展示的 workspace 绝对路径作为隐式 cwd。

### 3. Tool 命名、发现与 schema 预算

- **稳定工具名（冻结）：** `mcp__{serverId}__{rawToolName}`；`rawToolName` 含非 `[A-Za-z0-9_-]` 时映射为 `_` 并保证 server 内唯一（冲突时后缀 `_2`…）；**禁止**与内建教学工具同名抢注（冲突拒绝注册 + doctor warning）。
- **发现时机：** Settings「测试连接」临时连接 → `initialize` + `tools/list` → 断开或保持（结果不进 agent run）；agent run 开始前若根开关与 server 启用则确保连接并生成 `ToolEntry[]` 注入当次 registry 视图；run 进行中**禁止**静默扩展 tool 表面（对齐 ADR-0060：MCP tools 集合在 run baseline 建立后不得新增/改 schema）；配置变更中途不自动重载 MCP 表面，下一 run 再生效。
- **Schema / 结果预算：** 每 server `tools/list` 最大 64 个；全局 MCP tools 注入上限 128；单 tool description 最大 4 KiB（截断标记 `…[truncated]` + `truncated:true`）；单 tool JSON Schema 最大 32 KiB（超限拒绝注册）；全局 MCP schema 总字节 256 KiB（超限按 server 顺序 fail-closed）；tool result 走既有 `enforceToolResultBudget`（ADR-0041/0056）。
- **temporary chat vs teaching chat：** 两者**共享同一 MCP 注入规则**（根开关 + server 启用 + 预算 + fingerprint + 默认 privileged）；差距**仅限教学文件生成相关能力**（`generate_lesson` 等教学产物写工具在 temporary 不注入），不因「临时」裁掉 MCP、web、workspace read 等已开放的用户配置能力（见 ADR-0046）。不存在 temporary 专用 MCP 白名单；不存在「teaching 才有 MCP」。

### 4. Effect 映射（冻结默认）

| 情况 | effectClass | permission |
| --- | --- | --- |
| 无 override | **`privileged`** | 走 privileged 交互门（须审批，不得 full_access 静默当 read） |
| `toolEffectOverrides[rawName]=read` | `read` | web/url 类命名不自动 read |
| override=`workspace_write` | `workspace_write` | 必须仍做 workspace path containment；**MCP handler 不执行工作区写**（真正写盘应鼓励模型调内建 `write_workspace_file`）；override 仅影响审批文案/策略分类 |
| override=`external_write` | `external_write` | concurrency 硬限制 1；内容标 external untrusted |
| override=`privileged` | `privileged` | 默认同无 override |

`classifyToolEffect` 对 `mcp__` 前缀工具：优先查运行时映射表（session-manager 在 list 时写入），未命中 → `privileged`（fail-closed）；**禁止**把映射表持久化为可被 workspace 篡改的权威。动态 MCP 工具不进 `TOOL_CONTRACT.md` 闭集表，而在 audit 快照中记录；`scripts/check-tool-contract.mjs` 不要求枚举用户 MCP tools。

### 5. IPC 合同（Phase B 冻结 channel 前缀）

前缀 `teach:mcp-*`（并入 teaching IPC 登记，避免平行网关）：

| Channel | 方向 | 作用 |
| --- | --- | --- |
| `teach:mcp-get-config` | invoke | 返回 secret-free 视图（secret 仅显示「已配置」布尔） |
| `teach:mcp-update-config` | invoke | CAS 更新；body 含 `expectedFingerprint` |
| `teach:mcp-test-server` | invoke | 对单 server 试连 + tools/list 摘要（名称/effect/截断标记）；超时/失败稳定错误码 |
| `teach:mcp-list-runtime` | invoke | 当前进程连接态（connected/disabled/error code）；无密钥 |

规则：renderer **永不**获得 secret 明文；无 MCP 专用「执行任意 tool」IPC（防 UI 绕过 agent 审批，试连只 list）；preload 白名单登记，未登记 channel 拒绝。

### 6. Settlement / 隐私 / 安全不变量（测试锁定）

1. MCP handler **不** import outcome committer / ledger writer。
2. MCP 结果**不**自动变 Evidence「已掌握」；最多 conversation tool 轨迹。
3. Fork / replay：`toolsReplayed` 默认 false；不得因 MCP 改为 true。
4. Support-bundle / doctor：command/args 脱敏；secret 永不导出。
5. Workspace untrusted 文件不能打开根 `enabled`。
6. 无 YOLO 文案；总开关和 server 开关单击立即提交，不二次确认、不生成切换成功状态卡。

## 不变量

- 默认 `enabled: false`，无启用条目时零连接、零 MCP tool schema；server 启用 ≠ tool 调用授权。
- 动态 MCP 工具计入 tools-schema fingerprint（ADR-0060）；run 内 MCP 表面变化按 `expanded`/`incompatible` fail-closed。
- 稳定错误码（面向用户中文短句；日志可含 server id，不含 command 行内 token）：`mcp_disabled`、`mcp_server_disabled`、`mcp_invalid_config`、`mcp_cas_conflict`、`mcp_transport_unsupported`、`mcp_spawn_failed`、`mcp_handshake_failed`、`mcp_list_failed`、`mcp_budget_exceeded`、`mcp_tool_not_registered`、`mcp_call_failed`、`mcp_call_timeout`、`mcp_server_unavailable`、`mcp_secret_unresolved`、`mcp_name_conflict`。

## 后果

- A–F 已交付（stdio / Streamable HTTP / SSE、user/workspace scope、IPC、registry 注入、Form/JSON Settings UI、doctor `mcp_status`、support-bundle 脱敏）；v1 默认 off/manual 行为保持。
- Settings 可描述「添加并启用 MCP」；必须同时保留默认 off、无 auto-connect 与 effect/approval 边界。
- 历史 ADR 中「不引入 MCP」复读句与 0127/0128 冲突时，以 **0127+0128 + AGENTS/SECURITY** 为准。
- 回滚：根 `enabled:false` 为运行时总闸；删除 `src/main/mcp` 为代码回滚单位。

## 验证

- `pnpm typecheck`、`pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts`、`pnpm run check:security`、`pnpm run check:tool-contract`
- 分阶段落地（A–F）与 Phase A 最低 unit 清单：`docs/adr/evidence/ADR-0128.md`

## 非目标

- 不开放 marketplace / 远程目录（后续产品政策见 ADR-0132/0141）。
- 不把 stdio MCP 称为 OS sandbox。
- 不授权 MCP 直写 teaching ledger/outcome。
- 不授权 temporary-chat **独享**或**额外裁掉** MCP；临时与教学共享 MCP；temporary 不得获得教学产物写工具。
- 不授权 product `autoDrain: true`、C-6 destructive memory migration。
- 不保证兼容所有第三方 MCP 方言；未知 capability **忽略**，tools 以 list 为准。
- 不在默认 CI 烧真实外部 MCP 网络（unit 用 fake transport）。
