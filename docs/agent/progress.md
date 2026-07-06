# Agent 能力实施进度

本文是 agent 能力建设的进度源。每次让 AI 完成一个阶段或切片后，都要更新这里，并在必要时同步更新 [implementation-roadmap.md](implementation-roadmap.md) 的 Phase 状态。

## 总览

| 项目 | 状态 | 最近提交 | 说明 |
| --- | --- | --- | --- |
| 文档规划 | 已完成 | `a292a79` | 已拆分 agent 能力设计文档、参考项目映射和路线图。 |
| 通用 AI 执行 Prompt | 已完成 | `4b9ca0d` | 新增通用模板，要求每次实施后更新进度。 |
| Phase 0：基线测试与诊断 | 未开始 | - | 需要先补现状测试。 |
| Phase 1：搜索 runtime 深模块 | 未开始 | - | 依赖搜索专题设计，建议在 Phase 0 后执行。 |
| Phase 2：发送前 context hygiene | 未开始 | - | 可在 Phase 0 后优先执行。 |
| Phase 3：自动与手动压缩 | 未开始 | - | 依赖 Phase 2 的 estimator/hygiene。 |
| Phase 4：只读子 agent | 未开始 | - | 建议在 Phase 0 后实施，写入能力延后。 |
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

## 进行中

无。

## 未开始

- Phase 0：基线测试与诊断。
- Phase 1：搜索 runtime 深模块。
- Phase 2：发送前 context hygiene。
- Phase 3：自动与手动压缩。
- Phase 4：只读子 agent。
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
