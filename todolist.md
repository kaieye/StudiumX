# StudiumX 教学闭环：实时执行待办与交付边界

> **状态基线：** 2026-07-19 已执行 `git fetch --prune origin`；本文以 `origin/main` 的 `5f5cd3217fee1de653ffe644806039461d4463d3` 为唯一代码基线。
>
> **用途：** 此文件是后续实现、review、集成与发布的检查清单，不是生产完成声明。Git 中已推送的提交、独立 review 记录和可复现的自动化结果才是完成证据。
>
> **规划对齐：** `docs/plans/sx-p0-remaining-work-execution-plan.md` 的基线日期为 **2026-07-15**，其中较早的“尚未实施”表述不能覆盖当前 `origin/main` 已合入事实；同时，其领域不变量、TDD、全量 gate 与“缺失命令/测试即未证明”的规则仍然有效。`docs/plans/codex-rust-v0.144.4-teaching-adoption-plan.md` 是 P0/P1/P2 的架构与验收约束来源。

---

## 1. 已完成且不得回退

以下项目已由当前 `origin/main` 的提交历史和源码存在性确认。后续工作只能消费或窄接入它们，**不得复制第二套领域实现、放宽其安全边界，或以集成名义重写深模块**。

- [x] **教学事实基线：** durable `LearningSessionLedger`、typed lesson interaction evidence，以及“生成/打开 Lesson 不自动写正式 Learning record”的 cutover 已合入。Session、Evidence、Outcome/Record 的语义必须继续分离；canonical 文件优先于 catalog、UI 与缓存投影。
- [x] **Outcome 到上下文的既有深模块：** `LearningOutcomeCommitter`（`0acaaa4`，并有后续稳定/冲突/insufficient 修复）、窄且 learner-safe 的 outcome IPC（`734314e`）、确定性 `NextTeachingStepPlanner`（`eda17c3`）、`TeachingContextAssembler` + `ResourceGrounder`（`0f4caa9`）与 learner-safe presentation（`840d566`）均已进入历史。它们不等于下列生产 snapshot/bootstrapping/Electron 闭环已经完成。
- [x] **M4 App sole-writer：** App preview 向唯一 LearningOutcomeCommit 写入路径的切换（`9f3b7d4`）及其 remediation（`fa0b15e`）已合入。renderer 不得重新计算 mastery/outcome，不得直接写 record/outcome/catalog，也不得恢复旧的乐观成功语义。
- [x] **Protocol Core v1：** schema v1 teaching event protocol（`cef8f86`）、`TeachingTurnCoordinator`（`2f1d959`）及 Round 1–11 的身份、authority、reconciliation、in-flight 与严格解析加固已经合入，当前 tip 为 `5f5cd32`。已完成的 Protocol Core 必须保持 fail-closed。
- [x] **已合入的质量/安全/隐私约束：** 既有 structure、security、provider privacy、secret storage、repository hygiene、Agent recovery/operation idempotency 与 learner-safe presentation/redaction 相关 checks 是保留 gate。每次集成必须重新运行相关 gate；“代码中已有脚本/测试”不能替代本次运行结果。

### 永久不变量

1. Evidence 是可追溯学习者交互事实，不是 outcome，更不是 Learning record。
2. 只有 committer 在证据门控后可产生 durable outcome/正式 Learning record；生成、模型自述、renderer 状态、答案 key 或 rubric 都不是写入授权。
3. 不确定副作用不得盲目重试或伪装成功；canonical 事实优先，catalog/projection 只能 read-repair。
4. learner-facing DTO、DOM、日志与诊断必须 allow-list；不得泄露 raw prompt/reasoning、secret、provider payload、绝对路径、raw private learner text 或答案 key。
5. 不回退 Protocol Core、M4 sole-writer 或已经通过的 quality/security/privacy gates；接口不足时回原 owner 做窄修复，而不是在下游复制领域规则。

---

## 2. 当前进行中（仅可如实表述）

