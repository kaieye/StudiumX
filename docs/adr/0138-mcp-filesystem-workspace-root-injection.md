# ADR-0138：MCP Filesystem Workspace-Root Injection — Phase F 实现合同

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-23
- **范围：** 受控 stdio filesystem MCP 的**显式授权** workspace-root 参数注入；canonical path / 作用域 containment；session 在 workspace 切换时重建；Doctor/runtime 仅暴露 secret-free effective args（ADR-0132 Phase F implementation addendum）。
- **取代：** 无
- **被取代：** 部分被 [ADR-0141](0141-mcp-product-experience-parity-policy.md)（体验默认：filesystem 类可默认 granted，用户可关）修订。
- **相关：** ADR-0128、ADR-0132、ADR-0133–0137、ADR-0139、ADR-0140、ADR-0141、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`
- **证据：** `src/main/mcp/workspace-root-injection.ts`、`src/shared/mcp/config-schema.ts`、`src/shared/mcp/filesystem-mcp-defaults.ts`、`tests/unit/mcp-workspace-root-injection.unit.test.ts`；解析规则明细见 `docs/adr/evidence/ADR-0138.md`。

## 背景

默认**不**向任何 MCP server 注入当前工作区根路径。仅当用户在该 server 配置上显式授予 `workspaceRootInjection: 'granted'`，且 runtime 提供非空 `activeWorkspaceRoot` 时，stdio transport 可在 spawn 参数中**至多追加一次**规范化后的绝对路径。体验默认见 ADR-0141（filesystem 类可默认 granted）。

## 决定

1. **配置模型（向后兼容）：** 在 `UserMcpServerV1` / `UserMcpServerPublicV1` 增加可选字段（缺省 = 关闭）：`workspaceRootInjection`（`'off' | 'granted'`，默认 `'off'`）与 `injectionIdentity`（`'filesystem_mcp' | 'generic' | null`，默认 `null`；**不**单独授权注入，供后续 allowlist / UI 使用）。解析规则：未知值 fail-closed 为 parse error（不静默降级为 off，避免“以为开了其实没开”的反向；缺省/省略则 off）；非 stdio transport 允许存字段但 runtime **永不**注入；公共投影与 fingerprint 包含上述 secret-free 字段。
2. **注入解析（纯函数 `resolveInjectedStdioServer`）：** 硬规则：仅 `transport === 'stdio'`；仅 `workspaceRootInjection === 'granted'`；`activeWorkspaceRoot` 经 `path.resolve` 后必须绝对路径且非空；`scope === 'workspace'` 时规范化后的 active root 必须与 `server.workspaceRoot` containment 匹配（win32 lower-case；active 等于 bound root 或位于其下），否则 `workspace_scope_mismatch` 不注入；将规范化 active root **追加**到 `args` **一次**，当且仅当 `args` 中尚无完全相等的 path segment（规范化后比较；win32 不区分大小写）；返回 `{ ...input, args: effectiveArgs }`，**不**改写 command/cwd/env/secrets；永不读取或拼接 secret env / headers。
3. **Session / transport 接线：** 在 `McpSessionManager.ensureSession` 创建 transport **之前**调用 `resolveInjectedStdioServer`；`buildSnapshot` / `testServer` / `refreshServer` 已有的 `workspaceRoot` 参数作为 `activeWorkspaceRoot` 传入；`LiveSession` 记录创建时用于注入的规范化 root（或 `null`），若后续 ensure 时 injection root 变化，先 drop 再重建（workspace switch）；`hasSameSessionDefinition` 纳入 `workspaceRootInjection` 与 `injectionIdentity`，配置变更时重建 session；`createTransport` 收到 **effectiveArgs**，但 session 内用于 CAS/定义比较的权威 server 仍以配置文档为准（注入后的 args 不写回 config store）。
4. **Settings / i18n：** stdio server 编辑器提供最小开关（允许注入当前工作区根路径）；`injectionIdentity` 可选，至少保证 form/JSON 模型字段可读写；文案键 `mcp.servers.workspaceRootInjection` 等（en-US / zh-CN）。

## 不变量

- 注入路径字符串**不是**写权限；MCP 工具仍默认 privileged，走既有 effect / approval。
- 不替代 `write_workspace_file` 或 settlement writer。
- Doctor/runtime 若展示 effective command line，必须走既有 redact 路径，不含 secrets。
- 不实现 marketplace identity 自动 trust。

## 后果

- 落地于 `workspace-root-injection.ts` 与 session-manager；默认 off 保证无配置即无注入，注入后 args 不写回 config store。
- 回滚：删除 `workspace-root-injection` 模块即回到无注入的 stdio 行为；配置字段可保留但不生效。

## 验证

- unit 覆盖：默认 off / 非 stdio / 空 active root → 不注入；granted + stdio + absolute root → 追加一次；args 已含相同 path segment → 不重复追加；workspace scope mismatch → 不注入；win32 风格大小写规范化比较；http/sse 永不注入。
- 门禁：`pnpm exec vitest run --project unit tests/unit/mcp-workspace-root-injection.unit.test.ts`、`pnpm typecheck`、`pnpm run check:security`、`pnpm run check:tool-contract`、`pnpm run check:teaching-evidence`。
- 解析规则明细：`docs/adr/evidence/ADR-0138.md`。

## 非目标

1. 不交付 marketplace / auto-connect / 多来源 precedence（Phase E/H）。
2. 不基于命令名/标签模糊识别后自动注入。
3. 不向 http/sse URL 或 header 注入；不注入 secret / OAuth token。
4. 不绕过 `write_workspace_file`、effect lattice、approval 或 settlement；注入不提供授权根之外的 FS capability。