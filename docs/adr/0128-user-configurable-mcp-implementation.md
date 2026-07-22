# ADR-0128：用户可配置 MCP — 实现合同（传输 / 配置 / effect / IPC / 分阶段落地）

- **状态：** 已采纳（实现合同；工程已落地 A–F：官方 MCP SDK `1.29.0`、stdio / Streamable HTTP / SSE、user/workspace scope、IPC、registry 注入、Form/JSON Settings UI、doctor `mcp_status` 与 support-bundle 脱敏；**默认仍 off**；无 marketplace、无自动连接、无 YOLO）
- **日期：** 2026-07-22
- **范围：** 在 [ADR-0127](0127-user-configurable-mcp-design-gate.md) 决策冻结之上，锁定用户可配置 MCP 的 **wire schema、路径、传输子集、tool 命名、effect 映射、IPC、与 registry/dispatcher/fingerprint 接线、测试与分 phase 切片**。
- **相关：**
  - [ADR-0127](0127-user-configurable-mcp-design-gate.md)（政策 gate；本 ADR 为其实现合同）
  - [ADR-0024](0024-typed-tool-dispatcher-effect-policy.md) / [ADR-0048](0048-tool-contract-and-write-policy.md) / [ADR-0060](0060-tools-schema-session-fingerprint.md)
  - [ADR-0063](0063-declarative-tool-policy.md) / [ADR-0041](0041-tool-annotations-and-result-budget.md) / [ADR-0056](0056-tool-result-turn-budget-and-spill.md)
  - [ADR-0025](0025-teaching-config-resolver-secret-free-layers.md) / [ADR-0033](0033-config-optimistic-concurrency.md) / [ADR-0003](0003-critical-json-backups-and-verified-recovery.md)
  - [ADR-0042](0042-extension-manifest-minimal.md) / [ADR-0046](0046-teaching-footprint-ladder.md) / [ADR-0073](0073-teaching-feature-registry.md)
  - [ADR-0075](0075-module-size-policy-and-giant-peel.md)
  - 代码锚点：`src/main/ai/tools/{registry,dispatcher,effect-policy,tools-schema-fingerprint}.ts`、`src/shared/features.ts`、`src/shared/teaching-ipc-contract.ts`
- **证据提交：** 本 ADR + 各 phase 合并时的定向 unit / 文档同步；全量 e2e / 真模型非本 ADR 强制

## 1. 目标与非目标

### 1.1 目标

1. 用户可在持久化于 **userData** 的配置中 opt-in 添加、启用、禁用、删除 MCP server，并明确选择 `user` 或绑定当前目录的 `workspace` scope。
2. 启用后的 server 经 **main 进程** 会话管理；其 tools 进入既有 **ToolRegistry → Dispatcher → effect lattice → permission gate → ToolOutcome** 路径。
3. 默认 **MCP 总开关 off**；无启用条目时 **零连接、零 MCP tool schema**。
4. 与 teaching settlement / ledger / `expectedRevision` / `toolsReplayed:false` **正交且不得旁路**。

### 1.2 非目标（本 ADR 全 phase 均不交付）

- MCP **marketplace** / 远程推荐目录 / 自动信任第三方二进制
- YOLO / always-approve / DangerFullAccess
- 默认 ShellTool 产品词表（stdio 仅作用户指定 server 的 transport，不向模型暴露通用 shell）
- MCP 写 LearningSession / Outcome / Learning record
- 工作区文件 **静默** 启用 MCP
- Docker 级 OS isolation 声明
- 默认远程 telemetry

## 2. 模块边界（物理布局）

新增代码优先落在独立模块，**禁止**把 client 逻辑塞进 `teaching-turn-coordinator` / `learning-session-ledger` / 巨型 `registry.ts` 而不 peel：

```text
src/shared/mcp/
  types.ts                 # wire DTO / 错误码（纯类型 + 纯校验）
  tool-name.ts              # mcp__{serverId}__{toolName} 编解码（纯）
  effect-map.ts             # 默认 effect 映射 + policy hint 应用（纯）
  config-schema.ts          # UserMcpConfigV1 parse/normalize（纯）

src/main/mcp/
  config-store.ts           # userData 读写 + CAS/备份钩子
  secret-env.ts             # header/env secret 与 safeStorage 桥（无密钥进日志）
  session-manager.ts        # 连接生命周期、tools/list 缓存、预算
  transports/
    sdk-client.ts           # 官方 SDK：stdio / Streamable HTTP / SSE
  tool-bridge.ts            # MCP callTool → ToolEntry.handler
  registry-inject.ts        # 将动态 ToolEntry 注入 buildDefaultRegistry 旁路
  redact.ts                 # doctor/support-bundle 脱敏

src/main/… teaching-ipc / preload 薄封装（Phase B）
src/renderer/… Settings 段（Phase B/D）
```

