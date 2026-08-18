# ADR-0013：MCP Runtime、Trust 与 Secret 边界

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** mcp

## 背景

MCP 将用户配置的外部 server 与动态工具接入 Agent runtime。远端 schema、annotation、OAuth token 和工具结果都跨越信任边界，不能因为 server 已连接就获得执行或教学权威。

## 决定

- MCP server lifecycle、tool discovery 与调用由主进程 host 管理；renderer 只接收 secret-free 状态与受限结果。
- 动态 MCP tool 使用稳定命名并进入与静态工具相同的 effect lattice、approval、workspace trust、预算、结果归一化和审计流程；未知 effect 默认为 `privileged`。
- 远端 annotation 只作展示元数据，不降级 effect、不跳过 approval，也不扩大 workspace root。
- OAuth 使用受限 redirect、PKCE、state 与主进程 token lifecycle；token、resolved headers/env 永不进入 public DTO、Doctor、support bundle 或日志。
- MCP handler 不写 LearningSession、Evidence、Outcome 或 learner profile；MCP 结果不是 Teaching Evidence，settlement sole-writer 与 `expectedRevision` 保持不变。
- MCP 配置来源携带 provenance；连接或列出工具不等于授权调用。

## 边界与后果

- Settings 产品面只提供 list/editor/import/OAuth，不提供 marketplace 设置页；该产品地板由 [AGENTS](../../AGENTS.md) 与 [SECURITY](../../SECURITY.md) 维护。
- filesystem server 的 root injection 仍受路径围栏与工具写入策略限制。
- MCP 不支持 code-mode 执行不可信代码或 shell-escalation 旁路。
- 改变 token 所在进程、effect 接线或 teaching isolation 需要新的 ADR。

## 实施锚点

- [MCP host](../../src/main/mcp/host.ts)
- [TOOL_CONTRACT](../tools/TOOL_CONTRACT.md)
- [安全边界](../../SECURITY.md)
