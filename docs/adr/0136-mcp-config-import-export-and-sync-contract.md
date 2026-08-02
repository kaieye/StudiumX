# ADR-0136：MCP 配置 Import / Export / Migration 与 McpSync 合同 — Phase D 实现合同

- **状态：** 已实施（ADR-0132 Phase D implementation addendum；仅授权本 phase）
- **日期：** 2026-07-23
- **范围：** 批量 MCP 配置导入预览、确认后写入 canonical user config、脱敏导出、legacy 形状解析与 migration report、以及未来跨端 `McpSync` 的共享 wire 合同（本 phase **不**实现网络同步）。
- **相关：** ADR-0127、ADR-0128、ADR-0132、ADR-0133、ADR-0134、ADR-0135、Zcode MCP 对齐历史研究（已结项）、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`。

## 1. 决定与非目标

Phase D 把外部 MCP 配置变成**用户可控的草稿**，经逐项预览与确认后，才通过既有 `mcpUpdateConfig` / CAS `expectedFingerprint` 路径写入 `UserMcpConfigV1`。导入本身**不**连接 server、**不**启动 stdio、**不**打开 OAuth、**不**改 effect lattice、settlement 或 ToolOutcome。

本 phase **明确不交付**：

1. 多来源 precedence（CLI/env/workspace/plugin）与 effective-config 合并；
2. auto-connect / 后台重连；
3. marketplace / plugin install；
4. workspace-root 注入；
5. 任何跨设备网络 sync 客户端（仅冻结 shared wire 类型）；
6. 就地改写/删除用户磁盘上的第三方配置文件。

## 2. 支持的导入形状

解析入口接受 JSON 文本（Settings 粘贴或本地文件内容）。识别顺序固定、fail-closed：

| Shape id | 识别条件 | 说明 |
| --- | --- | --- |
| `studiumx_user_mcp_v1` | 顶层 `schemaVersion === 1` 且存在 `servers` 数组 | StudiumX 规范文档（含 public 或 durable 形）；secret ref 值不回显为明文 |
| `claude_cursor_mcpServers` | 顶层 `mcpServers` 为对象 map | Claude Desktop / Cursor 常见 `{ "name": { command\|url, ... } }` |
| `mcp_servers_nested` | 顶层 `mcp.servers` 为对象 map 或数组 | 部分工具使用的嵌套形态 |
| `unsupported` | 无法识别 | 返回错误；不部分写入 |

单 server 对象（含 `command`/`url`/`type`/`transport`）也可作为 map 的一项被 bulk 解析器复用；与编辑器既有 `jsonToDraftMcpServer` 语义对齐：`streamableHttp` → `http`。

字段映射（外部 → 草稿）：

- `type` / `transport`：`stdio` \| `http` \| `sse`（`streamableHttp` → `http`）
- `command` / `args` / `cwd` / `env`：stdio
- `url` / `headers`：http/sse
- `timeout` / `timeoutMs`：可选正整数毫秒
- `enabled`：缺省 `true`（仍受 root `enabled` 与手动试连约束）
- `oauth`：仅 public endpoints/clientId/scopes/resource；**拒绝** client_secret / token 字段进入草稿
- server id：优先外部 key；非法 id 则 slugify label；与现有 id 冲突时生成唯一候选并记 conflict

未知顶层字段忽略（不 fail）；畸形 server 记入 report warnings 并跳过该项，不中止整批可解析项。

## 3. 导入生命周期：草稿 → 确认 → CAS

```text
parse JSON → ImportPreview (drafts + risks + report skeleton)
  → user selects subset
  → client merges into current public drafts
  → mcpUpdateConfig(expectedFingerprint, config, secretChanges?)
  → main parseUserMcpConfig + secret merge + CAS write