单文件目标 **&lt; 500–800** 行（ADR-0075）；超限 peel，不继续塞。

## 3. 配置合同（UserMcpConfigV1）

### 3.1 路径（冻结）

| 项 | 值 |
| --- | --- |
| 配置文件 | `{userData}/mcp/config.v1.json` |
| 备份 | `{userData}/mcp/config.v1.json.bak`（对齐 ADR-0003 精神：写前备份 + 可读性校验） |
| 密钥 | **不**写入 config JSON；`env` / `headers` 中标记为 secret 的值进 platform secret storage，config 仅存 **secret ref id** |
| 工作区 | **禁止** 作为启用权威；可选未来 `{workspace}/.studiumx/mcp.suggest.json` 仅作「导入草稿」建议（须用户确认后写入 userData）— **Phase A 不实现 suggest 文件** |

### 3.2 JSON 形状（冻结字段名）

```json
{
  "schemaVersion": 1,
  "enabled": false,
  "servers": [
    {
      "id": "my-server",
      "label": "My Server",
      "enabled": false,
      "scope": "user",
      "workspaceRoot": null,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "cwd": null,
      "envSecretRefs": {},
      "envPlain": {},
      "url": null,
      "headersSecretRefs": {},
      "headersPlain": {},
      "timeoutMs": null,
      "toolEffectOverrides": {},
      "createdAt": "2026-07-22T00:00:00.000Z",
      "updatedAt": "2026-07-22T00:00:00.000Z"
    }
  ],
  "fingerprint": "optional-cas-token"
}
```

### 3.3 校验规则（fail-closed）

1. `schemaVersion` 必须为 `1`；未知版本拒绝加载并保留文件（不静默迁移毁档）。
2. `id`：`^[a-z][a-z0-9_-]{0,63}$`；配置内唯一。
3. `enabled`（根）为总开关；server 级 `enabled` 为二次开关。连接条件：`root.enabled && server.enabled`。
4. `transport`：接受 `stdio`、`http`（Streamable HTTP）与 `sse`；通用 JSON 中的 `streamableHttp` 在解析时规范化为内部 `http`；未知 transport fail-closed。
5. `stdio`：`command` 非空字符串；`args` 为 string 数组（可空）；**禁止**通过 config 注入 shell 元字符解释层——使用 `spawn(command, args, { shell: false })`。
6. `cwd`：允许 `null` 或绝对路径；**禁止** workspace-relative 静默扩权。
7. `envPlain` / `headersPlain`：**禁止**键名匹配 `/api[_-]?key|token|secret|password|authorization/i` 的明文值——此类必须走对应 secret refs。
8. `scope`：`user` 在任意 workspace snapshot 可用；`workspace` 必须带用户明确选择的绝对 `workspaceRoot`，且仅在匹配 root 的 snapshot / test 中可连接。配置仍只写 userData。
9. HTTP/SSE `url` 必须是有效的 `http:` 或 `https:` URL；`timeoutMs` 为 `null` 或正整数。
10. `toolEffectOverrides`：值仅允许 `read` | `workspace_write` | `external_write` | `privileged`；非法值拒绝整个 server。
11. 默认文档：根 `enabled: false`、`servers: []`。

### 3.4 Settings Form / JSON 兼容

- 添加/编辑页提供 Form 与 JSON 两种模式，一次编辑一个 server。
- JSON 接受直接 server config、单 server map，以及 `{ "mcpServers": { ... } }` wrapper。
- `type: "streamableHttp"` 规范化为内部 `http`；`args` 为 string 数组，Form 中按空白拆分。
- renderer 仅用 `<configured>` 表示已有 secret；secret plaintext 只允许 renderer → main 单向提交，main 不回显 ref id 或 plaintext。

### 3.5 CAS / 并发

- 写配置使用 fingerprint / 乐观并发（对齐 ADR-0033 精神）：`expectedFingerprint` 不匹配 → 冲突错误，不覆盖。
- 读失败（JSON 损坏）：尝试 `.bak` 校验恢复（ADR-0003）；仍失败 → 空默认 + doctor fact，**不**半解析启用。

## 4. 传输与会话

### 4.1 已交付传输子集

