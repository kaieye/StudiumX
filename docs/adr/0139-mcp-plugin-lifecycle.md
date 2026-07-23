# ADR-0139：MCP Plugin-provided servers lifecycle foundation — Phase G 实现合同

- **状态：** 已实施 foundation；**插件安装后自动注册/连接由 [ADR-0141](0141-mcp-product-experience-parity-policy.md) 允许**；仍无 jiti/code-mode
- **日期：** 2026-07-23
- **范围：** plugin manifest 可声明的 MCP servers、稳定 namespace id、allowlist 模板展开、in-memory plugin MCP registry（trust 分层）、卸载/撤销清理钩子。
- **相关：** ADR-0042、ADR-0127、ADR-0128、ADR-0132 §2.6 / Phase G、ADR-0137（plugin 层可作只读 source）、ADR-0140、`SECURITY.md`。

## 1. 决定与非目标

Phase G foundation 把 “plugin 声明的 MCP” 从字符串草稿提升为可审计 lifecycle：

1. 解析 plugin 声明片段（stdio/http/sse **public** 字段）；
2. 稳定 namespace：`plugin_<pluginSlug>_<serverSlug>`（合法 id charset）；
3. 模板变量 **仅** allowlist：`pluginRoot`、`userHome`（可选）；拒绝 `${env.*}` / 任意 shell；
4. trust 状态：`declared | verified | trusted | revoked`；**trusted 可默认进入 connect 候选**（ADR-0141）；tools/call 仍须 effect/审批；
5. unregister/revoke 时通过钩子 drop sessions / forget OAuth tokens / 清理 scoped artifacts。

本 phase **明确不交付**：

1. 远程 marketplace 下载或自动更新（见 ADR-0140）；
2. 插件代码执行（jiti / code-mode / 任意 require）；
3. auto-connect 默认开启；
4. 远端 signature 根证书分发；
5. 完整 Extension 安装 UI。

## 2. Id namespace

| 输入 | 规则 |
| --- | --- |
| pluginId / serverId | 先 lower-case，非 `[a-z0-9_-]` 替换为 `_`，压缩连续 `_`，trim `_` |
| 合成 id | `plugin_${pluginSlug}_${serverSlug}`，再截断到 64 字符且匹配 `^[a-z][a-z0-9_-]{0,63}$`；若首字符非法则前缀 `p` |

冲突时 registry 拒绝第二次 register（fail-closed）。

## 3. Trust 与四层授权

与 ADR-0132 一致：`declared` 仅可见；`verified` 表示本地 manifest/hash 检查通过（本 phase 可由调用方标记）；`trusted` 表示用户允许将其作为 **配置来源候选**；connect / tool call 仍走既有路径。

## 4. 模板

展开发生在 **已 verified/trusted** 且提供 `PluginMcpTemplateContext` 时：

- 允许：`{{pluginRoot}}`、`{{userHome}}`
- 拒绝：任何其它 `{{...}}` 或 `$` 插值 → 该项 server 跳过并 warning

## 5. 模块锚点

```text
docs/adr/0139-mcp-plugin-lifecycle.md
src/shared/mcp/plugin-types.ts
src/main/mcp/plugin-mcp-registry.ts
src/main/mcp/plugin-mcp-bootstrap.ts
tests/unit/mcp-plugin-lifecycle.unit.test.ts
tests/unit/mcp-plugin-bootstrap.unit.test.ts
```

### 5.1 Product wiring note (ADR-0141)

Full **Extension install/uninstall** pipeline is still thin (ADR-0042 is types-only;
no main-process extension host). Product lifecycle is therefore:

1. `plugin-mcp-bootstrap.ts` fail-soft scans:
   - `resources/builtin-mcp-plugins` (and `process.resourcesPath` twin) → trust `trusted`
   - `~/.studiumx/plugins`, `<userData>/plugins`, optional `McpHostOptions.pluginScanRoots`
     → parse OK → `verified` then auto-`trusted` for local filesystem packs
2. `McpHost.start()` calls bootstrap, then `applyEffectiveConfig` so
   `pluginRegistry.toPluginSourceServers()` feeds the Phase E plugin layer.
3. Uninstall hook surface: `McpHost.unregisterPluginMcp(pluginId)` /
   `PluginMcpRegistry.unregisterPlugin` (marketplace `onUninstall` still keys by
   marketplace entryId; map to pluginId when install records carry one).

## 6. 不变量

settlement sole-writer、secret-free IPC、remote annotations 不降权、`toolsReplayed:false`、无默认 remote telemetry。
