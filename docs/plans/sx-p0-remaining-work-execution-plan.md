# StudiumX P0 剩余工作权威执行计划

> **文档状态：实施前基线与后续执行顺序；不是完成声明。**
>
> **基线确认日期：2026-07-15**
>
> **唯一事实来源：** Git 的已合入提交、已推送分支和自动化测试结果。产品文件仍是运行时教学事实的来源；本文只规定后续实施与验收纪律。
>
> **适用范围：** 继承 `codex-rust-v0.144.4-teaching-adoption-plan.md` 的 P0 教学闭环。本文在该规划之上记录当前 cutover 状态、尚未完成的 P0 路线、写域隔离和交付门禁。若两份文档在未来实现细节上冲突，以经过评审的领域 contract、实际 canonical schema 和新增 ADR 为准；不得以本文为理由扩大 P0 范围。

---

## 1. 执行结论与当前状态

P0 的第一段基础链已经进入 `main`：**Session、Evidence，以及 Outcome 的“禁止 Lesson 生成自动写正式 Learning record”cutover** 都已完成并合入。它们不是待实现项，也不应被后续包重新设计或回退。

但 **P0 教学事实闭环尚未完成**。截至本基线：

- `main` 的 HEAD 为 `1710743`（`feat(lesson): cut over auto learning records`）。
- `LearningSessionLedger`（Session）已在 `main`，源提交为 `20ae4e9`，并已包含随后恢复/并发/原子 receipt 加固。
- `LessonInteractionRecorder`（Evidence）及 preview 到 canonical Session 的绑定已在 `main`，源提交为 `17343d3`，并已包含 evidence receipt/guard/preview lifecycle 加固。
- 自动 Learning record 写入的 cutover 已在 `main`：Lesson 生成不再把 `learningRecordNote` 当作已被证实的学习事实。
- `feat/sx-p0-outcome-evaluator` 上存在 **尚未进入 `main` 的 evaluator 预备工作**（从 `863d8ed` 到已推送的 `225ec0c`）。该分支的工作树当前还有未提交的 P1 修复；它必须先完成本分支的 P1 fixes、review 与受控集成，**不能被称作已完成的 Outcome committer**。
- `LearningOutcomeCommitter`、`NextTeachingStepPlanner`、`TeachingContextAssembler`/ResourceGrounder、`TeachingTurnPresentation` 和 P0 Golden E2E 均尚未完成。

因此，后续工作的严格顺序是：

```text
0. evaluator branch：完成 P1 fixes → review → integration（只交付 evaluator foundation）
1. Session/outcome 原子结算（LearningOutcomeCommitter）
2. Outcome committer 的窄 IPC 接入
3. Planner（NextTeachingStepPlanner）
4. Context（TeachingContextAssembler + 最小 ResourceGrounder）
5. Present（TeachingTurnPresentation）
6. Golden E2E、故障注入、全量发布审计
```

**不得跳过第 0 步，或把 evaluator 的“可判定证据”误报成“已安全提交 outcome/record”。** evaluator 只能产生候选判定；只有 committer 才能结算 canonical outcome 和正式 Learning record。

---

## 2. 已完成且已合入的基线（不得回退）

下表只记录已由 Git 历史确认的事实；它不把 evaluator 分支或任何工作树的未提交内容标记为完成。

| 基线 | 已合入事实 | 证据提交/范围 | 后续不得破坏的不变量 |
|---|---|---|---|
| Session | durable `LearningSessionLedger`、legacy projection、恢复/并发/append receipt 加固已进入 `main`。 | 初始 `20ae4e9`；随后有 `1052aa2`、`f4f7e40` 等加固。 | 新的学习步骤必须有稳定 Session identity；相同 event/operation 不得制造重复事实；catalog 是可修复投影。 |
| Evidence | typed lesson interaction evidence、原子 evidence receipt、preview 与 canonical Session 绑定、preview lifecycle 测试已进入 `main`。 | 初始 `17343d3`；随后 `4d4e39b`、`c45d444`、`6521cb8`、`216e6fa` 等。 | renderer/自由文本不得直接宣布掌握；回答需带稳定 evidence identity/provenance；重复事件幂等。 |
| Outcome cutover | Lesson 生成自动写正式 Learning record 的旧语义已切断。 | `1710743` 已是 `main` HEAD。 | 仅生成或打开 Lesson 不得产生“已掌握”记录；预期答案/评分 rubric 不是学习结果。 |

后续实现必须将这些基线作为依赖，而不是替代品：

