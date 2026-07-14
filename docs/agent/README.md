# Agent 能力建设文档索引

本目录只保留仍在推进的 agent runtime 文档。Phase 0–5 的临时设计稿和参考映射已在实现与检查通过后清理；完成记录继续保留在进度文档和 Git 历史中。

## 当前范围

当前剩余工作集中在持久化与恢复边界：child transcript、compaction replaced turn ids、启动恢复语义，以及长期归档/检索边界。

## 文档结构

- [状态、持久化与记忆边界](state-persistence-and-memory.md)：turn、child run、source、compaction、checkpoint 与 learner memory 的边界。
- [实施路线图](implementation-roadmap.md)：Phase 0–6 的状态、验收标准和剩余工作。
- [AI 执行 Prompt](ai-execution-prompt.md)：继续实施未完成切片时使用的通用模板。
- [实施进度](progress.md)：已完成、进行中、验证命令和剩余风险的记录。

## 已完成能力的验证入口

- 搜索 runtime：`pnpm run check:search-runtime`
- 上下文 hygiene / compaction：`pnpm run check:agent-loop-context-hygiene`、`pnpm run check:agent-loop-context-compaction`
- 子 agent / 并行任务：`pnpm run check:agent-delegation-runtime`
- 持久化审计与恢复：`pnpm run check:agent-conversation-audit-metadata`、`pnpm run check:agent-run-recovery`

## 设计原则

1. 深模块优先：调用方看到小接口，复杂策略留在模块实现里。
2. 发送时清理优先于持久化裁剪：原始会话记录保留，发给模型前再做预算化投影。
3. 子 agent 默认最小权限：先支持只读和前台短任务，再放开后台、写入和恢复。
4. 所有自动行为都可解释：搜索后端、压缩原因、子任务状态、预算消耗必须在事件或诊断里可见。
5. 每阶段都能独立上线：先补测试和观测，再逐步增加 runtime 能力。