- [ ] **M5 分支仅已占位，尚未交付。** `feat/m5-teaching-loop-snapshot-ipc` 的 HEAD 与 `origin/main` 完全相同（左右差异均为 `0`），工作树干净，没有 M5 专属提交。**创建 M5 worktree/branch 不等于 M5 已完成，也不等于生产 IPC 已接通。**
- [ ] 当前 main 已有 `TeachingLoopSnapshot`、`loadTeachingLoopFactSource`、`buildTeachingLoopFacts`、`resolveTeachingLoop`、planner、context assembler 与 grounder 的领域实现/测试；但未发现 `TeachingSystemApi.readTeachingLoopSnapshot`、`teach:read-teaching-loop-snapshot` 或对应 preload/gateway/service 生产入口。因此只能称为“底层 read-model 已具备、M5 生产读链未接通”。
- [ ] **Protocol Medium backlog 已识别但尚未结项：** 它是 Protocol Core v1 之后的硬化工作，不能因为 Round 1–11 已合入就从待办中删除。

---

## 3. 未完成里程碑与完成定义

### M5 — production read-only TeachingLoop snapshot IPC 全链路

**目标：** 以一个只读、版本化、严格解析、learner-safe 的生产入口暴露当前教学循环快照；不得借读取触发 reconcile、写入、生成或隐式修复。

- [ ] 打通唯一调用链：

  ```text
  renderer
    → TeachingSystemApi.readTeachingLoopSnapshot
    → preload
    → teach:read-teaching-loop-snapshot
    → strict IPC parser / gateway
    → TeachingWorkspaceService.readTeachingLoopSnapshot
    → loadTeachingLoopFactSource
    → buildTeachingLoopFacts
    → resolveTeachingLoop
    → planNextTeachingStep
    → assembleTeachingContext
    → ResourceGrounder
    → learner-safe result
  ```

- [ ] 请求只允许稳定、已授权的 workspace/session identity（以及经 contract 明确允许的最小 read options）；拒绝未知字段、跨 workspace identity、路径、任意 source、renderer 自报 outcome、答案、provider 或 artifact payload。
- [ ] `TeachingWorkspaceService` 只做 façade/delegation；gateway 只做严格解析、归属/权限检查和错误映射；不得把 planner、committer 或 grounding 规则复制进 IPC。
- [ ] 返回值必须是 learner-safe projection：显式区分 `ready`、`needs_practice`、`not_evidenced`、resource 不 ready、可恢复/不可恢复读取失败等；不将缺失或不确定事实提升为完成/已掌握。
- [ ] 只读证明：调用前后 canonical Session/outcome/record/catalog 的内容和计数不变；任何 read-repair/commit/action 需走独立、显式的 effect API。
- [ ] M5 代码完成后必须有**独立 review**：逐项检查 public contract、严格 parser、unknown/extra field 拒绝、workspace/session binding、authority、source allow-list、无副作用、DTO/诊断脱敏和 negative tests。作者自测不构成 review。
- [ ] M5 合入前必须以最新 `origin/main` 普通集成（不得基于陈旧本地 main、不得 force-push），记录 base hash、集成 hash、变更路径、review、命令结果、遗留风险与下游 schema contract。

### M6 — `schemaVersion: 2` 的公开 snapshot/event 投影

**前置：** M5 的 v1 只读生产链已独立 review 并集成；schema owner 已锁定 contract/gateway/shared type 的写域。

- [ ] 定义 v2 的**完整 planner projection**：下一步、有限 reason code、输入/provenance 摘要、resource readiness 与安全降级状态都可被消费，且不能依赖 renderer 推断。
- [ ] 定义 v2 的 learner-safe context projection：仅输出教学所需的摘要、预算/截断的允许信息和可展示状态，不能输出内部 assembler/grounder 原文。
- [ ] 输出 grounded `sourceIds` 及经允许的来源摘要；每个 ID 必须能回溯至 trusted resource authority，缺失/排除 source 必须显式、安全地降级。
- [ ] 扩展 identity allow-list（workspace/session/turn/operation 等实际需要的稳定 identity），同时保留严格的字段、格式、归属和版本校验；禁止“任意 ID 字符串透传”。
- [ ] v2 **绝对禁止** raw chunks、路径、secret、raw evidence、learner answer、provider payload，以及 prompt/reasoning/答案 key。禁止仅靠 UI 隐藏：shared DTO、IPC parser、gateway、日志和测试 fixture 均须拒绝或脱敏。
- [ ] 为 v1/v2 写明确 migration/compatibility policy：可读取的旧历史如何投影、未知版本如何 fail closed、是否允许双读；不得静默混用 schema 或把未验证 v1 事件标为 v2 成功。