1. **Session 是教学领域对象**，不等同于 Agent run、旧 workspace `SessionEvent` 或单个 Lesson 文件。
2. **Evidence 是原始、可追溯的学习者交互事实**；它本身不是 outcome，更不是 Learning record。
3. **Learning record 是证据门控的 durable effect**；它不能由生成、打开、模型自述或 UI 乐观状态直接产生。
4. canonical files 优先于 catalog、UI 和缓存投影；任何投影失败都不能改写 canonical 事实。
5. 不重引 `learningRecordNote` 自动落盘路径，也不创建第二套 Session/evidence/catalog/Agent loop。

---

## 3. evaluator 分支：P1 fixes、review 与集成门

### 3.1 当前准确位置

`feat/sx-p0-outcome-evaluator` 的已推送 tip 是 `225ec0c`（`feat(teaching): publish canonical assessment artifacts`）。该分支含 evaluator 与 publisher-owned assessment sidecar 的准备工作，但它**尚未合入 `main`**。其工作树中还有未提交的 P1 fixes，至少涉及 evaluator、path access 和 evaluator unit tests；这些改动不属于已完成事实。

该分支可以交付的范围仅为：**安全地从已绑定、digest 校验、publisher-owned 的 assessment artifact 加载 typed evidence 并得到 outcome evaluation input/result。** 它不应抢先写 Learning record、planner 状态、renderer presentation 或 Golden glue。

### 3.2 P1 fixes 的目标

在 review/integration 之前，evaluator owner 必须把未提交 P1 fixes 收敛为可审查的最小 patch，证明 evaluator 对 canonical assessment 的信任边界是保守的：

- 路径必须通过既有 safe-path/realpath 边界，拒绝 traversal、junction/symlink escape、非 assessment 文件和超限读取。
- assessment 必须是 Session/Lesson binding 显式引用的 publisher-produced sidecar；必须做 SHA-256 digest 校验。
- parser 只能接受明确的静态 assessment grammar，不得把任意“看起来安全”的 HTML 或可执行 Lesson 当作权威评分来源。
- active content、quirks-mode 文档、嵌套/歧义 quiz、重复/错序 item identity、未知 schema 或损坏文件必须保守失败为 `not_evidenced`/可诊断状态，绝不能放大为 `established`。
- 故障、缺失或不可信 artifact 只能阻止判定；不得自动补写 evidence/outcome/record。

### 3.3 evaluator 分支的限定写域

默认只允许修改下列 evaluator 自有范围及其直接 tests/fixtures：

```text
src/main/learning-outcome-evaluator.ts
src/main/path-access.ts（仅 evaluator 所需的窄安全 helper）
tests/unit/learning-outcome-evaluator.unit.test.ts
tests/integration/learning-outcome-evaluator.integration.test.ts
package.json（仅已有 evaluator check 的必要、最小变动）
```

以下内容为边界，除非 integration owner 在书面交接中明确转移锁：

- 不写 `learning-outcome-committer.ts` 或任何 Learning record writer；
- 不写 planner/context/presentation；
- 不重写 `teaching-workspace.ts`、`teaching-ipc-gateway.ts`、`teaching-ipc-contract.ts` 等 hub；
- 不把 P1 的通用 protocol、tool dispatcher、Agent state machine、config catalog、MCP、shell 或插件市场混入该分支；
- 不修改已有 Session/Evidence canonical schema 来绕开 evaluator 约束。

### 3.4 TDD 验收与 review gate

先写失败测试，再实现最小收敛修复。至少覆盖：

1. 合法的 publisher assessment sidecar + 正确 digest + verified evidence 可产生确定的 evaluator 结果；
2. 路径逃逸、assessment 缺失、错误扩展名、超限文件、读取失败、digest mismatch、非法 hash、损坏 UTF-8/HTML 均不能建立掌握；
3. 带 script/iframe/object/base/template 等 active 或非正向 grammar 元素的文档被拒绝；
4. quirks-mode、错误 `data-item-id`、重复或嵌套卡片、无效 answer/type、超出允许数量的题目被拒绝；
5. 同一 reloaded Session/evidence 输入得到稳定、可序列化的结果；不存在 evaluator 读取时隐式写入；
6. 既有 Session/Evidence/lesson artifact 回归保持通过。

建议最小命令证据：

```powershell
pnpm run check:learning-outcome-evaluator
pnpm run typecheck
git diff --check
```

