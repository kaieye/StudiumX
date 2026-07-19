# C-4P9 Session-audit durable append：设计门（P9-S2 已实施；P9-S3/S4/S5/S6/S7/S8/S9/S10/S11/S12 evidence 已完成；C-4P9 未关闭）

> **状态：P9-S2 已实施，P9-S3/S4/S5/S6/S7/S8/S9/S10/S11/S12 tests-only evidence slice 已完成；C-4P9 design gate 仍 pending。**`4b30220`（`feat(data): add durable session audit append`）与 `5f47382`（`test(data): cover durable session audit append`）完成最小切片 **P9-S2 audit 专用 framed、legacy-compatible、fixed-file durable append**；`c286a42`（`test(data): cover audit durable append recovery`）保留 P9-S2 partial-write 与 archive-level failure/retry 的实际历史 evidence；`ab723a6`（`test(data): cover audit pre-write short-circuit`）仅补齐首个 audit write `EIO`、0 bytes 的 archive-save short-circuit/retry evidence；`47393f9`（`test(data): cover audit directory capability symmetry`）仅修改测试，补齐 audit/parent directory `open`/`sync` 的 20 个 allowlist capability symmetry cases；`5f931c9`（`test(data): cover audit ledger failure recovery`）仅修改测试，加强 ledger-own failure residual：audit 在 ledger 失败后不 rollback/不重复追加，retry 与后续 save 保持 audit/ledger idempotent；`816e403`（`test(data): cover concurrent identical audit saves`）仅修改测试，补齐 concurrent identical same-save 的 per-path linearization + exact dedupe residual；`bee173f`（`test(data): cover audit divergent-trace conflict`）仅修改测试，补齐 on-disk 同 identity 但 trace 分叉时 fail closed、不得误作 exact dedupe 的 residual；`dcb9bae`（`test(data): cover concurrent same-ID body conflict`）仅修改测试，补齐 concurrent same-ID 但 canonical body 分叉时 fail closed 的 residual；`9d54c5e`（`test(data): cover markdown publish short-circuit residual`）仅修改测试，补齐 Markdown durable write/file-sync/file-close/rename 失败时保留 JSON、不 append audit/ledger 的 archive short-circuit residual。`bab5d1e`（`test(data): cover markdown directory close residual`）仅修改测试，补齐 Markdown-phase directory close 失败时 JSON 与 Markdown 均已发布、不 append audit/ledger 的 archive short-circuit residual。`2aec1bc`（`test(data): cover markdown directory sync residual`）仅修改测试，补齐 Markdown-phase directory fsync 失败时 JSON 与 Markdown 均已发布、不 append audit/ledger 的 archive short-circuit residual。本文保留各切片的受限 evidence 和 P9 后续风险；它**不宣称 C-4P9 已完成**，也不授权 generic JSONL migration、跨文件 transaction、ledger authority/save-order 变更、repair、rotation 或 IPC/UI。

