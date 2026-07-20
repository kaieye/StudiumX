# ADR-0041：Context hygiene ladder and quality gates

- **状态：** 已实施（文档与质量门）；投影阶梯代码沿用既有 projector/compactor
- **日期：** 2026-07-21
- **范围：** request-context 投影阶梯语义、PR/CI 路径敏感门、本地 pre-push 子集、SECURITY 与测试教义入口
- **相关：** [ADR-0013](0013-budgeted-provenance-aware-teaching-context.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0040](0040-teaching-prompt-cache-contract.md)、`SECURITY.md`、`docs/testing.md`

## 背景

Hermes 与 Reasonix 在「压缩 / 上下文维护」上曾冲突：一方倾向 durable 历史改写不变量，另一方倾向可重算 projection 阶梯。StudiumX 已有 `RequestContextProjector`、`request-history-hygiene` 与 `ContextCompactor`，且教学 assembler（ADR-0013）与 chat request projection 必须分离。质量侧需要路径敏感的 PR 元数据与可选 pre-push，同时保持 Blocking CI 窄而硬（ADR-0023）。

## 决策

### 1. 上下文维护分层（唯一语义）

| 层 | 行为 | 默认 |
| --- | --- | --- |
| **A. Provider 投影**（每轮、可重算） | history hygiene（旧 tool 结果 snip / 超预算 digest）→ 阈值估算 → 超 soft/hard 阈值时 LLM compact；保护 system 前缀与尾部消息，并修复 tool-call 配对边界 | **默认路径**；实现于 `src/main/ai/request-history-hygiene.ts`、`request-context-projection.ts`、`context-compactor.ts` |
| **B. Durable compaction boundary**（稀有、显式） | 将 compaction 边界写入 conversation 文件，避免超长会话反复重摘要 | **可选 / 未默认开启**；仅当产品明确需要跨长会话恢复时再单独立项 |

**不变量**

- 压缩失败：冷却 / 防 thrash；**不得**静默毁掉 LearningSessionLedger 权威或 settlement。
- ADR-0013 教学 assembler 与 chat request 压缩 **分离**；本 ADR 不改 teaching context allowlist。
- 投影可瘦、审计完整；ProjectionReport 保持隐私安全（无 raw prompt / learner answers / 完整绝对路径）。
- 归档原件仍可供后续检索工具读取（见 ADR-0001 no-FTS 与未来 Slice F）；不等于把摘要 bake 进稳定 system（ADR-0040）。
- **不**把「除 compression 外不改 context」绑死在每轮 projection 上（避免与 durable transcript SoT 打架）。

Keep-policy（层 A 默认）：

- 保留 system 前缀消息。
- 保留足够 tail（token 预算 + 最小消息数），并 repair tool pair 边界。
- 压缩摘要仅作为 reference-only 插入，不替代 ledger / evidence 事实。

### 2. 信任模型入口

根级 `SECURITY.md` 声明工作区路径、密钥存储、provider 出站、日志/support-bundle 脱敏、effect 授权为产品边界；明确非 shell / 非 OS 隔离声称；报告渠道见该文件。

### 3. 质量门

| 门 | 作用 |
| --- | --- |
| Workflow concurrency | 全部 `.github/workflows/*.yml` 顶层 `concurrency` + `cancel-in-progress: true` |
| PR template | `.github/pull_request_template.md`：Teaching-impact / Privacy-impact / Prompt-prefix-guard / Settlement-guard |
| `pnpm run check:teaching-impact` | 有 PR body 时，路径命中敏感前缀则要求对应元数据字段 |
| `pnpm run check:prepush` | 本地子集：`typecheck` + `check:security`；可选 `.githooks/pre-push` |
| `docs/testing.md` | 反 change-detector：优先 import 真模块 + temp workspace |

Blocking CI 仍保持窄门（typecheck / security-privacy / P0 teaching evidence），不因本 ADR 自动扩成 full suite。

## 已实施范围与验证入口

- `SECURITY.md`
- `docs/testing.md`
- `.github/pull_request_template.md`
- `.github/workflows/*.yml`（单一顶层 concurrency）
- `.githooks/pre-push`（可选：`git config core.hooksPath .githooks`）
- `scripts/check-prepush.mjs`、`scripts/check-teaching-impact.mjs`
- `package.json`：`check:prepush`、`check:teaching-impact`

```bash
pnpm run check:teaching-impact
pnpm run check:security
# 可选本地：pnpm run check:prepush
```

投影代码既有验证入口：

```bash
pnpm run check:context-compactor
pnpm run check:context-projection-report
pnpm run check:agent-loop-context-hygiene
pnpm run check:agent-loop-context-compaction
```

## 不包含 / non-claims

- 不默认开启 durable compaction boundary（层 B）。
- 不引入 SQLite FTS、shell、MCP 市场、自动遥测。
- 不改变 ledger sole-writer、effect lattice 或 prompt-cache 合同（ADR-0008/0021/0023/0024/0040）。
- 不把 Playwright / 全量 `check:*` 塞进每个 PR。
- 不授权烧真实模型 key 的默认 CI benchmark。

## 后果

- 上下文维护有唯一产品语义：默认可重算投影阶梯，durable 改写为显式可选。
- 贡献者有薄而可执行的安全/测试入口，而不稀释 Blocking CI。
