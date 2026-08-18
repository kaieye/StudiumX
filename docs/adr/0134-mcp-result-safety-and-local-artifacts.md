# ADR-0134：MCP Result Safety 与本地 Artifact — Phase B 实现合同

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-22
- **范围：** MCP call result typed normalization、inline/model 硬预算、binary/base64/oversize 本地 artifact spill、non-fetching resource links、bounded 本地 trace correlation（ADR-0132 Phase B implementation addendum）。
- **取代：** 无
- **被取代：** 无
- **相关：** ADR-0128、ADR-0132、ADR-0133、ADR-0135–0140、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`
- **证据：** `src/main/mcp/result-normalizer.ts`、`src/main/mcp/artifact-writer.ts`、`src/main/mcp/trace-store.ts`、`src/main/mcp/session-manager.ts`、`src/shared/mcp/result-types.ts`、`tests/unit/mcp-*.unit.test.ts`；wire 与验收明细见 `docs/adr/evidence/ADR-0134.md`。

## 背景

MCP server result 是不可信的外部内容。本 phase 在 MCP bridge 前把 result 归一化为封闭、secret-safe 的 result model；它**不**把 MCP output 自动变成 Evidence、Outcome、memory、learner profile 或 canonical teaching record。实际 tool invocation 仍走既有 `ToolRegistry → Dispatcher → effect lattice → approval → ToolOutcome`，handler 不导入 ledger writer 或 outcome committer。

## 决定

1. **Typed result model 与 normalizer：** 明确区分 bounded text blocks、structured JSON（安全序列化、截断标记）、resource links（纯 metadata、默认 non-fetching）、image/audio/binary/base64（只生成本地 artifact reference 或 bounded omission summary）、MCP application error（`isError:true`）。normalizer 必须：容忍官方 SDK 结果及未知/畸形 content 并 fail closed 为安全文本摘要；保留 `structuredContent` 不被 `content` 覆盖；对每种 inline field、entry count、总字符/字节设硬上限；对 image/base64、data URL 与 oversized payload 不向模型内联原始字节；资源链接默认绝不 fetch；先应用 MCP 专属 budget 再交给既有 generic tool result budget；将 `isError:true` 映射为 failed MCP call，绝不作为 dispatcher 成功 ToolOutcome。
2. **Artifact writer：** artifact 仅存于 main process 的受控 local root（`userData/mcp/artifacts`），content-addressed、0600 权限、digest 校验、symlink-contained path policy。artifact public reference 只含 opaque id、kind、byte length、media type（若安全）、digest prefix 和 bounded summary；不含 absolute path、base64、resource body、URL credentials、headers、env、arguments 或 secret values。artifact 不自动在 renderer 打开、不自动上传、不进入 support bundle 原文、不赋予文件/网络/tool capability；清理/retention 只允许后续独立 ADR 扩展，本 phase 可保留 process-local references，不建立新的 teaching authority。
3. **Trace correlation：** main-side trace 可关联 call 的 server id、registered/raw tool name、duration、cancelled、result byte count、truncated/spilled flags 和 stable result kind；不记录 raw args、payload、headers、env、URL credentials、secret refs 或 full text。trace 是本地 bounded diagnostic aid，不是 telemetry、settlement writer、replay authorization 或 timeline authority；fork 仍保持 `toolsReplayed:false`。
4. **API / compatibility：** `McpTransport` 内部保留 raw SDK result shape；`McpSessionManager.callTool` 返回 typed normalized success payload 给 `tool-bridge`；legacy string consumers 收到确定性 bounded model-facing representation；application-level MCP error 走既有 failed result 分支。Public IPC/Doctor/Settings 不接收 raw results 或 artifact paths。

## 不变量

- MCP 结果不是 teaching evidence，不自动成为 Evidence / Outcome / LearningSession / learner profile；MCP 不写 ledger / outcome。
- `expectedRevision`、fork `toolsReplayed:false`、settlement sole-writer 不变。
- secret/base64/absolute path 不出现在 model-facing result、trace、IPC 或 Doctor projections。
- artifact/trace 处理不 import ledger/outcome writer；effect/approval/ToolOutcome 边界不变。
- 不授权任意 resource URL 自动 fetch、renderer 访问 raw result/artifact 路径、远程 telemetry 或可执行 artifact。

## 后果

- 已实现于 `src/main/mcp/result-normalizer.ts`、`artifact-writer.ts`、`trace-store.ts`、`session-manager.ts` 与 bridge/dispatcher adapter：MCP SDK `structuredContent` 与普通 `content` 分开保留；application `isError:true` 经 typed bridge error 映射为 `mcp_application_error` failed `ToolOutcome`。artifact root 固定在 main-managed `userData/mcp/artifacts`，trace 仅进程内、无 IPC / persistence / telemetry。
- 回滚：移除 Phase B code 即回到 v1 raw/string 结果路径；不新增 durable authority。

## 验证

- unit 覆盖：text + `structuredContent` 共存、unknown content、safe JSON truncation；base64/data URL/image/audio/oversize payload spill 与 artifact digest/containment；resource links represented but never fetched；per-entry/total MCP budget 在 generic turn result budget 之前；`isError:true` 成为 failed call 而 transport failure 保留断连行为；无 secret/base64/absolute path 出现在 model-facing result、trace、IPC 或 Doctor；artifact/trace 不 import ledger/outcome writer 且 effect/approval 边界不变。
- 门禁：`pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts`、`pnpm run check:tool-contract`、`pnpm run check:teaching-evidence`、`pnpm run check:teaching-ipc-contract`、`pnpm run check:security`、`pnpm typecheck`。
- 详细验收与实现说明：`docs/adr/evidence/ADR-0134.md`。

## 非目标

1. 不交付 OAuth、source precedence、auto-connect、workspace-root injection、plugin 或 marketplace。
2. 不授权任意 resource URL 自动 fetch、renderer access to raw result/artifact filesystem paths。
3. 不引入远程 telemetry 或可执行 artifact。
4. MCP 结果不自动成为 Evidence、Outcome、LearningSession 或 learner profile。