### M7 — Coordinator production bootstrap 与 IPC assembly

**前置：** M5/M6 已集成；Protocol Medium 中影响 terminal durability/authority 的项已关闭或被明确 gate 阻断。

- [ ] 把已存在且主要由 unit/integration fixture 使用的 `TeachingTurnCoordinator` 以 production composition root 创建，注入真实 ledger/recorder/committer/reconcile/planner/context/grounder ports。
- [ ] 组装版本化 IPC command、gateway、订阅/replay 与严格 command parser；禁止 renderer 直接触碰 coordinator ports 或 filesystem truth。
- [ ] 明确 lifecycle：accepted、durable receipt、ephemeral projection、terminal、replay/recover 的顺序、幂等键和失败映射；同一 identity 的重复/乱序/并发必须 fail closed 或返回既有结果。
- [ ] bootstrap 只连线，不改写已验收 committer/planner/context/Protocol Core 语义；新增环境依赖、权限和 capability 都必须显式配置并可测试。

### M8 — App/Reader 正式 snapshot/presentation 消费

**前置：** M6 schema 已锁定，M7 生产 assembly 已可运行。

- [ ] App/reader 从 `readTeachingLoopSnapshot` 和受控 event/replay 消费状态，使用 `TeachingTurnPresentation` 做 learner-safe 投影；不再以技术 timeline、猜测的 Agent 状态或乐观 spinner 充当教学事实。
- [ ] 保持 M4 sole-writer：UI 只能发 allow-listed action/request，不能自行写 outcome/record、拼装 DTO 或宣布 mastery。
- [ ] 覆盖键盘、焦点、accessible name、有限 `aria-live`、非颜色唯一提示、source 摘要访问、错误/重启状态；保存成功仅在 durable proof 已确认后宣布，且不重复公告。
- [ ] Reader/App/diagnostics 的 DOM、snapshot 和可导出文本继续执行 redaction/allow-list gate。

### M9 — restart/recovery reconstruction

**前置：** M7 durable production assembly 与 M8 UI consumption 已存在；M6 有可判别版本策略。

- [ ] 应用重启后仅从 canonical ledger/recorder/committer/reconciliation 事实重建 snapshot、terminal、planner 与 presentation；不得把内存 bus、旧 renderer 状态或临时 provider 输出当 authority。
- [ ] 覆盖 restart 发生在 accepted、evidence、commit、catalog read-repair、terminal/replay 等窗口；重复 replay、operation/event ID 和乱序事件均不得产生第二个 record、第二个 active step 或第二次“已保存”。
- [ ] 不能确认 durable effect 时保持 review/reconcile/failed 的安全状态，而不是自动写入；恢复结果须与 catalog/projection/UI 三层一致。

### M10 — 真实 Electron Production App Golden

**前置：** M5–M9、Protocol Medium backlog 和独立 review 均已完成并推送；在干净 checkout 上运行。

- [ ] 通过真实 Electron 生产 App 路径（renderer → preload → IPC → main services → canonical files → renderer）验证固定离线 fixture：错误回答 → `needs_practice` → 对比/重试 → `misconception_corrected` → 恰一个 Learning record → planner 下一步 → grounded source → learner-safe presentation。
- [ ] 强制验证两个 crash window：
  1. artifact/Learning record rename 后、catalog 更新前；
  2. temp write 后、atomic publish 前。
  重启后只能得到一致事实或安全未完成态，绝无幽灵完成、半发布或重复记录。