如果 P1 fixes 需要新增安全 helper，必须增加直接负例；不能只依赖 happy-path snapshot。review 必须逐项确认：trust root、path resolution、digest、HTML grammar、失败语义和无写入副作用。review 通过后以**追加 commit**提交并 push；禁止 rebase + force-push 已推送历史。

### 3.5 集成 gate

evaluator 被 integration owner 合入后，应只提供一个可被 committer 调用的纯/只读 evaluator interface。合入前：

- 确认 evaluator 分支所有必要 fixes 已 commit、push、review；
- 对 `main` 做普通 merge 或从已推送 commit 做窄 cherry-pick，逐 hunk 解决冲突；
- 运行 evaluator tests、typecheck、`git diff --check` 及 Session/Evidence 相关回归；
- 集成提交不得顺带开始 outcome commit、IPC 或 planner；
- 记录被集成的 commit hash、测试证据、changed paths、未决风险与下游 committer contract。

---

## 4. 后续 P0 工作包与严格依赖

每个包必须有唯一 owner、独立分支、明确 base hash 和互斥写域。下游只依赖已 push 的 commit，不依赖他人本机工作树。任何包发现上游 interface 不足时，返回上游 owner 追加窄 commit；不得在下游或 integration 分支复制/重写深模块。

### P0-R1：Session/outcome 原子结算（LearningOutcomeCommitter）

**前置依赖：** 已合入的 Session/Evidence/cutover 基线，以及已 review/integrated 的 evaluator foundation。

#### 目标

将 evaluator 的只读结果与 durable Session/Evidence 结算为唯一、可审计、可恢复的 `LearningOutcome`；仅在 outcome 为 `established` 或 `misconception_corrected` 且证据充分时，幂等发布正式 Learning record。实现应把 `evaluate`（只读判定）与 `commit`（durable effect）分开。

推荐最小 interface：

```ts
interface LearningOutcomeCommitter {
  evaluate(input: OutcomeEvaluationInput): OutcomeDecision
  commit(input: OutcomeCommitInput): Promise<OutcomeCommitResult>
  reconcile(sessionId: string): Promise<OutcomeReconciliation>
}
```

#### 非目标与安全边界

- 不实现 Planner、Context、renderer presentation 或通用 transaction framework。
- 不让 IPC/renderer 直接写 `learning-records/`、outcome markers 或 catalog。
- 不将 `needs_practice`/`not_evidenced` 伪装为成功，也不生成“已掌握”措辞。
- 不覆盖或自动修复损坏 legacy record；保留原始字节，隔离并诊断。
- 不能确认副作用是否完成时，返回可 review/reconcile 的不确定状态；不得盲目重写。

#### 限定写域

建议 branch：`feat/sx-p0-outcome-committer`。默认可写：

```text
src/main/learning-outcome-committer.ts（或 src/main/learning-outcome/ 下唯一深模块）
src/shared/teaching-types/learning-outcome.ts（若缺失）
tests/unit/learning-outcome-committer.unit.test.ts
tests/integration/learning-outcome-commit.integration.test.ts
scripts/check-learning-outcome-committer.mjs
scripts/check-learning-record-evidence-gate.mjs
scripts/check-learning-outcome-recovery.mjs
scripts/check-learning-record-read-repair.mjs
```

不得碰 hub、IPC、renderer、planner/context/presentation。若必须读取既有 catalog/record writer，只通过其稳定 seam；任何 hub 适配由后续窄 IPC/integration owner 完成。

#### TDD 验收

1. 只生成/打开 Lesson、没有 verified evidence、或 evaluator 拒绝时，**零** Learning record。
2. `needs_practice` 与 `not_evidenced` 可结算为 outcome，但绝不写 mastered/established record。
3. `established` 与 `misconception_corrected` 只写一个 record，包含 Session、Lesson/assessment、evidence IDs、规则/evaluator version 与 operation identity。
4. 同一 operation/outcome 的重试返回 `already_committed` 或等价幂等结果，不产生第二个 record/outcome。
5. stage → flush → atomic publish → settlement marker → catalog reconcile 的每个边界可恢复：record 已发布/catalog 未更新可 read-repair；publish 前失败不会产生完成投影。
6. outcome marker 与 Learning record 交叉状态可 `reconcile(sessionId)`，canonical file 优先。
7. 旧 `legacy_generated` record 仅可读/标注，不自动升级为掌握证据。

最低命令：

```powershell
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
pnpm exec vitest run --project integration tests/integration/learning-outcome-commit.integration.test.ts
pnpm run check:learning-outcome-evaluator
pnpm run typecheck
git diff --check
```

