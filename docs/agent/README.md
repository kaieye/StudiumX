# Agent 能力建设文档索引

本目录记录 StudiumX/TeachOS 下一阶段 agent 能力建设方案。文档按能力域拆分，避免把搜索、派发、压缩和落地步骤混在一个臃肿文档里。

## 范围

当前优先级是让主 agent 从“单轮工具调用循环”演进为可持续工作的教学 agent runtime：

- 搜索与抓取：稳定检索、结构化来源、可追踪引用、抓取安全和后端能力抽象。
- 子 agent 派发：把调研、只读检查、并行任务和后台任务从主对话上下文中隔离出去。
- 上下文压缩：在长会话中保留当前任务、用户约束、教学记忆和最近工具结果，同时压缩历史噪声。
- 观测与预算：每个工具调用、子任务和压缩动作都能被 UI、日志和持久化记录解释。

## 文档结构

- [运行时现状与缺口](runtime-baseline.md)：当前主循环、工具注册、对话入口和持久化的实际形状。
- [搜索与检索设计](search-and-retrieval.md)：搜索 provider seam、抓取安全、引用结构和测试计划。
- [子 agent 与任务派发](subagents-and-delegation.md)：`delegate_task`、只读子任务、并行任务、事件和权限策略。
- [上下文压缩设计](context-compression.md)：token 估算、发送前历史清理、自动压缩和摘要语义。
- [状态、持久化与记忆边界](state-persistence-and-memory.md)：turn 元数据、child run、sources、compaction 和 learner memory 的边界。
- [参考项目映射](reference-map.md)：从 `ref_project` 中提炼出的可复用模式。
- [实施路线图](implementation-roadmap.md)：分阶段落地顺序、验收标准和建议提交粒度。

## 设计原则

1. 深模块优先：调用方看到小接口，复杂策略留在模块实现里。
2. 发送时清理优先于持久化裁剪：原始会话记录保留，发给模型前再做预算化投影。
3. 子 agent 默认最小权限：先支持只读和前台短任务，再放开后台、写入和恢复。
4. 所有自动行为都可解释：搜索后端、压缩原因、子任务状态、预算消耗必须在事件或诊断里可见。
5. 每阶段都能独立上线：先补测试和观测，再逐步增加 runtime 能力。
