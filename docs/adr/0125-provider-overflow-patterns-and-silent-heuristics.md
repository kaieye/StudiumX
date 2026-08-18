# ADR-0125：Provider overflow 模式库与静默 overflow 启发式

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施
- **日期：** 2026-07-21
- **范围：** 将 Pi 风格的多 provider context-overflow 文本模式 + NON_OVERFLOW 排除 + 静默 usage 启发式，落地为 recovery 旁 pure 模块，并接入 `classifyProviderRecovery`
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0052](0052-provider-error-and-recovery-taxonomy.md)、[ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)、[ADR-0121](0121-improvements-adoption-closeout.md)；本切片对应历史 Pi 对照审查 ADAPT-P1
- **证据：** `src/shared/provider-overflow-patterns.ts`、`src/shared/provider-recovery.ts`、`src/utils/overflow.ts`；测试 `tests/unit/provider-overflow-patterns.unit.test.ts`、`tests/unit/provider-recovery.unit.test.ts`。

## 背景

`classifyProviderRecovery`（ADR-0052）已把 `context_overflow` 定为 **永不自动重试**、**优先 compress** 的 recovery 类。但 `isContextOverflow` 原先只有少量通用正则：

- 漏检网关方言（Anthropic `prompt is too long`、Gemini token count、OpenRouter endpoint 文案、Cerebras 空 body 400/413、MiniMax / Kimi / DS4 / Ollama 等）
- 无 **NON_OVERFLOW** 排除：Bedrock `ThrottlingException: Too many tokens, please wait…` 会被 `/too many tokens/i` 误标为 overflow
- 无 **静默 overflow**：z.ai（`stop` + usage > window）、Xiaomi MiMo（`length` + output 0 + 输入填满窗口）无法识别

Pi `packages/ai/src/utils/overflow.ts` 维护了实证 pattern 库；本仓 **不** 搬 monorepo pi-ai SDK / AssistantMessage 类型，只移植 pure 匹配与启发式。

## 决策

### 1. Pure 模块

新建 `src/shared/provider-overflow-patterns.ts`：

| 导出 | 作用 |
| --- | --- |
| `matchOverflowErrorText(text)` | OVERFLOW_PATTERNS 命中且 **非** NON_OVERFLOW_PATTERNS → true |
| `isSilentContextOverflow(usage, stopReason, contextWindow)` | stop + input+cacheRead > window；或 length + output===0 + input≥0.99×window |
| `OVERFLOW_PATTERNS` / `NON_OVERFLOW_PATTERNS` | 可测的只读 pattern 列表 |

覆盖族（非穷尽）：Anthropic、OpenAI/LiteLLM、Gemini、xAI、Groq、OpenRouter、Together、llama.cpp、LM Studio、Copilot、MiniMax、Kimi、DS4、Cerebras 400\|413 no body、Mistral、Bedrock input-too-long、Ollama、z.ai `model_context_window_exceeded`、中文网关「上下文超限」等。

### 2. Recovery 接线

`provider-recovery.ts`：

1. 分类顺序 **不变**：billing → auth → **overflow** → max_tokens → …
2. `isContextOverflow` 改为调用 `matchOverflowErrorText`；若 error 对象带 `usage` + `stopReason`/`finish_reason` + `contextWindow`/`context_window`，再跑 `isSilentContextOverflow`
3. **flags 不变**：`class: 'context_overflow'` → `retryable: false`、`shouldCompress: true`、`shouldFallback: false`
4. 无 usage/window 的裸 `finish_reason: 'length'` 仍走 `max_tokens`（与 ADR-0051/0052 一致）

### 3. 与 retry 的边界

- overflow **永不** 进入 auto-retry（ADR-0057 已约束 billing/auth/length/overflow）
- 本 ADR **不** 实现 compress 执行路径；只保证 `shouldCompress` 信号正确
- **禁止** credential rotation

## 已实施范围与验证入口

| 路径 | 变更 |
| --- | --- |
| `src/shared/provider-overflow-patterns.ts` | 新建 pure 模式库 |
| `src/shared/provider-recovery.ts` | 接线 + re-export helpers |
| `tests/unit/provider-overflow-patterns.unit.test.ts` | 各 family 正例、throttling 负例、silent 正/负例 |
| `tests/unit/provider-recovery.unit.test.ts` | 扩展：模式库 → context_overflow 且不重试；throttling 非 overflow；silent 对象路径 |

```bash
pnpm exec vitest run --project unit \
  tests/unit/provider-overflow-patterns.unit.test.ts \
  tests/unit/provider-recovery.unit.test.ts
pnpm typecheck
```

## 明确不包含 / non-claims

1. **不** 自动重试 context overflow（无 sleep/retry loop 变更）
2. **不** 整包移植 Pi monorepo provider SDK / AssistantMessage 类型 / 模型表
3. **不** credential 多 key 旋转或未配置聚合器的自动 failover
4. **不** 改 agent-loop settlement、`toolsReplayed`、effect lattice、默认 shell / MCP marketplace / YOLO / phone-home
5. **不** 保证覆盖所有上游方言；未知文案仍 best-effort，默认不标 overflow

## 与 pi.md §4.1 的关系

本 ADR 关闭 **ADAPT-P1** 实施切片；历史对照审查文档已删除，以本 ADR 与代码为准。后续 pattern 增量可在本模块追加 fixture + pattern，无需新 ADOPTION 表。