P9-S2 只替换 per-conversation 固定 `.agent-sessions/<conversation-id>.jsonl` 的 append boundary：不 rotation、不调用 generic `durable-jsonl`；per absolute audit path queue 在线性化的 same-descriptor 生命周期中完成 exact-byte read、validate/dedupe/conflict、framed append、file `fsync`/`close`，再按 audit directory、conversation parent directory 的顺序确认 durability。directory `open`/`sync` 仅 `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 可降级为通用 warning；post-directory failure retry 先 dedupe exact rows，之后才允许既有 ledger flow 继续。

P9-S3 是严格 tests-only historical evidence slice，P9-S4、P9-S5、P9-S6、P9-S7、P9-S8、P9-S9、P9-S10、P9-S11 与 P9-S12 同为严格 tests-only evidence slice；均不改变生产 contract。S4 仅覆盖首个 audit write `EIO`、0 bytes 的 short-circuit/retry。S5 覆盖 audit directory 与 conversation parent directory 的 `open`/`sync`：五个 allowlist code 各覆盖两层、两种操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 的 `EINVAL` 仍 fatal。S5 无 production/API/schema/order 变化，也不是完整 capability matrix。S6 仅覆盖 ledger-own failure residual。S7 仅覆盖 concurrent identical same-save linearization。S8 仅覆盖 on-disk 同 identity 但 trace 分叉时 fail closed、不得误作 exact dedupe。S9 仅覆盖 concurrent same-ID 但 canonical body 分叉时 fail closed 并保留 winner bytes。S10 仅覆盖 Markdown durable write/file-sync/file-close/rename 失败时保留 JSON、不 append audit/ledger 的 archive short-circuit residual。S11 仅覆盖 Markdown-phase directory close（第二次 directory close）失败时 JSON 与 Markdown 均已发布、不 append audit/ledger 的 archive short-circuit residual。S12 仅覆盖 Markdown-phase directory fsync（第二次 directory sync）失败时 JSON 与 Markdown 均已发布、不 append audit/ledger 的 archive short-circuit residual。

C-4P1 `34c48f4` 的 JSON/Markdown durable replace 仍只提供既有有序 archive boundary。P9-S2 保持 JSON → Markdown → audit → existing ledger queue → final verify 的顺序，且不改变 audit JSONL schema/version、parser、raw historical bytes、trace write-once 规则、archive/ledger authority、IPC/UI 或任何 canonical bytes。不得以 C-4P1、C-5E trace、shared `replaceDurably()` 或其它 JSONL writer 的通过证明整个 C-4P9 已 durable。

> 后续工作的统一入口见 [本地数据待办](../local-data-todo.md)；已实施决定见 [ADR 索引](../adr/README.md)。

## 1. 固定 scope 与不变量

未来 scope **仅**是一个已解析 conversation 的固定 session-audit 文件 append：

```text
<conversation>/.agent-sessions/<conversation-id>.jsonl
```

当前 writer 为 `appendAgentConversationSessionAuditLog()`（`src/main/agent-conversation-session-audit.ts`），archive save 由 `saveAgentConversationArchive()`（`src/main/agent-conversation-archive.ts`）调用。future implementation 只能替换这个固定 audit-path 的 append boundary；不授权迁移其它 JSONL、artifact、checkpoint、archive、ledger 或 workspace writer。

必须保持以下不变量：

- **单文件、non-rotating。**不得使用 `durable-jsonl` 的默认月度/size sealing 或任何 rotation。audit header、entry-ID dedupe、archive verification、history/artifact protection 与 deletion lifecycle 都以此固定文件及其历史 bytes 为前提；拆成 sealed segments 会改变这些语义。
- audit JSONL version/schema、header/entry ID、`parentId`、排序、现有 raw bytes、tolerant parser 与 legacy read 行为保持不变；不回填、不规范化、不 rewrite 历史行。
- C-5E 的 trace 是可选、write-once correlation metadata：新 header/entry 只写经既有 normalize 的安全值；trace 不进入 audit ID/hash/parent/dedupe；legacy trace-free 或 malformed rows 保持 tolerant read 且不改写。C-4P9 **不是** C-5 trace、action identity、receipt、idempotency-model 或 schema rewrite。
- 不引入 actionId、transaction、多文件原子性、rotation、retention、migration、repair UI/IPC、历史扫描或 deletion policy change。

## 2. Save 顺序、authority 与完成语义

future implementation 必须保留 `saveAgentConversationArchive()` 的有序边界：

1. canonical JSON durable replace；
2. canonical Markdown durable replace；
3. session audit durable append；
4. learning-work ledger queue callback 内的 ledger append；
5. final archive verify。

这是有序 publish，**不是多文件 transaction**，不承诺跨 JSON、Markdown、audit 和 ledger 的共同原子性或 post-publish rollback。

具体 authority/short-circuit 要求：

- JSON durable failure：不得写 Markdown、audit 或 ledger。
- Markdown durable failure：JSON 可以保留；不得写 audit 或 ledger。
- audit append failure：JSON/Markdown 可以保留，但**不得**运行 ledger append；save 必须失败。
- ledger append failure：JSON/Markdown/audit 都可留存，但 save 必须失败；不得把已存在 audit 当作此次 save 已确认成功。
- retry 必须保持 archive 的 stable ledger-entry semantics：ledger 仍负责其既有 queue/identity verification/idempotency；audit repair 不能发明第二种 ledger identity、receipt 或 action protocol。
- final verify 永远排在 ledger callback 成功之后；不得在 audit bytes 可读时跳过 ledger 或 final verification。

## 3. Audit append contract

future writer 必须引入 **per audit-path queue**。queue 覆盖同一路径的完整 read → validate → dedupe/conflict 判定 → append → file fsync/close → parent-directory sync/close 区间；不能只串行化最后一个 `appendFile()`。

### 3.1 读取、legacy rows 与 dedupe

- `ENOENT` 是唯一可视为“空 audit”的 read result；`EACCES`、I/O、unknown、directory/symlink/type error、close error 和其它 read failure 必须 reject/fail closed。
- 必须在 queue 内读取并解析当前 bytes，再据同一 snapshot 建立 header/entry identity 与待追加 rows。
- retry/continuation 若所有待追加 canonical rows 已存在且 canonical row identity/trace 均一致，可作为 no-op 成功；不得重写已有 bytes。
- 同一 entry ID 或 header identity 但 canonical row/trace 不同，必须作为 conflict 失败；不得静默把它当作“已写成功”，不得覆盖、删除、合并或回填既有 row。
- trace 比较必须沿用 C-5E 的 write-once/normalization 规则：legacy malformed/trace-free row 仍可 tolerant read，但不能被 durable migration rewrite 成新 trace，也不能借 dedupe 改写 row。

### 3.2 Torn tail、non-newline 与 malformed legacy bytes

future implementation 必须在获批前选择并测试一个**保守、无 rewrite**的策略：

- 对最后一段 non-newline / torn tail、以及任何 malformed legacy row，不能把新 JSON 直接拼到末尾，使两段 bytes 变成一条不可解析的 row；
- 不得为了“修复”而 truncate、补换行、重序、格式化、删除或 rewrite 历史 bytes；
- 若无法在不改写现有 bytes 的前提下证明安全 append，必须 reject 并让 save fail closed；
- 若批准一种可追加策略，必须精确定义它只接受哪些 tail 形态、如何保持原 bytes、如何使 parser/reader compatibility 不变，以及如何避免将 malformed row 误当作可 dedupe 的 canonical row。

不能将当前 tolerant parser 的“读取时忽略 malformed line”误用为 append authorization。

## 4. Durable publish 与失败边界

C-4P9 需要 audit-specific durable append primitive 或获批准的 shared extension，最少顺序为：在已验证的 audit path 上 append complete newline-delimited batch → file fsync → file close → parent directory sync → parent directory close。

- pre-append 的 write/file-sync/file-close failure：不得确认新的 audit row；不得运行 ledger append；旧 audit bytes 必须保留。任何临时/partial append 状态只能按批准的 append recovery contract 处理，不能虚报成功。
- append 完成但 parent directory sync/close 失败：本次必须 reject/fail closed；新的 row **可能已存在**，但不得运行 ledger append，也不得 rollback、truncate、删除或覆盖 audit。该状态是 complete-but-unacknowledged 的 append 变体。
- retry 必须重新进入同一路径 queue、读取当前 bytes、逐行验证 exact canonical rows；已经存在的完全相同 rows 不得重复追加，冲突 rows 必须失败。retry 不得仅凭内存 flag、旧 read snapshot 或“append 曾抛错”猜测结果。
- 只有 shared directory-fsync capability allowlist 的五个 code 可允许明确降级：`EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR`。warning 必须通用，且不得含 path、content、entry/header ID、trace 或其它敏感/可关联数据。`EACCES`、`EPERM`、`EIO`、unknown 与任何 close failure 均 fatal。
- 不承诺 rollback transaction。尤其不得在 post-directory failure 后删除已追加行，或为了让 ledger 重试“干净”而重写 audit。

## 5. Concurrency、archive/ledger recovery 与 helper 边界

- 同一 audit path 的 concurrent initial save、continuation、retry 必须由 per-path queue 线性化。不同 audit path 不获得不必要的全局 serialization。
- queue 必须覆盖 audit dedupe 与 append，不得让两个 concurrent saves 用同一旧 snapshot 各自认为 header/entry 缺失。
- archive/ledger recovery 必须遵守第 2 节顺序：audit 的 post-directory failure 后，下一次 retry 可以通过 exact-row no-op repair audit acknowledgement，但只能随后让既有 ledger queue 做其稳定 entry 判定；不得绕过 JSON/Markdown preconditions、ledger identity verification 或 final verify。
- ledger 自身失败后的 retry 必须不重复 audit rows，也不得将 audit-only 结果误报为 archive save success。
- artifact materialization/protection、history index protection、archive verification 和 deletion lifecycle 的既有固定-file assumptions 必须保持；不得以 rotation、segment discovery 或自动 cleanup 改变它们。

`appendDurableJsonlLine()` **不得直接用于 C-4P9**，除非先有经批准的 non-rotation option、audit-specific path/row contract 与可注入 I/O seam。其现有 month/size sealing model 不构成 audit append 的安全替代；把 audit path 接入默认 rotation 即为破坏性语义变更。

## 6. P9-S2 实施与 P9-S3/S4/S5 evidence 验证；仍未关闭的测试矩阵

`c286a42` 的 P9-S3 定向 unit 覆盖 2 个文件、**61 tests passed**；`ab723a6` 的 P9-S4 仅运行 archive durable 定向 unit：1 file、27 tests passed。当前 `47393f9` 的 P9-S5 单独运行 session-audit unit 为 **1 file、51 tests passed**，与 archive durable 共同运行是 **2 files、78 tests passed**；另通过 `pnpm run typecheck`、`pnpm run check:security`、`git diff --check`。这些都是定向 evidence，**不是完整 suite**：

```sh
# P9-S3 historical evidence
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts
pnpm run typecheck
pnpm run check:security
git diff --check