#### 具体 Golden 子场景

在确定性 workspace 中，建立绑定 assessment 的 Session：第一次错误回答结算 `needs_practice`，断言没有 `learning-records/` 文件；第二次经过纠正的正确回答结算 `misconception_corrected`，断言恰有一个 record，且其 provenance 引用同一 Session 的两次 evidence。对相同 operation 重放两次，目录和 Session outcome 保持单一。

---

### P0-R2：Outcome committer + 窄 IPC

**前置依赖：** P0-R1 已 push、review、可独立运行；evaluator 已在集成基线中。

#### 目标

将 LearningOutcomeCommitter 以**最小、版本化、typed 的 IPC command**接入已有 main-process teaching façade，让受支持的 preview/review（以及必要的 conversation adapter）能请求结算并获得安全的 projection。IPC 是调用边界，不是第二个领域实现。

#### 非目标与安全边界

- 不创建泛用“写文件”/“执行 outcome” IPC；请求只能携带允许的 Session/evidence/operation identity 与明确 action。
- renderer 不得提交 record 内容、任意路径、任意 outcome label、答案 key 或安全敏感 artifact payload。
- 不在此包把 planner 自动推进、生成下一 Lesson 或修改 UI state machine。
- 只 expose allowlisted learner-safe status；不暴露 raw prompt、provider payload、chain-of-thought、secret、绝对路径或 evaluator internals。

#### 限定写域

建议 branch：`feat/sx-p0-outcome-commit-ipc`。唯一获准写 hub 的 owner 仅在以下窄范围修改：

```text
src/shared/teaching-ipc-contract.ts
src/shared/teaching-types/system-api.ts（若现有 contract 要求）
src/main/teaching-ipc-commands.ts
src/main/teaching-ipc-gateway.ts
src/main/teaching-workspace.ts（仅 façade delegation）
src/preload/index.ts
tests/unit/teaching-ipc-gateway.unit.test.ts
tests/unit/teaching-workspace-outcome-commit.unit.test.ts（新增）
```

`learning-outcome-committer.ts` 是 P0-R1 owner 的深模块，IPC owner 不得改写其 durable 算法。`App.tsx`、planner/context/presentation 不在本包写域。

#### TDD 验收

1. contract 对 success、already committed、insufficient evidence、conflict、retryable/non-retryable failure 有判别联合；不靠错误字符串。
2. main 端验证 Session/evidence relationship 和 operation identity；非法/跨 workspace/路径字段被拒绝。
3. 同一 IPC request 重发不会重复 record；结果来自 committer 的 durable result，而不是 renderer 乐观状态。
4. `needs_practice` 投影只表明需要练习，绝不显示已保存 Learning record。
5. preload surface 最小化，未知 channel/extra field/原始私密字段不泄露。
6. gateway 调用仅做输入验证、权限/归属检查和 façade delegation；不复制 evaluator/committer 领域规则。

最低命令：

```powershell
pnpm exec vitest run --project unit tests/unit/teaching-ipc-gateway.unit.test.ts tests/unit/teaching-workspace-outcome-commit.unit.test.ts
pnpm exec vitest run --project integration tests/integration/learning-outcome-commit.integration.test.ts
pnpm run typecheck
git diff --check
```

#### 具体 Golden 子场景

通过 renderer 可见的 preview/review 行为提交首次错误答案，收到“继续练习”而无保存记录；提交纠正答案后得到一次 `misconception_corrected` 保存态。模拟 preload request 重发，UI 与 canonical files 都仍显示同一个 outcome/record，且 renderer 无法调用未声明 channel。

---

### P0-R3：Planner（NextTeachingStepPlanner）

**前置依赖：** P0-R2 已集成，故 outcome 从 UI/IPC 到 canonical files 的路径已可验证。

#### 目标

以 Mission、Course、最新 Session、durable outcome/evidence 和 resource readiness 为输入，确定地选择下一教学动作，例如 `contrast_and_retry`、`continue_next_session`、`request_goal_clarification` 或 `prepare_lesson`。Planner 读取事实、返回计划；它不写 outcome/record。

#### 非目标与安全边界

- 不使用模型自由文本决定领域状态，不启动 Agent run，不直接生成 Lesson。
- 不重做 Course/session catalog 或保存复杂计划历史。
- 缺少可信输入时保守地请求澄清/练习，不把不确定性升级为通过。
- planner 不得绕过 effect policy、resource readiness 或已有 Session 状态。

#### 限定写域

建议 branch：`feat/sx-p0-next-step-planner`。

