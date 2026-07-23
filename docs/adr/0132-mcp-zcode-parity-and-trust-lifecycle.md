# ADR-0132：MCP 与 Zcode 对齐——多来源、自动连接、插件市场与信任生命周期

- **状态：** 已采纳；**体验政策由 [ADR-0141](0141-mcp-product-experience-parity-policy.md) 修订**（允许 auto-connect / marketplace / install→connect 等主流体验；硬安全不变量仍见 §3）；Settings 产品面收窄见 [ADR-0142](0142-mcp-product-surface-settings-only.md)。
- **日期：** 2026-07-22
- **范围：** 将 MCP 从“用户手动配置、默认关闭的 v1 client”升级为完整 MCP client 目标：多来源配置、自动连接、OAuth、workspace-root 注入、plugin-provided servers、marketplace、迁移/同步、完整 server lifecycle，以及相应的 trust/provenance/approval 合同。
- **参照：** `ref_project/Zcode` Desktop 3.3.3（2026-07-08 构建）和 [`docs/improvements/mcp-zcode-alignment-target.md`](../improvements/mcp-zcode-alignment-target.md)。
- **取代范围：** 本 ADR 取代 ADR-0127、ADR-0128 中“无 MCP marketplace”“无 auto-connect”“workspace 文件不得作为 MCP 配置来源”“plugin MCP 仅可作为导入草稿”“filesystem MCP 不得获得受控 workspace-root 注入”等**产品禁令**。ADR-0127/0128 的现有 v1 实现事实、secret isolation、effect lattice、settlement 和 ToolOutcome 不变量继续有效。
- **相关：** ADR-0127、ADR-0128、ADR-0024、ADR-0048、ADR-0060、ADR-0061、ADR-0063、ADR-0073、ADR-0079、ADR-0083、ADR-0112、ADR-0115、ADR-0118。

## 1. 背景

StudiumX 已在 ADR-0128 的 A–F 范围交付用户可配置 MCP v1：userData canonical config、manual settings、stdio/HTTP/SSE、main-process sessions、动态 tool registry、effect/approval 接线、Doctor 和脱敏 support bundle。该方案刻意采用“默认 off、无 auto-connect、无 marketplace”的窄边界。

产品现在要求与 Zcode 的 MCP 生态能力对齐。这不只是增加 Settings 表单，而是引入从发现到撤销的完整 lifecycle：

```text
discover → inspect → install → verify → trust → configure → connect
→ authorize → use → update → revoke → uninstall → cleanup
```

因此，旧 ADR 中的绝对禁止会妨碍后续合法实现，必须由本 ADR 显式收窄/取代，而不是通过隐藏 flag、未登记 IPC 或产品外脚本绕过。

## 2. 决定

### 2.1 目标能力成为正式产品方向

下列能力均是 StudiumX 的正式对齐目标，可按 §8 阶段实施：

1. **多来源配置：** CLI/session override、environment、user、workspace、plugin/marketplace 和 system defaults；提供严格 schema、优先级、覆盖和 provenance 投影。
2. **自动连接：** 对解析后且仍具信任资格的 server，在 session start 建立受控连接和工具发现。
3. **OAuth：** authorization-code + PKCE、callback/deep-link、refresh/revoke 和 secure token storage。
4. **workspace 配置：** 支持兼容的 workspace MCP 配置文件、目录继承和覆盖规则，作为真实配置来源而非仅导入草稿。
5. **workspace-root 注入：** 向经识别、授权的 filesystem MCP server 提供受控 workspace root。
6. **插件与 marketplace：** plugin manifest MCP declarations、模板变量、discover/install/update/uninstall、marketplace 和签名/provenance/revocation lifecycle。
7. **配置迁移与同步：** 多 server import/export、legacy migration、McpSync 版本和冲突合同。
8. **成熟 runtime：** tools/list pagination、tools/list_changed、disconnect/retry lifecycle、structured/multimodal result normalizer、artifact spill、trace/audit correlation 和可执行诊断。

### 2.2 四层授权模型

实现不得把“配置存在”混同为“可执行外部副作用”。必须区分并投影：

