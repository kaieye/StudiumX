# 实施路线图

路线图按可独立提交的阶段拆分。每阶段都应先补测试面，再改 runtime，避免一次性重写 agent loop。

## Phase 0：基线测试与诊断

状态：已完成。

目标：在不改变行为的前提下固定现状。

工作：

- 为 `ToolRegistry` 增加注册、覆盖、handlerMap 的单元测试。
- 为 `runAgentLoop` 增加 fake provider 测试：无工具、单工具、多工具、工具错误、最大迭代、取消。
- 为 `web_search` / `web_fetch` 当前输出加快照或结构测试。
- 增加基础 usage/diagnostic 类型，但先不接 UI。

验收：

- 当前行为有测试保护。
- 后续 refactor 可以证明没有破坏现有工具调用。

建议 commit：

- `test(agent): cover current loop and tool registry`

## Phase 1：搜索 runtime 深模块

状态：未开始。

目标：把搜索 provider 和抓取安全从工具 handler 中抽出来。

工作：

- 新增 `SearchRuntime` 与 `SearchProvider` 接口。
- 将现有后端迁移为 provider adapters。
- 统一 `SearchResultEnvelope` 与 `FetchResultEnvelope`。
- 增加 `sourceId/retrievedAt/provider/attempts`。
- 加强 `web_fetch` SSRF、防重定向绕过和 body 流式上限。
- 使用 fake provider 建集成测试。

验收：

- 设置中的所有现有 backend 仍能工作。
- agent 能得到结构化 sources。
- 安全测试覆盖 IPv4、IPv6、DNS、重定向和 proxy 场景。

建议 commit：

- `feat(search): add search runtime and structured sources`
- `fix(fetch): harden url resolution and response limits`

## Phase 2：发送前 context hygiene

状态：已完成。

目标：先解决 tool result 无限增长，不引入 LLM 摘要。

工作：

- 新增 `ContextEstimator`。
- 新增 `RequestHistoryHygiene`。
- 在 `runAgentLoop` 调 provider 前对 messages 做发送投影。
- 保持 result transcript 写回原始内容。
- 增加 context estimate 和 hygiene events。

验收：

- 大 tool result 不再完整重复发送。
- 最近工具结果仍完整保留。
- 持久化 conversation 不被 hygiene 改写。

建议 commit：

- `feat(context): add send-time history hygiene`

## Phase 3：自动与手动压缩

状态：未开始。

目标：在上下文接近阈值时压缩历史。

工作：

- 新增 `ContextCompactor`。
- 增加 model context profile 和 soft/hard thresholds。
- 支持 reference-only summary message。
- 支持压缩事件和失败 cooldown。
- 保护最近用户消息、最近 assistant 消息和 tool pair。
- 提供手动压缩入口，先可只在 main process 暴露。

验收：

- 构造长会话会触发压缩。
- 压缩后仍回答最新用户消息。
- 摘要失败不会静默丢历史。

建议 commit：

- `feat(context): compact long conversations safely`

## Phase 4：只读子 agent

状态：未开始。

目标：主 agent 可以派发一个只读 child task。

工作：

- 新增 `DelegationRuntime`、`ChildAgentExecutor`、`ChildRunStore`。
- 新增 profile 到 tool policy 的映射。
- 注册 `read_only_task` 或 `delegate_task`。
- child agent 默认只读，禁止写入、课程生成、ask 和递归派发。
- child summary 回流父 transcript。

验收：

- 主 agent 能派发只读调研并得到摘要。
- child 不能写 workspace。
- child 失败不会终止父对话。

建议 commit：

- `feat(agent): add read-only child task delegation`

## Phase 5：并行任务与状态 UI

状态：未开始。

目标：支持多个独立只读任务并发执行，并让用户看见状态。

工作：

- 新增 `parallel_tasks` 工具。
- 增加 FIFO 并发槽和 timeout。
- 扩展 stream event：queued/running/completed/failed/canceled。
- UI 显示每个 child run label 和最终摘要。
- usage 聚合到父结果。

验收：

- 2-3 个子任务可以并发执行。
- 一个任务失败不影响其他任务完成。
- UI 能展示子任务状态和错误。

建议 commit：

- `feat(agent): run read-only child tasks in parallel`

## Phase 6：持久化与恢复

状态：未开始。

目标：让 child runs、压缩摘要和搜索 sources 可审计。

工作：

- child transcript 或摘要持久化。
- conversation record 中记录 compression item metadata。
- sources 存入 turn metadata，支持 UI 引用回看。
- 启动时标记 orphan child run 为 canceled 或 recoverable。
- 大型 tool result 归档到单独 blob，JSON turn 保留 digest、preview 和归档路径。
- 明确 learner memory、conversation compaction、archived retrieval 三类数据边界。

验收：

- 重启后不会出现悬挂 running child。
- 历史对话能看到 sources 和压缩记录。
- 诊断视图可以解释一次回答用过哪些能力。
- 长会话 JSON 不再因为大型工具结果无限膨胀。

建议 commit：

- `feat(agent): persist child runs and context diagnostics`

## 风险清单

- 成本失控：子任务并发和自动压缩都会增加模型调用，必须有预算和上限。
- 上下文污染：child transcript 不能直接进入父上下文。
- 权限升级：child 默认禁止写入和递归派发。
- 搜索幻觉：snippet 与 fetch 正文必须区分，不能把没抓取的页面当作已阅读。
- 压缩误导：摘要必须标记为历史参考，最新用户消息永远优先。
- 工具配对损坏：压缩和 hygiene 不能产生孤立 tool result。
- UI 噪声：事件要可折叠，默认只显示对用户有意义的状态。

## 推荐近期顺序

当前最稳妥的起步顺序：

1. Phase 0 固定测试基线。
2. Phase 2 做 deterministic context hygiene，快速降低长会话风险。
3. Phase 1 拆搜索 runtime，因为它能给后续子 agent 提供稳定 sources。
4. Phase 4 做只读 child task。
5. Phase 3 引入摘要压缩。

Phase 2 可以先于 Phase 1，因为它对用户体验的风险收益比最高，且不依赖搜索重构。
