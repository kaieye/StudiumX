# Agent 能力实施进度

本文是 agent 能力建设的进度源。每次让 AI 完成一个阶段或切片后，都要更新这里，并在必要时同步更新 [implementation-roadmap.md](implementation-roadmap.md) 的 Phase 状态。

## 总览

| 项目 | 状态 | 最近提交 | 说明 |
| --- | --- | --- | --- |
| 文档规划 | 已完成 | `a292a79` | 已拆分 agent 能力设计文档、参考项目映射和路线图。 |
| 通用 AI 执行 Prompt | 已完成 | `4b9ca0d` | 新增通用模板，要求每次实施后更新进度。 |
| Phase 0：基线测试与诊断 | 已完成 | `5ffcaa9` | 已补 ToolRegistry、agent loop、web tools 基线 check，并新增基础 usage/diagnostic 类型。 |
| Phase 1：搜索 runtime 深模块 | 已完成 | `cfda6ab` | 已抽出 SearchRuntime，搜索/抓取工具改为薄封装，并新增结构化 sources、attempts 和抓取安全测试。 |
| Phase 2：发送前 context hygiene | 已完成 | `fdf9ea1` | 已新增发送前历史清理、CJK 友好估算和最小诊断事件。 |
| Phase 3：自动与手动压缩 | 已完成 | `pending` | 已新增 ContextCompactor、自动/手动触发、reference-only 摘要、失败 cooldown 和压缩事件。 |
| Phase 4：只读子 agent | 已完成 | `6bf0fee` | 已新增 DelegationRuntime、delegate_task/read_only_task 和只读 profile 工具边界。 |
| Phase 5：并行任务与状态 UI | 未开始 | - | 依赖 Phase 4。 |
| Phase 6：持久化与恢复 | 未开始 | - | 依赖 sources、child run、compaction metadata 的实际落地。 |

## 已完成

### 文档规划

完成内容：

- 新增 [README.md](README.md) 作为 agent 文档索引。
- 新增 [runtime-baseline.md](runtime-baseline.md)，记录当前主循环、工具注册和对话入口缺口。
- 新增 [search-and-retrieval.md](search-and-retrieval.md)，设计搜索 provider seam、抓取安全和结构化 sources。
- 新增 [subagents-and-delegation.md](subagents-and-delegation.md)，设计只读子任务、并行任务、profile 和工具策略。
- 新增 [context-compression.md](context-compression.md)，设计发送前 hygiene、token 估算和压缩摘要。
- 新增 [state-persistence-and-memory.md](state-persistence-and-memory.md)，定义 turns、compaction、child runs、sources 和 learner memory 边界。
- 新增 [reference-map.md](reference-map.md)，整理 Kun、Reasonix、Hermes、codex-plusplus 可借鉴点。
- 新增 [implementation-roadmap.md](implementation-roadmap.md)，拆分 Phase 0-6。

提交：

- `a292a79 docs(agent): outline agent capability roadmap`

验证：

- 检查新增文件列表和文档链接。
- 未运行测试，因为只新增设计文档。

### 通用 AI 执行 Prompt

完成内容：

- 新增 [ai-execution-prompt.md](ai-execution-prompt.md)。
- 模板要求 AI 先读文档、限定范围、声明非目标、运行验证、更新进度并提交。
- README 已加入 prompt 和 progress 入口。
- roadmap 每个 Phase 已加状态标记。

提交：

- `4b9ca0d docs(agent): add AI execution prompt and progress tracking`

验证：

- 已检查文档入口、阶段状态和未完成项标记。

### Phase 0：基线测试与诊断

完成内容：

- 新增 `check:agent-tool-registry`，覆盖 `ToolRegistry` 注册、同名覆盖、`handlerMap` 绑定上下文，以及默认 registry 的工作区读写和 web 工具注册边界。
- 新增 `check:agent-loop-baseline`，用本地 fake chat provider 覆盖无工具、单工具、多工具、工具错误、最大迭代 forced-final、最大迭代 error 和取消。
- 新增 `check:web-tools-baseline`，固定 `web_search` / `web_fetch` 当前结构化输出、HTML 文本提取、纯文本抓取、缺参错误和基础 URL guard 行为。
- 新增 `AgentLoopUsage` / `AgentLoopDiagnostic` 基础类型，暂不接 UI 和事件流。
- 为测试导出 `assertSafeUrl`，不改变 `web_fetch` 生产行为。