```text
src/main/next-teaching-step-planner.ts
src/shared/teaching-types/next-teaching-step.ts
tests/unit/next-teaching-step-planner.unit.test.ts
tests/integration/next-teaching-step-planner.integration.test.ts
scripts/check-next-teaching-step-planner.mjs
```

可通过既有 seam 读取 outcome/session/resource summary；不得改 committer、IPC hub、lesson generation 或 renderer。实际 runtime 连接由 integration owner 在 P0-R6 后的明确 glue commit 进行，或单独分配只读 adapter。

#### TDD 验收

1. 相同 normalized inputs 必须得到相同 step/理由码；禁止时间、随机数、模型文本影响选择。
2. `needs_practice` 稳定选择 `contrast_and_retry`；`misconception_corrected` 且后续目标存在时选择继续下一 Session。
3. `not_evidenced`、冲突、未知 schema、资源不 ready 不能选择“完成”或继续生成未经依据的 Lesson。
4. 结果含 inputs/provenance summary 与有限理由码，但不含 private answer/raw evidence text。
5. planner 对 legacy/read-only Session 只做保守建议，不写回 canonical facts。

最低命令：

```powershell
pnpm exec vitest run --project unit tests/unit/next-teaching-step-planner.unit.test.ts
pnpm exec vitest run --project integration tests/integration/next-teaching-step-planner.integration.test.ts
pnpm run typecheck
git diff --check
```

#### 具体 Golden 子场景

同一 Session 第一次 outcome 为 `needs_practice` 时，planner 必须返回 `contrast_and_retry`；第二次 `misconception_corrected` 结算后，planner 返回继续下一步而不是再次宣布掌握或再次创建 record。将资源 readiness 置为 false，结果必须降级为安全等待/澄清动作。

---

### P0-R4：Context（TeachingContextAssembler + 最小 ResourceGrounder）

**前置依赖：** P0-R3 已验证确定性下一步；所有需要实际生成/继续教学的 input 都由 planner 决定。

#### 目标

在统一、受预算控制的 assembler 中，将 Mission、Course、当前 Session、outcome/next step 和可信资源组装为可审计的 `TeachingContext`/`GroundingPack`。Lesson 与 conversation 必须消费同一上下文 contract；实际使用的 `sourceId` 必须可回溯到可靠资源。

#### 非目标与安全边界

- 不引入向量库、复杂 RAG、第二套 provider/skill/config catalog、远程抓取或多 Agent。
- 不让任意文件、未授权 URL、secret、全量 conversation transcript 或 raw provider payload 进入上下文。
- 不在 assembler 中直接写 Lesson/outcome/record，也不把 token budget 失败静默截断为误导内容。
- 不重复 path/URL 安全机制；复用已有安全读取与 resource authority seam。

#### 限定写域

建议 branch：`feat/sx-p0-teaching-context`。

```text
src/main/teaching-context-assembler.ts
src/main/resource-grounder.ts（仅最小实现；可同目录深模块）
src/shared/teaching-types/teaching-context.ts
src/shared/teaching-types/grounding.ts
tests/unit/teaching-context-assembler.unit.test.ts
tests/integration/teaching-context-assembler.integration.test.ts
scripts/check-teaching-context-assembler.mjs
scripts/check-teaching-resource-grounding.mjs
```

不得修改 provider catalog、Agent loop、hub façade、planner/committer 或 renderer。把现有生成路径接到 assembler 的工作必须是明确、窄的 integration glue，不应在本包顺带改写 lesson generation。

#### TDD 验收

1. conversation 与 Lesson generation 对同一输入得到同一 normalized context/grounding identity。
2. `GroundingPack` 包含实际 `sourceId`、定位/provenance、budget 使用与截断理由；没有可信 resource 时结果可诊断且保守。
3. 预算有明确优先级，超过预算时舍弃低优先信息并报告，而不是泄露或隐式随机截断。
4. Session/evidence/outcome 只提供下一教学动作所需的最小摘要；不包含 raw learner input，除非 contract 明确允许且已脱敏。
5. 不允许的 resource、escape path、失效 source、重复片段、未知 schema 全部被拒绝或有 typed exclusion。

最低命令：

```powershell
pnpm exec vitest run --project unit tests/unit/teaching-context-assembler.unit.test.ts
pnpm exec vitest run --project integration tests/integration/teaching-context-assembler.integration.test.ts
pnpm run typecheck
git diff --check
```

#### 具体 Golden 子场景

