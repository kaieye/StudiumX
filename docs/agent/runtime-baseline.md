# 运行时现状与缺口

本文描述当前 agent runtime 的实际结构，作为后续搜索、子 agent、上下文压缩设计的共同基线。

## 当前主链路

入口在 `src/main/teaching-conversation-runtime.ts`：

1. `runTeachingConversationTurn` 接收 UI 侧 payload、workspace、stream 和依赖。
2. 读取设置、解析 provider、加载记忆、构造 system prompt。
3. 通过 `buildDefaultRegistry` 注册工作区工具、搜索工具和抓取工具。
4. 按场景额外注册 `ask` 与 `generate_lesson`。
5. 将历史 `AgentChatMessage` 转成 provider `ChatMessage`。
6. 调用 `runAgentLoop`，并把 agent loop 事件转成前端 stream 事件。
7. 将最终消息转回 `AgentChatTurn`，并处理记忆捕获和课程生成恢复。

主循环在 `src/main/ai/agent-loop.ts`：

- 每轮调用 `callChatProvider`。
- 如果模型返回 tool calls，逐个执行 handler。
- tool 结果追加到 transcript，再进入下一轮。
- 如果没有 tool call，就把文本作为最终回答。
- endpoint 不支持 tools 时降级到 `callProvider` 单次生成。
- 支持取消、最大迭代次数和错误状态。

工具 seam 在 `src/main/ai/tools/registry.ts`：

- `ToolRegistry.register` 保存 `ToolEntry`。
- `definitions()` 暴露工具 schema。
- `handlerMap(ctx)` 将 `ToolContext` 绑定到 handler。
- 默认 registry 根据设置注册 workspace read/write、`web_search`、`web_fetch`。

## 已有优势

- 工具入口足够集中，后续可以在 registry 层加 profile、权限和动态 schema。
- `runAgentLoop` 已经有事件模型，适合扩展子 agent 事件、压缩事件和 usage 事件。
- `TeachingSettingsV1` 已经承载搜索后端配置，后续新增预算和压缩设置有稳定位置。
- `generate_lesson` 已经证明“业务 pipeline 作为工具接入对话”的模式可行。

## 主要缺口

### 搜索与抓取

- `web_search` 已支持多个后端，但 provider 能力、输出引用、telemetry 和错误分类仍耦合在单个工具实现里。
- `web_fetch` 已有基础 SSRF guard，但还缺 DNS 解析后的 IP 检查、IPv6/CGNAT/metadata/proxy 语义、body 流式上限。
- 搜索结果缺少统一的 `sourceId`、`retrievedAt`、`provider`、`confidence` 与 citation 信息。

### 子 agent

- 当前只有单 agent loop，没有 child run、并发槽、父子事件、子 transcript 或结果回流。
- 多个 tool call 在 loop 内串行执行，无法表达“并行只读调研”或“后台任务”。
- registry 没有按子 agent profile 过滤工具，也没有只读策略或写入互斥策略。

### 上下文压缩

- 对话历史按原样发送给 provider，没有 token 预算估算。
- 大型 tool result 会持续留在上下文中，没有发送前清理。
- 没有自动压缩摘要、手动压缩、摘要元数据或压缩失败恢复。
- system prompt、tool schema、历史消息的合计预算不可见。

### 观测和恢复

- 状态目前是粗粒度 `thinking/tool_running/tool_done/done/error/canceled`。
- 没有子任务状态、压缩原因、搜索后端 attempts、usage 聚合和诊断接口。
- 长任务中断或应用重启后，缺少 orphan child run 的恢复策略。

## 目标 runtime 形状

建议新增三个深模块，它们都挂在现有 `runTeachingConversationTurn -> runAgentLoop` 链路上，但各自保持小接口。

### `SearchRuntime`

负责 provider 选择、检索、抓取、引用归一化、后端 telemetry 和安全限制。`web_search` 与 `web_fetch` 工具只做参数解析和结果渲染。

### `DelegationRuntime`

负责 child run 的创建、排队、执行、取消、事件转发、并发预算、工具策略过滤和结果摘要。主 agent 只看到 `delegate_task` 等工具。

### `ContextManager`

负责估算、发送前历史清理、压缩触发、摘要生成、压缩消息注入和诊断。持久化层仍保存原始 turns，发送给 provider 的 messages 是预算化投影。

## 需要保持的约束

- `generate_lesson` 仍然是教学业务能力，不应被误建模成通用子 agent。
- 工作区写入必须保持当前安全策略：课程目录由课程生成 pipeline 控制，普通写文件工具不能绕过。
- 临时会话不能悄悄获得 workspace 工具或读取文件。
- 上下文压缩摘要只作为历史参考，不能变成新的当前任务。