```

不变量：

1. **导入永不直接写盘**；无新的 main IPC 专门 “import apply”。
2. 确认前 UI 可展示 command/url/风险徽章；**不**调用 `mcpTestServer` / authorize。
3. Secret 形 key（`api_key`/`token`/`secret`/`password`/`authorization` 等）在预览中可标 `secret_present`；用户确认后走既有 `secretChanges` + `safeStorage` 路径，renderer 永不回读明文。
4. 导入的 server 默认 **enabled 可由源决定，但 root MCP 开关不因导入自动打开**；不 auto-connect。
5. id 冲突：默认生成唯一 `proposedId` 并记 conflict；用户可取消该项。本 phase 不提供静默 overwrite。

## 4. 导出与脱敏

导出输入为 renderer 可见的 `UserMcpConfigPublicV1`（或等价 public servers 列表）。输出 JSON 为稳定、可再导入的 **redacted export document**：

```json
{
  "schemaVersion": 1,
  "enabled": false,
  "servers": [ /* public fields only */ ],
  "export": {
    "kind": "studiumx_mcp_export",
    "contractVersion": 1,
    "exportedAt": "ISO-8601",
    "secretsRedacted": true
  }
}
```

脱敏规则：

1. `env` / `headers` 中已配置 secret 的 key 使用占位符 `<configured>` 或**省略值**（实现固定一种；默认省略 secret keys 的明文，仅保留 key 列表于 `envSecretKeys` / `headersSecretKeys` 可选字段，或统一用 Claude 兼容 map 时写 `"<configured>"`）。
2. **永不**包含 OAuth access/refresh token、PKCE verifier、authorization code、deep-link 全文。
3. OAuth **public** config（endpoint、clientId、scopes、resource）可导出。
4. 不包含 `fingerprint`（避免跨设备 CAS 误用）；不包含 secret ref ids。
5. 导出文件可再经 import 解析为 `studiumx_user_mcp_v1` 或兼容 map。

## 5. Migration report

每次 parse 与每次确认 merge 产生可审计、**无 secret 值** 的 report：

```ts
type McpMigrationReport = {
  sourceShape: McpImportSourceShape
  parsedCount: number
  skippedCount: number
  conflictCount: number
  warningCount: number
  selectedCount?: number
  importedCount?: number
  warnings: readonly string[] // bounded, no values
  conflicts: readonly { sourceKey: string; proposedId: string; existingId: string }[]
  preservedOriginalFiles: true
}
```

规则：

1. 绝不 in-place 删除或覆写用户提供的源文件；app 只读其内容。
2. warnings 仅含字段路径/原因码级摘要，不含 env/header/url query secret。
3. Doctor / support bundle 若未来引用 report，同样只投影计数与 shape id。

## 6. McpSync wire（未来就绪）

共享类型冻结 `contractVersion: 1`，即使本 phase 无网络：

```ts
type McpSyncEnvelopeV1 = {
  contractVersion: 1
  kind: 'mcp_sync_export' | 'mcp_sync_offer' | 'mcp_sync_conflict'
  exportedAt: string
  /** Always secret-free / token-free. */
  payload: McpSyncPayloadV1
}

type McpSyncPayloadV1 = {
  enabled: boolean
  servers: readonly McpSyncServerV1[] // redacted public fields only
}

type McpSyncConflictV1 = {
  serverId: string
  reason: 'id_collision' | 'fingerprint_mismatch' | 'schema_unsupported'
}
```

冲突不得静默覆盖 local user config；应用方必须用户确认。本 phase 仅 export/import 本地文件/粘贴可选用 envelope 包装；无 sync channel IPC。

## 7. IPC / UI

- **优先复用** `teach:mcp-get-config` / `teach:mcp-update-config`。
- 文件选择在 renderer 使用 `<input type="file">` 读文本；无需 main 文件 dialog IPC。
- 若未来需要 main 侧 userData bulk migrate，须另开窄 IPC 且 secret-free、列入 teaching-ipc-contract；**本 phase 不新增**。

Settings：Import（粘贴/选文件）→ 预览列表（多选 + risk badges）→ Confirm；Export → 下载/复制 redacted JSON。

## 8. 安全与教学不变量

1. secret-free IPC 与 public DTO 边界不变。
2. 无 auto-connect、无 marketplace、无 workspace-root 注入。
3. settlement sole-writer、`expectedRevision`、fork `toolsReplayed:false` 不变。
4. import-export 模块为 pure shared（可在 renderer 使用）；不 import ledger/outcome writer。
5. 导入不扩大 tool effect；远端 annotations 不降权。

## 9. 验收

至少覆盖：

1. 三种导入形状解析与 unsupported fail-closed；
2. secret 出现时 risk flag；export 无明文 secret / 无 OAuth token；
3. id 冲突与 draft 选择合并；
4. 确认路径仅通过 updateConfig CAS；
5. migration report 计数与 `preservedOriginalFiles: true`；
6. McpSync 类型可序列化且不含 secret 字段名约定。

最低验证：

```bash
pnpm exec vitest run --project unit tests/unit/mcp-import-export.unit.test.ts
pnpm exec vitest run --project unit tests/unit/user-mcp-settings-section.unit.test.tsx
```

## 10. 实现锚点

```text
docs/adr/0136-mcp-config-import-export-and-sync-contract.md
src/shared/mcp/import-export.ts
src/shared/mcp/index.ts
src/renderer/.../UserMcpSettingsSection.tsx (+ model helpers as needed)
tests/unit/mcp-import-export.unit.test.ts
```
