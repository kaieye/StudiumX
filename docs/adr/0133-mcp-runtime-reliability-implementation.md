# ADR-0133：MCP Runtime Reliability — Phase A 实现合同（分页 / inventory stale / 断连 / 手动重连）

- **状态：** 已实施（ADR-0132 Phase A implementation addendum；仅授权并记录本 phase）
- **日期：** 2026-07-22
- **范围：** `tools/list` cursor pagination、`notifications/tools/list_changed`、session stale/断连状态、下一 run 与显式刷新重连、有限本地诊断、Settings/Doctor 投影。
- **相关：** ADR-0127、ADR-0128、ADR-0132、Zcode MCP 对齐历史研究（已结项）、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`。

## 1. 决定与边界

ADR-0132 将成熟 MCP runtime 列为正式方向，但要求每个 phase 有独立实现合同。本 ADR 落实 Phase A，且**不**同时交付 OAuth、result normalizer/artifacts、config source precedence、auto-connect、workspace-root capability、plugin 或 marketplace。

本 phase 保持 MCP v1 的 root/server enable gate 与按 run 建立 registry snapshot 的模式。默认没有后台自主重连；可恢复连接只允许由：

1. 下一次 `buildSnapshot()`（下一 run）；或
2. 用户经 secret-free IPC 发起的显式 server refresh

触发。连接建立和工具发现不授权工具调用；所有实际调用继续经过 `ToolRegistry → Dispatcher → effect lattice → approval → ToolOutcome`。

## 2. 传输合同

`McpTransport` 变为生命周期感知的 paged contract：

- `listTools({ cursor, signal })` 一次只读取一页，返回 `{ tools, nextCursor? }`；
- transport 可通知 `tools_changed`、`closed` 和 `error`；通知不携带 headers、env、arguments、tool result 或任意 secret；
- SDK adapter 使用官方 SDK 的 cursor 参数和 `ToolListChangedNotificationSchema`；
- transport `close`/fatal `error` 要使 manager 中对应 client 失效；重复 close 必须幂等。

分页循环由 `McpSessionManager` 管理，而不是 SDK adapter。manager 必须检测重复 cursor、尊重 abort、设置有限 page 上限，并在读取过程中应用 per-server tool/schema 硬预算。因 collision、无效 schema 或单 schema budget 被拒绝的前项不能消耗可注册工具名额，使后续合格工具可被发现；全局 snapshot 预算仍在 snapshot materialization 阶段硬性执行。

## 3. Inventory 与 runtime 状态

每个 live session 维护稳定的 inventory snapshot：已发现数量、可注册数量、按安全 reason 聚合的拒绝数量、generation 和 stale 标记。`tools_changed` 仅把该 server 标成 stale；它绝不修改已经交给正在运行的 registry 的 schema。

下一 run 或显式 refresh 才替换 stale inventory。runtime public projection 可以暴露：

- `disabled`、`idle`、`connecting`、`connected`、`disconnected`、`retry_wait`、`failed`；
- stale、inventory generation、discovered/registered/rejected counts；
- bounded retry/refresh metadata 与稳定错误码。

public projection、Doctor、support bundle、renderer 永不含 raw stderr、URL credentials、headers、env、command token、secret ref/value 或 raw SDK error。为了保持 Phase A 可审计性，可保存有限、清洗后的本地 diagnostic summary；它不进入 remote telemetry。

## 4. 断连与重连策略

以下事件必须使 cached session stale 并从可复用 sessions 中移除：transport close、fatal transport error、超时、以及可恢复的 transport `callTool` 异常。application-level MCP `isError` result 不是传输断连，保留给后续 Phase B 的 typed result/outcome 合同处理。

失效后 runtime state 为 `disconnected`（或在显式、有限 retry policy 等待期间为 `retry_wait`）。本 phase 的后台 retry 默认关闭；implementation 可计算受限的 retry eligibility/metadata，但不得在用户未操作时启动无限或隐式连接循环。显式 refresh 必须严格检查 server id 和 workspace scope，先 drop stale session，再建立新 transport；下一 run 采用同样受限路径。

错误分类使用稳定、不泄漏的 `McpErrorCode`，至少区分 spawn、handshake、list、call timeout、server unavailable 与 budget failure。可用的本地错误细节只能用于已清洗诊断摘要，不能成为 UI/raw log payload。

## 5. IPC、UI、Doctor

新增一个具体的、main-process-owned refresh route；它不是通用 `tools/call`，不接收 tool name/arguments，也不绕过 existing config/workspace gates。其输入只包含 server id 与可选 active workspace root，输出为 secret-free `McpTestServerResult`/runtime projection。

Settings 显示 discovered / registered / rejected counts、stale/断开状态与可用的“刷新”操作。现有“测试连接”保留为用户可理解的 diagnostic 操作，但不得被暗中实现为无限重连。Doctor/support bundle 只暴露聚合、稳定代码和清洗摘要。

## 6. 威胁模型与不变量

- 远端 server 可以提供分页循环、变化风暴、错误、超大 schema、恶意文字和 transport 断连；cursor/page/tool/schema 的硬上限、abort 和 bounded summaries 必须 fail closed。
- 接收 `tools_changed` 不扩大当前 run 的 schema；stale tool 只在下一 snapshot/explicit refresh 出现。
- 不新增 OAuth URL/token、workspace root injection、plugin manifest activation、marketplace download、shell/general code execution 或 default telemetry。
- remote annotations/effect trust、MCP result artifacts 和 trace payload 不属于本 phase，均不得通过 convenience field 偷渡。
- settlement sole-writer、`expectedRevision`、`toolsReplayed:false`、canonical teaching file authority、secret-free IPC、effect lattice 和 ToolOutcome 路径不变。

## 7. 回滚

本 phase 的数据没有新的 durable authority。关闭 root/server switch 立即使 session 工具不可用；移除 Phase A code 后仍可读取既有 v1 config。runtime stale/count fields 为 optional/public diagnostic additions，旧 renderer consumer 必须以缺省值安全渲染。

## 8. 验收与测试

至少覆盖：

1. 多页 cursor、空 cursor、重复 cursor、page cap 和 abort；
2. pagination 下 per-server/per-schema/global hard budget，及“早期拒绝不耗尽后续候选”的场景；
3. `tools/list_changed` 仅标 stale，不修改当前 run snapshot，下一 run/explicit refresh 才更新；
4. transport close/error、call timeout/transport error 立即失效 session，下一 run 重连而不复用坏 client；
5. explicit refresh IPC 的 whitelist/payload/scope checks；
6. runtime/Settings/Doctor 只展示 secret-free、bounded fields；
7. MCP handler 不导入 ledger/outcome writer，dispatcher/effect/approval/ToolOutcome 路径不变。

最低命令：

```bash
pnpm typecheck
pnpm run check:security
pnpm run check:tool-contract
pnpm run check:teaching-evidence
pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts
```
