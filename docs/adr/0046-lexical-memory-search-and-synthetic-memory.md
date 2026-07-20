# ADR-0046：词法记忆检索与教学合成记忆工具

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** main-only 词法检索、`memory_search` / `remember_teaching_memory` / `forget_teaching_memory`、合成记忆索引进 turn-tail、人批门控
- **相关：** [ADR-0001](0001-rebuildable-sqlite-projection.md)、[ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0040](0040-teaching-prompt-cache-contract.md)、[ADR-0042](0042-teaching-footprint-ladder.md)、[ADR-0044](0044-tool-contract-and-write-policy.md)、`docs/improvements/hermes-reasonix.md` §2.1–2.2 / Slice F

## 背景

需要「跨会话 / 记忆检索」与「教学合成条目」而不打开 ADR-0001 禁止的 SQLite FTS 产品面，也不把记忆正文 bake 进稳定 system 前缀（ADR-0040）。Hermes/Reasonix 仲裁要求：

- **main-only** 词法 / BM25 类检索，热路径 **零 LLM**；
- 合成记忆 `remember` / `forget` **需人批**；前缀仅 **title+scope** 索引；
- 结果默认 tool-only，不自动进 system。

## 决策

### 1. 词法检索引擎

- `src/main/ai/teaching-lexical-search.ts`：进程内 n-gram 词法打分 + snippet；无 LLM、无 SQLite FTS、无外部搜索服务。
- 语料默认：教学记忆 catalog（未删除 / 未禁用条目）。
- 可选扩展：`loadAuthorizedDocuments` 可注入 NOTES / learning-records 等已授权本地文件；**当前运行时默认不注入**（catalog-only），接口保留供后续接线。
- **禁止** 将 ADR-0001 analytics SQLite 扩成 FTS 或用户可见搜索语料。

### 2. 工具合同

| 工具 | effect | 门控 |
| --- | --- | --- |
| `memory_search` | `read` | workspace 读能力；返回 id/title/snippet/meta；注明不自动注入 system |
| `remember_teaching_memory` | `workspace_write` | **始终** 需交互批准（跳过 `full_access` / `based_on_approval` 自动放行）；标签强制含 `teaching-synthetic` |
| `forget_teaching_memory` | `workspace_write` | 同上人批；**仅** 可墓碑带 `teaching-synthetic` 的条目 |

- 登记于 `effect-policy.ts`、`agent-capability-policy.ts`（workspace read/write grant 列表）、`docs/tools/TOOL_CONTRACT.md` + `check-tool-contract`。
- 运行时：`tools.enabled && memory.enabled && workspaceToolsEnabled` 时注册。
- 语义分工：学习者画像 / 错题仍走既有 memory 同意捕获；「如何教 X / 易混概念」= 合成记忆或 skill/reference，不静默改写长期 learner profile。

### 3. 索引投影（turn-tail，非 system 前缀）

- `buildTeachingSyntheticMemoryIndexLines`：仅 `teaching-synthetic`、未删除条目的 `id` + `scope` + `title`。
- 经 `teaching-conversation-prompt` 注入 **turn-tail** 教学索引块，不进入稳定 system prefix（ADR-0040）。
- 正文必须经 `memory_search`（或未来授权读工具）按需取。

### 4. 不变量

- 保持 effect lattice 与 capability allow-list；未知工具仍 fail-closed `privileged`。
- 不默认 Mem0 类云记忆；不自动静默改写长期 memory。
- ledger ⟂ run；检索与合成记忆不写 LearningSession outcome。

## 已实施范围与验证入口

- `src/main/ai/teaching-lexical-search.ts`
- `src/main/ai/tools/memory-tools.ts`
- `teaching-conversation-runtime.ts` 注册；`teaching-conversation-prompt.ts` 索引块
- `registry.ts` 合成记忆强制人批
- `TeachingMemoryStore` / workspace 透传 `includeDeleted` 与 `deleteMemory`
- 合同：`TOOL_CONTRACT.md`、`scripts/check-tool-contract.mjs`

```bash
pnpm run check:tool-contract
pnpm exec vitest run --project unit \
  tests/unit/teaching-lexical-search.unit.test.ts \
  tests/unit/memory-tools.unit.test.ts \
  tests/unit/agent-capability-policy.unit.test.ts
```

## 不包含 / non-claims

- **不** 实施 SQLite FTS、产品级全文搜索 UI、或把 analytics projection 当语料。
- **不** 默认加载 NOTES / learning-records（`loadAuthorizedDocuments` 为可选桩，待授权路径接线）。
- **不** 提供 `search_past_teaching_sessions` 独立工具名（本切片以 `memory_search` 覆盖记忆检索；会话归档检索可后续单独立项）。
- **不** 允许 forget 非 `teaching-synthetic` 记忆或静默改 learner profile。
- **不** 把记忆正文 bake 进 system prefix；索引仅 title+scope。