| 层级 | 回答的问题 | 典型状态 |
| --- | --- | --- |
| 来源 / provenance | server 从哪里来、谁发布、版本和签名是什么？ | user / workspace / plugin / marketplace / environment / CLI |
| 安装与信任 | 是否允许下载、启动或连接该 server？ | discovered / verified / trusted / revoked |
| 连接与授权 | 是否可建立 transport；OAuth 是否完成？ | disabled / connecting / connected / authorization_required / disconnected / failed |
| tool invocation | 此次 tool call 是否按 effect、policy 和用户批准执行？ | read / workspace_write / external_write / privileged + permission decision |

自动连接主要影响第三层（transport / tools/list）。**产品体验上**允许 install 流程一并「启用并连接」（ADR-0141）。第四层 tool invocation 仍须 effect lattice 与既有审批；安装不得用 YOLO 语义跳过审批，但**不再**要求 install 与 connect 永远拆成两次强制交互。

### 2.3 多来源配置和 precedence

目标 precedence 从高到低为：

```text
CLI / session override
→ environment
→ user configuration
→ workspace configuration
→ plugin / marketplace-provided configuration
→ system defaults
```

实现 ADR 必须冻结：同名 server winner、shadowed entries、`enabled` 的合并语义、workspace 目录 walk 边界、legacy file shape、source 删除后的 session 清理、以及每种 source 可以覆盖的字段。Settings/Doctor 必须显示 effective config、来源和被覆盖原因。

### 2.4 Auto-connect 与资源治理

对已解析且可信的 server，session start 可自动连接、认证和列取工具。实现必须具有：

- global、per-source、per-server 的 disable/override；
- 子进程/网络/并发 server/连接时长的硬预算；
- 有上限的 retry、退避、cancel 和可见状态；
- workspace 切换、source 被覆盖/撤销、plugin 卸载、token revoke 后的即时 session drop；
- auto-connect 建立协议连接与工具发现；**不**自动执行 tools/call 副作用，但工具应对模型可见（ADR-0141）；
- 允许冷启动/workspace 激活时的受控自动连接（可关、有预算）；
- 本地可见日志和 Doctor 状态；catalog 拉取 ≠ 默认产品 telemetry。

### 2.5 Workspace MCP 与 filesystem root access

workspace MCP 配置可成为实际来源，且可按 precedence 自动生效。workspace-root 注入也被允许，但必须：

- canonicalize path，检查 symlink containment、workspace trust 和 scope；
- 基于已验证 server identity/manifest 的 structured capability，而不是模糊 argv 字符串替换；
- 在 effective config、audit 和 Doctor 中以脱敏方式可见；
- 在 workspace/scope/trust 改变时立即撤销；
- 仍不允许 MCP bridge 直接绕过内建 `write_workspace_file` 写 canonical teaching data。

### 2.6 Plugin 和 marketplace trust

marketplace 与 plugin MCP 进入产品范围，但必须有完整供应链合同：

- publisher identity、签名/哈希、版本 pin、更新历史、撤销名单和紧急禁用；
- 安装前展示 command、network endpoint、requested secrets/OAuth scope、filesystem access 和 effect preview；
- plugin 模板变量仅在已验证 plugin context 中按允许名单扩展；
- install、trust、connect、workspace-root access、tool invocation 宜可分别撤销；**允许** UX 将 install+connect 合并为可选一步（ADR-0141）；
- update/uninstall/revoke 必须关闭 sessions，清理 tools、OAuth tokens、artifacts 和 cache；
- 任意代码模式、默认 shell escalation 仍不被授权；远程目录与更新通道允许用户配置（须可禁用/撤销，ADR-0141）。

### 2.7 Remote metadata、effect 与结果

MCP tool annotations、server metadata 和 marketplace metadata 应被保留用于 UI、诊断、并发/重试建议与审计。annotations 应用于 UI 与审批建议；在用户/策略启用时可映射较低 effect 建议（ADR-0141）。无 policy 时默认仍 privileged + 审批。

MCP 返回内容必须经 result normalizer：分页/描述/schema/结果有硬预算；大 JSON、image/base64 和 resource 采用摘要/本地 artifact；resource link 不自动 fetch；结果不自动成为 Evidence、Outcome、LearningSession 或 learner profile。

## 3. 不变量

本 ADR 不取代以下约束：