- [ ] 重放同一 event/operation ID、重启重开 Session、source 移除/不 ready、解析拒绝、无 authority、UI a11y/redaction 都必须有可复现的自动化断言。
- [ ] Golden 至少在干净 checkout 重复运行三次（`--repeat-each=3` 或等价更强执行），不得有 flaky；产物仅保留脱敏 fixture、截图和事件摘要。

### Protocol Medium backlog — 必须在声称 production terminal 可信前关闭

- [ ] **durable success 显式绑定 reconciliation：** success/terminal 只有在 authoritative `recon.state` 为 `settled` 或满足已定义的 `repaired` 证明时才可 durable；marker、record、identity、evidence、operation 与 catalog 关系必须一致。不得仅信任 commit 自报或 `recon.record` 单点。
- [ ] **收紧 success DTO：** `recordSaved` 与 `catalogRecordPresent` 的 optional/默认语义必须按 kind、record presence 和 reconciliation state 明确化；禁止“字段缺失即 false/成功”的宽松解释，禁止 record-claiming outcome 在没有相匹配 marker/record proof 时 durable。
- [ ] **pending/no-authority 策略：** 合法的 no-authority/no-record `pending` 仅能产生 ephemeral `insufficient_evidence`；任何 authority 缺失、冲突、parse 不确定、身份不匹配或错误 durable claim 都必须 sticky `failed`/review 状态，不能在 replay 后变成 success。
- [ ] 为上述三项各增加正例、反例、spoofed DTO、乱序/replay、restart/reconcile 与 renderer-visible terminal tests；未知字段/未知 schema 必须 fail closed。

---

## 4. 严格依赖与集成顺序

```text
已合入领域基线 + M4 sole-writer + Protocol Core v1 + 既有 gates
  └─ M5：production read-only snapshot IPC（独立 review + latest-main integration）
      └─ M6：schemaVersion 2 public projection / migration policy
          ├─ Protocol Medium hardening（durability/DTO/pending authority）
          └─ M7：Coordinator production bootstrap + IPC assembly
              └─ M8：App/Reader snapshot + presentation 正式消费
                  └─ M9：restart/recovery reconstruction
                      └─ M10：真实 Electron Production App Golden + 全量发布审计
                          └─ P1/P2 Codex 借鉴（仅在 M10 gate 后）
```

- 下游只依赖**已提交并已 push 的 hash**，不依赖任何 owner 的本地 worktree、未提交修复或口头承诺。
- 每个里程碑必须有唯一 owner、独立分支、明确 base hash 和互斥写域；hub（shared IPC contract/gateway、workspace façade、preload、App、test config）只能由指定 integration owner 在记录锁转移后改动。
- M5 结束不自动表示 M6/M7 可跳过；M7 的 coordinator 接通不自动表示 UI/restart/Golden 完成；M10 前一律不能宣称“教学闭环已生产完成”。

---

## 5. 验收证据与 gates

### 每个提交 / 独立 review 的最低证据

- [ ] `git status --short --branch` 干净；`git diff --check` 通过；`git diff --name-only <base>...HEAD` 仅在获准写域。
- [ ] 先有可失败的 unit/integration/E2E 测试和负例；禁止删/skip/放宽断言、只更新 snapshot、宽泛 `as any`、silent fallback 或手工演示代替自动化。
- [ ] 类型检查、目标包测试、相关回归和安全/隐私/a11y/redaction tests 的实际输出已记录；失败、未运行或缺少命令都应如实标为“未证明”。
- [ ] Review 逐项确认：目标/非目标、public contract、unknown input、identity/authority、durability、read/recovery、privacy、a11y、legacy/migration、写域、下游 dependency hash 和已知风险。
- [ ] 每个 green checkpoint 立即形成聚焦 commit 并普通 push；已 push 分支禁止 force-push，修复用追加 commit。

### M5–M9 需要新增或扩展的直接证据

