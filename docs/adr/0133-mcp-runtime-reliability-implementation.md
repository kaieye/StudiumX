# ADR-0133：MCP Runtime Reliability — Phase A 实现合同（分页 / inventory stale / 断连 / 手动重连）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-22
- **范围：** `tools/list` cursor pagination、`notifications/tools/list_changed`、session stale/断连状态、下一 run 与显式刷新重连、有限本地诊断、Settings/Doctor 投影（ADR-0132 Phase A implementation addendum）。
- **取代：** 无
- **被取代：** 无
- **相关：** ADR-0127、ADR-0128、ADR-0132、ADR-0134–0140、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`
- **证据：** `src/main/mcp/session-manager.ts`、`src/main/mcp/transports/*`、`src/main/mcp/tool-bridge.ts`、`tests/unit/mcp-*.unit.test.ts`；传输/inventory/重连 wire 明细见 `docs/adr/evidence/ADR-0133.md`。

## 背景

ADR-0132 将成熟 MCP runtime 列为正式方向，但要求每个 phase 有独立实现合同。本 ADR 落实 Phase A，且**不**同时交付 OAuth、result normalizer/artifacts、config source precedence、auto-connect、workspace-root capability、plugin 或 marketplace。

本 phase 保持 MCP v1 的 root/server enable gate 与按 run 建立 registry snapshot 的模式。默认没有后台自主重连；可恢复连接只允许由下一次 `buildSnapshot()`（下一 run）或用户经 secret-free IPC 发起的显式 server refresh 触发。连接建立和工具发现不授权工具调用；所有实际调用继续经过 `ToolRegistry → Dispatcher → effect lattice → approval → ToolOutcome`。

## 决定

1. **传输合同（paged）：** `McpTransport` 变为生命周期感知的 paged contract——`listTools({ cursor, signal })` 一次只读一页并返回 `{ tools, nextCursor? }`；transport 可通知 `tools_changed`、`closed`、`error`（通知不携带 headers、env、arguments、tool result 或任意 secret）；官方 SDK cursor 参数与 `ToolListChangedNotificationSchema`；close/fatal error 使 manager 中对应 client 失效，重复 close 幂等。分页循环由 `McpSessionManager` 管理（检测重复 cursor、尊重 abort、有限 page 上限、per-server tool/schema 硬预算）；因 collision、无效 schema 或 budget 被拒绝的前项不消耗可注册工具名额；全局 snapshot 预算仍在 materialization 阶段硬性执行。
2. **Inventory 与 runtime 状态：** 每个 live session 维护稳定 inventory snapshot（discovered/registered/rejected counts、generation、stale）；`tools_changed` 仅把该 server 标成 stale，绝不修改已经交给正在运行的 registry 的 schema。下一 run 或显式 refresh 才替换 stale inventory。public projection 可暴露 `disabled`/`idle`/`connecting`/`connected`/`disconnected`/`retry_wait`/`failed`、stale、generation 与计数；永不含 raw stderr、URL credentials、headers、env、command token、secret ref/value 或 raw SDK error。
3. **断连与重连：** transport close、fatal transport error、超时与可恢复的 transport `callTool` 异常使 cached session stale 并移出可复用 sessions；application-level MCP `isError` result 不是传输断连（留给 Phase B 的 typed result/outcome 合同）。失效后 runtime state 为 `disconnected`（或显式有限 retry 等待期间 `retry_wait`）；后台 retry 默认关闭，实现不得在用户未操作时启动无限或隐式连接循环。显式 refresh 必须严格检查 server id 与 workspace scope，先 drop stale session 再建新 transport。错误分类使用稳定、不泄漏的 `McpErrorCode`（至少 spawn / handshake / list / call timeout / server unavailable / budget failure）。
4. **IPC / UI / Doctor：** 新增一个 main-process-owned、secret-free refresh route（不是通用 `tools/call`，不接收 tool name/arguments，不绕过 existing config/workspace gates），输入只含 server id 与可选 active workspace root，输出 secret-free `McpTestServerResult`/runtime projection。Settings 显示 discovered/registered/rejected counts、stale/断开状态与刷新操作；Doctor/support bundle 只暴露聚合、稳定代码和清洗摘要。

## 不变量

- 远端 server 可以提供分页循环、变化风暴、错误、超大 schema、恶意文字和 transport 断连；cursor/page/tool/schema 的硬上限、abort 和 bounded summaries 必须 fail closed。
- 接收 `tools_changed` 不扩大当前 run 的 schema；stale tool 只在下一 snapshot / explicit refresh 出现。
- 不新增 OAuth URL/token、workspace root injection、plugin manifest activation、marketplace download、shell/general code execution 或 default telemetry。
- settlement sole-writer、`expectedRevision`、`toolsReplayed:false`、canonical teaching file authority、secret-free IPC、effect lattice 和 ToolOutcome 路径不变；MCP handler 不 import ledger/outcome writer。

## 后果

- 本 phase 的数据没有新的 durable authority。关闭 root/server switch 立即使 session 工具不可用；移除 Phase A code 后仍可读取既有 v1 config。runtime stale/count 字段为 optional/public diagnostic additions，旧 renderer consumer 必须以缺省值安全渲染。

## 验证

- unit 覆盖：多页/空/重复 cursor、page cap、abort；pagination 下 per-server/per-schema/global hard budget 及“早期拒绝不耗尽后续候选”；`tools/list_changed` 仅标 stale、不修改当前 run snapshot；transport close/error、call timeout/transport error 立即失效 session、下一 run 重连而不复用坏 client；explicit refresh IPC 的 whitelist/payload/scope checks；runtime/Settings/Doctor 只展示 secret-free、bounded fields；MCP handler 不导入 ledger/outcome writer，dispatcher/effect/approval/ToolOutcome 路径不变。
- 门禁：`pnpm typecheck`、`pnpm run check:security`、`pnpm run check:tool-contract`、`pnpm run check:teaching-evidence`、`pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts`。
- 传输/inventory/重连 wire 细节与验收清单：`docs/adr/evidence/ADR-0133.md`。

## 非目标

1. 不交付 OAuth、result normalizer/artifacts、config source precedence、auto-connect、workspace-root capability、plugin 或 marketplace。
2. 默认无后台自主重连；不启动无限/隐式连接循环。
3. 不新增 shell/general code execution 或默认 telemetry。
4. 不通过 convenience field 偷渡 remote annotations/effect trust、MCP result artifacts 或 trace payload。
