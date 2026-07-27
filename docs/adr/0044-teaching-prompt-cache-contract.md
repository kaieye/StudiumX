# ADR-0044：Teaching prompt cache contract

- **状态：** 已实施（2026-07-27 修订）
- **范围：** 教学与临时会话的 agent chat prompt 组装
- **相关：** [ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)、[ADR-0163](0163-teaching-capability-selection-and-plan-preview.md)

## 决定

Prompt 分为两个明确部分：

1. `buildSessionStablePrefix` 只包含会话内稳定内容：系统教学策略、external-content boundary、工具策略、紧凑 skill index，以及**唯一例外**——从 app-shipped builtin root 加载并通过 `verifySkillPack` 校验的 Teaching Kernel（`teach`）完整正文。
2. `composeTeachingUserTurn` 生成本轮 dynamic turn-tail，承载页面/临时上下文、记忆捕获计划、学习者画像、运行时模型信息、紧凑 orchestration plan，以及**当前阶段**非 kernel skill 正文。

运行时只把 stable prefix 作为 `system` 消息；turn-tail 与原始用户输入合并为 `user` 消息。`buildAgentChatSystemPrompt` 保留为 stable prefix 的兼容导出。

## Prompt body 预算

- Teaching Kernel stable body 总预算：`18_000` 字符。
- 当前阶段非 kernel dynamic body 总预算：`24_000` 字符。
- 单个 skill body 上限：`14_000` 字符。
- 多个大正文使用确定性 water-fill 分配；短正文返还未使用配额，所有当前阶段正文公平获得空间。
- 截断必须带明确 marker；预算统计只记录计数，不记录正文。

## Prefix identity

Stable prefix identity 取决于：

- conversation mode；
- lesson tool policy/availability；
- stable policy 与 skill index；
- 经验证的 app-shipped Teaching Kernel 内容/版本。

以下变化**不得**改变 stable prefix：当前 stage、orchestration plan、preset、页面上下文、记忆/画像、provider runtime facts、个人/custom/stage skill 正文。Teaching Kernel 内容变化属于 app-release/session-stable cache invalidation，会改变 prefix。

## 不变量

- 只有经验证的 app-shipped `teach` 全文可进入 stable prefix；personal/custom skill 即使同 id 也不得 shadow kernel。
- 非 kernel 全文只能进入当前 stage 的 dynamic turn-tail；later/advisory/blocked/excluded 正文不得装配。
- plan projection 不含 skill body、secret、路径或 learner Evidence。
- ledger、settlement sole-writer、`expectedRevision`、`toolsReplayed:false`、effect lattice 与硬 `AgentRunBudget` 不由本 ADR 改变。

## 实现与验证

- `src/main/teaching-conversation-prompt.ts`
- `src/main/teaching-conversation-runtime.ts`
- `tests/unit/teaching-prompt-cache.unit.test.ts`
- `tests/unit/teaching-skill-orchestration-prompt.unit.test.ts`

```bash
pnpm exec vitest run --project unit \
  tests/unit/teaching-prompt-cache.unit.test.ts \
  tests/unit/teaching-skill-orchestration-prompt.unit.test.ts
```

## 不包含

- 不引入供应商特定 `cache_control` 协议字段。
- 不允许任意 skill 自声明 stable-prefix 权限。
- 不改变记忆同意门、课程生成权威、工具审批或外部内容信任边界。
