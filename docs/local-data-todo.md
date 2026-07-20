# 本地数据待办

> 本文是本地数据**下一步工作的唯一入口**。已完成的架构决定、已实施的受限切片及其历史验证证据见 [ADR 索引](adr/README.md)。
>
> 下列条目只记录尚未关闭的范围、明确 blocker 和实施前设计门；设计文档本身**不是实现授权**。本文件不重复维护已关闭 scope、提交或 tests-only 历史证据，避免把局部实现误读为完整 close-out。

## 先决规则与立项格式

1. 任何后续切片都必须先在对应 design gate 获得**范围、决策 owner、实现 owner、API/产品 contract 和 operations owner**批准，再单独立项；不得直接修改某个 writer 以“顺手迁移”。
2. 每个获批切片的立项记录至少要写明：
   - 要解决的唯一问题、明确排除项和 canonical authority；
   - identity、public result、retry / conflict / unknown-state 语义；
   - 支持的平台 capability profile、完整 failure/crash matrix、recovery 的唯一允许动作；
   - schema/path/IPC/lifecycle 是否变化，以及 legacy reader/writer compatibility；
   - 不泄露内容、路径、secret 或其他 locator 的 diagnostics / audit 边界；
   - 验收 owner、测试层级、host-native/operations 证据和停止条件。
