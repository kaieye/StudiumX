# C-5H：Workspace 用户变更 correlation 设计门槛（mission-first，未实现）

> **状态：仅设计发现；阻塞后续实现，未获产品/API 批准。**
>
> 本文记录 `mission_updated` 与 `lesson_style_applied` 审计后发现的 action correlation 缺口，以及一个可审查的、分阶段的候选 contract。它**不是功能实现、测试报告或 C-5 completion 声明**。本轮没有业务代码或测试变更，也没有运行或虚构任何测试结果。
>
> 路线图仍将 `mission_updated`、`lesson_style_applied`、`lesson_generated` 与其它 user actions 保留在 C-5 remaining queue；见 [路线图 C-5 后续队列](../local-data-storage-improvement-roadmap.md#5-下一迭代队列仅未实施工作) 与[实施计划 C-5](local-data-storage-implementation-plan.md#8-c-5跨存储-traceid-与可解析结构化日志conversationmemorylearning-sessionconversation-lifecycleconversation-audit-jsonl-与-forked-conversation-已有切片)。

## 1. 设计问题与现状

当前两个 workspace 用户变更均是非事务性的多事实写入：

```text
mission_updated:
  MISSION.md write → lifecycle JSONL append → registry touch/save

lesson_style_applied:
  assets/lesson.css write → lifecycle JSONL append → registry touch/save
  renderer 在 IPC 成功后另行写 global settings（second write）
```

现有 `updateMission()` 与 `applyLessonStyle()` payload 分别只有业务输入（`workspaceId + prompt` / `workspaceId + styleId`）。它们没有可受信地区分“一次用户动作的网络/IPC 重试”与“用户再次点击相同动作”的 action identity，也没有 private receipt、exact-retry 协议、event dedupe 或 partial-failure recovery contract。`MISSION.md` 和 CSS 都是用户可见事实文件；它们自身也不能安全地区分同内容的两次动作。

只在 main 为 `mission_updated` 或 `lesson_style_applied` lifecycle row 补一个 `randomUUID()` trace **不满足路线图的 correlation 目标**：它只能标识一次 main 调用，不能让 exact retry 找回同一次已持久化动作，也不能在 file/lifecycle/registry 之间处理部分失败。更重要的是，C-5 已建立的安全语义明确规定 trace 是 opaque correlation metadata，**不是** action identity、lifecycle identity、dedupe 或 query/filter key。把 trace 改作 identity 会破坏该边界；把它交由 renderer 提供又会越过已批准的 trusted-trace 生成边界。

`lesson_style_applied` 额外有 renderer 在 backend 成功后更新 global settings 的独立写入。该 second write 并不与 workspace CSS/lifecycle/registry 组成既有原子事实边界。因此，不能在尚未决定其产品语义、失败呈现与恢复责任前，把 style 纳入 mission 的首个 correlation 实现。

## 2. 事实、红线与明确非目标

### 2.1 事实来源与安全边界

- `MISSION.md` 与 `assets/lesson.css` 继续是用户可见的 workspace 事实文件；registry 与 lifecycle 维持各自既有事实/索引语义。private receipt 只能是重试与恢复辅助记录，不能替代、覆盖或成为这些文件的事实来源。
- 不向 `MISSION.md`、CSS、front matter、HTML comment 或 scaffold 文件嵌入 action id、trace、receipt、hash 或机器元数据。
- 不扫描、回填、迁移、修复或重写 legacy `MISSION.md`、CSS、registry、workspace index 或 lifecycle JSONL；trace-free 或 malformed historical lifecycle rows 仍按现有 tolerant reader 语义读取。
- lifecycle writer 继续执行既有安全边界：strip raw trace → `normalizeTraceId()` → 仅持久化 lowercase 合法 UUID。本文不提议改变该 writer、其历史 reader 容错或 lifecycle schema 的安全规则。
- trace 仅是 main-generated correlation metadata，独立于 action identity；不得用 trace 生成/推导 workspace ID、路径、事件 ID/kind、registry/index identity、dedupe、查询或过滤。
- C-5H 不向 lifecycle、tagged logger、receipt 或诊断记录**新增** raw prompt、CSS、其内容 hash、secret-derived value、provider ID 或 request-id 日志；也不以本设计回填、搬迁或重写既有持久化内容。action id 若获批也只能作为 private、opaque、non-secret token，不能进入上述日志或用户可见文件。

### 2.2 非目标

本文不实现、也不设计为已解决：

- `lesson_generated` correlation、其它 conversation/workspace user actions，或 C-5 的全量 lifecycle producer 覆盖；
- lifecycle/audit JSONL 既有 read+append concurrency；
- C-2 retention、删除、恢复或审计设计；C-1 FTS/额外查询面；C-6 controlled legacy flat-memory migration；
- 通过截断、删除或重写 canonical JSON/Markdown/JSONL 达成恢复或去重；
- 将 renderer settings second write 悄然并入 `lesson_style_applied` 事实事务。

## 3. 方案与替代矩阵（设计评审用）

| 方案 | 能否区分 exact retry 与再次用户动作 | 安全/恢复影响 | 结论 |
|---|---|---|---|
| A. lifecycle-only main UUID | 否。每次 main 调用都有新 UUID，无法绑定 IPC retry。 | 保持 trace-only 边界，但无法阻止重复 lifecycle row、无法返回原 receipt，也无法解释 file 成功后的 append/registry 失败。 | **拒绝**作为 mission/style action correlation 方案；它只能提供单次调用诊断。 |
| B. renderer 提供 opaque、non-secret action id + main 私有 receipt | 可以，前提是 product/API 明确 action id 的生成、存活、重放与冲突语义，main 以 private receipt 协调重试。相同 payload 但不同 action id 保持两个用户动作。 | action id 不能是 trace，也不能记录 prompt/CSS/hash；receipt 必须 private、durable、最小化，且接受 external edit/未知 partial state 时 fail closed。 | **推荐的候选方向**，但依赖下文两个待批准问题；在批准前**阻塞实现**。 |
| C. main-generated UUID + “没有 retry” contract | 不能进行 exact retry；失败后用户只能重新发起，并产生新动作。 | API 较小，但 IPC 超时、renderer reload 或 file 已写/lifecycle 未写时的用户体验与恢复语义不清晰。 | 可作为产品明确接受“at-least-once、无精确重试”时的替代；当前**未获批准**。 |
| D. mission-first；暂不覆盖 style | 可将 B 的复杂性限制在单一 user-visible file、一个 lifecycle kind 与 registry touch。 | 避免 style 的 renderer settings second write、CSS/scaffold 写入与实现版本变化混入第一切片。 | **推荐范围切分**；不是 style 已解决，也不是永久排除。 |

B 与 D 是建议组合，**不表示用户、产品或 API owner 已批准 renderer 传入 action id、增加 receipt 文件或改变 IPC 返回类型**。

## 4. 推荐的 staged contract（若且仅若获批准）

### Stage 0：批准门槛（当前阻塞）

开始任何实现前，必须批准：

1. renderer 可为单个 mission submit 生成并在 retry/reload 窗口内复用的 opaque non-secret `actionId`，并把它作为独立字段传到 main；它不是 trace，也不能进入日志或 user-visible file。
2. main 可在 workspace 的 private `.studiumx/` 数据域持久化最小 receipt，并将 IPC 成功结果扩展为可返回同一 action 的 receipt/trace 状态。receipt 的 retention、清理与 API 形状必须有明确 owner。

没有这两个批准时，后续只能选择方案 C（也仍需明确批准），不得把“补 trace”伪装成方案 B。

### Stage 1：只覆盖 `mission_updated`

候选 payload 由现有 `{ workspaceId, prompt }` 扩展为独立的 `{ actionId }`，但不含 renderer trace。main 在首次接受未见 `actionId` 时生成 trace；trace 仅随该次成功的 new lifecycle event 作为 correlation metadata 持久化。action id 只在 private receipt 中用于定位重试，不写入 lifecycle row、registry、`MISSION.md`、日志或 analytics projection。

receipt 是**recovery aid，不是事实或 projection**。其最小持久化字段应仅足以定位并恢复该 action，例如：receipt schema/version、opaque action id、operation kind（`mission_updated`）、workspace id、main-generated normalized trace、有限的 phase/status、必要的非内容性事实引用（例如由 future implementation 明确的 lifecycle event reference）及更新时间。禁止 raw prompt、rendered mission、content/CSS hash、secret/provider/request-id 数据。receipt 应位于 private workspace metadata，而不是 Markdown/CSS；具体文件名、分片和 access policy 是 future implementation design 的一部分，不能由本文冒充既定实现。

### Stage 2：exact retry、重复动作与 partial failure 的候选验收约束

以下是实现验收约束，不是已存在行为：

1. **exact retry**：同一 workspace、同一 opaque action id、语义相同的 mission submit 必须返回首次 action 的同一 receipt/trace；不得重写 `MISSION.md`、不得追加第二个 `mission_updated` row、不得再 touch/save registry。
2. **same payload, different action**：相同 prompt 但不同 action id 是两个不同用户动作；必须生成不同 trace，并且不得以 prompt、rendered content 或内容 hash 静默 dedupe。它们各自的 lifecycle/registry 行为须由获批 contract 明确定义，不能把相同文本当作 retry。
3. **reused action id with changed payload**：不得静默覆盖。因为 receipt 禁止保存 raw payload/hash，future implementation 必须在每次请求中以当前 request render 与当前 `MISSION.md` 的受限比较、明确 expected revision/CAS，或另一项获批的 non-content binding 来检测不一致；无法证明安全时必须以 conflict/indeterminate 失败，不得新写文件或追加 lifecycle。
4. **partial failure recovery**：file write、lifecycle append、registry save 之间任一步失败或进程中断后，receipt 必须使同一 action id 的 retry 能得出唯一、安全结论：完成并返回原 receipt、继续缺失的安全步骤，或显式 `indeterminate/conflict` 并保留 canonical bytes。不得通过扫描并重写历史文件猜测完成状态，也不得为恢复新增重复 lifecycle row。
5. **external edits/legacy**：receipt 缺失的 legacy workspace、历史 trace-free/malformed lifecycle row、或发现 `MISSION.md` 与 retry target 不一致时，都不能自动“修复”或覆盖。只有获得明确的 state match 才可继续；否则返回 conflict/indeterminate，并保留文件与 JSONL 原字节。
6. **durability/order**：future implementation 必须写明 receipt 的 prepare/finalize 时机及每个 crash point 的恢复表；receipt 不能声称成功早于相应 canonical file/lifecycle/registry 状态。尚未定义的 event reference、CAS/revision 或 sequencing 不得在实现中临时猜测。

本文没有把这些 contract 写成代码；没有新增 payload、receipt、trace 传播、event dedupe、恢复逻辑或测试。

### Stage 3：style 保持排除

在 mission contract 经过实现和审查前，`lesson_style_applied` 不接入 receipt/action-id 机制。未来 style 设计必须单独说明：backend CSS/lifecycle/registry 成功但 renderer settings 失败时的用户可见状态、retry ownership、scaffold/repair CSS writes 不生成 user-action lifecycle 的边界，以及同 style 重复应用与 CSS implementation 演进的语义。它不能复用 mission 的结论来声称已覆盖。

## 5. Future implementation only：最小预计文件与测试矩阵

下列是**未来实现候选落点**，不表示已修改、已批准或穷尽所有文件。

| 区域 | 最小预计文件 | future implementation only 职责 |
|---|---|---|
| shared IPC/type | `src/shared/teaching-types/workspace.ts`、`src/shared/teaching-types/system-api.ts` | 为 mission action id 和 receipt-aware result 定义获批 contract；不向 style 扩散。 |
| IPC parser/gateway/preload | `src/main/teaching-ipc-commands.ts`、`src/main/teaching-ipc-gateway.ts`、`src/preload/index.ts`、`src/shared/teaching-ipc-contract.ts` | 校验 opaque action id、维持 IPC response；不得接受 renderer trace。 |
| renderer mission caller | `src/renderer/src/app-shell/appStore.ts`（以及仅在实际调用处必要的 UI 文件） | 在一个用户 submit 生命周期生成/复用 action id，处理 receipt/conflict；不改 style settings flow。 |
| main service + private receipt | `src/main/teaching-workspace.ts`、新增受限 receipt module（路径待批准） | mission-only sequencing、receipt prepare/reconcile/finalize、partial-failure state machine；不污染 `MISSION.md`。 |
| lifecycle boundary | 无新增 production file 预期；沿用 `src/main/teaching-workspace/lifecycle.ts` 的既有 writer/reader | 不改变 trace normalization/tolerant read 安全边界；不得让 action id 成为 lifecycle identity/dedupe key。 |
| tests | 新增/扩展 mission IPC、service、receipt、lifecycle integration/unit tests | 仅在获批实现中覆盖下列矩阵。 |

| 测试域 | future implementation only 验收矩阵 |
|---|---|
| IPC / main / renderer | renderer 只传 opaque action id、不能传 trace；parser 拒绝 malformed/secret-like action token；main 生成 trace；重新加载或 retry 时复用同 action id 的结果；IPC result 清楚表达 success/duplicate/conflict/indeterminate（最终枚举待批准）。 |
| receipt | receipt 只含允许字段、私有权限/路径、durable prepare/finalize、损坏/缺失 receipt fail closed；不含 raw prompt、rendered content、prompt/CSS hash、provider ID 或日志 request id。 |
| exact retry / distinct action | 同 action id + 相同 mission：同 receipt/trace、`MISSION.md`/lifecycle/registry bytes 或观察量无额外写入；同 prompt + 不同 action id：不同 trace、绝不由内容自动 dedupe；相同 action id + 改变 payload：conflict/indeterminate 且不覆盖。 |
| partial failure | 分别注入 file write、lifecycle append、registry save、receipt finalize 与进程中断边界失败；retry 不产生第二 lifecycle row，不错误回报成功，不改写外部编辑后的 file。每个阶段都要有预先批准的恢复表。 |
| lifecycle / legacy | 新 `mission_updated` trace 仍经 writer normalized lowercase UUID；action id 不写 lifecycle；legacy trace-free/malformed row tolerant read；legacy workspace 或 receipt 缺失不回填/迁移/重写。 |
| security / observability | 生命周期、logger、receipt、fixture/assertion输出均不泄露 prompt/CSS/hash/secret/provider/request id；trace 继续不作为 identity/dedupe/query/filter；不新增未批准 lifecycle logger tag。 |
| style isolation | mission 实现不改变 `applyLessonStyle()`、CSS scaffold/repair、renderer settings second write 或 `lesson_style_applied` lifecycle 行为。 |

## 6. 实现前所需的用户/产品选择（最多两项）

1. **是否批准 action-id + receipt API？** 是否允许 renderer 为 mission submit 提供 opaque non-secret action id，并允许 main 持久化私有 receipt、返回 receipt-aware retry/conflict 结果？若否，请明确是否接受方案 C 的“无 exact retry、每次重试是新动作”语义。
2. **mission 的冲突语义是什么？** 当同一 action id 的 retry 遇到 external `MISSION.md` 编辑、registry/lifecycle partial failure 或 changed payload 时，产品是否要求 fail-closed 的 `conflict/indeterminate` 并要求用户重新确认，还是要引入明确的 expected revision/CAS UI？在该选择前，不能安全定义 automatic continuation。

---

## 审查结论

C-5H 目前仅建立了一个 **mission-first action correlation 设计门槛**：拒绝把 lifecycle-only UUID 当作 retry identity，建议在获批后以 renderer action id（非 trace）和 private receipt 处理 exact retry/recovery，并明确暂不覆盖 style。它**未实现 `mission_updated` 或 `lesson_style_applied` trace/correlation**，更未完成 `lesson_generated` 或其它 user actions；C-5 不得因此被标记为完成。
