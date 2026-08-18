# ADR-0004：Agent Run 与 Conversation 串行化

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** agent-runtime

## 背景

Agent 的运行生命周期与真实学习过程不是同一实体。并发输入、取消、steer/follow-up 和恢复若由多个入口同时推进，会造成顺序不确定、重复 effect 或把运行状态误当教学事实。

## 决定

- `AgentRun` 使用独立状态机表达运行、暂停、取消、失败与完成；它不拥有 LearningSession、Evidence 或 Outcome 权威。
- 同一 conversation 的 turn 在单一 lane 中串行提交；busy 期间的新输入进入有序队列，而不是并发修改当前 turn。
- steer 只能影响仍可变更的当前运行；follow-up 形成后续 turn，二者都保留稳定 identity 与顺序。
- replay、resume 与进程重连基于持久化 revision / receipt 恢复可观察状态，不自动重放已执行工具或外部 effect。
- 取消是显式运行结果；晚到事件必须按 run/turn identity 隔离，不能推进已终止运行。

## 边界与后果

- Conversation archive、timeline 与 renderer snapshot 是运行投影，不是教学 authority。
- lane 串行化不允许通过第二 host 或 IPC handler 建立旁路。
- 并行只可发生在受政策允许的内部纯读任务，不改变 turn 的提交顺序。
- 改变 run/session 分离或 conversation 顺序模型需要新的 ADR。

## 实施锚点

- [AgentRun 状态机](../../src/main/agent-run-state-machine.ts)
- [Conversation turn lane](../../src/main/ai/agent-conversation-turn-lane.ts)
- [Agent conversation 状态检查](../../scripts/check-agent-conversation-state.mjs)