3. canonical JSON、Markdown、JSONL、immutable record 和 Memory 文件仍是事实来源；projection、partition、sealing、summary、`.bak` 与 private receipt 都不授权删除、覆盖或替代事实来源。
4. [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 记录的是**部分** consumer migration；它不表示所有 writer 已迁移，也不表示完整 C-4P6、完整 C-4P9 或跨文件 transaction 已完成。不得把 [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md) 解读为全局 actionId、exact retry 或 receipt。
5. 任何 `possibly published`、provider outcome unknown、损坏、身份冲突、越界路径或无法证明的 I/O 结果都不得被自动 retry、rollback、delete 或报告为成功；具体 disposition 必须由获批 contract 定义。

## C-4：仍未完成的 durable closure 设计门

### P8：Windows strict durable profile

- **未关闭范围：**本项只讨论 POSIX-equivalent Windows strict profile；其目标必须明确覆盖 strict containment、expected-target identity precondition、atomic no-overwrite / restricted overwrite（或 exchange）以及 directory-durability，而不能以较弱 profile 替代。
- **首要 blocker：**先取得可审计的 Windows/NTFS S3 identity-precondition primitive，能够在实际 publish 点约束 expected target identity。只在 publish 前读取 file ID 不能消除 inspect-to-publish race，因此不能作为该 blocker 的关闭证据。
- **批准前必须交付的设计输入：**
  1. 明确目标 Windows、NTFS/storage、Node/Electron profile，以及“strict”具体承诺和不支持时的 fail-closed result；
  2. 审计 HANDLE-relative、reparse-point/junction-safe parent traversal 与 final-leaf inspection 的 native API contract；
  3. 定义 atomic no-overwrite 与受限 overwrite/exchange 的 identity precondition、metadata policy、file/parent-directory flush 与 close error semantics；
  4. 定义 reparse replacement、leaf replacement、sharing/antivirus/lock、rename、flush/close 和 crash 的 adversarial failure matrix，以及 host-native CI / power-loss 或 reboot 验证计划。
- **可分配的后续工作仅在上述输入获批后：**先完成 native capability/audit 原型和 host-native negative tests；只有原型能证明 S3 precondition 后，才可单独立项实现 strict traversal/publish。若无法证明该 primitive，本项不得以降级实现宣告关闭。

### P9：session-audit durable append

- **未关闭范围：**[C-4P9 Session-audit durable append](plans/local-data-session-audit-durable-append-design.md) 只定义后续设计门；本项需要的 generic JSONL、rotation、repair、跨文件语义和完整 close-out 均未获批准。
- **不可越过的边界：**既有 audit schema/version、header、entry ID、`parentId`、ordering、legacy tolerant read、history/artifact/deletion 语义保持不变。不得改变 archive save order 或 ledger authority；不得默认按月份/大小 rotation，不得把 archive publish 或 trace correlation 计为 P9 完成。
- **立项前必须按顺序决定：**
  1. **generic JSONL / rotation / repair scope：**先批准 generic API 与 audit compatibility contract；再定义 segment discovery、sealing、rotation trigger、repair authority/trigger、字节保留或损失政策、operator control 与 migration 边界。
  2. **capability / failure contract：**覆盖 directory、`mkdir`、path inspection、`open`、`stat`、`read`、partial/invalid transfer、`write`、`fsync`、`close`；逐项定义 supported/degraded/fatal、是否可能已 append、stable privacy-safe diagnostic 与唯一 recovery 动作。unsupported behavior 绝不能报告 durable success。
  3. **跨文件 authority：**任何超出 ordered best-effort 的承诺都要先定义 JSON、Markdown、audit、ledger 的 authority、partial-publish visibility、crash/retry state machine、reconciliation、idempotency 和 final verification；不得把多个 rename 或 lock 误称为 transaction，也不得引入隐式 rollback/delete。
  4. **surface 与运营：**repair/migration/rotation/conflict/durability status 的 IPC/UI 权限与 stable states 尚未批准；同时需要 privacy-safe observability、runbook、rollout/upgrade、capacity/retention、concurrency、failure injection 和实际环境验收 owner。
  5. **平台/断电：**Windows capability 及 file/directory flush/close error semantics、目标文件系统与 crash/reboot/power-loss model 必须单独验证；定向 unit fault injection 不能替代该证据。
- **最小任务粒度：**一个获批切片只能处理上列一个明确 contract；generic migration、rotation、repair、IPC/UI 或跨文件语义均不得随 audit writer 改动被悄然带入。

### P6：learning-outcome durable settlement 的剩余 close-out 设计门

- **未关闭范围：**[C-4P6 Learning outcome durable settlement](plans/local-data-learning-outcome-durable-settlement-design.md) 仍是风险/设计门。P6 close-out 必须保持“不是 cross-file transaction 或共同原子提交”的边界，直到另行批准并验证相应 protocol。
- **authority 固定：**会写 immutable Learning record 的 outcome 以 `immutable Learning record → outcome.json / completed session.json projection → settlement marker` 为优先级；不写 record 的 outcome 以有效 settlement marker 为 operation settlement / idempotency authority。catalog、stage、单独 marker 或 UI optimistic state 不得反向覆盖或单独宣告成功。
- **立项前必须关闭的 blocker：**
  1. **manifest capability：**从已验证 session-directory capability 开始，定义 regular-file/directory/symlink containment、stage `open(wx)`/write/file `fsync`/close、final rename/replace、parent-directory `open`/`fsync`/close、safe cleanup 的 ownership 与逐相位失败结果；未获 allowlist 的 downgrade、unknown error、permission/open/write/sync/close failure 必须 fail closed。
  2. **crash / recovery state machine：**为 record、outcome、manifest、marker 各 durable point 的正常、restart/reconcile 路径定义状态、转换、可见性、是否可能已发布、public result、retry eligibility 和 `reconcile()` 的唯一允许动作。未知状态不得 blind rewrite、re-evaluate、生成新 operation identity 或报 settled。
  3. **跨文件边界：**明确 P6 没有 cross-file transaction/common atomicity；不得在 retry/reconcile/cleanup 中 rollback 或删除 canonical record/outcome/manifest/marker。若产品要求 transaction、delete、retention、compaction 或 migration rewrite，必须另设 protocol，先定义 participant authority、intent/commit（或等价）记录、并发、recovery、backup/restore、audit 与 tombstone policy。
  4. **compatibility / surface / operations：**任何 schema、path、marker/manifest/record metadata、API、IPC 或 lifecycle 改动都需先给出 reader/writer compatibility、upgrade/downgrade、unknown-version fail-closed、sole-writer 与 public retry contract；再指定 fresh/upgrade/partial/corrupt/disk-full/permission/crash/concurrency/catalog rebuild 的 runbook 和验收证据。
  5. **Windows / power-loss：**独立确认 native Windows file `fsync`、close、rename/replace、directory-sync downgrade、shared/antivirus/lock behavior，以及 record/outcome/manifest/marker 在目标 runtime/filesystem 上的 restart 与真实 reboot/power-loss 状态。mock、POSIX 测试或“最终文件存在”不能关闭本项。
- **最小任务粒度：**先获批目标 platform profile、manifest contract、fault/crash matrix、public result/retry semantics、schema/API/lifecycle scope、测试层级与 operations owner；在这些输入齐备前，不得以新增补测或 writer 修改声称完成 P6。

## C-5：尚未覆盖的用户动作 correlation 设计门

### P5H：workspace user mutation（mission-first）

- **当前状态：**[C-5H Workspace 用户变更 correlation](plans/local-data-workspace-user-mutation-correlation-design.md) 仅提出 mission-first 的候选 contract。当前没有产品/API 批准，故不得直接实现 `mission_updated` correlation、renderer actionId 或 private receipt。
- **批准时必须先决定：**
  1. 是否接受 renderer 提供 opaque、non-secret actionId，以及 main 持久化 workspace-private receipt；若不接受，必须明确“每次重试都是新动作、没有 exact retry”的产品语义；
  2. 同一 actionId 的 payload change、外部 `MISSION.md` 编辑、registry/lifecycle partial failure 或 receipt 缺失/损坏时，是 fail-closed `conflict`/`indeterminate` 并要求重新确认，还是另行批准 expected revision/CAS UI；
  3. receipt 的 namespace/schema/权限/retention、prepare/reconcile/finalize、并发锁/queue，以及允许字段和不允许持久化的 prompt、CSS、hash、provider/request-id/secret；
  4. main-owned trace 与 action identity 的边界：trace 继续只作 diagnostic correlation，不能由 renderer 提供，也不得成为 receipt key、lifecycle identity、dedupe、query 或 filter key。
- **范围红线：**首个候选切片只覆盖 mission submit 的 `MISSION.md`、lifecycle、registry 与 receipt-aware recovery 边界；同 prompt 的不同用户动作绝不能按内容自动 dedupe。`lesson_style_applied` 的 settings second write、CSS scaffold/repair 和 generic workspace writer 必须单独设计，不能被悄然并入。

### P5I：direct-UI lesson generation

- **当前状态：**[C-5I Direct-UI lesson generation correlation](plans/local-data-lesson-generation-user-action-correlation-design.md) 仅审计 renderer `generateLesson` / `generateLessonStream` 到 main `generateAndPersistLesson()` 的同一次 direct UI submit；尚未获产品/API 批准，不能实施。
- **批准时必须先决定：**
  1. actionId 在 submit、lost response、stream reconnect、renderer reload 与明确放弃时的生命周期；相同 prompt 的新 submit 必须生成新 actionId，既有 `lessonGenerationRunId`、stream id、agent run id、lesson/artifact transaction/lifecycle id 都不是 caller retry identity；
  2. 同 actionId request binding：如何在不持久化 prompt/messages/content hash 的前提下验证 retry 与首次请求一致；外部修改、payload mismatch、receipt missing/corrupt 或 artifact/index/lifecycle 无法证明时的 `conflict` / `indeterminate` 语义；
  3. stable API/UI vocabulary（候选为 `success`、`reused`、`rejected`、`conflict`、`indeterminate`，最终枚举待批准）、private receipt 的 authority/placement/retention/locking，以及 main 为首次 accepted action 生成 trace 的边界；
  4. provider authority/cost policy：receipt prepare 是否先于 provider call、何时允许同 action 再次进入 provider、provider outcome unknown 是否一律为 `indeterminate`。在未获明确批准前，绝不得自动重跑 provider。
- **范围红线：**只覆盖 direct UI 的 generate/stream；不覆盖 agent `generate_lesson`、agent run、mission、lesson style、generic workspace writer、C-4 durable publish、artifact journal/reconciliation 或任一 legacy backfill/repair。receipt 不是 lesson、index、lifecycle、registry、journal 或 audit 的事实来源，也不得进入 user-visible artifact、lifecycle/logger/analytics 或 generic error text。

## C-6：controlled legacy Memory 迁移设计门

- **未关闭范围：**[C-6 受控 legacy Memory 搬迁](plans/local-data-memory-controlled-migration-design.md) 仍是设计门；真实 migration 尚未获得授权，且不得暴露或推导 candidate、path、identifier、content 或 hash。
- **真实迁移的批准前提：**
  1. 可信 main-only identity/scope authorization 与一次性、显式、可取消的 confirmation binding；不得从历史 preflight、startup、后台任务、设置切换、自动 retry 或 renderer path input 推断 consent；
  2. descriptor-relative no-follow copy、exclusive destination create、durable publish、descriptor-bound delete 与 directory sync capability；不具备的平台必须 fail closed，不能回退不受约束的 path I/O；
  3. 非覆盖 duplicate policy、private hold/backup 的 ownership、retention/cleanup、legal hold、delete 不可逆性及 partial delete 的人工恢复责任；legacy source 与 scoped target 同时存在或 accepted source 不唯一时必须停止，不得 merge/overwrite；
  4. copy → file `fsync` → internal checksum verify → durable hold publish/directory sync → explicit confirmation → fresh revalidation → durable non-overwrite scoped publish/directory sync → legacy delete → final receipt 的真实 phase/recovery contract。跨文件系统或多 record 不存在整体 atomicity，receipt 只能记录真实 phase；
  5. 数据最小化 audit/diagnostics、fuzz/fixture security tests，以及 unsafe/deep/symlink/unknown partition、scope mismatch、source drift、external edit、concurrency、disk-full、每阶段 crash、partial copy/delete、retry/idempotency 和 legacy tolerant read 的验收。
- **在这些前提未批准前唯一可讨论的最小 safe slice：**main-only dry-run intent/receipt preview：重新执行只读 preflight 和 trusted-scope validation，只给出短期 aggregate-only intent 状态；不 copy、不创建 hold、不 publish、不 delete、不新增 renderer path input。它仍需单独立项，且必须证明 canonical Memory bytes、mtime 与目录布局不变，以及所有 UI/log/audit 不泄露 locator 或内容。
- **范围红线：**不得启动、后台或自动迁移；不得加入迁移按钮、candidate 明细或可枚举 source 列表；不得以 preflight/partition/receipt/backup 为由删除、替换或自动清理 legacy canonical Memory。
