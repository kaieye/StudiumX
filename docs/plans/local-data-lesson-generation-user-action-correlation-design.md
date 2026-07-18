# C-5I：Direct-UI lesson generation lifecycle / user-action correlation 设计门槛（未实现）

> **状态：仅设计发现；阻塞后续实现，未获产品/API 批准。**
>
> 本文只审计 direct UI 从 `generateLesson` / `generateLessonStream` submit 到 main `generateAndPersistLesson()` 的**同一次用户动作**。它不是功能实现、测试报告或 C-5 completion 声明；没有业务代码、测试、配置或迁移变更，也没有运行或虚构任何 C-5I 测试结果。
>
> 本文不把 C-5H 的 mission-first 候选 contract 延伸为已批准的 lesson-generation contract。C-5H 与 C-5I 都必须各自通过产品/API 设计门后才能实施；见 [C-5H workspace user-mutation correlation 设计门槛](local-data-workspace-user-mutation-correlation-design.md)、[路线图 C-5 后续队列](../local-data-storage-improvement-roadmap.md#5-下一迭代队列仅未实施工作) 和[实施计划 C-5](local-data-storage-implementation-plan.md#8-c-5跨存储-traceid-与可解析结构化日志conversationmemorylearning-sessionconversation-lifecycleconversation-audit-jsonl-与-forked-conversation-已有切片)。

## 1. 范围、排除项与当前事实

### 1.1 本 gate 的唯一范围

C-5I 只覆盖用户在 renderer direct UI 发起一次 lesson generation 后，经以下已有调用链进入 main 的 action correlation / retry / recovery 问题：

```text
renderer `generateLesson()` / `generateLessonStream()` submit
  → preload / IPC parser / gateway
  → TeachingWorkspaceService.generateLesson() / generateLessonStream()
  → runLessonGeneration()
  → generateAndPersistLesson()
```

它讨论的是“这一次 direct UI submit 在 response 丢失、stream 断连、renderer reload 或局部 durable failure 后，如何安全地得到稳定结果”的未来 contract；不把现有生成流程改称为已具备 exactly-once 或 transaction 语义。

### 1.2 明确排除

本文不实现、也不设计为已解决：

- agent `generate_lesson`、agent run、turn-local attempted/failure 记录、agent tool identity 或 agent retry；它们需要独立 future gate，不能自动并入 direct UI action contract；
- generic `write_workspace_file`、allowlisted workspace Markdown、`lesson_style_applied`、C-5H `mission_updated`，或任一其它 lifecycle producer；
- provider policy、prompt/UI redesign、全局 transaction、跨 workspace transaction、全局 receipt registry 或新的 generic idempotency framework；
- 把 `lessonGenerationRunId`、stream id、agent run id、returned lesson id / artifact transaction id / lifecycle event id 当作 caller retry identity；
- C-4 durable publish、lesson artifact journal/reconciliation、C-5E conversation audit JSONL、C-5C learning-session ledger 的语义改造或“已覆盖”声明；
- 扫描、回填、迁移、修复或重写 legacy lessons、artifact journals、workspace index、lifecycle JSONL、change history、registry 或 session data。

### 1.3 当前 identity 并不满足 user-action retry

renderer 的 `lessonGenerationRunId` 是本地 UI run/notification 状态：它由 workspace id、时间和本地 sequence 组成，未放入 `GenerateLessonPayload`，不会通过 IPC；结束后 renderer state 会清空，reload 后也不能作为可验证的 retry token。当前 direct generate payload 只有业务输入（`workspaceId`、`prompt`、可选 `courseName` / `messages`）；没有 `actionId`。stream id 是 gateway 为一次 streaming IPC invocation 分配/回传的 transport 标识，不是跨 reload 的 caller identity。

同样，agent run / tool result、provider result、lesson number/id、artifact publisher `transactionId`、普通 Lesson 的可见 commit marker、lifecycle event id 都是在调用中或持久化流程中产生的事实/投影标识：它们不能安全表达“这是同一 direct UI submit 的 exact retry”。它们既不能让 renderer 在 response 丢失后定位同一 action，也不能区分“用户第二次以相同 prompt 提交”与“同一 submit 的重试”。

## 2. 当前多事实 pipeline 与 crash / failure 缺口

当前 direct UI 和 agent tool 最终共用 `generateAndPersistLesson()`；这种共用实现不等于两者已经共享同一 caller authority 或 retry contract。就 direct UI 而言，当前顺序可概括为：

```text
capture change-audit pre-state
→ ensure workspace structure / scaffold
→ load settings + current index
→ provider plan production
→ artifact staging + journal
→ canonical learning-session binding
→ satellite artifacts + ordinary Lesson visible commit marker
→ index save
→ `lesson_generated` lifecycle JSONL append
→ best-effort publisher journal delete
→ workspace change-history/audit record
→ registry touch/save
→ IPC result / stream done
```

### 2.1 Artifact publication、journal 与 canonical session binding

artifact publisher 先完成 render，再在 hidden sibling staging directory 写 artifacts；写 journal 后先 bind canonical learning session，再依次 publish satellites，最后 rename ordinary Lesson。ordinary Lesson 是现有“visible commit marker”：其正常存在使 artifact/session set 可发现；commit intent journal 先 durable，post-commit journal acknowledgement/cleanup 不触发 rollback。

artifact journal 的职责是 publisher-level staged/binding/publishing/commit-intent/projection-pending recovery。catalog reconciliation 通过 journal 和最终 artifact bytes 区分可保留、清理或隔离的 artifact set。它**不是** direct UI caller receipt：它不记录 renderer action identity、request/retry disposition、stable IPC result、provider invocation authority 或 lifecycle/index/registry completion。

因此，下列现有/可能 window 都不能由 journal 单独回答“一次 direct UI action 是否已成功、可继续还是必须冲突”：

| durable / process 边界 | 当前可见问题；不得由 C-5I 实现临时猜测 |
|---|---|
| scaffold / path validation / settings / index read 前后 | workspace structure 可能已创建、pre-state 已 capture；没有 caller receipt 说明 action 是否开始、能否安全重放 provider。 |
| provider invocation / provider response | provider 可能已消耗请求并产生 plan，但 renderer 未收到结果、进程可在 artifact publish 前中断；没有 action-scoped authority 阻止 retry 盲目再调用 provider。 |
| staged artifact / journal write | journal 写入或更新失败、staging cleanup/recovery failure、进程死亡可留下 staged/incomplete state；journal 只能按 artifact ownership/reconciliation 处理，不能回复同一 UI action 的 stable result。 |
| canonical session binding | binding 先于 final artifact；binding 成功后 artifact 失败/进程中断可留下 inert session。现有 rollback/recovery 是 publication safety，不是 UI action completion receipt。 |
| satellites / ordinary Lesson visible commit | ordinary Lesson rename 后 artifact/session authority set 可已 committed；随后 journal acknowledgement、cleanup、index、lifecycle 或 response 可失败。不得为“再试一次”盲目生成第二套 artifact 或回滚已可见 canonical set。 |
| index save | committed artifacts 可能存在而 index 未更新；retry 必须先读取并受限 reconcile，不能假定 index absence 等于没有生成。index write 的 pre/post failure、crash 与 external edit 需要 stable disposition。 |
| `lesson_generated` lifecycle append | index 成功后才 append；append error/close/directory-sync 或进程中断可能发生在 row 已持久化、未持久化或调用方未知的边界。retry 不能追加第二 row，也不能把 trace/event id 当 dedupe key。 |
| journal delete | 当前 index/event 后删除 journal 是 best-effort；删除失败可留下 recoverable journal，不能被解释为 caller failure receipt 或要求重跑 provider。 |
| workspace change history / audit | change history/audit 在 lifecycle 后；其失败可能让 artifact/index/lifecycle 已存在而 operation 返回失败，且 registry 尚未保存。它是 mutation history projection，**不是** C-5E conversation audit，也不是 user-action receipt。 |
| registry touch/save、IPC response / stream done | registry save、response 发送、stream done 都可能在前述 canonical/projection facts 后失败或丢失。重新 submit 不能据此重做 provider、artifact、lifecycle 或 registry side effect。 |

C-5I 不承诺把这些 facts 收敛为一个全局 atomic transaction，也不承诺 post-commit rollback。未来实现只能在获批的 action-scoped recovery table 中定义每个边界的 read/reconcile、continue、conflict 或 indeterminate disposition。

## 3. 红线与 trusted boundary

- direct UI `actionId` 若获批，只能是 renderer 为一个 submit 生成并在明确 retry/reload 窗口内复用的 opaque、non-secret token；它不是 trace、lesson id、event id、stream id、agent run id 或 provider id。
- main 是 authority：main 必须验证 actionId 的形状/namespace、workspace binding、operation kind 和 reuse policy；renderer 不得提供 trace，不得声明 action 已完成，也不得写 private receipt。
- trace 仍只能由 main 为获批的新 lifecycle diagnostic correlation metadata 生成并经现有 normalize boundary 持久化。trace **永远不是** action identity、receipt key、lifecycle identity、dedupe、query 或 filter key；不得由 renderer/agent 提供。
- private receipt 是 recovery aid，不是 lesson、index、lifecycle、registry、journal 或 audit 的事实来源/projection。它不得嵌入 HTML、Markdown、front matter、assessment、session artifact、journal、lifecycle row、registry、change history、logger 或 analytics。
- receipt/action handling 不得持久化 raw prompt、messages、rendered lesson、artifact bytes、content hash、provider secret、API key、provider request id、agent secret 或 trace-derived secret。actionId 也不得进入 user-visible file、lifecycle/logger diagnostics、analytics projection 或 generic error text。
- legacy no-receipt workspace、legacy trace-free/malformed lifecycle rows、legacy journals/index/lessons 保持现有 tolerant/reconciliation behavior；不得因 C-5I 扫描回写、补 trace、迁移或“自动修复”。
- external mutation、receipt missing/corrupt、payload mismatch、无法证明 artifact/index/lifecycle state 的情况必须 fail closed 为 approved `conflict` 或 `indeterminate`；不得覆盖外部修改、删除 canonical artifacts、重写 JSONL 或以 content similarity 自动 dedupe。

## 4. 推荐的候选 contract（仅在批准后）

### Stage 0：实现前必须先批准

在任何 IPC/type/renderer/main/receipt 代码开始前，产品/API owner 必须批准：

1. **actionId 生命周期。** direct UI 在何时生成（点击 submit 前）、何时保存在 renderer/reload recovery state、哪些 lost-response / reconnect / reload 情况可复用、何时明确丢弃；不同用户再次 submit 即使 prompt 相同也必须生成新 actionId。
2. **request binding / conflict policy。** 同一 actionId 的 retry 如何证明与首次请求一致，而又不把 prompt/messages/content hash 持久化到 receipt；何时使用 request-local comparison、expected revision/CAS 或其它获批 non-content binding；无法证明时的 `conflict` / `indeterminate` policy。
3. **response and UI vocabulary。** API 是否区分并稳定返回 `success`、`reused`、`rejected`、`conflict`、`indeterminate`（最终枚举待批准），以及 UI 对 each disposition 的 loading、reconnect、reload、重新确认、manual recovery 与错误显示。
4. **private receipt authority。** receipt namespace/schema/version、workspace-private placement、access policy、retention/cleanup owner、corruption policy、concurrent same-action locking/queue policy，以及何时 prepare/reconcile/finalize；这些不能复用或伪装成 artifact journal。
5. **provider authority / cost policy。** receipt 的 prepare point 是否在 provider call 前；何时允许一次同 action retry re-enter provider；provider outcome unknown 时是否一律 `indeterminate` 而非自动再调用。

没有上述批准，唯一安全结论是：不得新增 actionId/receipt，也不得用 main random UUID、stream id 或 artifact transactionId 冒充它们。

### Stage 1：direct UI only 的最小候选切片

批准后，最小候选范围仅为 direct UI `generateLesson` / `generateLessonStream`：

- renderer 在一个 direct submit 生命周期为 `{ workspaceId, prompt, courseName?, messages?, actionId }` 附带独立 actionId；renderer trace 仍禁止；
- parser/gateway 只接受获批的 opaque token，main 创建/读取 private receipt，并为首次被接受的 action 生成 main-owned trace；
- receipt 至少以 actionId + workspace + operation kind 绑定有限 phase/status、main trace、必要的非内容性 facts references 和更新时间；路径、分片、schema 和 permissions 仍以批准的 private-data design 为准；
- main 在 receipt-aware gate 内决定 provider call、artifact publication/reconciliation、index/lifecycle/change-history/registry continuation，并返回 approved stable disposition；
- 不改 agent tool payload/authority，不把 style/MISSION/Markdown writer 纳入，不创造 generic transaction 框架。

这只是候选 subslice，不是对 API、receipt 文件、IPC result type 或任何 storage schema 的批准。

### Stage 2：exact retry 与 stable disposition

批准后的验收 contract 至少必须覆盖：

1. **lost IPC response / stream reconnect / renderer reload：**同 workspace、同 actionId、语义一致的 direct UI retry 要返回同一已决定 disposition，以及同一已接受 action 的 trace/receipt view；不能仅因 transport 断开而再运行 provider。
2. **provider boundary：**如果 receipt/authoritative facts 无法证明 provider 是否已为该 action 成功产出可安全继续的 plan，不能盲目重跑 provider；必须遵循获批的 read/reconcile、rejected 或 indeterminate policy。
3. **artifact committed but projections pending：**ordinary Lesson/session/artifact set 已 committed 而 index、lifecycle、change history、registry 或 response 未完成时，retry 只能依据 receipt 和受限 canonical reconciliation 决定继续缺失安全步骤或报告 conflict/indeterminate；绝不再发布 duplicate artifacts。
4. **post-lifecycle durable uncertainty：**lifecycle append 的 post-write/close/directory-sync failure 可能使 row 已追加但调用未获成功确认。retry 必须先在 action-scoped authority 内读取/验证允许的 facts，不能追加第二 `lesson_generated` row，也不能用 trace/event id 作为 generic dedupe key。
5. **external mutation / payload conflict：**same actionId + changed prompt/messages/course or external artifact/index/lifecycle mutation，不得静默覆盖、重新生成或将 content 相同视为 safe retry；返回获批 conflict/indeterminate 并保留 canonical bytes。
6. **different direct submits：**相同 prompt 但不同 actionId 是两个用户动作，不得以 prompt、rendered content、lesson title 或 hash 自动 dedupe；其 provider/artifact/lifecycle/registry effects 依获批 product semantics 分别发生。
7. **crash/restart/concurrency：**receipt recovery 在 main private authority/queue 下重新读取；同 action 并发 submit/reconnect 不会导致两个 provider call、两套 artifact、两条 lifecycle row 或重复 registry side effect。不同 action 的 normal concurrency policy 不在本文暗中改变。

## 5. “read/reconcile” 与“retry provider”必须分开设计

artifact publisher 和 catalog reconciliation 已有受限恢复职责：验证 staged/final artifact bytes、隔离不安全 incomplete publication、保留已 committed normal Lesson/session pair、补齐可由 disk 发现的 catalog facts。它们不能回答 caller action 是否应再次调用 provider，也不可以被 receipt implementation 用来搜索/猜测用户 prompt 或历史 action identity。

future C-5I implementation 必须为每个 receipt phase 预先定义：

| 观察到的状态 | 可考虑的操作（均须获批实现） | 禁止的捷径 |
|---|---|---|
| action 尚未获 main 接受 | reject / create prepared receipt，具体 provider authority 取决于批准 contract | 仅用 renderer run id 或 stream id 判断未开始。 |
| provider 状态未知 | report `indeterminate`，或仅在明确批准的 safe proof 下继续 | 自动再跑 provider、按同 prompt/content “去重”。 |
| journal/staging 未完成且 publication 未 committed | 采用已有 publication recovery / isolate 后再按 receipt policy决定；不能把 journal 当 success receipt | 删除不属于本 action 的文件、把 journal phase 当 UI success。 |
| ordinary Lesson/session committed，index/lifecycle 未确认 | 受限读取/reconcile 后只补批准且可证明缺失的 projection，或 conflict/indeterminate | 再生成/再发布 artifacts，或重写/删除 committed lesson。 |
| lifecycle 可能已追加 | action-scoped 验证与 stable disposition；保持 lifecycle trace 不作 dedupe key | 直接 append 第二 row、由 UUID trace 查询/过滤来“去重”。 |
| change history 或 registry 未确认 | 仅按批准恢复表继续可证明步骤，或 indeterminate | 把 change history/journal/registry 任一项伪装为整个 action receipt。 |

任何 future continuation 都必须保留现有 canonical bytes 的 authority；不允许通过 truncate/delete/rewrite lesson HTML、assessment、session artifact、index 或 JSONL 来“修复成一致”。

## 6. Future implementation only：预计 seam 与测试矩阵

下列落点仅用于审查实现边界，**不表示已修改、已批准或穷尽所有文件**：

| 区域 | 可能的最小落点 | future implementation only 职责 |
|---|---|---|
| shared IPC/type | `src/shared/teaching-types/workspace.ts`、`src/shared/teaching-types/system-api.ts`、`src/shared/teaching-ipc-contract.ts` | 为 direct UI actionId 与 receipt-aware generation result 定义获批 contract；不扩散到 agent/style/generic writer。 |
| parser/gateway/preload | `src/main/teaching-ipc-commands.ts`、`src/main/teaching-ipc-gateway.ts`、`src/preload/index.ts` | 验证 opaque actionId、保持 stream transport 与 stable result semantics；拒绝 renderer trace。 |
| renderer direct callers | `src/renderer/src/app-shell/appStore.ts` 及必要的 direct generation UI | submit-time generate/reuse actionId、lost response/reload handling、approved disposition UI；`lessonGenerationRunId` 仍仅为 UI run state。 |
| main service / private receipt | `src/main/teaching-workspace.ts`、新增受限 receipt module（路径待批准） | direct-UI-only authority、per-action serialization、provider/artifact/index/lifecycle/history/registry recovery table；不把 receipt 混入 journal。 |
| artifact/reconciliation boundary | 预计沿用 `src/main/teaching-lesson-artifacts.ts`、`src/main/teaching-workspace/catalog-reconciliation.ts` 的现有安全语义 | 仅以明确 seam 读取/reconcile current facts；不得把 publisher journal 改成 generic UI receipt，也不得扩大为全局 transaction。 |
| tests | 新增/扩展 direct-generation IPC、renderer, service、receipt、publication/recovery、lifecycle integration tests | 只在批准实现中证明下列矩阵。 |

所需的 future test matrix 至少包括：

- provider call counting：同 action lost-response/reload/reconnect 不重复 provider call；different actionId + same prompt 不被内容 dedupe；provider result unknown 不盲目重跑；
- deterministic artifact/publication recovery：stage/journal/binding/satellite/ordinary Lesson visible commit 的每个 failure/crash window；committed artifacts 不回滚、不重复；session binding safety 不退化；
- I/O injection：workspace scaffold、artifact/journal、index save、lifecycle append（尤其 post-write/close/directory-sync uncertainty）、journal delete、change history/audit、registry save、receipt prepare/finalize 的 pre/post durable failures；
- restart / concurrency：跨进程/重启、同 action concurrent submit、stream reconnect、IPC response loss、renderer reload；验证 stable disposition、无 duplicate artifact/lifecycle/registry，且不会盲目 rerun provider；
- privacy/security：actionId validation、renderer trace rejection、receipt private path/permissions、generic diagnostics 不含 prompt/messages/content/hash/provider secret/request id；trace 不作为 identity/dedupe/query/filter；
- compatibility：legacy no-receipt workspace、legacy journals/index/lessons、trace-free/malformed lifecycle rows 保持原语义和 bytes；不扫描、回填或重写历史数据；
- scope isolation：agent `generate_lesson`、`write_workspace_file`、lesson style、C-5H mission、C-4 durable publishers、C-5C/C-5E existing behavior 均无未经批准的变化。

## 7. 审查结论与 approval gate

C-5I 当前只建立了一个 **direct-UI lesson generation lifecycle / user-action correlation 设计门槛**。它确认 direct UI generation 是 provider、artifact publication/session binding、index、lifecycle、journal cleanup、change history 与 registry 的多事实流程；现有 journal/reconciliation 和 normal Lesson visible commit marker 不能替代 caller receipt，现有 renderer run/stream/result identifiers 也不能替代 action identity。

**当前结论：NO-GO。**在 actionId lifecycle、request conflict policy、private receipt authority/retention、provider retry cost policy、stable IPC/UI disposition 和每个 durable crash/recovery table 获批准前：

- 不新增 actionId、receipt、trace propagation、lifecycle dedupe 或 recovery implementation；
- 不把 C-4 durable publication、artifact journal/reconciliation 或 C-5H mission gate记为 C-5I completion；
- 不把 direct UI contract 自动扩展给 agent `generate_lesson`；
- 不将 C-5 标记为全量 lifecycle/user-action correlation 完成。