| 项 | 合同 |
| --- | --- |
| 实现 | 官方 `@modelcontextprotocol/sdk` `1.29.0`；`StdioClientTransport`、`StreamableHTTPClientTransport`、`SSEClientTransport` 统一由 `sdk-client.ts` 适配 |
| stdio | SDK 使用 `command` + `args` + sanitized env + 可选绝对 `cwd`；不经过 shell 解释层 |
| HTTP/SSE | URL 由用户输入；支持 plain + main 进程解析后的 encrypted secret headers |
| 生命周期 | 仅在显式“测试连接”或 agent run snapshot 需要 tools/list 时懒连接；app quit、根/server disable、配置删除或运行定义变化时断开 |
| 超时 | `initialize` / `tools/list` / `tools/call` 均有硬超时（建议默认 30s / 30s / 60s，可配置上界封顶） |
| 崩溃 | fail-closed：该 server tools 从注册表移除；模型侧工具调用返回 `failed` + 稳定错误码 `mcp_server_unavailable` |
| 日志 | 禁止记录 env 明文、header 明文、完整 tool arguments 中的疑似密钥；路径家目录脱敏 |

### 4.2 Remote transport 规则

- Streamable HTTP 使用内部 `http`，通用 JSON 对外写作 `streamableHttp`；legacy SSE 保持 `sse`。
- URL 必须使用 `http:` 或 `https:`；未知 scheme 拒绝。
- 仍无 marketplace；URL 只来自用户填写或粘贴的配置。

### 4.3 环境变量消毒

`sanitizedEnv` = 最小继承集（`PATH`/`PATHEXT`/`SYSTEMROOT`/`LANG` 等平台必要项） + `envPlain` + 解析后的 secret refs。

**硬禁止**默认注入：

- 任何 provider `apiKey` / TeachingSettings 密钥
- `ELECTRON_*` 调试开关扩大攻击面（除非 allowlist 证明必要）
- 工作区绝对路径作为「隐式默认 cwd」而未在 UI 展示

## 5. Tool 命名、发现与 schema 预算

### 5.1 稳定工具名（冻结）

```text
mcp__{serverId}__{rawToolName}
```

- `rawToolName` 来自 MCP `tools/list` 的 `name`；若含非 `[A-Za-z0-9_-]`，映射为 `_` 并保证 server 内唯一（冲突时后缀 `_2`…）。
- 解码失败 / 非此前缀 → 不是 MCP bridge 工具。
- **禁止**与内建教学工具同名抢注：若规范化后与 registry 静态名冲突，**拒绝注册该 MCP tool** 并记 doctor warning。

### 5.2 发现时机

| 时机 | 行为 |
| --- | --- |
| Settings「测试连接」 | 临时连接 → `initialize` + `tools/list` → 断开或保持（UI 可选）；结果不进 agent run |
| Agent run 开始前 | 若根开关与 server 启用：确保连接 → `tools/list` → 生成 `ToolEntry[]` 注入当次 registry 视图 |
| Run 进行中 | **禁止**静默扩展 tool 表面（对齐 ADR-0060）：MCP tools 集合在 **run baseline 建立后** 不得新增/改 parameters schema；连接掉线则后续 call 失败，不得热插拔新 tool |
| 配置变更中途 | 进行中的 run **不**自动重载 MCP 表面；下一 run 再生效 |

### 5.3 Schema / 结果预算

| 预算 | Phase A 默认（可在 settings 调低，不可无界） |
| --- | --- |
| 每 server `tools/list` 最大 tools | 64 |
| 全局 MCP tools 注入上限 | 128 |
| 单 tool description 最大字符 | 4 KiB（截断时 description 末尾标记 `…[truncated]` 且 **仍注册** 时须在 list 元数据记 `truncated:true`） |
| 单 tool JSON Schema 最大字节 | 32 KiB；超限 **拒绝注册该 tool** |
| 全局 MCP schema 总字节 | 256 KiB；超限按 server 顺序 fail-closed 拒绝后续 tool |
| tool result | 走既有 `enforceToolResultBudget`（ADR-0041/0056） |

临时 chat 与 teaching chat **共享同一 MCP 注入规则**（根开关 + server 启用 + 预算 + fingerprint + 默认 privileged）。

**产品差距（冻结）：** 临时 chat 与 teaching chat 的 tool 表面差距 **仅限教学文件生成相关能力**（见 §5.4 与 [ADR-0046](0046-teaching-footprint-ladder.md) 修订），**不得**因「临时」再裁掉 MCP、web、workspace read 等已对 teaching 开放的用户配置能力。