- [ ] **M5：** renderer→preload→gateway→service 的真实 invoke test；strict request/result parser tests；无副作用前后对比；source/identity allow-list；learner-safe payload 与日志 redaction。
- [ ] **M6：** schema v1/v2 compatibility 和 unknown-version rejection；full planner/context/sourceId projection；所有禁止字段的 property/negative tests。
- [ ] **M7：** production composition root、真实 port injection、command/event/replay IPC、重复/乱序/并发、terminal ordering 与 authority failure tests。
- [ ] **M8：** Electron a11y、keyboard/focus、saved-announcement dedupe、DOM/snapshot/diagnostic redaction，以及 UI 不重算领域事实的测试。
- [ ] **M9：** crash/restart/reconcile fixtures；canonical/catalog/UI 三层断言；no-authority/pending/replay 的安全 terminal 断言。

### M10 发布阻塞全量 gate

在**干净 checkout** 中先验证脚本存在，再执行计划要求的等价或更强命令；若规划中的命令缺失、改名却无 ADR/等价自动化，结论必须是“未证明”，不得降级为人工验收。

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm run typecheck`、`pnpm run test:unit`、`pnpm run test:integration`、`pnpm run build`
- [ ] `pnpm run check:security`、`pnpm run check:provider-privacy`、`pnpm run check:settings-secret-storage`、`pnpm run check:repository-hygiene`
- [ ] `pnpm run check:agent-run-recovery`、`pnpm run check:agent-operation-idempotency`、`pnpm run check:workspace-write-tool`、`pnpm run check:web-fetch-safe-url`、`pnpm run check:external-link-controls`
- [ ] `node scripts/check-workspace-catalog-reconciliation.mjs`、`node scripts/check-teaching-learning-loop.mjs`
- [ ] `pnpm exec playwright test --project electron-e2e tests/e2e/teaching-learning-loop.e2e.spec.ts`
- [ ] 同一 Electron Golden 再执行 `--repeat-each=3`；并执行 `git diff --check`

**任一** flaky、安全/隐私泄露、secret/路径/raw payload 暴露、canonical/catalog/UI 不一致、重复 record、未确认写入自动重试、schema downgrade、或者未关闭的 Protocol Medium authority 漏洞，都阻塞 M10 与发布。

---

## 6. 不可冒充生产完成的边界

在以下任一事实存在时，禁止写“生产完成”“P0 完成”“教学闭环完成”或等价表述：

- M5 只有 worktree/branch，或只完成 domain module/unit test，未有 renderer→Electron IPC→main façade 的只读生产链与独立 review。
- M6 schema v2 没有严格 migration/禁止字段测试，或 M7 只在 fixture 中创建 coordinator、没有 production bootstrap/IPC assembly。
- App/reader 没有消费 canonical snapshot，或仍用 renderer/Agent 技术状态推断 mastery/save 状态。
- restart/recovery 不能从 canonical truth 重建，或 durable terminal 仍可在 pending/no-authority/不确定 reconciliation 上被宣布成功。
- 未在干净 checkout 通过 M10 真实 Electron Golden、两个 crash window、幂等/乱序重放、三层一致性、a11y/redaction 与全量 gate。

此阶段允许的准确表述是：**“底层教学领域模块、M4 sole-writer 和 Protocol Core v1 已合入；M5 production read-only snapshot IPC 尚未开始提交，M6–M10 与 Protocol Medium hardening 仍待交付。”**

---

## 7. `codex-rust-v0.144.4-teaching-adoption-plan.md` 完整逐项 crosswalk

**判定规则：** 下表逐项对应该规划的 P1-1…P1-13、P2-1…P2-8；状态仅表示截至 `origin/main` `5f5cd32` 已由提交/源码确认的范围，不能把“已有相邻模块、fixture 或 gate”扩大为该 work package 完成。规划原文规定 **P1 只有在 P0 Golden E2E 通过后才进入**；当前对个别 P1 项的“部分完成”只是已合入的前置/局部实现，剩余工作仍按 P1 的完成定义执行。

### P1（P0/M10 全绿后才可按风险证据排期）

| 规划包 | 准确状态 | 已合入部分与剩余边界 | 与 M5–M10 的关系 |
|---|---|---|---|
| **P1-1 Canonical Teaching Event Protocol** | **部分完成** | 已合入 `teaching-events.ts` schema v1、严格 envelope/parser、Coordinator core 与 Round 1–11 hardening。**未完成**：规划要求的 legacy `chunk/status/tool/terminal` adapter 迁移、双读单写/版本 upcaster、一个发布周期 telemetry，以及回放重建的完整跨 runtime 迁移。Protocol Core v1 不等于完整 protocol migration。 | M5 使用严格只读 contract；M6 只能定义并验证 snapshot/event v2 的迁移边界；M7 接入 production IPC。M10 前不能把 v1 core 或 v2 DTO 说成 P1-1 完成。 |
| **P1-2 Typed Tool Dispatcher 与 Effect Policy** | **后续** | 尚无规划定义的统一 `ToolDispatcher.dispatch`、`ToolOutcome`/`LifecycleOutcome` 和 `EffectPolicy` 全面迁移。已有 workspace-write/web-fetch checks 只是现有安全 gate，不是 dispatcher/effect-policy 完成。 | M5–M10 继续复用既有授权/安全 seam，不得为了此项重构 tool/runtime；M10 后以已观察 effect 风险为立项证据。 |
| **P1-3 显式 Agent Run 状态机** | **后续** | 现有 Agent recovery/operation-idempotency checks 不等于 `AgentRunStateMachine`；`waiting/running/awaiting_user/cancelling/completed/failed/interrupted` 的闭合迁移尚未证明。durable `request-user-input` / Action Required / Draft State 也没有独立完成证据。 | M9 可验证教学事实恢复，但不得把 teaching Session 与 Agent run 混为一体；显式 run state 与 durable action-required/draft-state 留在 P1。 |
| **P1-4 TeachingConfigResolver** | **后续** | 现有 settings/secret-storage 机制可被 P0 消费；尚无教学闭环专用的 layered config resolver、来源解释、fingerprint 与诊断 contract。 | M5–M10 仅使用既有受控配置，不能引入第二配置平台；后续与 P1-5 共同提供 Layered Config 基线。 |
| **P1-5 TeachingCapabilityCatalog** | **后续** | 尚无 immutable `CapabilitySnapshot`、availability/freshness/readiness catalog；不得把当前 resource readiness 或 provider registry 误报为 capability catalog。 | M5/M6 可只投影已验证的 resource readiness/sourceId；M7–M10 不冻结或扩展 provider/skill 能力。P1-4 完成后才可形成 Layered Config + immutable Capability Snapshot。 |
| **P1-6 Context Projection Report 与预算审计** | **部分完成** | P0 已有 `TeachingContextAssembler`、最小 `ResourceGrounder`、预算/provenance 约束。**未完成**：跨 runtime 的稳定 `ProjectionReport`、统一 Context、compaction、Skills Injection Report、确定性 fingerprint 和默认脱敏的 included/omitted/truncation 报告。 | M5/M6 只能输出 learner-safe 的有限 context/source projection；不得把 snapshot DTO 当作完整 projection report。M10 后按 P1 完成 report 与 context hygiene/compaction。 |
| **P1-7 Durable CourseDefinition** | **后续** | Course 仍不能因已有目录/catalog 投影而视为 durable CourseDefinition；`CourseDefinitionStore.read/write/repair`、lazy migration 与可恢复 Session ordering 未完成。 | M5–M10 使用当前 Mission/Course/Session facts 和 fixture，不得顺带改文件格式或启动全库迁移。 |
| **P1-8 ResourceGrounder 深化** | **部分完成** | 已有 P0 最小 `ResourceGrounder` 与可信 sourceId/provenance 路径。**未完成**：统一 `GroundingSourceAdapter`、去重/freshness/digest/trust-use-for、引用失效、safe URL 与真实教学 Adapter 驱动的扩展；不得演化为默认 RAG/vector 平台。 | M5–M10 只要求真实、allow-listed grounded sourceId 和 resource-gap 降级；深化放到 M10 后的 P1。 |
| **P1-9 TeachingWorkspaceInspector** | **后续** | 尚无默认只读的 `WorkspaceInspectionReport`；catalog reconciliation 脚本不等于 inspector，inspect 与 repair 分离也未完成。 | M9/M10 的恢复/三层断言可提供需求证据，但不得让诊断读取暗中修复或变成 M5 effect。 |
| **P1-10 结构化 Doctor 与恢复报告** | **后续** | 尚无 `TeachingDoctor.run()`、稳定 check code/safe evidence/recommended action 的可导出只读报告。M9 recovery tests 不等于 Doctor。 | M9/M10 先证明 crash/recovery；P1 再将已观察的 crash window、source gap、catalog drift、config 问题诊断化。**Support Bundle 不属于 P1-10。** |
| **P1-11 Audit Correlation 与 Provider Privacy** | **部分完成** | operation/event identity、Protocol Core authority hardening、`check:provider-privacy` 与 secret-storage gate 已存在。**未完成**：完整 `AuditCorrelation` seam、safe metadata audit store、跨 evidence/effect/outcome 关联与专用 audit-correlation check；旧自由文本日志不得迁入。 | M5–M10 持续执行 allow-list/redaction，不得输出 provider payload/secret/raw answer；M10 不通过时阻塞，P1 再补全 correlation。 |
| **P1-12 Teaching Composer Commands 与无障碍加固** | **部分完成** | learner-safe presentation、Reader 相关 a11y/Electron 测试已合入。**未完成**：规划中的有限 `TeachingCommand` union（continue/retry/show_source/end_session）、稳定“轮到你”composer、reduced-motion 与完整 composer a11y gate；不得扩张为通用 Agent 控制台。 | M8 必须消费 snapshot 并保持 keyboard/focus/redaction，但这不自动完成 P1-12；其余 composer command 仅在 M10 后按 P1 边界推进。 |
| **P1-13 Main-process TeachingTurnCoordinator 与 Blocking CI** | **部分完成** | `TeachingTurnCoordinator` core、schema v1 与 unit/integration fixture 已合入。**未完成**：M7 的真实 production bootstrap/IPC assembly、真实 renderer 不直编排 writer/provider 的证明，以及将 P0 Golden/security/privacy/typecheck/build 设为 Blocking CI 的 workflow/required checks。Coordinator core 不等于 M7 或 Blocking CI 完成。 | M7 是该包的 production assembly 前置交付；M10 是 blocking Golden/全量 CI 证据。P1-13 只有二者完成且 CI 实际 required 后才可标记完成。 |

### P2（默认不排期；必须有真实规模/风险信号）

| 规划包 | 准确状态 | 真实触发条件与剩余边界 | 与 M5–M10 的关系 |
|---|---|---|---|
| **P2-1 Learning Branch Projection** | **触发式候选** | 仅当线性 planner 已无法覆盖经观察的 remediation/alternative path，且有用户需要分支学习的比例等量化信号时立项；先做只读的 **branch-history read model** / 分支投影，绝不复制 canonical outcome/record。 | 非 M5–M10 依赖；M10 的线性 Golden 必须先成立。 |
| **P2-2 长 Session Resume Picker** | **触发式候选** | 仅当真实 workspace 的 Session 数、恢复耗时或恢复失败工单达到团队预设门槛时立项；**resume picker** 候选必须来自 durable ledger，含 keyboard/a11y。 | M9 先完成 canonical recovery reconstruction；不得用 picker 替代恢复正确性。 |
| **P2-3 高级技术 Inspector** | **触发式候选** | 仅当支持/开发确实需要查看 typed events、effects 或 projection report 来定位问题时立项；必须默认隐藏、只读、全字段走 redaction schema，不能成为学习者默认 UI 或展示 raw reasoning。 | 非 M5–M10 gate；M10 的 redaction/audit 结果是是否需要 inspector 的输入证据。 |
| **P2-4 保守的并行只读工具** | **触发式候选** | 先有 P1-2 typed dispatcher/effect 分类，再由 profiling 证明 allow-listed `effect=read` 工具存在实际性能收益；resource locks 不冲突、输出顺序确定、取消传播，写 effect 永不并行，默认仍串行。 | 与 M5–M10 不适用为前置；不得为缩短 Golden 而引入并行/非确定性。 |
| **P2-5 Watcher/Config 乐观并发** | **触发式候选** | 仅在观察到多人/外部编辑丢失、真实冲突或 watcher 事件问题后，结合 P1-4 fingerprint 引入 `write(expectedFingerprint,next)`；必须避免静默覆盖、假冲突和 watcher 风暴。 | 非 M5–M10 依赖；当前 crash/read-repair 不授权其提前写入。 |
| **P2-6 MCP（仅在存在真实教学 Adapter 时）** | **触发式候选** | 必须同时具备至少一个真实教学场景、用户价值、威胁模型、授权/超时/审计/隐私/离线降级和有限 typed adapter；无真实 Adapter 则永不实施，绝无任意工具透传。 | 与 M5–M10 不适用为前置；不能作为 grounding/IPC 的快捷替代。 |
| **P2-7 Helper Isolation（仅执行不可信代码时）** | **触发式候选** | 仅当产品明确需要执行不可信学习代码时立项；届时须有独立 process/OS boundary、deny-by-default capability、资源限制、文件/网络 allow-list、kill/recovery/audit。普通 Lesson/grounding 不经过 helper。 | 与 M5–M10 不适用为前置；不得因“安全看起来更强”而提前引入跨平台维护负担。 |
| **P2-8 脱敏 Support Bundle** | **触发式候选** | **固定归属 P2-8，不得升格为 P1。** 先交付 P1-10 本地只读 Doctor（以及需要时 P2-3 Inspector）；只有真实支持流程证明本地报告不足、并有隐私评估与 ADR 时，才做 `SupportBundleBuilder`。默认不得含 raw answer/prompt/provider payload/secret/完整绝对路径，必须用户预览并明确同意。 | 非 M5–M10 依赖；M10 仅提供 redaction baseline，不能作为 Support Bundle 已完成的证据。 |

### 与当前里程碑的范围结论

- M5–M10 的目标是把**已存在的教学事实深模块**接成可审计、可恢复、learner-safe 的 production Electron 闭环；它们不是把全部 P1/P2 提前完成的容器。
- P1-1、P1-6、P1-8、P1-11、P1-12、P1-13 均已有局部合入事实，仍必须分别完成上表列出的迁移/报告/深化/CI 边界；不得以“部分完成”写成“已完成”。
- P2-1…P2-8 全部不排期，尤其 P2-3…P2-7 只接受表中真实规模/风险信号；**Doctor 仍为 P1-10，而 redacted Support Bundle 仍为 P2-8**，当前没有将其提前实施或升格的证据与 ADR。

---

## 8. 协作、分支事实与仓库卫生

- 当前主工作区 `D:\project\StudiumX` **不是 clean**，但不得把它描述成可随意清理的功能性脏树：唯一 tracked 的 `src/renderer/src/views/agent-conversation/AgentConversationReader.tsx` 在 status 中显示修改，而 `git diff --numstat` 和 `git diff --ignore-space-at-eol --numstat` 均无内容差异，应按 **EOL 假脏** 处理；同时其中保留受保护的 untracked 资产/运行产物，包括 `codex.png`、`fault.png`、`.out/.err/.pid`、损坏依赖备份等。任何 owner 都不得在该工作区 checkout、stash、reset、clean、rebase 或写文件。
- 不得把本地可见的 **9 个 `fix/*` 分支**写成 9 个远端分支；远端存在性只能以 `git ls-remote --heads origin <branch>` 或已 fetch 的 `refs/remotes/origin/*` 证明。本地分支、其他 worktree 和未推送提交都不是下游依赖。
- 并行任务一律从已 fetch 的 `origin/main` 建独立干净 worktree/分支；下游只依赖已 commit 且已 push 的 hash。
- 只提交 owner 获准的路径；集成 owner 只写 glue/hubs/golden tests，不重写已验收深模块。
- 不触碰、更名、提交或将其纳入 diff：`codex.png`、`fault.png`、测试运行 `.out/.err/.pid`、构建产物、临时 fixture、损坏依赖备份或他人未跟踪文件。
- handoff 必须记录：branch、origin ref、base/commit hash、changed paths、实际命令与结果、未运行项及原因、review、未决风险、交付 contract 和下游必须等待的 gate。
