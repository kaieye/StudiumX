# ADR-0134：MCP Result Safety 与本地 Artifact — Phase B 实现合同

- **状态：** 已实施（ADR-0132 Phase B implementation addendum；仅本 phase 范围）
- **日期：** 2026-07-22
- **范围：** MCP call result typed normalization、inline/model hard budgets、binary/base64/oversize local artifact spill、non-fetching resource links、bounded local trace correlation。
- **相关：** ADR-0128、ADR-0132、ADR-0133、`docs/improvements/mcp-zcode-alignment-target.md`、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`。

## 1. 决定与边界

MCP server result 是不可信的外部内容。本 phase 在 MCP bridge 前把 result 归一化为封闭、secret-safe 的 result model；它**不**把 MCP output 自动变成 Evidence、Outcome、memory、learner profile 或 canonical teaching record。实际 tool invocation 仍走既有 `ToolRegistry → Dispatcher → effect lattice → approval → ToolOutcome`，handler 不导入 ledger writer 或 outcome committer。

本 phase 不交付 OAuth、source precedence、auto-connect、workspace-root injection、plugin 或 marketplace。它不授权任意 resource URL 自动 fetch、renderer access to raw result/artifact filesystem paths、remote telemetry、或可执行 artifact。

## 2. Typed result model 与 normalizer

新增 shared result types，明确区分：

- bounded text blocks；
- structured JSON（安全序列化、截断标记）；
- resource links（纯 metadata、默认 non-fetching）；
- image/audio/binary/base64（只生成本地 artifact reference 或 bounded omission summary）；
- MCP application error (`isError:true`)。

Normalizer 必须：

1. 容忍官方 MCP SDK 结果及未知/畸形 content，fail closed 为安全文本摘要；
2. 保留 `structuredContent`，而不是被 `content` 覆盖；
3. 对每种 inline field、entry count、总字符/字节设置硬上限；
4. 对 image/base64、data URL 与 oversized payload 不向模型内联原始字节；
5. 资源链接默认绝不 fetch；
6. 先应用 MCP 专属 budget，再将 model-facing text 交给既有 generic tool result budget；
7. 将 `isError:true` 映射为 failed MCP call，绝不作为 dispatcher 成功 ToolOutcome。

## 3. Artifact writer

Artifact 仅存于 main process 的受控 local root，采用 content-addressed 写入、0600 权限、digest 校验和 symlink-contained path policy。artifact public reference 只包括 opaque id、kind、byte length、media type（若安全）、digest prefix 和 bounded summary；不含 absolute path、base64、resource body、URL credentials、headers、env、arguments 或 secret values。

artifact 不自动在 renderer 打开、不自动上传、不进入 support bundle 原文、不赋予文件/网络/tool capability。清理/retention 只允许后续独立 ADR 扩展；本 phase 可保留 process-local references，不建立新的 teaching authority。

## 4. Trace correlation

main-side trace 可关联 call 的 server id、registered/raw tool name、duration、cancelled、result byte count、truncated/spilled flags 和 stable result kind。它不记录 raw args、payload、headers、env、URL credentials、secret refs 或 full text。trace 是本地 bounded diagnostic aid，不是 telemetry、settlement writer、replay authorization 或 timeline authority；fork 仍保持 `toolsReplayed:false`。

## 5. API / compatibility

`McpTransport` retains raw SDK result shape internally. `McpSessionManager.callTool` returns a typed normalized success payload to `tool-bridge`; legacy string consumers receive a deterministic bounded model-facing representation. Application-level MCP error returns the existing failed result branch. Public IPC/Doctor/Settings do not receive raw results or artifact paths.

## 6. 验收与测试

至少覆盖：

1. text + `structuredContent` coexistence、unknown content、safe JSON truncation；
2. base64/data URL/image/audio/oversize payload spill，artifact digest and containment；
3. resource links are represented but never fetched；
4. per-entry/total MCP budget before generic turn result budget；
5. `isError:true` becomes failed call, while transport failures retain disconnect behavior；
6. no secret/base64/absolute path appears in model-facing result, trace, IPC or Doctor projections；
7. artifact/trace handling does not import ledger/outcome writer and leaves effect/approval/ToolOutcome boundaries intact.

最低验证：

```bash
pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts
pnpm run check:tool-contract
pnpm run check:teaching-evidence
pnpm run check:security
pnpm typecheck
```

## 7. 实现证据（2026-07-22）

已实现于 `src/main/mcp/result-normalizer.ts`、`artifact-writer.ts`、`trace-store.ts`、`session-manager.ts` 与 bridge/dispatcher adapter。MCP SDK `structuredContent` 会与普通 `content` 分开保留；application `isError:true` 经 typed bridge error 映射为 `mcp_application_error` failed `ToolOutcome`，不会成为成功 outcome。artifact root 固定在 main-managed `userData/mcp/artifacts`，trace 仅进程内、无 IPC / persistence / telemetry。

Focused verification passed:

```bash
pnpm exec vitest run --project unit tests/unit/mcp-*.unit.test.ts tests/unit/tool-dispatcher.unit.test.ts tests/unit/mcp-tool-bridge.unit.test.ts
pnpm run check:tool-contract
pnpm run check:teaching-evidence
pnpm run check:teaching-ipc-contract
pnpm run check:teaching-ipc-commands
```

`pnpm typecheck` 和 `pnpm run check:security` 仍被本 phase 之外的既有 renderer / external-content-boundary failures 阻塞；不得将其归因于本 ADR 实现。