### 5.4 临时 chat vs teaching chat（差距仅限教学文件生成）

产品要求：**两者差距仅在「生成/写入教学文件」**，不在 MCP、检索、通用 agent 工具面。

| 能力面 | teaching chat | temporary chat |
| --- | --- | --- |
| 用户配置 MCP tools（本 ADR） | 按 §5 注入 | **同样注入**（同一 snapshot / 预算 / effect） |
| web_search / web_fetch 等已有 external 工具 | 按既有 readiness | **同样**（不因临时再裁） |
| workspace read / 既有非「教学产物写入」工具 | 按既有 policy | **同样** |
| **教学文件生成**（见下表「教学产物写工具」） | 允许（既有 privileged / writer） | **不注入 / 不可用** |
| LearningSession / outcome settlement 写路径 | 既有 sole-writer | **仍不可用**（临时对话不成为教学真相写口） |

**教学产物写工具（临时 chat 排除清单，Phase C 接线时锁定代码名）：**

- `generate_lesson`（及未来仅服务于 lesson/course 产物落盘的等价 tool）
- 任何「专用于创建/覆盖 Lesson / Course 定义 / 正式 learning record」的 host 触发 tool（若以 model tool 暴露）
- **不是**排除：`write_workspace_file` 的通用工作区写——若 teaching chat 可用，temporary 默认 **同样可用**（仍走 path containment + 审批）；若产品后续要把「写 lesson 路径」从通用 write 中拆出，另开 ADR，不得借「临时」静默扩大或缩小 MCP。

**MCP 特例：** 不存在「temporary 专用 MCP 白名单」；不存在「teaching 才有 MCP」。仅当用户 opt-in 的同一 config 生效。

**Fingerprint：** temporary 与 teaching 可共用同一 MCP snapshot 算法；若某 run 因排除 `generate_lesson` 导致静态 tool 集更小，属 **合法收窄**（ADR-0060 narrowed），不得再额外收窄 MCP 集。


## 6. Effect 映射（冻结默认）

ADR-0127 允许「默认 privileged **或** 拒绝注册」。本 ADR **冻结默认**：

| 情况 | effectClass | permission kind |
| --- | --- | --- |
| 无 override | **`privileged`** | 走 privileged 交互门（与 `ask` 等一致：须审批，不得 full_access 静默当 read） |
| `toolEffectOverrides[rawName]=read` | `read` | 仅当实现侧 **无法证明写/网** 时仍建议保持谨慎；Phase A **允许** override 为 read，但 **web/url 类命名不自动 read** |
| override=`workspace_write` | `workspace_write` | 必须仍做 workspace path containment；MCP handler **不得**自行写盘绕过 `write_workspace_file` 路径——Phase A **推荐禁止** MCP 直写工作区：若 override 为 workspace_write，bridge 仍只把结果当数据返回，**真正写盘**应鼓励模型调内建 `write_workspace_file`。Phase A **硬规则：MCP handler 不执行工作区写**；override=`workspace_write` 仅影响审批文案/策略分类，**不**授予 bridge 写盘。 |
| override=`external_write` | `external_write` | concurrency 硬限制 1；内容标 external untrusted |
| override=`privileged` | `privileged` | 默认同无 override |

### 6.1 `classifyToolEffect` 扩展

今日 `effect-policy.ts` 对未知名返回 `privileged`。MCP 工具名带 `mcp__` 前缀时：

1. 优先查 **运行时映射表**（session-manager 在 list 时写入，`Map<toolName, ToolEffectClass>`）。
2. 映射表未命中 → `privileged`（fail-closed）。
3. **禁止**把映射表持久化为「可被 workspace 篡改」的权威。

实现方式：`classifyToolEffect(toolName, optionalRuntimeMap?)` 或并列 `classifyToolEffectWithMcp(…)`，保持静态内建表不变；`check:tool-contract` 对 **静态** inventory 继续漂移检查，**动态** MCP 工具不进 `TOOL_CONTRACT.md` 闭集表，而在 audit 快照中记录。

### 6.2 TOOL_CONTRACT 动态工具立场

- 静态教学工具：仍维护 `docs/tools/TOOL_CONTRACT.md`。
- 动态 MCP：合同改为「桥接规则」一节（本 ADR + 实现后短文）：命名、默认 privileged、预算、不进 settlement。
- `scripts/check-tool-contract.mjs` **不**要求枚举用户 MCP tools。

## 7. Registry / Dispatcher 接线

