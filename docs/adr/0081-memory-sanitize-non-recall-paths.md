# ADR-0081：非 recall 路径的记忆注入消毒（lesson prompts + memory tools）

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** 将 ADR-0076 的 `sanitizeMemoryInjectionText` 接到 lesson prompt 组装与 memory tool 文档投影（模型可见文本边界）
- **相关：** [ADR-0076](0076-memory-injection-sanitize.md)、[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)、[ADR-0044](0044-teaching-prompt-cache-contract.md)、[ADOPTION S-10](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/shared/memory-sanitize.ts`（既有 helper，本切片不改算法）
  - `src/main/ai/lesson-prompts.ts`（system / user 记忆列表注入前 sanitize）
  - `src/main/ai/tools/memory-tools.ts`（`memoryToDocument` + synthetic index title 投影 sanitize）
  - `tests/unit/lesson-prompts.unit.test.ts`
  - `tests/unit/memory-tools.unit.test.ts`
  - `tests/unit/memory-sanitize.unit.test.ts`

## 背景

ADR-0076 已在 `TeachingMemoryRecall.retrieve` 返回前消毒 content。S-10 residual 审计发现另有两条 **injection / display-to-model** 路径仍直接插值 `memory.content` / `record.content`：

1. `buildLessonSystemPrompt` / `buildLessonUserPrompt` 把长期记忆列表写进课程生成 prompt。
2. `memory-tools` 的 `memoryToDocument` 把 catalog 正文投影为词法检索文档，结果作为 tool output 回到模型；synthetic index 标题亦从 content 派生。

产品地板：同意门控 memory；**禁止 FTS5 / 向量库**；不静默改写 learner-profile。本切片只补边界消毒，不改 consent、存储形状或排序。

## 决策

### 1. lesson prompt 组装

`buildLessonSystemPrompt` 与 `buildLessonUserPrompt` 在 map 记忆列表时对每条 `memory.content` 调用 `sanitizeMemoryInjectionText`，再写入 system / user 文本。scope、id、列表结构不变。

### 2. memory tool 模型侧投影

`memoryToDocument`：

- `text: sanitizeMemoryInjectionText(record.content)`
- `title: titleFromContent(text)`（基于消毒后文本）

`buildTeachingSyntheticMemoryIndexLines` 对 title 派生同样先 sanitize，避免密钥形态进入可索引 title 行。

合成标签（`teaching-synthetic`）判定仍读 `record.tags`，不受 content sanitize 影响。

### 3. 边界语义（storage 仍 raw）

- **On-disk / catalog storage 保持原始 content**；sanitize 仅作用于注入模型或作为 tool 结果返回给模型的投影。
- 不改 `TeachingMemoryStore` schema、create/delete、consent 总闸。
- 词法检索仍可在已 sanitize 的 document 文本上打分；**不**引入 FTS5 / 向量检索；排序策略本身未重设计（引擎仍 ADR-0050）。

## 已实施范围与验证入口

```bash
CI=true pnpm exec vitest run --project unit \
  tests/unit/memory-sanitize.unit.test.ts \
  tests/unit/lesson-prompts.unit.test.ts \
  tests/unit/memory-tools.unit.test.ts
```

## 不包含 / non-claims

- **不** 实施 SQLite FTS5、产品全文搜索 UI、或向量 / embedding 检索。
- **不** 启动自动 memory phase / dream / 静默改写 learner-profile / 自动 skill 创建。
- **不** 改变 consent capture 语义或 Memory catalog 分区 / migration 权限。
- **不** 改写 catalog 持久化正文（storage remains raw；sanitize at inject/display boundary only）。
- **不** 重做跨会话 recall 排序或 n-gram 策略。
- conversation turn-tail 等其它注入路径若仍有 residual，可后续单独立项共用同一 helper。