提交：

- `5ffcaa9 test(agent): cover current loop and tool registry`

验证：

- `npm run check:agent-tool-registry`
- `npm run check:agent-loop-baseline`
- `npm run check:web-tools-baseline`
- `npx tsc --noEmit`

### Phase 1：搜索 runtime 深模块

完成内容：

- 新增 `SearchRuntime`，集中承载搜索 provider dispatch、结构化来源归一化、微信公众号 fallback、抓取正文和诊断边界。
- 将 `web_search` / `web_fetch` 工具改为薄封装，handler 只做参数校验、调用 runtime 并序列化 JSON。
- 搜索结果新增 `sourceId`、`retrievedAt`、`provider`，搜索 envelope 新增 `backend`、`attemptedBackends`，同时保留既有 `provider/count/results/attempts` 兼容字段。
- 抓取结果新增 `sourceId`、`finalUrl`、`contentType`、`truncated`、`attempts`，并使用流式 body 上限，避免先读完整响应再截断。
- `web_fetch` 安全检查升级为 URL、IPv4、IPv6、CGNAT、云 metadata、DNS 解析结果和重定向目标检查；设置 proxy 时仍先做安全解析。
- 新增 `check:search-runtime`，覆盖 structured sources、显式后端不可用不 fallback、HTML 提取、长正文截断、重定向到内网拒绝、DNS/proxy 安全边界。

提交：

- `cfda6ab feat(search): add search runtime and structured sources`

验证：

- `npm run check:search-runtime`
- `npm run check:web-tools-baseline`
- `npm run check:web-search-providers`
- `node scripts/check-wechat-web-tools.mjs`
- `npm run check:agent-tool-registry`
- `npm run check:agent-loop-baseline`
- `npx tsc --noEmit`

剩余风险：

- `npm run check:agent-chat` 仍是 Phase 2 记录的既有失败，本阶段未改临时会话 prompt 文案断言。
- 搜索 sources 目前仍只写入 tool result JSON，尚未落到 turn metadata 或 UI sources 面板；这属于 Phase 6 的持久化与审计范围。

### Phase 2：发送前 context hygiene

完成内容：

- 新增 `ContextEstimator`，对 ASCII、CJK、message 和 tool schema 做本地 token 粗估。
- 新增 `RequestHistoryHygiene`，在发送给 provider 前缩短旧的大型 tool result、已完成 tool call 的长参数，并用累计工具结果预算折叠更旧结果。
- 保留最近 tool result 的完整内容；旧结果 digest 保留首行和 error/warning 等高信号行。
- `runAgentLoop` 在普通工具轮、forced-final 轮和不支持工具的 degraded 轮发请求前使用发送投影，但返回的 result transcript 保留原始完整 tool result。
- 新增 `context_estimated` 与 `context_hygiene_applied` 事件，先作为 loop 层最小诊断能力。
- 新增 `check:agent-loop-context-hygiene`，用 fake provider 验证发送投影、最近结果保留、原始 transcript 不被改写和估算行为。

提交：

- `fdf9ea1 feat(context): add send-time history hygiene`

验证：

- `npm run check:agent-loop-context-hygiene`
- `npm run check:agent-loop-baseline`
- `npm run check:agent-loop-empty-final`
- `npm run check:dsml-tool-calls`
- `npm run check:conversation-lesson-tool`
- `npx tsc --noEmit`

剩余风险：

- `npm run check:agent-chat` 未通过，失败点是临时会话 prompt 文案断言期望匹配 `学习者画像和课程概览`，实际 prompt 为 `学习者画像、课程概览和当前打开页面...`；本阶段未改该路径，未混入无关修复。

### Phase 3：自动与手动压缩

完成内容：