### 7.1 注入点

```text
buildDefaultRegistry(settings, …)
  → 静态 tools（现状）
  → if mcpRootEnabled: registry-inject.attachMcpTools(registry, mcpSnapshot)
```

- `mcpSnapshot`：纯数据（definitions + effect map + server health）。
- 每个 MCP `ToolEntry.handler` 只做：校验名 → session-manager.callTool → 字符串化结果（JSON）→ 预算。
- **Permission descriptor**：默认 `kind` 与 effect 对齐：
  - `read` → 可无交互或轻量（与内建 read 一致）
  - `external_write` → `external_network`
  - `workspace_write` / `privileged` → 强制 interactive（不得被 full_access 静默跳过「首次启用 server」之外的 tool 调用——**server 启用 ≠ tool 调用授权**）

### 7.2 Dispatcher

- 不新增平行 dispatcher；MCP 走既有 `dispatch` / batch 路径。
- `external_write` / `privileged` / `workspace_write` 仍 concurrency=1 精神。
- 取消：传播 `AbortSignal` 至 MCP call（能取消则取消，不能则超时）。

### 7.3 tools schema fingerprint（ADR-0060）

- MCP tools **计入** fingerprint。
- Run 内 MCP 表面变化 → 按 0060：`expanded` / `incompatible` fail-closed。
- 合法策略：仅在 **run 开始** 建立含 MCP 的 baseline；中途配置变更忽略直至下一 run。

## 8. IPC 合同（Phase B 冻结 channel 前缀）

前缀：`teach:mcp-*`（并入 teaching IPC 登记，避免平行网关）。

| Channel | 方向 | 作用 |
| --- | --- | --- |
| `teach:mcp-get-config` | invoke | 返回 secret-free 视图（secret 仅显示「已配置」布尔） |
| `teach:mcp-update-config` | invoke | CAS 更新；body 含 `expectedFingerprint` |
| `teach:mcp-test-server` | invoke | 对单 server 试连 + tools/list 摘要（名称/effect/截断标记）；超时/失败稳定错误码 |
| `teach:mcp-list-runtime` | invoke | 当前进程连接态（connected/disabled/error code）；无密钥 |

规则：

- Renderer **永不**获得 secret 明文。
- 无 MCP 专用「执行任意 tool」IPC（防 UI 绕过 agent 审批）；试连只 list，不暴露通用 call。
- Preload 白名单登记；未登记 channel 拒绝。

## 9. Feature registry

在 `src/shared/features.ts` 增加（实现 Phase A/B 时）：

```text
id: user_mcp_servers
stage: experimental   # Phase D 产品 UI 稳定后可升 stable
footprintHint: 4
```

- `mcp_marketplace` 等 **仍在** `FORBIDDEN_FEATURE_IDS`。
- `isFeatureEnabled("user_mcp_servers")` **不**授权连接；仅产品/doctor 元数据。真正门控是 config `enabled` + 实现存在。

## 10. 错误码（稳定、可测）

| code | 含义 |
| --- | --- |
| `mcp_disabled` | 根开关 off |
| `mcp_server_disabled` | server 未启用 |
| `mcp_invalid_config` | 校验失败 |
| `mcp_cas_conflict` | fingerprint 冲突 |
| `mcp_transport_unsupported` | 非本 phase 传输 |
| `mcp_spawn_failed` | stdio 启动失败 |
| `mcp_handshake_failed` | initialize 失败 |
| `mcp_list_failed` | tools/list 失败 |
| `mcp_budget_exceeded` | 预算拒绝注册/截断策略触发 |
| `mcp_tool_not_registered` | 调用未注册名 |
| `mcp_call_failed` | tools/call 失败 |
| `mcp_call_timeout` | 超时 |
| `mcp_server_unavailable` | 崩溃/断开 |
| `mcp_secret_unresolved` | secret ref 无法解析 |
| `mcp_name_conflict` | 与静态工具冲突 |

消息面向用户：中文短句；日志可含 server id，**不含** command 行内 token。

## 11. Settlement / 隐私 / 安全不变量（测试锁定）

1. MCP handler **不** import outcome committer / ledger writer。
2. MCP 结果 **不**自动变 Evidence「已掌握」；最多 conversation tool 轨迹。
3. Fork / replay：`toolsReplayed` 默认 false；不得因 MCP 改为 true。
4. Support-bundle / doctor：command/args 脱敏；secret 永不导出。
5. Workspace untrusted 文件不能打开根 `enabled`。
6. 无 YOLO 文案；总开关和 server 开关单击立即提交，不进行二次确认，也不生成切换成功状态卡；仅错误与显式测试连接反馈使用页面状态。

