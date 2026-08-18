# ADR-0009：同意门控的教学 Memory

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** memory

## 背景

长期 memory 可以改善连续性，也可能把模型推断、敏感内容或过期信息悄然带入后续教学。检索与保存必须分离，并保持人在写入与注入环节的控制。

## 决定

- memory 写入、修改、删除与注入必须经过明确的人类同意；不存在无人批准的自动 memory phase。
- synthetic teaching memory 与 canonical LearningSession / Evidence 分离；memory 命中只能作为带 provenance 的辅助上下文。
- `memory_search` 使用有界本地词法检索，并按 scope 隔离；不使用 SQLite FTS 或向量库提供面向用户的产品搜索面。
- 被召回内容按不可信外部内容处理，经过消毒、预算与注入边界；memory body 不进入稳定 system prefix。
- learner profile 不从对话、工具结果或模型总结中静默更新。

## 边界与后果

- memory 不证明掌握、不产生 outcome，也不能改变 settlement revision。
- 删除采用可审计的受控语义，不允许模型绕过用户确认。
- 产品级 FTS / 向量搜索需要 disposable index、独立权威模型与新的 ADR。
- 改变同意门或自动注入边界需要新的 ADR。

## 实施锚点

- [Teaching memory recall](../../src/main/teaching-memory-recall.ts)
- [Memory capture 检查](../../scripts/check-memory-capture.mjs)
- [安全边界](../../SECURITY.md)