- 新增 `ContextCompactor`，在发送给 provider 前基于本地估算、模型上下文窗口和 soft/hard thresholds 判断是否压缩较旧历史。
- 自动压缩通过同一 provider 生成 reference-only summary message，并明确最新用户消息优先。
- 压缩边界保护最近 tail、最新用户消息和 tool call/result 配对，避免发给 provider 的消息出现孤立 tool result。
- 摘要生成失败时保留原始发送历史，并记录 `context_compaction_failed` 事件和 cooldown，避免每轮重复失败。
- `runAgentLoop` 在 hygiene 后、provider 调用前接入 compactor；返回的 result transcript 仍保留原始完整历史，不把发送投影写回持久化。
- 新增 `context_compaction_started`、`context_compaction_completed`、`context_compaction_failed` 事件，并在教学 runtime 中映射为现有状态流。
- `AgentChatStreamPayload.contextCompaction.force` 提供 main process 层手动触发入口，解析器只暴露少量白名单参数。
- 新增 `check:context-compactor` 和 `check:agent-loop-context-compaction`，覆盖阈值触发、reference-only 摘要、最新消息保留、tool pair、失败回退和 cooldown。

提交：

- `pending`

验证：

- `npm run check:context-compactor`
- `npm run check:agent-loop-context-compaction`
- `npm run check:agent-loop-context-hygiene`
- `npm run check:agent-loop-baseline`
- `npm run check:agent-loop-empty-final`
- `npm run check:agent-tool-registry`
- `npm run check:agent-delegation-runtime`
- `npm run check:teaching-ipc-commands`
- `npm run check:conversation-lesson-tool`
- `npx tsc --noEmit`

剩余风险：

- `npm run check:agent-chat` 仍是 Phase 2 记录的既有失败，失败点仍为临时会话 prompt 文案断言，本阶段未混入无关修复。
- 压缩摘要目前只作为发送投影注入，不持久化 compaction metadata 或 replaced turn ids；这属于 Phase 6。
- 手动入口只在 main/process payload 层可用，尚未做 UI 按钮或诊断面板。

### Phase 4：只读子 agent

完成内容：

- 新增 `DelegationRuntime`、`ChildRunStore` 和只读 child system prompt，child 内部复用 `runAgentLoop`。
- 新增 `delegate_task` 与 `read_only_task` 工具；主教学对话启用工具时可派发前台只读 child task。
- child registry 通过 profile 投影限制工具：`read_only/research` 允许工作区只读与 web 工具，`workspace_audit` 只允许工作区只读；child 不注册 `write_workspace_file`、`ask`、`generate_lesson` 或递归派发工具。
- 父 transcript 只保存 delegation 工具 JSON 结果，child transcript 不展开进父上下文。
- child 生命周期事件从工具 handler 透传到 agent loop，并在教学 runtime 中映射为现有 status 流。
- 新增 `check:agent-delegation-runtime`，覆盖父 agent 派发、child 读文件、只读工具白名单、child 失败不终止父 loop。

提交：

- `6bf0fee feat(agent): add read-only child task delegation`

验证：

- `npm run check:agent-tool-registry`
- `npm run check:agent-delegation-runtime`
- `npm run check:agent-loop-baseline`
- `npm run check:agent-loop-context-hygiene`
- `npm run check:conversation-lesson-tool`
- `node scripts/check-workspace-write-tool.mjs`
- `npx tsc --noEmit`

剩余风险：

- child run 目前只在内存中执行，未持久化 child transcript 或 metadata；这属于 Phase 6。
- UI 暂用现有 status/process timeline 展示子任务开始/完成/失败，没有独立 child run 列表；并发与状态 UI 留到 Phase 5。
- 未新增 `parallel_tasks`，仍是单个前台 child task。

## 进行中

无。

## 未开始

- Phase 5：并行任务与状态 UI。
- Phase 6：持久化与恢复。

## 更新规则

每次 AI 完成工作后必须：

1. 更新总览表状态。
2. 在“已完成”或“进行中”记录改动摘要。
3. 写入 commit hash。
4. 写入验证命令和结果。
5. 如果 Phase 状态变化，同步更新 [implementation-roadmap.md](implementation-roadmap.md)。
6. 如果发现路线图不再准确，更新对应专题文档或新增决策说明。
