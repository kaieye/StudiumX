# ADR-0002：使用 UTC 分区、无损 JSONL 分段与显式摘要 projection

- **状态：** 已实施
- **范围：** C-2A、C-2B、C-2C
- **证据提交：** `d23b272`、`549f4f8`、`07dfbfb`

## 决定

1. 新会话按 UTC `YYYY/MM` 目录组织，读取端同时兼容 legacy flat 布局。
2. `learning-work.jsonl` 等 logical JSONL source 通过当前 active 文件和严格识别的 sealed segments 顺序读取；跨 UTC 月或达到 50 MiB 时，只允许 fsync 后的无损 active → sealed rename。
3. 会话摘要使用带来源信息的显式 projection；摘要不是 canonical 会话内容的替代品。

## 已落地范围与验证入口

- `d23b272` 实现 conversation storage 的 UTC 月分区，并在会话、artifact protection 与 lifecycle 读取路径保留 legacy 兼容；相关验证在 `tests/unit/teaching-agent-conversations.unit.test.ts`、`tests/unit/agent-artifact-protection.unit.test.ts` 等。
- `549f4f8` 实现 durable segmented JSONL ledger、50 MiB / UTC 月 rotation 与 sealed segment 读取；相关验证在 `tests/unit/durable-jsonl.unit.test.ts`、`tests/unit/learning-work-ledger.unit.test.ts`、`tests/unit/agent-conversation-archive-ledger-segments.unit.test.ts` 和 lifecycle JSONL 测试中。
- `07dfbfb` 实现显式 conversation summary projection；相关验证在 `tests/unit/agent-conversation-summary-projection.unit.test.ts`。

## 不包含

- 分区、sealing 和摘要都不授权删除、截断、压缩或重写 canonical JSON、Markdown、JSONL。
- 物理 retention、用户控制、canonical compaction、删除和恢复仍未实施；见[本地数据待办](../local-data-todo.md)。
