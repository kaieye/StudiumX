# ADR-0138：MCP Filesystem Workspace-Root Injection — Phase F 实现合同

- **状态：** 已实施（ADR-0132 Phase F implementation addendum；仅本 phase 范围）；体验默认见 [ADR-0141](0141-mcp-product-experience-parity-policy.md)（filesystem 类可默认 granted）
- **日期：** 2026-07-23
- **范围：** 受控 stdio filesystem MCP 的 **显式授权** workspace-root 参数注入；canonical path / 作用域 containment；session 在 workspace 切换时重建；Doctor/runtime 仅暴露 secret-free effective args。
- **相关：** ADR-0128、ADR-0132、ADR-0133、ADR-0134、ADR-0135、ADR-0136、`docs/improvements/mcp-zcode-alignment-target.md`、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`。

## 1. 决定与边界

默认 **不** 向任何 MCP server 注入当前工作区根路径。仅当用户在该 server 配置上显式授予 `workspaceRootInjection: 'granted'`，且 runtime 提供非空 `activeWorkspaceRoot` 时，stdio transport 可在 spawn 参数中 **至多追加一次** 规范化后的绝对路径。

本 phase **不**交付：

- marketplace / auto-connect / 多来源 precedence（Phase E/H）；
- 基于命令名/标签模糊识别后的自动注入；
- http/sse URL 或 header 注入；
- secret / OAuth token 注入；
- 绕过 `write_workspace_file`、effect lattice、approval 或 settlement；
- symlink 逃逸到授权根之外的 FS capability（注入只提供路径字符串；server 自身 FS 策略不由本 ADR 扩权）。

## 2. 配置模型（向后兼容）

在 `UserMcpServerV1` / `UserMcpServerPublicV1` 增加可选字段（缺省 = 关闭）：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `workspaceRootInjection` | `'off' \| 'granted'` | `'off'` | 显式用户授权；`'off'` 与缺省行为相同 |
| `injectionIdentity` | `'filesystem_mcp' \| 'generic' \| null` | `null` | 用户声明的策略身份标签；**不**单独授权注入；供后续 allowlist / UI 使用 |

解析规则（`config-schema.ts`）：

- 未知值 fail-closed 为 parse error（不静默降级为 off，避免“以为开了其实没开”的反向；缺省/省略则 off）；
- 非 stdio transport 允许存字段但 runtime **永不**注入；
- 公共投影与 fingerprint 包含上述 secret-free 字段。

## 3. 注入解析（纯函数）

`src/main/mcp/workspace-root-injection.ts`：

```ts
resolveInjectedStdioServer(
  server: UserMcpServerV1,
  activeWorkspaceRoot: string | null | undefined
): {
  server: UserMcpServerV1
  injected: boolean
  effectiveArgs: readonly string[]
  reason?: string
}
```

硬规则：

1. 仅 `transport === 'stdio'`；否则 `injected: false`，`reason: 'not_stdio'`。
2. 仅 `workspaceRootInjection === 'granted'`；否则 `reason: 'not_granted'`。
3. `activeWorkspaceRoot` 经 `path.resolve` 后必须为绝对路径且非空；否则 `reason: 'no_active_root'` / `not_absolute`。
4. `scope === 'workspace'` 时：规范化后的 active root 必须与 `server.workspaceRoot` 在 containment 语义下匹配（win32 用 lower-case 比较；要求 active 等于 bound root 或位于其下）。不匹配 → `reason: 'workspace_scope_mismatch'`，不注入。
5. 将规范化 active root **追加**到 `args` **一次**，当且仅当 `args` 中尚无 **完全相等** 的 path segment（规范化后比较；win32 不区分大小写）。
6. 返回的 `server` 为 `{ ...input, args: effectiveArgs }`，**不**改写 command/cwd/env/secrets。
7. 永不读取或拼接 secret env / headers。

## 4. Session / transport 接线

- 在 `McpSessionManager.ensureSession` 创建 transport **之前**调用 `resolveInjectedStdioServer`。
- `buildSnapshot` / `testServer` / `refreshServer` 已有的 `workspaceRoot` 参数作为 `activeWorkspaceRoot` 传入。
- `LiveSession` 记录创建时用于注入的规范化 root（或 `null`）；若后续 ensure 时 injection root 变化，先 drop 再重建（workspace switch）。
- `hasSameSessionDefinition` 纳入 `workspaceRootInjection` 与 `injectionIdentity`，配置变更时重建 session。
- `createTransport` 收到的 server 使用 **effectiveArgs**；session 内用于 CAS/定义比较的权威 server 仍以配置文档为准（注入后的 args 不写回 config store）。

## 5. Settings / i18n

stdio server 编辑器提供最小开关：允许注入当前工作区根路径（`workspaceRootInjection`）。`injectionIdentity` 可选；至少保证 form/JSON 模型字段可读写。文案键：`mcp.servers.workspaceRootInjection` 等（en-US / zh-CN）。

## 6. 安全与非目标

- 注入路径字符串 **不是** 写权限；MCP 工具仍默认 privileged，走既有 effect / approval。
- 不替代 `write_workspace_file` 或 settlement writer。
- Doctor/runtime 若展示 effective command line，必须走既有 redact 路径，不含 secrets。
- 不实现 marketplace identity 自动 trust。

## 7. 验收与测试

`tests/unit/mcp-workspace-root-injection.unit.test.ts` 至少覆盖：

1. 默认 off / 非 stdio / 空 active root → 不注入；
2. granted + stdio + absolute root → 追加一次；
3. args 已含相同 path segment → 不重复追加；
4. workspace scope mismatch → 不注入；
5. win32 风格大小写规范化比较（在 platform 条件或纯 normalize 辅助上覆盖）；
6. http/sse 永不注入。

最低验证：

```bash
pnpm exec vitest run --project unit tests/unit/mcp-workspace-root-injection.unit.test.ts
```

## 8. 一句话

Phase F 在显式用户授权下，向 stdio MCP spawn args 安全地注入一次规范化的当前工作区根；默认关闭，不绕过 effect/settlement，不根据模糊身份自动注入。
