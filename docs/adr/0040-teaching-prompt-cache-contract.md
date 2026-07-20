# ADR-0040：Teaching prompt cache contract

- **状态：** 已实施
- **范围：** 教学与临时会话的 agent chat prompt 组装
- **相关：** docs/improvements/hermes-reasonix.md §1.1，Task A

## 决定

将 prompt 拆分为两个明确的部分：

1. `buildSessionStablePrefix` 仅包含会话内稳定的系统策略、外部内容边界、工具策略以及技能索引（名称、来源和短意图）。
2. `composeTeachingUserTurn` 生成 `<teaching-context-packet>`，承载本轮变化的页面上下文、临时会话上下文、记忆捕获计划、学习者画像、运行时模型信息和 slash skill 正文。

运行时每轮只把稳定前缀作为 `system` 消息，并将 turn-tail 与原始用户输入合并为 `user` 消息。`buildAgentChatSystemPrompt` 保留为只返回稳定前缀的兼容导出。

## 已实施范围与验证入口

- `src/main/teaching-conversation-prompt.ts`
- `src/main/teaching-conversation-runtime.ts`
- `tests/unit/teaching-prompt-cache.unit.test.ts`

```bash
pnpm exec vitest run --project unit tests/unit/teaching-prompt-cache.unit.test.ts
```

## 不变量

- 相同 mode、lesson tool 可用性和技能索引输入时，system prefix 必须字节级一致。
- 可见页面、记忆捕获计划、学习者画像、运行时模型信息和技能正文不得泄漏到 system prefix。
- ledger、settlement、工具权限与工具注册表行为不由本 ADR 改变。

## 不包含

- 不引入供应商特定的 `cache_control` 或请求协议字段。
- 不改变技能加载、记忆写入、课程生成或外部内容信任边界。
