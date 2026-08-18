# ADR-0005：工具 Effect、审批与写入策略

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** tool-policy

## 背景

工具调用跨越读取、工作区写入、网络可观察 effect 与特权执行。仅靠工具名、模型声明或 UI 开关无法形成安全授权，动态 MCP 工具也不能绕过同一套执行边界。

## 决定

- 每个工具在执行前按 `read`、`workspace_write`、`external_write` 或 `privileged` 分类；未知工具 fail closed 为 `privileged`。
- effect classification、具体 capability、工作区 trust、approval、path fence 与 sandbox policy 是相互独立且必须共同满足的门禁。
- 工具总开关不构成授权；持久化的 `tools.enabled` 仅为兼容字段，加载后归一化为可用，实际执行仍由具体门禁决定。
- 工作区写入只能通过受控 durable publisher，遵守 containment、protected path、no-clobber / restricted overwrite 与可审计 receipt。
- 声明式 policy 可收窄权限，不能把远端 annotation、模型请求或配置来源当作 effect 降级依据。
- 工具清单、默认 effect 与投影规则的 canonical 合同由 [TOOL_CONTRACT](../tools/TOOL_CONTRACT.md) 维护，ADR 不复制清单。

## 边界与后果

- approval 文案只使用“需批准 / 按风险 / 本课放行”等真实语义，不提供 YOLO、always-approve 或 DangerFullAccess 产品标签。
- 工具结果不是 Teaching Evidence；工具执行也不得绕过 settlement sole-writer。
- 非 `read` effect 不因批处理、插件或 MCP 来源而获得并行写入权。
- 改变 effect lattice 或写入授权模型需要新的 ADR。

## 实施锚点

- [Tool dispatcher](../../src/main/ai/tools/dispatcher.ts)
- [Tool policy](../../src/main/ai/tools/tool-policy.ts)
- [TOOL_CONTRACT](../tools/TOOL_CONTRACT.md)
