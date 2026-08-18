# ADR-0136：MCP 配置 Import / Export / Migration 与 McpSync 合同 — Phase D 实现合同

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-23
- **范围：** 批量 MCP 配置导入预览、确认后写入 canonical user config、脱敏导出、legacy 形状解析与 migration report、以及未来跨端 `McpSync` 的共享 wire 合同（本 phase **不**实现网络同步）（ADR-0132 Phase D implementation addendum）。
- **取代：** 无
- **被取代：** 无
- **相关：** ADR-0127、ADR-0128、ADR-0132、ADR-0133、ADR-0134、ADR-0135、ADR-0137–0140、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`
- **证据：** `src/shared/mcp/import-export.ts`、`src/shared/mcp/index.ts`、`src/renderer/src/views/settings/sections/UserMcpSettingsSection.tsx`、`tests/unit/mcp-import-export.unit.test.ts`、`tests/unit/user-mcp-settings-section.unit.test.tsx`；wire 类型明细见 `docs/adr/evidence/ADR-0136.md`。

## 背景

Phase D 把外部 MCP 配置变成**用户可控的草稿**，经逐项预览与确认后，才通过既有 `mcpUpdateConfig` / CAS `expectedFingerprint` 路径写入 `UserMcpConfigV1`。导入本身**不**连接 server、**不**启动 stdio、**不**打开 OAuth、**不**改 effect lattice、settlement 或 ToolOutcome。

## 决定

1. **支持的导入形状（fail-closed）：** 解析入口接受 JSON 文本，识别顺序固定：`studiumx_user_mcp_v1`（`schemaVersion === 1` 且存在 `servers` 数组）、`claude_cursor_mcpServers`（顶层 `mcpServers` 对象 map）、`mcp_servers_nested`（顶层 `mcp.servers` 对象 map/数组）、`unsupported`（报错、不部分写入）。单 server 对象（`command`/`url`/`type`/`transport`）可被 bulk 解析器复用；与编辑器既有 `jsonToDraftMcpServer` 对齐（`streamableHttp` → `http`）。字段映射：`type`/`transport`（stdio/http/sse）、`command`/`args`/`cwd`/`env`（stdio）、`url`/`headers`（http/sse）、`timeout`/`timeoutMs`（可选正整数）、`enabled`（缺省 true，仍受 root `enabled` 与手动试连约束）、`oauth`（仅 public endpoints/clientId/scopes/resource，**拒绝** client_secret/token 字段进草稿）；server id 优先外部 key、非法则 slugify label、冲突生成唯一候选并记 conflict。未知顶层字段忽略；畸形 server 记 warning 并跳过该项，不中止整批可解析项。
2. **导入生命周期（草稿 → 确认 → CAS）：** parse JSON → ImportPreview（drafts + risks + report skeleton）→ 用户选择子集 → 客户端合并进当前 public drafts → `mcpUpdateConfig(expectedFingerprint, config, secretChanges?)` → main parseUserMcpConfig + secret merge + CAS write。不变量：导入**永不直接写盘**，无新的 main IPC 专门“import apply”；确认前 UI 展示 command/url/风险徽章但**不**调用 `mcpTestServer` / authorize；secret 形 key（`api_key`/`token`/`secret`/`password`/`authorization` 等）预览标 `secret_present`，确认后走既有 `secretChanges` + `safeStorage` 路径，renderer 永不回读明文；导入的 server 默认 enabled 可由源决定，但 root MCP 开关不因导入自动打开；id 冲突默认生成唯一 `proposedId` 并记 conflict，本 phase 不提供静默 overwrite。
3. **导出与脱敏：** 输出稳定、可再导入的 **redacted export document**（`schemaVersion: 1`、`enabled: false`、servers public fields only、`export.kind: studiumx_mcp_export`、`secretsRedacted: true`）。`env`/`headers` 中已配置 secret 的 key 用占位符 `<configured>` 或省略值（仅保留 key 列表）；**永不**包含 OAuth access/refresh token、PKCE verifier、authorization code、deep-link 全文；OAuth **public** config（endpoint、clientId、scopes、resource）可导出；不包含 `fingerprint`（避免跨设备 CAS 误用）与 secret ref ids。导出文件可再经 import 解析。
4. **Migration report：** 每次 parse 与每次确认 merge 产生可审计、**无 secret 值** 的 `McpMigrationReport`（sourceShape、parsed/skipped/conflict/warning/selected/imported counts、bounded warnings、conflicts、`preservedOriginalFiles: true`）。绝不 in-place 删除或覆写用户提供的源文件；app 只读其内容。warnings 仅含字段路径/原因码级摘要，不含 env/header/url query secret；Doctor / support bundle 若引用 report 同样只投影计数与 shape id。
5. **McpSync wire（未来就绪）：** 共享类型冻结 `contractVersion: 1`，即使本 phase 无网络（envelope kind `mcp_sync_export` / `mcp_sync_offer` / `mcp_sync_conflict`；payload 为 secret-free redacted servers）。冲突不得静默覆盖 local user config；应用方必须用户确认。本 phase 仅 export/import 本地文件/粘贴可选用 envelope 包装；无 sync channel IPC。
6. **IPC / UI：** 优先复用 `teach:mcp-get-config` / `teach:mcp-update-config`；文件选择在 renderer 使用 `<input type="file">` 读文本，无需 main file dialog IPC；若未来需要 main 侧 userData bulk migrate，须另开窄 IPC 且 secret-free、列入 teaching-ipc-contract，本 phase 不新增。Settings：Import（粘贴/选文件）→ 预览列表（多选 + risk badges）→ Confirm；Export → 下载/复制 redacted JSON。

## 不变量

1. secret-free IPC 与 public DTO 边界不变。
2. 无 auto-connect、无 marketplace、无 workspace-root 注入。
3. settlement sole-writer、`expectedRevision`、fork `toolsReplayed:false` 不变。
4. import-export 模块为 pure shared（可在 renderer 使用）；不 import ledger/outcome writer。
5. 导入不扩大 tool effect；远端 annotations 不降权。

## 后果

- 落地于 `src/shared/mcp/import-export.ts` 与 `UserMcpSettingsSection`；`McpSync` 仅为共享 wire 类型，无网络客户端。
- 回滚：移除 import-export 模块即回到仅编辑器手填；已导入 server 仍为普通 user config，root 开关可关。

## 验证

- unit 覆盖：三种导入形状解析与 unsupported fail-closed；secret 出现时 risk flag；export 无明文 secret / 无 OAuth token；id 冲突与 draft 选择合并；确认路径仅通过 updateConfig CAS；migration report 计数与 `preservedOriginalFiles: true`；McpSync 类型可序列化且不含 secret 字段。
- 门禁：`pnpm exec vitest run --project unit tests/unit/mcp-import-export.unit.test.ts`、`pnpm exec vitest run --project unit tests/unit/user-mcp-settings-section.unit.test.tsx`、`pnpm typecheck`、`pnpm run check:security`、`pnpm run check:tool-contract`、`pnpm run check:teaching-evidence`。
- 详细 wire 类型、字段映射与导出 JSON 示例：`docs/adr/evidence/ADR-0136.md`。

## 非目标

1. 不交付多来源 precedence（CLI/env/workspace/plugin）与 effective-config 合并。
2. 不交付 auto-connect / 后台重连。
3. 不交付 marketplace / plugin install、workspace-root 注入。
4. 不实现任何跨设备网络 sync 客户端（仅冻结 shared wire 类型）。
5. 不就地改写/删除用户磁盘上的第三方配置文件。