planner 决定继续下一 Lesson 时，assembler 仅选择 fixture 中两个可信 source 的固定片段。发布的 Lesson/其 canonical metadata 必须引用真实 `sourceId`；移除其中一个 source 后，context report 显示排除原因，生成路径不能偷偷使用硬编码替代来源。

---

### P0-R5：Present（TeachingTurnPresentation）

**前置依赖：** P0-R2 的 durable outcome IPC、P0-R3 planner 和 P0-R4 context 均已集成可读；UI 不应抢先定义这些状态。

#### 目标

把 Session、evidence、outcome、next step、context/resource readiness 和 durable save snapshot 投影为学习者可理解、可访问且不泄密的教学流程。UI 只消费 typed snapshot/events；领域状态机仍在 main/domain modules。

#### 非目标与安全边界

- 不在 renderer 计算 mastery/outcome、生成 Learning record 或重新实现 planner。
- 不把 Agent tool names、branch revision、token、provider request、raw reasoning/prompt/answer key 暴露为学习者状态。
- 不以颜色作为唯一状态；不产生 token/chunk `aria-live` 风暴；不在重启后重复保存公告。
- 不将 `App.tsx` 变成领域 hub；技术 timeline 只作为折叠诊断 adapter。

#### 限定写域

建议 branch：`feat/sx-p0-teaching-presentation`。

```text
src/renderer/src/teaching-turn-presentation.ts
src/renderer/src/agent-conversation-state.ts
src/renderer/src/agent-conversation-projection.ts
src/renderer/src/agent-conversation-presentation.ts
src/renderer/src/agent-process-timeline.ts
src/renderer/src/views/agent-conversation/AgentConversationReader.tsx
src/renderer/src/app-shell/agent-conversation-runner.ts
tests/unit/teaching-turn-presentation.unit.test.ts
tests/e2e/teaching-turn-presentation.a11y.spec.ts（或等价、聚焦 E2E）
scripts/check-teaching-turn-presentation.mjs
scripts/check-teaching-presentation-redaction.mjs
```

`App.tsx`、IPC contract/gateway、package/test configuration 是 hub，默认由最终 integration owner 持锁；若确需修改，只可在锁转移记录后以最小 glue 修改。不得修改 committer/planner/context 深模块。

#### TDD 验收

1. 固定呈现四个 learner phases：确认目标、完成检索练习、讲解/重试、保存/继续；同一时刻最多一个 `active` 或 `needs_you`。
2. 未回答或错答不显示“已掌握”；`needs_practice` 明确导向 retry；`misconception_corrected` 仅在 durable record 已确认后显示保存成功。
3. 保存状态来自 canonical/committer snapshot，catalog reconcile 中只能显示“正在确认保存”。
4. 键盘可完成回答、重试、继续和查看 source；焦点移动合理；关键状态有克制 `aria-live`；所有状态有文字语义。
5. technical details allowlist/redact；snapshot、DOM 和 diagnostics 不出现 raw prompt、chain-of-thought、secret、provider payload 或答案 key。
6. 重启/重放不会增加 active phase、重复 learner action 或第二条“已保存”公告。

最低命令：

```powershell
pnpm exec vitest run --project unit tests/unit/teaching-turn-presentation.unit.test.ts
pnpm exec playwright test --project electron-e2e tests/e2e/teaching-turn-presentation.a11y.spec.ts
pnpm run typecheck
git diff --check
```

#### 具体 Golden 子场景

真实键盘路径从错误检索答案开始：焦点进入“轮到你”、提交后 UI 显示对比重试且没有已掌握状态；纠正后只显示一次保存确认，并可通过键盘进入带 sourceId 的来源摘要。重启应用后 UI 恢复同一 Session/outcome，不重复 live announcement。

---

### P0-R6：Golden E2E、恢复注入与全量审计

**前置依赖：** evaluator foundation、P0-R1 至 P0-R5 全部已 push/review/integrated。此包只做 glue、fixtures、故障注入和发布门禁；不重新实现深模块。

#### 目标

用用户可见行为、公开 IPC 和 canonical workspace 文件证明完整纵向闭环：错误 → 证据 → 结算 → 纠正 → 单一 record → planner → grounded next lesson/context → learner-safe presentation，并在故障、重启与重放中保持一致。

#### 非目标与安全边界

- 不用 mock 直接调用私有 committer/ledger 方法来替代真实 writer/catalog/IPC/renderer 路径。
- 不将 fault injector 暴露到生产用户、任意路径写入或任意 crash hook；仅测试构建/环境下的两个明确 pause point。
- 不以 UI 文案断言替代 canonical file、catalog projection 与 IPC snapshot 的三层一致性。
- 不借集成重构已验收深模块；接口缺口回原 owner 修复。

