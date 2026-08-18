# ADR-0137：MCP 多来源 precedence 与受控 auto-connect — Phase E 实现合同

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-23
- **范围：** 多来源 MCP 配置解析（CLI/session → environment → user → workspace → plugin → system）、winner/shadowed 投影、workspace 只读文件与可选 env 文档加载、以及全局 `autoConnect` 受控发现连接（ADR-0132 Phase E implementation addendum）。
- **取代：** 无
- **被取代：** 部分被 [ADR-0141](0141-mcp-product-experience-parity-policy.md)（默认体验：auto-connect 可随根开关默认开启、允许冷启动/workspace 自动连接）修订。
- **相关：** ADR-0127、ADR-0128、ADR-0132、ADR-0133、ADR-0134、ADR-0135、ADR-0136、ADR-0138–0140、ADR-0141、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`
- **证据：** `src/shared/mcp/source-resolver.ts`、`src/shared/mcp/source-types.ts`、`src/main/mcp/source-loaders.ts`、`src/main/mcp/host.ts`、`tests/unit/mcp-source-resolver.unit.test.ts`；模块锚点与验收明细见 `docs/adr/evidence/ADR-0137.md`。

## 背景

Phase E 把“用户 userData 唯一权威”扩展为**可解析的多来源 effective 视图**，同时：

1. **userData 仍是唯一 durable 写权威**（CAS / secret merge / import 确认写入路径不变）；
2. workspace / env / CLI 层为**只读输入**，永不就地改写源文件；
3. **root MCP 出厂默认仍可为 off**（首次安装零连接）；用户打开 root 后，**产品目标为默认自动连接已启用 server**（ADR-0141）；`autoConnect` 为可关闭偏好；
4. auto-connect **只**做 transport initialize + tools/list 发现，**永不** tools/call。

## 决定

1. **Precedence（高 → 低）：** CLI / session override → environment → user configuration（userData canonical）→ workspace configuration → plugin / marketplace-provided（E 中仅 stub）→ system defaults。数值 rank 见 `MCP_CONFIG_SOURCE_PRECEDENCE`（cli=0 … system=5）。
2. **同名 server 合并：** 更高 precedence 源的完整 `UserMcpServerV1` 记录获胜；败者进入 `shadowed[]`（`reason: 'id_collision'`，保留完整 record 与双方 origin 供 Settings/Doctor 展示）；层内重复 id fail-soft（跳过后续项记 warning，不中止其它 id）；不做字段级 partial merge。
3. **Root 开关与 autoConnect：** `enabled`（root）**仅 user gate**（durable `UserMcpConfigV1.enabled`），workspace/env **不能**强制打开 root；`autoConnect` **仅 user gate**，政策目标（ADR-0141）：根开启后默认倾向自动连接，实现可保留缺省 false 的兼容读并迁移/UI 默认推荐 true；单 server `enabled` 取胜者记录上的值。
4. **Workspace 只读路径（v1）：** 相对当前 workspace root（canonicalize 后）读取，**不**目录向上 walk（E 不做 parent inheritance）：`.agents/mcp.json`、`mcp.json`（workspace root）、`zcode.json` 可选键 `mcpServers`（仅该对象 map，其它键忽略）。解析复用 ADR-0136 形状识别；畸形文件 fail-closed（该文件 servers 空 + warning），不污染其它层；**永不写入**这些路径。
5. **Environment / CLI：** `STUDIUMX_MCP_CONFIG_JSON`（完整 JSON 文档，与 import 形状相同；空/未设置→无 env 层）；CLI 层用 `STUDIUMX_MCP_CLI_JSON`（与 import 同形状）或 `McpHost`/`loadMcpSourceLayers` 的 `cliServers`/`setCliServers`（最高 precedence）。v1 **不**支持逐 server 拆分的多个 env 变量。
6. **Auto-connect 合同：** 资格需全部满足：`userGate.enabled === true`、`userGate.autoConnect === true`、effective server `enabled === true`、workspace scope 匹配、OAuth（非 stdio）ready（否则跳过——不阻塞其它 server、不打开 browser）。行为：仅 `initialize` + tools/list（等价 testServer/refreshServer 发现路径）；**禁止** tools/call 与 artifact 写入作为 auto-connect 副作用；**无**无限 retry（失败记 runtime error/failed，下次仅由用户 refresh、`autoConnectNow` 或 run `buildSnapshot` 再试）；并发上限默认 `DEFAULT_MAX_AUTO_CONNECT = 4`。触发：`McpHost.autoConnectNow(workspaceRoot?)` 显式 API（gate 未开则 no-op）；**不**在 `McpHost.start()` 无条件调用；推荐在 Settings 打开 root+autoConnect 后的 config apply 路径及 workspace 激活钩子（仅当 gate 为 true）调用。**冷启动 / workspace 激活的受控自动连接已由 ADR-0141 允许。**

## 不变量

1. Settlement sole-writer；MCP 不 import ledger / outcome committer。
2. Secret / OAuth token 永不进 renderer / logs / Doctor；workspace 层 ephemeral secret 仅 main 内存，public 投影脱敏。
3. Remote `readOnlyHint` 不降权 effect。
4. MCP result ≠ teaching evidence。
5. `toolsReplayed:false` / `expectedRevision` 不变。
6. Root 默认 off；autoConnect 默认 false（兼容读）。
7. 无 marketplace、无网络 sync、无 untrusted download。

## 后果

- 落地于 `source-resolver` / `source-loaders` / `host.autoConnectNow` 与 plugin 层 stub；root 默认 off 保证首次安装零连接。
- 回滚：user-only resolve 与旧行为 server 列表一致；关闭 root/autoConnect 即回 v1 行为；workspace/env/CLI 层不写入源文件。

## 验证

- unit 覆盖：precedence cli > env > user > workspace > plugin > system；同 id winner 全记录、loser 在 shadowed；root enabled / autoConnect 仅来自 user gate；autoConnect 缺省 false 且仅 gate 全开时 eligible 非空；OAuth 未 ready 的 server 被 skip；user-only resolve 与旧行为 server 列表一致；加载器对坏 JSON fail-closed。
- 门禁：`pnpm exec vitest run --project unit tests/unit/mcp-source-resolver.unit.test.ts`、`pnpm typecheck`、`pnpm run check:security`、`pnpm run check:tool-contract`、`pnpm run check:teaching-evidence`。
- 模块锚点与验收明细：`docs/adr/evidence/ADR-0137.md`。

## 非目标

1. 不交付 workspace-root 注入（Phase F）、plugin 真实来源（Phase G）、marketplace（Phase H）。
2. 不实现网络 McpSync 客户端。
3. 不启动无限 retry / 自主 reconnect loop。
4. auto-connect 不自动执行 tools/call 副作用。