## 12. 分阶段落地（可分派）

| Phase | 交付 | 合并门槛 |
| --- | --- | --- |
| **A — 纯核心** | `src/shared/mcp/*` + `src/main/mcp/*` stdio + config-store + session-manager + tool-bridge；**无** UI；可选 dev-only 主进程钩子或 unit 用 fake transport | 下表 unit；typecheck；**默认仍 off** |
| **B — IPC** | `teach:mcp-*` channels + preload + secret-free DTO；无完整 Settings UI 可用最小 dev 调用 | IPC contract 测试；安全检查扩展 |
| **C — Registry 注入** | `buildDefaultRegistry` / agent run 接线；fingerprint 含 MCP；**temporary 与 teaching 同 MCP 注入**；临时仅排除教学产物写工具 | tool-dispatcher unit + schema guard unit |
| **D — Settings UI** | 列表 + 详细添加/编辑页；Name/Scope；Form/JSON；stdio / Streamable HTTP / SSE；单击开关；显式试连 | i18n；无 marketplace；默认 off 可见；无二次确认/切换成功卡 |
| **E — Doctor / bundle** | facts + redact | support-bundle 脱敏测试 |
| **F — SSE/HTTP** | 官方 SDK remote transports + URL/header/timeout 规则 | 已完成；定向 config/session unit |

**产品「已上线」声明** 至少要求 **A+B+C+D** 完成且默认 off 的验收通过。

### 12.1 Phase A 最低 unit 清单

- config parse：默认 off；坏版本拒绝；secret 键名禁明文
- tool-name 编解码 / 冲突
- effect-map 默认 privileged + override
- fake transport：list 预算截断；call 超时；disable 后零工具
- bridge 不调用 ledger/outcome（依赖图或 mock 断言）
- CAS 冲突

### 12.2 命令

```bash
pnpm typecheck
pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts
pnpm run check:security
pnpm run check:tool-contract
```

（测试文件名实现时可调整，但须可从本 ADR 追溯。）

## 13. 与 ADR-0127 的关系

| 0127 | 0128 |
| --- | --- |
| 允许用户配置 MCP 的政策 | 可编码的合同与 phase |
| 威胁模型 | 映射为错误码、消毒、预算、测试 |
| 实现门槛列表 | 本 ADR §12 满足后即视为门槛解锁对应 phase |
| 不授权无合同实现 | 本 ADR **授权**按 phase 合并符合合同的代码 |

冲突时：**安全不变量**以 0127+0128 共同为准；字段名以 **0128** 为准。

## 14. 明确不包含 / non-claims

1. 生产 MCP 代码按本 ADR 分布在 `src/shared/mcp/*`、`src/main/mcp/*`、IPC/preload 与 renderer Settings 模块；本 ADR 文档本身不改变运行时。
2. 不开放 marketplace / 远程目录。
3. 不把 stdio MCP 称为 OS sandbox。
4. 不授权 MCP 直写 teaching ledger/outcome。
5. 不授权 temporary-chat **独享**或 **额外裁掉** MCP；临时与教学共享 MCP。不授权 temporary-chat 获得教学产物写工具（`generate_lesson` 等）。
6. 不授权 product `autoDrain: true`、C-6 destructive memory migration。
7. 不保证兼容所有第三方 MCP 方言；未知 capability **忽略**，tools 以 list 为准。
8. 不在默认 CI 烧真实外部 MCP 网络（unit 用 fake transport）。

## 15. 后果

1. A–F 已交付；后续修改应保持通用 MCP 客户端配置习惯，不为同类能力增加产品差异化阻力。
2. Settings 可描述“添加并启用 MCP”；必须同时保留默认 off、无 auto-connect 与 effect/approval 边界。
3. 历史 ADR 中「不引入 MCP」复读句与 0127/0128 冲突时，以 **0127+0128 + AGENTS/SECURITY** 为准。
4. 回滚：根 `enabled:false` 为运行时总闸；删除 `src/main/mcp` 为代码回滚单位。

---

**一句话：** 用户 MCP = userData 权威配置 + user/workspace scope + 默认 off + stdio / Streamable HTTP / SSE + Form/JSON + `mcp__server__tool` + 默认 `privileged` + 既有 dispatcher；开关单击即提交、无二次确认和切换成功卡，marketplace、自动连接与 settlement 旁路仍禁止。