#### 限定写域

建议 branch：`feat/sx-p0-teaching-loop-integration`，由唯一 integration owner 持锁：

```text
tests/e2e/teaching-learning-loop.e2e.spec.ts
tests/integration/teaching-learning-loop.integration.test.ts
tests/fixtures/teaching-learning-loop/
scripts/check-teaching-learning-loop.mjs
最小故障注入 seam 与其 test-only wiring
src/shared/teaching-ipc-contract.ts（仅 glue）
src/main/teaching-ipc-gateway.ts（仅 glue）
src/main/teaching-workspace.ts（仅 glue）
src/renderer/src/App.tsx（仅 glue）
必要的测试配置 / package.json 脚本
```

integration owner 不得修改 `learning-session-ledger.ts`、`lesson-interaction-recorder.ts`、`learning-outcome-evaluator.ts`、`learning-outcome-committer.ts`、planner、context 或 presentation 的核心语义；只允许导线、composition 和测试所需的窄 seam。

#### TDD 验收

1. 离线、确定性 fixture 从真实 preview/review/IPC/renderer 路径覆盖：错误回答 → `needs_practice` → 对比重试 → `misconception_corrected` → 恰一个 Learning record → planner 继续下一步。
2. **Crash window A：** assessment/Learning record artifact rename 后、catalog 更新前暂停/重启；read-repair 后 canonical 文件、catalog、UI 只出现一次事实。
3. **Crash window B：** temp write 后、atomic publish 前暂停/重启；不得出现半发布 record/outcome/complete UI，恢复后操作可安全重试。
4. 重放相同 event ID 与 operation ID，Session、attempt、outcome、record 均保持幂等。
5. 真实 `GroundingPack.sourceId` 出现在下一 Lesson/metadata；不得使用硬编码假 source。
6. 三层断言：canonical files、catalog/projection、IPC/learner UI 一致；错误和恢复状态也要断言。
7. 键盘、焦点、accessible name、有限 `aria-live`、不依赖颜色、redaction 都有 E2E 覆盖。
8. 失败 artifact 只保留脱敏 fixture/截图/事件摘要；绝无 secret、raw provider payload、raw private learner text 或 chain-of-thought。

#### 具体 Golden E2E（发布阻塞）

**Fixture：** 一个固定 Mission、一个 Course、两个可信资源、首个 Lesson 的静态 assessment sidecar、确定性 clock/ID provider 和离线 provider fixture。固定 IDs 至少包括 `session-golden-001`、两次 evidence IDs、一次 correction operation ID 与两个 source IDs。

**主路径：**

1. 打开或恢复 `session-golden-001`，确认 preview 绑定 canonical Session。
2. 学习者用键盘提交错误的 retrieval answer；evidence receipt 与 Session event 各仅一次。
3. evaluator 返回可验证的失败证据；committer 结算 `needs_practice`；断言无 Learning record，planner 选择 `contrast_and_retry`，UI 不显示 mastery。
4. 学习者完成对比说明后以键盘提交正确重试；产生第二条 evidence。
5. evaluator/committer 结算 `misconception_corrected`；断言 `learning-records/` 恰一文件，provenance 指向同一 Session 的两条 evidence 和 assessment digest。
6. 重发第二次 operation，断言 outcome/record 数量不变；保存 UI 不重复公告。
7. planner 选择下一 Session/lesson；Context assembler 输出只含 fixture 中可用资源，发布下一 Lesson 后断言其 metadata/内容包含真实 `sourceId`。
8. 重启后再次打开：Session 状态、catalog、UI、record 和来源摘要一致。

**故障路径：** 主路径分别在 Crash window A 与 B 中注入暂停并重启；两种路径都必须达到上述一致性或安全的未完成态，且不得产生重复/幽灵“已保存”。

#### 全量审计与发布门

