# 参考项目映射

本文只记录可迁移模式，不照搬实现。目标是把 `ref_project` 中的经验映射到 StudiumX 当前 TypeScript/Electron runtime。

## Kun

Kun 与当前技术栈最接近，优先参考 TypeScript 模块形状。

### 上下文

相关文件：

- `ref_project/Kun-master/kun/src/loop/context-estimator.ts`
- `ref_project/Kun-master/kun/src/loop/request-history-hygiene.ts`
- `ref_project/Kun-master/kun/src/loop/context-compactor.ts`
- `ref_project/Kun-master/kun/src/loop/compaction-summary.ts`
- `ref_project/Kun-master/kun/src/loop/session-summary.ts`
- `ref_project/Kun-master/src/renderer/src/lib/context-capacity.ts`

可借鉴：

- CJK-aware token estimator。
- 发送前 history hygiene，不改持久化记录。
- soft/hard thresholds 与 model profile。
- compaction item 保留 pinned constraints。
- recent tail 保护和 tool pair 修复。
- provider prompt token 明显膨胀时不盲信。
- UI 上下文容量模型。

### 子 agent

相关文件：

- `ref_project/Kun-master/kun/src/delegation/delegation-runtime.ts`
- `ref_project/Kun-master/kun/src/delegation/child-agent-executor.ts`
- `ref_project/Kun-master/kun/src/adapters/tool/delegation-tool-provider.ts`
- `ref_project/Kun-master/kun/src/contracts/capabilities.ts`

可借鉴：

- `ChildRunRecord`。
- FIFO 并发槽。
- `maxChildRuns`。
- detach/abort。
- orphan reconciliation。
- profile/toolPolicy。
- usage aggregation。

### 搜索

相关文件：

- `ref_project/Kun-master/kun/src/ports/web-provider.ts`
- `ref_project/Kun-master/kun/src/adapters/tool/web-tool-provider.ts`
- `ref_project/Kun-master/kun/tests/web-tool-provider.test.ts`

可借鉴：

- `sources/citations/telemetry/sourceId/retrievedAt` 输出。
- allow/deny domain。
- 流式截断。
- fake provider 测试面。

## Reasonix

Reasonix 的 Go 实现适合参考任务接口和安全边界。

### 子 agent

相关文件：

- `ref_project/Reasonix/internal/agent/task.go`
- `ref_project/Reasonix/internal/agent/parallel_tasks.go`
- `ref_project/Reasonix/internal/agent/subagent_store.go`

可借鉴：

- `task`、`read_only_task`、`parallel_tasks` 三层接口。
- 子 agent 工具 registry 过滤。
- 父子事件嵌套。
- 后台 job 与子会话持久化。
- `continue_from` 风格的恢复能力。
- 依赖感知的并行任务调度。

### 抓取安全

相关文件：

- `ref_project/Reasonix/internal/tool/builtin/webfetch.go`
- `ref_project/Reasonix/internal/tool/builtin/webfetch_ssrf_test.go`
- `ref_project/Reasonix/internal/tool/builtin/web_fetch_proxy_test.go`

可借鉴：

- DNS dial 阶段 IP 检查。
- IPv6、CGNAT、metadata、DNS rebinding 测试。
- HTTP CONNECT、SOCKS、proxy/no_proxy 语义测试。

### 上下文与恢复

相关文件：

- `ref_project/Reasonix/internal/agent/compact.go`
- `ref_project/Reasonix/internal/agent/prune.go`
- `ref_project/Reasonix/docs/SESSION_MEMORY_RETRIEVAL.md`
- `ref_project/Reasonix/docs/CHECKPOINTS.md`

可借鉴：

- usage 触发压缩、tail budget、summary tag、失败 fallback。
- 旧 tool result 先 snip/prune，并归档原文。
- BM25 history/memory 检索。
- memory 作为 synthesis cache。
- checkpoint/rewind 的统一 controller seam。

## Hermes

Hermes 功能最完整，但 runtime 更重。适合拆取策略，不适合整体搬迁。

### 搜索

相关文件：

- `ref_project/hermes-agent-main/tools/web_tools.py`
- `ref_project/hermes-agent-main/agent/web_search_provider.py`
- `ref_project/hermes-agent-main/agent/web_search_registry.py`

可借鉴：

- provider seam 和 capability advertising。
- search 与 extract/fetch 区分。
- provider availability 与配置优先级。
- 长网页截断缓存。

### 上下文压缩

相关文件：

- `ref_project/hermes-agent-main/agent/context_compressor.py`
- `ref_project/hermes-agent-main/agent/conversation_compression.py`
- `ref_project/hermes-agent-main/agent/context_breakdown.py`
- `ref_project/hermes-agent-main/website/docs/developer-guide/context-compression-and-caching.md`

可借鉴：

- reference-only summary 前缀。
- summary end marker。
- 压缩摘要元数据。
- tool output pruning before summarization。
- token-budget tail protection。
- 摘要失败 cooldown。
- structured summary template。

### 子 agent

相关文件：

- `ref_project/hermes-agent-main/tools/delegate_tool.py`

可借鉴：

- `delegate_task` 工具契约。
- leaf/orchestrator 角色。
- `max_concurrent_children`。
- `max_spawn_depth`。
- 后台派发、超时、暂停、取消。
- 动态 schema 描述实际限制。

不建议 v1 直接引入：

- Kanban/cron 体系。
- 持久后台任务队列。
- 深层递归 orchestrator。

## codex-plusplus

该项目没有明显可直接复用的内建搜索/抓取或 delegation runtime。可参考方向是外部能力扩展和 MCP 管理。

相关文件：

- `ref_project/codex-plusplus-main/docs/tweaks/mcp.md`
- `ref_project/codex-plusplus-main/packages/runtime/src/mcp-sync.ts`
- `ref_project/codex-plusplus-main/docs/OWL-RUNTIME.md`

可借鉴：

- MCP 外部工具注册与同步思路。
- runtime 与 browser worker 的消息桥接。

## 迁移顺序建议

1. 从 Kun 迁移 TypeScript 形状：context estimator、history hygiene、delegation runtime。
2. 从 Reasonix 迁移安全测试：SSRF/proxy/DNS rebinding。
3. 从 Hermes 迁移语义策略：reference-only summary、provider capabilities、delegate limits。
4. codex-plusplus 只作为 MCP/worker 扩展参考，不作为核心 agent runtime 依据。
