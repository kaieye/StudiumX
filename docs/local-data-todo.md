# 本地数据待办

> 本文是本地数据**下一步工作的唯一入口**。已完成的架构决定及其证据见 [ADR 索引](adr/README.md)。
>
> 下列条目记录未完成范围及待批准的设计门；设计文档不是实现授权。个别条目会标明已实施的受限切片，但不得把该切片的建议、验证矩阵或候选 contract 扩大为 complete durable closure。

## 先决规则

1. 任何后续切片先在对应 design gate 获得 scope / owner / API 批准，再单独立项；不得直接修改其 writer 以“顺手迁移”。
2. canonical JSON、Markdown、JSONL、immutable record 和 Memory 文件仍是事实来源；projection、分区、sealing、summary、`.bak` 与 receipt 都不授权删除或替代事实来源。
3. [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 记录的是**部分** consumer migration：C-4P8 已在受控 `write_workspace_file` 的文本文件 create / restricted-overwrite scope 关闭，但这不表示所有 writer 已迁移、完整 C-4P6、完整 C-4P9 或跨文件事务已经完成；C-4P6-S1 也不得扩大为完整 C-4P6。不得把 [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md) 解释为全局 actionId / retry / receipt。

## C-4：仍未完成的其它 durable writer / closure 设计门

### P9：session-audit durable append

- 设计文档：[C-4P9 Session-audit durable append](plans/local-data-session-audit-durable-append-design.md)
- **已实施范围仍仅限 S2 + tests-only evidence：**`4b30220` / `5f47382` 完成 **P9-S2 audit 专用 framed、legacy-compatible、fixed-file durable append**；`c286a42`（`test(data): cover audit durable append recovery`）完成严格 **P9-S3 tests-only evidence slice**；`ab723a6`（`test(data): cover audit pre-write short-circuit`）完成严格 **P9-S4 tests-only evidence slice**；`47393f9`（`test(data): cover audit directory capability symmetry`）完成严格 **P9-S5 tests-only evidence slice**。证据与实际验证入口见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。
- **S2 实现范围：**仅固定 `.agent-sessions/<conversation-id>.jsonl`；不 rotation、不调用 generic `durable-jsonl`；per absolute audit path queue 覆盖 same-descriptor exact-byte read / validate / dedupe / framed append / file fsync+close，随后 audit directory、再 conversation parent directory durability confirmation。directory open/sync 仅五个 allowlist code 可降级为通用 warning；post-directory failure retry 会先 dedupe exact rows，之后才继续既有 ledger flow。
- **S3 历史 evidence：**`c286a42` 仅补齐 P9-S2 的 partial-write 与 archive-level failure/retry 定向证据：fixed-file non-rotating audit append 的真实 partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory `open`/`sync`/`close`、conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；无生产语义改动。其定向 unit 覆盖 2 个文件、61 tests passed；当时实际运行 `pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 均通过。
- **S4 新增 evidence 范围：**`ab723a6` 仅补齐 archive save 层的**首个 audit write 注入 `EIO` 且 audit 为 0 bytes**的 short-circuit/retry evidence：JSON/Markdown 保留、ledger 未执行；clean retry 后每个 canonical audit row 恰一条、ledger 恰一条。无生产语义改动；验证入口为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts`（1 file、27 tests passed）。
- **S5 新增 evidence 范围：**`47393f9` 仅修改测试，未修改 production code；Sol review approved。它对 audit directory 与 conversation parent directory 的 `open`/`sync` 做 capability symmetry 定向证据：五个 allowlist code `EINVAL`/`ENOSYS`/`ENOTSUP`/`EOPNOTSUPP`/`EISDIR` 各覆盖两层、两种操作，共 20 cases；每个成功且恰好产生一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 返回 `EINVAL` 仍 fatal。验证入口与结果为：单独运行 `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`（当前 S5 本切片：1 file、51 tests passed）；与 archive durable 一起运行（当前 S5 本切片：2 files、78 tests passed）；另有 `pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 通过。无 production/API/schema/order 变化。
- **仍未完成：**C-4P9 整个 gate 未关闭。S2 的实现与 S3/S4/S5 evidence 不表示 generic JSONL migration、跨文件 transaction、ledger authority 或 archive save-order 变更、repair、rotation、IPC/UI 已实施；S5 只补 capability symmetry 的这 20 个定向 tests-only cases，不是完整 capability matrix，也不是 full suite 或生产功能。并发、trace、generic JSONL、rotation、事务、ledger authority/save order、repair、IPC/UI 及其它 residual matrix 仍保留在 design gate 中，继续等待后续批准。
- 禁止越界：继续 **non-rotating**；不得接入 `appendDurableJsonlLine()` 的默认 month / size rotation，也不得将 C-4P1 archive publish 或 C-5E trace 计为完整 P9。不得以 S2 改变 ledger authority、JSON → Markdown → audit → 既有 ledger queue → final verify 的顺序，或扩大为其它 JSONL writer。

### P6：learning-outcome durable settlement 的剩余 close-out 设计门

- 设计文档：[C-4P6 Learning outcome durable settlement](plans/local-data-learning-outcome-durable-settlement-design.md)；已实施范围和提交证据见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。
- **已实施且仅限 S1 + S2 + S3 tests-only evidence：**`7292bf4` / `e02a086` 实现严格有序 publish、内置 ledger 的私有 writer-lock 覆盖、fail-closed injected load-only ledger，以及 authority-first controlled reconcile。`9847842`（`test(data): cover outcome publish crash recovery`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐单一 `after_outcome_publish` crash window 的恢复证据；没有 production/API/schema/path/order 变化。`1334513`（`test(data): cover outcome marker recovery`）只扩展同一个既有 unit `it`，补齐 settlement-marker durable rename 返回 `EIO` 后的受限 restart/reconcile evidence；没有 production/API/schema/path/order 变化，也不是新增 test count。它不是完整 settlement closure。
- **S2 evidence 的准确边界：**初次 commit 返回 `retryable_failure/reconciliation_required`；record 与 matching outcome 已存在，manifest 仍为 `active` / `outcomeRef: null`，marker 缺失，且未继续 manifest、marker 或 catalog-success。重启后的 reconcile 使用 immutable record authority，返回 `repaired`，不重新运行 evaluator、不重写 outcome，并按 manifest → marker 发布；第二次 reconcile 返回 `settled`，record/outcome/manifest/marker 四份 bytes 稳定；同一 operation 返回 `already_committed`，四份 bytes 仍稳定。验证入口为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 28 tests passed），另有 `pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 通过。
- **S3 evidence 的准确边界：**初次 commit 中现有 settlement-marker durable rename 返回 `EIO`；immutable record、`outcome.json` 与已 `completed` 的 manifest 存在而 marker 为 `ENOENT`。重启后的 reconcile 以 immutable record authority 仅发布 marker，evaluator / `createId` 不重跑，record/outcome/manifest 不重写；第二次 reconcile 与同 operation replay 的四份 canonical bytes 稳定。`1334513` 只扩展同一个既有 unit `it`，验证仍为同一 1 file / 28 tests passed（不是新增 test count）；typecheck、security check、diff check 通过。
- **S1/S2/S3 必须分开计数和命名：**S1 是 41 项 unit + 14 项 integration 的历史有限证据；S2 只覆盖单一 `after_outcome_publish` crash window；S3 只覆盖 marker final rename `EIO` failure/restart/reconcile。S3 不是泛化 `after_manifest_publish`、完整 manifest failure matrix、生产功能或完整 C-4P6 closure。
- **仍未完成：**完整 C-4P6 因 manifest capability-policy、manifest `open` / `write` / `fsync` / `close` 完整矩阵、其它 crash/failure、跨文件 transaction、rollback、delete、migration、API、operations validation 及完整 close-out 尚未完成，必须继续保留在本待办；不要删除 design/todo。

## C-5：尚未覆盖的用户动作 correlation 设计门

### P5H：workspace user mutation（mission-first）

- 设计文档：[C-5H Workspace 用户变更 correlation](plans/local-data-workspace-user-mutation-correlation-design.md)
- 当前未获产品 / API 批准，**不可直接实施** `mission_updated` correlation、actionId 或 private receipt。
- 首个候选范围仅为 mission-first；`lesson_style_applied` 的 settings second write 不能被悄然并入。

### P5I：direct-UI lesson generation

- 设计文档：[C-5I Direct-UI lesson generation correlation](plans/local-data-lesson-generation-user-action-correlation-design.md)
- 当前未获产品 / API 批准，**不可直接实施**。需先决定 actionId 生命周期、provider-authority private receipt、receipt retention / authority，以及 `success`、`reused`、`rejected`、`conflict`、`indeterminate` 结果语义。
- 禁止越界：仅覆盖 renderer direct UI 的 `generateLesson` / stream；不覆盖 agent `generate_lesson`、mission、lesson style 或 generic workspace writer。provider outcome unknown 时不得自动重跑。

## C-6：controlled legacy Memory 迁移设计门

- 设计文档：[C-6 受控 legacy Memory 搬迁](plans/local-data-memory-controlled-migration-design.md)
- 已有的 C-6A 只读 aggregate preflight 不授权真实迁移。未来必须先批准可信 main identity / scope、copy → 内部 checksum verify → explicit confirmation → delete、durability / recovery 与审计协议。
- 禁止越界：不得启动、后台或自动迁移，不得由 preflight 暴露或推导 candidate/path/content/hash。