在干净 checkout（不复用开发 workspace）执行；脚本名若在实现中调整，必须保留等价或更强自动化并更新本计划/ADR：

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test:unit
pnpm run test:integration
pnpm run build
pnpm run check:security
pnpm run check:provider-privacy
pnpm run check:settings-secret-storage
pnpm run check:repository-hygiene
pnpm run check:agent-run-recovery
pnpm run check:agent-operation-idempotency
pnpm run check:workspace-write-tool
pnpm run check:web-fetch-safe-url
pnpm run check:external-link-controls
pnpm run check:learning-outcome-evaluator
node scripts/check-workspace-catalog-reconciliation.mjs
node scripts/check-teaching-learning-loop.mjs
pnpm exec playwright test --project electron-e2e tests/e2e/teaching-learning-loop.e2e.spec.ts
pnpm exec playwright test --project electron-e2e tests/e2e/teaching-learning-loop.e2e.spec.ts --repeat-each=3
git diff --check
```

P0 不得因某条拟新增命令尚不存在就声明完成；缺失命令/测试等于验收证据缺失。任何 flaky、隐私泄露、安全回归、canonical/catalog/UI 不一致、重复记录或不确定写入自动重试均阻塞发布。

---

## 5. 通用 TDD、集成与交接纪律

### 5.1 TDD 执行规则

每个包必须以能够失败的测试开始，并保留负例。最低顺序：

```text
写出 domain invariant 的失败测试
→ 实现最小深模块/adapter
→ 包级 unit + integration 绿
→ 回归 + typecheck + diff check
→ commit + push
→ 交接给下游/集成
```

禁止删除/skip/放宽断言、仅更新 snapshot、宽泛 `as any`、silent fallback 或以手工演示代替自动化验收。所有 effect 包必须测试幂等、失败、重启/read-repair 和投影漂移；所有 UI 包必须测试 keyboard/focus/a11y/redaction。

### 5.2 分支、review、merge 与 push 纪律

1. 每包从协调者指定的已知 commit 创建独立分支；提交前先检查 `git status --short --branch`，不得吸收他人未提交文件。
2. worktree 有其他 owner 的改动时，不 checkout、stash、reset、clean、rebase 或覆盖它们；需要并行工作时使用独立 Git worktree。
3. 每个 green checkpoint 立即形成聚焦 commit 并 `git push origin <branch>`。已经 push 的分支禁止 force push；后续修改以追加 commit 表达。
4. merge/cherry-pick 仅使用已 push hash；遇到 hub 或语义不明冲突逐 hunk 处理，无法证明正确性时停止并请求 owner。禁止宽泛 `--ours/--theirs`、整目录覆盖或回退他人改动。
5. 所有 hub 文件默认由 integration owner 独占：IPC contract/gateway、teaching workspace façade、lesson generation/runtime、catalog/review façade、shared barrels、`App.tsx`、package/lockfile、Vitest/Playwright/Electron config、blocking CI。锁转移必须记录旧 owner 停止点、新 owner、base hash 与允许路径。
6. push 前至少执行：包级 tests、相关回归、`pnpm run typecheck`、`git diff --check`、`git diff --name-only <base>...HEAD` 的写域审计。
7. 每个 PR/review 必须检查：目标与非目标、写域、public contract、负例、durability、安全/隐私、a11y（如适用）、legacy migration、测试命令与结果、已知风险、下游 dependency hash。
8. handoff 模板必须包含：branch、commit hash、origin ref、base hash、changed paths、执行过的命令/结果、未执行项与原因、未决风险、交付的 contract、下游必须等待的 gate。

### 5.3 P0 范围冻结

在 Golden E2E 完全通过前，拒绝将以下内容作为 P0 依赖或顺带功能：shell、MCP、插件市场、OS sandbox、通用多 Agent、第二套 Agent loop/conversation store/permission manager/provider catalog/skill library/workspace catalog、数据库、云同步、复杂 RAG 或非教学闭环 runtime 重构。

---

## 6. 何时可以声称 P0 完成

只有满足全部条件才能说 P0 完成：

- evaluator P1 fixes 已 commit、push、review 并受控集成；
- P0-R1 至 P0-R5 各自有已 push 的独立 commit、范围内 diff 和自动化证据；
- 主 Golden E2E、两个 crash window、幂等重放、重启恢复、来源 grounding、a11y/redaction 均通过；
- 在干净 checkout 的全量审计通过，Golden 至少 `--repeat-each=3` 无 flaky；
- canonical files、catalog/projection、IPC 和 UI 对同一 Session/outcome/record 一致；
- 没有自动 Lesson-generated record、重复 record、未确认写入重试、私密 payload 泄露或 P0 范围蔓延；
- 每个集成/交接 hash、review 与风险记录可追溯。

在此之前，准确表述应为：**Session、Evidence 与 Learning record 自动写入 cutover 已合入；evaluator 正在完成 P1 fixes/review/integration；Outcome committer、Planner、Context、Present 与 Golden E2E 仍待实施。**
