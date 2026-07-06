# 子 agent 与任务派发设计

目标是让主 agent 能把可隔离的调研、检查、并行读取和长任务交给 child agents，而不污染主对话上下文。

## 当前缺口

`src/main/ai/agent-loop.ts` 当前是单 agent loop：

- 模型返回多个 tool call 时串行执行。
- 没有 child run 生命周期。
- 没有并发槽、取消传播或后台任务。
- 没有子 transcript 或结果摘要持久化。

`src/main/ai/tools/registry.ts` 当前只保存工具 schema 和 handler：

- 不能按 child profile 过滤工具。
- 不能表达只读、可写、禁止递归派发等策略。
- 不能按任务类型生成动态 schema 描述实际限制。

## v1 能力范围

第一版只做前台、短生命周期、可观测的派发：

- `delegate_task`：普通子任务，默认只读工具。
- `read_only_task`：强制只读，适合搜索、阅读、代码调查。
- `parallel_tasks`：一次派发多个互不依赖的只读任务，统一返回摘要。

暂不做：

- 长期后台队列。
- 子 agent 写文件。
- 子 agent 继续派发孙 agent。
- 跨应用重启后自动继续执行。

这些能力可以在 v2 基于同一 runtime 扩展。

## 目标模块

```ts
type DelegationRuntime = {
  runChild(input: ChildRunInput): Promise<ChildRunResult>
  runMany(input: ParallelChildRunInput): Promise<ParallelChildRunResult>
  abortChild(childRunId: string): Promise<void>
  listRuns(parentTurnId?: string): Promise<ChildRunRecord[]>
  diagnostics(): DelegationDiagnostics
}
```

主 agent 不直接创建 provider request，不直接管理 child transcript。它只通过工具调用 `DelegationRuntime`。

## Child run 记录

```ts
type ChildRunRecord = {
  id: string
  parentStreamId: string
  parentTurnId?: string
  label: string
  profile: 'read_only' | 'research' | 'workspace_audit'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
  prompt: string
  summary?: string
  error?: string
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    toolCalls: number
  }
  startedAt?: string
  completedAt?: string
}
```

v1 可先存在内存中，并把最终摘要写回父 transcript。v2 再接入持久化，用于恢复、审计和继续任务。

## 工具契约

`delegate_task` 参数：

```ts
type DelegateTaskArgs = {
  label: string
  prompt: string
  context?: string
  profile?: 'read_only' | 'research' | 'workspace_audit'
  maxIterations?: number
  timeoutMs?: number
}
```

返回：

```ts
type DelegateTaskResult = {
  childRunId: string
  status: 'completed' | 'failed' | 'canceled'
  summary: string
  citations?: Array<{ sourceId: string; url: string; title?: string }>
  filesRead?: string[]
  usage?: ChildRunRecord['usage']
}
```

`parallel_tasks` 参数：

```ts
type ParallelTasksArgs = {
  tasks: Array<{
    label: string
    prompt: string
    profile?: 'read_only' | 'research' | 'workspace_audit'
  }>
  maxConcurrency?: number
  timeoutMs?: number
}
```

返回按 task 顺序排列，并额外包含整体失败/取消统计。

## Profile 与工具策略

建议将工具策略作为 registry 的投影，而不是复制多个 registry：

```ts
type ToolPolicy = {
  allow: string[]
  deny: string[]
  workspaceWrite: boolean
  web: boolean
  delegation: boolean
}
```

默认 profile：

- `read_only`：允许 workspace read、search、fetch；禁止 write、generate_lesson、ask、delegate。
- `research`：允许 search/fetch 和 workspace read；禁止写入和递归派发。
- `workspace_audit`：允许 list/read/search/glob；禁止 web 和写入。

主 agent 可以有 `delegate_task`，child agent 默认没有 delegation 工具，避免递归失控。

## 执行模型

`DelegationRuntime` 内部包含：

- `ChildAgentExecutor`：构造 child system prompt、messages、registry 和 `runAgentLoop` 调用。
- `ChildRunScheduler`：FIFO 队列、最大并发数、timeout。
- `ChildRunStore`：记录状态、摘要、错误和 usage。
- `ChildEventSink`：把 child 状态映射为父 stream 事件。

事件建议扩展：

```ts
type AgentLoopEvent =
  | ExistingEvents
  | { type: 'child_run_started'; child: ChildRunRecord }
  | { type: 'child_run_delta'; childRunId: string; message: string }
  | { type: 'child_run_completed'; child: ChildRunRecord }
  | { type: 'child_run_failed'; child: ChildRunRecord }
```

UI 第一版可以只显示 “正在派发子任务：label” 与最终摘要；更细的 child transcript 可作为诊断视图后续加入。

## 结果回流

child agent 的完整 transcript 不应直接塞进父上下文。回流原则：

- 父 transcript 只保存 child summary、关键文件路径、来源引用和错误。
- child 工具结果在 child transcript 内部处理，不向父 agent 展开。
- 如果父 agent 需要细节，应重新调用只读工具或请求 child 给出更窄摘要。

## 并发与写入风险

v1 禁止 child 写文件，先避免竞态。未来开放写入前需要：

- workspace write lock。
- 文件级冲突检测。
- child patch 审核。
- 失败回滚或人工确认策略。

## 测试计划

单元测试：

- profile 到 tool definitions 的过滤。
- child run 状态流转。
- timeout 与 cancel。
- max concurrency 排队。
- child 工具错误被总结为 child failure，不让父 loop 崩溃。

集成测试：

- fake child provider 调用 read-only tool 后返回摘要。
- `parallel_tasks` 中一个失败不影响其他任务结果返回。
- child transcript 不进入父 transcript，只进入 child store。

验收标准：

- 主 agent 可以派发 2-3 个只读调研任务并汇总。
- 用户可以看到每个子任务状态。
- 子任务失败有可解释错误，不吞掉主 agent 回答。
- 子 agent 无法写 workspace 或递归派发。