1. 文件和 canonical learning records 仍是教学真相源。
2. `TeachingTurnCoordinator` / host 仍是 outcome settlement sole-writer。
3. MCP tools 必须经过 ToolRegistry → Dispatcher → effect lattice → permission gate → ToolOutcome；不存在 renderer 直通任意 tools/call IPC。
4. `expectedRevision` 不得放宽，fork/replay 仍默认 `toolsReplayed:false`。
5. secrets、OAuth tokens、headers、env 和 token-bearing URL 不得进入 renderer、日志、Doctor 或 support bundle。
6. 默认 remote telemetry 不得因 marketplace、OAuth、sync 或诊断而引入。
7. 不使用 YOLO、always-approve、danger-full-access 等语义替代审批。
8. MCP handler 不得 import ledger writer/outcome committer，也不得直接取得 canonical teaching writer authority。

## 4. 迁移

当前 ADR-0128 v1 行为继续作为兼容基线：已有 `userData/mcp/config.v1.json`、manual toggle、stdio/HTTP/SSE 和已保存 secret refs 不应被破坏。

新实现采用版本化 config/migration 路径：先读取既有 v1，再构建多来源 effective configuration；迁移必须可预览、可选择、可回退、保留原文件并生成 redacted report。没有完成对应阶段时，产品仍表现为当前 v1 行为，不得声称目标能力已经上线。

## 5. 失败处理与隐私

- schema/签名/来源/secret/OAuth 状态不合法时 fail-closed；
- server failure 不得阻塞本地教学 canonical read/write 或 settlement；
- connection diagnostics 仅保留有限的、脱敏的本地摘要；
- support bundle 只投影 redacted status、source category 和稳定错误码；
- sync 冲突不能静默覆盖 user 或 workspace configuration；
- marketplace/插件活动不得成为默认 phone-home telemetry。

## 6. 测试与门禁

每个阶段至少有：

- source precedence、workspace walk、migration、sync conflict tests；
- signature/provenance/revocation/install/uninstall cleanup tests；
- OAuth PKCE/state/refresh/revoke/secret non-echo tests；
- pagination、tool list change、disconnect/retry/cancel/budget tests；
- workspace-root containment/symlink/scope-switch tests；
- result normalizer/artifact/redaction tests；
- Settings → host → session → registry → approval → ToolOutcome integration tests；
- invariant tests，证明 settlement、ledger、`expectedRevision` 与 `toolsReplayed:false` 未被 MCP 扩权。

至少运行：

```bash
pnpm typecheck
pnpm run check:security
pnpm run check:tool-contract
pnpm run check:teaching-evidence
pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts
```

真实模型 API、真实 marketplace publish 和真实第三方安装不进入默认 PR CI。

## 7. 对现有 ADR 的影响

| 文档 | 影响 |
| --- | --- |
| ADR-0127 | marketplace、auto-connect、workspace config、plugin MCP 的禁令由本 ADR 取代；settlement/effect/secret 边界保留。 |
| ADR-0128 | A–F 是已交付 v1 基线；其“非目标/禁止”中的 marketplace、auto-connect、workspace authority 和 plugin ecosystem 改为本 ADR 的后续阶段。 |
| ADR-0042 | extension manifest `mcpServers` 可成为受验证 plugin 的实际来源；具体 manifest/trust schema 由实施 ADR 冻结。 |
| ADR-0073 | `mcp_marketplace` 可被引入 feature registry；仍不是授权或权限绕过开关。 |
| AGENTS.md / SECURITY.md / TOOL_CONTRACT | 必须同步移除已被取代的绝对禁止，改为本 ADR 的阶段门和不变量。 |

## 8. 实施阶段

| Phase | 交付 |
| --- | --- |
| A | tools/list pagination、list_changed、runtime disconnect/retry、诊断 |
| B | result normalizer、artifact spill、trace/audit correlation |
| C | OAuth、secure token lifecycle、Settings authorization |
| D | bulk import/export、legacy migration、McpSync wire |
| E | workspace/user/env/CLI source resolver、precedence、auto-connect |
| F | structured filesystem workspace-root capability |
| G | plugin manifest MCP lifecycle、template policy、provenance |
| H | marketplace discover/install/update/revoke/uninstall |

每一个 phase 需要独立实现 ADR 或对本 ADR 的 implementation addendum，明确 schema、IPC、权限、威胁模型、回滚和验收；禁止以单一“大 PR”混合所有 phase。

## 9. 一句话

StudiumX 的 MCP 产品目标升级为与主流客户端同级的完整 MCP client（自动连接、多来源、OAuth、marketplace/plugin）；体验层限制见 ADR-0141 放宽，硬安全仍依赖 secret isolation 与教学 settlement 不变量。
