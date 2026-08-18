# ADR-0132：MCP 与 Zcode 对齐——多来源、自动连接、插件市场与信任生命周期

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-22
- **范围：** 将 MCP 从“用户手动配置、默认关闭的 v1 client”升级为与 Zcode 对齐的完整 MCP client：多来源配置、自动连接、OAuth、workspace-root 注入、plugin/marketplace、迁移/同步与完整 server lifecycle，以及相应的 trust/provenance/approval 合同。
- **取代：** 部分 [ADR-0127](0127-user-configurable-mcp-design-gate.md) / [ADR-0128](0128-user-configurable-mcp-implementation.md) 中的后续产品禁令（无 marketplace、无 auto-connect、workspace 文件不得作为 MCP 配置来源、plugin MCP 仅可作导入草稿、filesystem MCP 不得获得受控 workspace-root 注入）。
- **被取代：** 部分被 [ADR-0141](0141-mcp-product-experience-parity-policy.md)（体验政策：auto-connect / marketplace / install→connect）与 [ADR-0142](0142-mcp-product-surface-settings-only.md)（Settings 产品面收窄）修订。
- **相关：** ADR-0127、ADR-0128、ADR-0024、ADR-0048、ADR-0060、ADR-0061、ADR-0063、ADR-0073、ADR-0079、ADR-0083、ADR-0112、ADR-0115、ADR-0118、ADR-0133–0140、ADR-0141、ADR-0142、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`
- **证据：** `src/main/mcp/*`、`src/shared/mcp/*`、`tests/unit/mcp-*.unit.test.ts`；目标能力与 A–H 阶段明细见 `docs/adr/evidence/ADR-0132.md`。

## 背景

StudiumX 已在 ADR-0128 的 A–F 范围交付用户可配置 MCP v1（userData canonical config、manual settings、stdio/HTTP/SSE、main-process sessions、动态 tool registry、effect/approval 接线、Doctor 和脱敏 support bundle）。该方案刻意采用“默认 off、无 auto-connect、无 marketplace”的窄边界。

产品现在要求与 Zcode 的 MCP 生态能力对齐。这不是只增加 Settings 表单，而是引入从发现到撤销的完整 lifecycle：

```text
discover → inspect → install → verify → trust → configure → connect
→ authorize → use → update → revoke → uninstall → cleanup
```

因此，旧 ADR 中的绝对禁止会妨碍后续合法实现，必须由本 ADR 显式收窄/取代，而不是通过隐藏 flag、未登记 IPC 或产品外脚本绕过。

## 决定

### 1. 目标能力成为正式产品方向（A–H 阶段）

1. **多来源配置：** CLI/session override、environment、user、workspace、plugin/marketplace 和 system defaults；提供严格 schema、优先级、覆盖和 provenance 投影。
2. **自动连接：** 对解析后且仍具信任资格的 server，在 session start 建立受控连接和工具发现。
3. **OAuth：** authorization-code + PKCE、callback/deep-link、refresh/revoke 和 secure token storage。
4. **workspace 配置：** 支持兼容的 workspace MCP 配置文件、目录继承和覆盖规则，作为真实配置来源而非仅导入草稿。
5. **workspace-root 注入：** 向经识别、授权的 filesystem MCP server 提供受控 workspace root。
6. **插件与 marketplace：** plugin manifest MCP declarations、模板变量、discover/install/update/uninstall、marketplace 和签名/provenance/revocation lifecycle。
7. **配置迁移与同步：** 多 server import/export、legacy migration、McpSync 版本和冲突合同。
8. **成熟 runtime：** tools/list pagination、tools/list_changed、disconnect/retry lifecycle、result normalizer、artifact spill、trace/audit correlation 和可执行诊断。

### 2. 四层授权模型

实现不得把“配置存在”混同为“可执行外部副作用”，必须区分并投影：来源/provenance → 安装与信任 → 连接与授权 → tool invocation。自动连接主要影响第三层（transport / tools/list）。**产品体验上**允许 install 流程一并「启用并连接」（ADR-0141）；安装不得用 YOLO 语义跳过审批，但**不再**要求 install 与 connect 永远拆成两次强制交互。第四层 tool invocation 仍须 effect lattice 与既有审批。

### 3. 多来源 precedence 与 auto-connect

目标 precedence 从高到低为：

```text
CLI / session override
→ environment
→ user configuration
→ workspace configuration
→ plugin / marketplace-provided configuration
→ system defaults
```

实现 ADR 必须冻结：同名 server winner、shadowed entries、`enabled` 的合并语义、workspace 目录 walk 边界、legacy file shape、source 删除后的 session 清理、以及每种 source 可覆盖的字段。对已解析且可信的 server，session start 可自动连接、认证和列取工具；实现必须具有 global/per-source/per-server disable、硬预算、有上限 retry/退避/cancel、即时 session drop（workspace 切换、source 覆盖/撤销、plugin 卸载、token revoke 后）。auto-connect 建立协议连接与工具发现，**不**自动执行 tools/call 副作用（ADR-0141）；允许受控冷启动/workspace 激活自动连接（可关、有预算）。catalog 拉取 ≠ 默认产品 telemetry。

### 4. Workspace MCP 与 filesystem root access

workspace MCP 配置可成为实际来源并按 precedence 自动生效；workspace-root 注入允许，但必须 canonicalize path、检查 symlink containment / workspace trust / scope、基于已验证 server identity/manifest 的结构化 capability（而非模糊 argv 字符串替换）、在 effective config/audit/Doctor 中以脱敏方式可见、在 workspace/scope/trust 改变时立即撤销。仍不允许 MCP bridge 直接绕过内建 `write_workspace_file` 写 canonical teaching data。

### 5. Plugin / marketplace / remote metadata 与结果

marketplace 与 plugin MCP 进入产品范围，但必须有完整供应链合同：publisher identity、签名/哈希、版本 pin、更新历史、撤销名单、紧急禁用；安装前展示 command、network endpoint、requested secrets/OAuth scope、filesystem access 和 effect preview；plugin 模板变量仅在已验证 plugin context 中按允许名单扩展；install/trust/connect/workspace-root access/tool invocation 可分别撤销，**允许** UX 将 install+connect 合并为可选一步（ADR-0141）；update/uninstall/revoke 必须关闭 sessions、清理 tools、OAuth tokens、artifacts 和 cache；任意代码模式、默认 shell escalation 仍不被授权；远程目录与更新通道允许用户配置（须可禁用/撤销，ADR-0141）。

MCP 返回内容必须经 result normalizer：分页/描述/schema/结果有硬预算；大 JSON、image/base64 和 resource 采用摘要/本地 artifact；resource link 不自动 fetch；结果不自动成为 Evidence、Outcome、LearningSession 或 learner profile。annotations 应用于 UI 与审批建议；在用户/策略启用时可映射较低 effect 建议（ADR-0141）；无 policy 时默认仍 privileged + 审批。

## 不变量

本 ADR 不取代以下约束：

1. 文件和 canonical learning records 仍是教学真相源。
2. `TeachingTurnCoordinator` / host 仍是 outcome settlement sole-writer。
3. MCP tools 必须经过 ToolRegistry → Dispatcher → effect lattice → permission gate → ToolOutcome；不存在 renderer 直通任意 tools/call IPC。
4. `expectedRevision` 不得放宽，fork/replay 仍默认 `toolsReplayed:false`。
5. secrets、OAuth tokens、headers、env 和 token-bearing URL 不得进入 renderer、日志、Doctor 或 support bundle。
6. 默认 remote telemetry 不得因 marketplace、OAuth、sync 或诊断而引入。
7. 不使用 YOLO、always-approve、danger-full-access 等语义替代审批。
8. MCP handler 不得 import ledger writer/outcome committer，也不得直接取得 canonical teaching writer authority。

## 后果

- 当前 ADR-0128 v1 行为继续作为兼容基线：已有 `userData/mcp/config.v1.json`、manual toggle、stdio/HTTP/SSE 和已保存 secret refs 不应被破坏。
- 新实现采用版本化 config/migration 路径：先读取既有 v1，再构建多来源 effective configuration；迁移必须可预览、可选择、可回退、保留原文件并生成 redacted report。没有完成对应阶段时，产品仍表现为当前 v1 行为，不得声称目标能力已经上线。
- A–H 已按 ADR-0133–0140 逐阶段落地；体验层放宽见 ADR-0141，Settings 产品面收窄为 list/editor/import/OAuth（ADR-0142）。
- 失败处理：schema/签名/来源/secret/OAuth 状态不合法时 fail-closed；server failure 不得阻塞本地教学 canonical read/write 或 settlement；connection diagnostics 仅保留有限、脱敏的本地摘要；support bundle 只投影 redacted status、source category 和稳定错误码；sync 冲突不能静默覆盖 user 或 workspace 配置；marketplace/插件活动不得成为默认 phone-home telemetry。

## 验证

- 每个阶段（ADR-0133–0140）独立验收：source precedence、workspace walk、migration、sync conflict；signature/provenance/revocation/install/uninstall cleanup；OAuth PKCE/state/refresh/revoke/secret non-echo；pagination、tools/list_changed、disconnect/retry/cancel/budget；workspace-root containment/symlink/scope-switch；result normalizer/artifact/redaction；Settings → host → session → registry → approval → ToolOutcome 集成；以及证明 settlement、ledger、`expectedRevision` 与 `toolsReplayed:false` 未被 MCP 扩权的不变量测试。
- 门禁：`pnpm typecheck`、`pnpm run check:security`、`pnpm run check:tool-contract`、`pnpm run check:teaching-evidence`、`pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts`。真实模型 API、真实 marketplace publish 和真实第三方安装不进入默认 PR CI。
- 对既有 ADR 的影响表、A–H 阶段表与详细测试清单：`docs/adr/evidence/ADR-0132.md`。

## 非目标

1. MCP 不是 LearningSession / Evidence / Outcome 的 settlement authority，也不得写入 ledger 或取得 canonical teaching writer 权威。
2. 不引入默认远程产品 telemetry / phone-home。
3. 不提供 YOLO / always-approve / danger-full-access 语义替代审批。
4. 不授权 jiti 全权限扩展、code-mode 执行不可信代码或 shell-escalation 旁路。
5. 不把 MCP tool 直通 renderer，也不绕过 ToolRegistry → Dispatcher → effect lattice → permission gate → ToolOutcome。