# P9-S4 pre-write short-circuit evidence
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts

# P9-S5 current capability-symmetry evidence
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts
pnpm run typecheck
pnpm run check:security
git diff --check
```

P9-S3 新补齐的定向 evidence gap 仅为：

- P9-S2 fixed-file durable append 的真实 partial-write 路径：partial prefix、torn-tail framing 与 dedupe；
- archive-level failure/retry 矩阵：audit file `sync`/`close`、audit directory `open`/`sync`/`close`、conversation parent directory `open`/`sync`/`close` failure 后的 clean retry。

上述 evidence slice 都没有生产语义改动。**P9-S3 保留 partial-write 与 archive-level failure/retry 的实际历史证据；P9-S4 仅补齐首个 audit write `EIO`、0 audit bytes 的 archive-save short-circuit/retry evidence；P9-S5 仅补齐上述 20 个 directory capability symmetry cases；P9-S6/S7/S8/S9/S10/S11/S12 分别仅补齐 ledger-own failure、concurrent identical same-save、divergent-trace conflict、concurrent same-ID body conflict、Markdown durable publish short-circuit、Markdown-phase directory close short-circuit 与 Markdown-phase directory fsync short-circuit 的定向 evidence；C-4P9 仍未关闭。**

下表仍是完整 C-4P9 后续切片/close-out 必须保留的 residual matrix；P9-S3/S4 只补齐上方明确列出的定向 evidence，不把其它项目、其它 JSONL writer 或跨文件 failure matrix 记为已关闭：

| 测试类别 | 最低验证 | P9-S3..S12 evidence 状态 |
|---|---|---|
| non-rotation compatibility | 固定 `.agent-sessions/<conversation-id>.jsonl` 继续单文件；不产生 sealed/month/size segment；header、entry IDs、archive verification、history/artifact protection 与 deletion lifecycle compatibility 不变。 | 未由 P9-S3/S4 关闭；仍属 residual matrix。 |
| C-4P1 save short-circuits | JSON failure 不触发 Markdown/audit/ledger；Markdown failure 不触发 audit/ledger；audit failure 不触发 ledger；ledger failure 可留 JSON/Markdown/audit 但 save reject；success 后才 final verify。 | P9-S4 仅补齐首个 audit write `EIO`、0 audit bytes 时 JSON/Markdown 保留、ledger 未执行及 clean retry；P9-S10 仅补齐 Markdown durable write/file-sync/file-close/rename 失败时保留 JSON、不 append audit/ledger；P9-S11 仅补齐 Markdown-phase directory close residual；P9-S12 仅补齐 Markdown-phase directory fsync residual；其它 short-circuit 仍属 residual matrix。 |
| durable failpoints | append write、audit file fsync/close、audit directory 与 conversation parent directory open/sync/close；pre failures 无新 acknowledged row/no ledger；post-directory failure reject、不 rollback、无 ledger。 | P9-S3 仅补齐 archive-level audit file sync/close 及两层 directory open/sync/close failure+clean-retry；P9-S4 仅补齐首个 audit write `EIO`、0 audit bytes。完整 failpoint matrix 仍未关闭。 |
| post-directory retry | 第一次 append 后 audit directory 或 conversation parent directory failure；第二次在同一 per-path queue 内 read/dedupe，确认 exact rows 后不重复追加，再允许既有 ledger/final-verify 路径继续。 | P9-S3 已补齐上述 archive-level directory failure/clean-retry 的定向 evidence；P9-S4 不扩大该范围；不等于 C-4P9 gate closure。 |
| ledger-own failure retry | audit 成功、ledger 失败后 retry 不追加 duplicate audit rows；ledger 的 stable entry/idempotency/conflict 语义保持。 | P9-S6 已补齐 archive 层 ledger-own failure residual 的定向 evidence（exact audit bytes、单 ledger 行、后续 save idempotent）；不等于完整 residual matrix 或 C-4P9 gate closure。 |
| concurrency | concurrent same save、initial+continuation、同 ID retry；一个 header、无 duplicate entry、正确 parent chain；不同 canonical rows 共享 ID 时 conflict fail closed。 | P9-S7 仅补齐 concurrent identical same-save；P9-S9 仅补齐 concurrent same-ID body conflict fail-closed + winner bytes；既有 initial+continuation linearization 与 sequential same-ID body conflict 保持；不等于完整 concurrency matrix 或 C-4P9 gate closure。 |
| read/tail corruption | `ENOENT` 空文件；`EACCES` 与其它 read failure reject；malformed legacy row、torn tail、non-newline tail 不静默拼接/重写；批准策略外一律 fail closed。 | P9-S3 已补齐 partial prefix、torn-tail framing、dedupe 的定向 evidence；P9-S4 不扩大该范围；其余 read/tail residual matrix 仍保留。 |
| trace/legacy compatibility | C-5E normalized write-once trace、legacy trace-free/malformed tolerant read、既有 raw bytes 不回填/不 rewrite；trace conflict 不得误作 dedupe success。 | P9-S8 仅补齐 on-disk 同 identity 但 trace 分叉时 fail closed、不 rewrite 的定向 evidence；legacy tolerance 与完整 write-once residual 仍属 residual matrix。 |
| capability downgrade | 仅五-code allowlist 可降级，warning 无 path/content/ID/trace；permission/I/O/unknown/close failure fatal。 | P9-S5 仅补齐 audit/parent directory `open`/`sync` 的 20 个 symmetry cases；完整 capability matrix 仍属 residual matrix。 |
| existing suites | `tests/unit/agent-conversation-session-audit.unit.test.ts`、`tests/unit/agent-conversation-archive-durable.unit.test.ts` 及相关 archive/ledger compatibility tests 继续通过；新增或后续测试必须清楚标明归属哪个已批准的 P9 evidence 或 implementation slice，且不得把本 design gate 记为已关闭。 | P9-S3 历史记录为 2 个 unit 文件、**61 tests passed**；P9-S4 为 1 个 archive durable unit file、27 tests passed；当前 P9-S5 为 1 file、**51 tests passed**，与 archive durable 共同运行 **78 tests passed**；P9-S6 为 archive durable 1 file、**27 tests passed**（加强既有 it，非新增 count）；P9-S7 为 session-audit 1 file、**52 tests passed**；P9-S10 为 archive durable 1 file、**30 tests passed**（write 单测并入 4-case matrix，净 +3）；P9-S11 为 archive durable 1 file、**31 tests passed**（Markdown-phase directory close residual）；P9-S12 为 archive durable 1 file、**32 tests passed**（Markdown-phase directory fsync residual）；不是 full suite，残余矩阵仍保留。 |

## 7. P9-S2/S3/S4/S5/S6/S7 后边界与仍待批准范围

P9-S2 只授权并实现本文件所述的固定 audit-file durable append；P9-S3/S4/S5/S6/S7/S8/S9/S10/S11/S12 只提供上述 tests-only evidence，不改变生产语义。S5 的范围严格限于 20 个 directory capability symmetry cases；S6 的范围严格限于 ledger-own failure residual 的定向 evidence；S7 的范围严格限于 concurrent identical same-save linearization 的定向 evidence；S8 的范围严格限于 divergent-trace conflict fail-closed 的定向 evidence；S9 的范围严格限于 concurrent same-ID body conflict fail-closed 的定向 evidence；S10 的范围严格限于 Markdown durable write/file-sync/file-close/rename short-circuit residual 的定向 evidence。S11 的范围严格限于 Markdown-phase directory close short-circuit residual 的定向 evidence。S12 的范围严格限于 Markdown-phase directory fsync short-circuit residual 的定向 evidence。不能据此扩展为完整 capability matrix、并发、完整 trace/legacy matrix、generic JSONL、rotation、事务、ledger authority/save order 或 API 的 evidence。这些切片都不授权 generic JSONL migration 或调用 `appendDurableJsonlLine()`、跨文件 transaction、改变 audit parser、重写/修复 existing JSONL、rotation、schema/version 变化、trace/action identity 改造、ledger authority 或 archive save-order 调整、artifact/history/deletion lifecycle 变化或新的 IPC/UI。

完整 C-4P9 仍须在本 design gate 中逐项保留并批准 non-rotation helper 边界以外的后续 scope、其余 failure coverage、其它 writer 是否可迁移，以及第 6 节尚未关闭的完整 residual matrix。路线图与 implementation plan 只能记录：**“P9-S3 保留 P9-S2 partial-write 与 archive-level failure/retry 的实际历史 evidence；P9-S4 仅补齐首个 audit write `EIO`、0 audit bytes 的 archive-save short-circuit/retry evidence；P9-S5 仅补齐 20 个 directory capability symmetry tests-only cases；P9-S6 仅补齐 ledger-own failure residual 的 tests-only evidence；P9-S7 仅补齐 concurrent identical same-save linearization 的 tests-only evidence；P9-S8 仅补齐 divergent-trace conflict fail-closed 的 tests-only evidence；P9-S9 仅补齐 concurrent same-ID body conflict fail-closed 的 tests-only evidence；P9-S10 仅补齐 Markdown durable publish short-circuit residual 的 tests-only evidence；P9-S11 仅补齐 Markdown-phase directory close short-circuit residual 的 tests-only evidence；P9-S12 仅补齐 Markdown-phase directory fsync short-circuit residual 的 tests-only evidence；C-4P9 仍未关闭。”**
