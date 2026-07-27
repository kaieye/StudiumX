# StudiumX 教学链路与多 Skill 编排复评

- **日期：** 2026-07-27
- **代码快照：** `main@d308289`
- **性质：** 当前实现复评、旧建议落地盘点与下一阶段路线图；**不是 ADR，也不是已批准 backlog**
- **恢复材料：** `/tmp/sx-eval` 中的 reader/lens JSON 与中断会话记录；这些材料只作为问题线索，最终结论以本快照的代码、测试和 ADR 状态为准
- **范围：** `Mission → 教学对话/lesson → typed evidence → settlement → next step → review`，以及多个 builtin skill 在这条主线上的选择、冲突、跨轮续航和产品呈现

## 当前工作区核对清单（2026-07-27）

> **核对范围：** 本清单以当前工作区（包含尚未提交的 ADR-0163 与相关实现）为准；正文其余 As-Is 叙述仍以 `main@d308289` 为原始复评快照。`[x]` 表示该项已具备生产接线与相应测试/ADR 证据，`[~]` 表示只完成了明确的一部分，`[ ]` 表示仍未交付。Pet 的真实学习历史接入已冻结为非目标，不计入待办。
>
> **已验证测试：** `pnpm exec vitest run --project unit tests/unit/teaching-turn-presentation.unit.test.ts tests/unit/skill-orchestration-preview.unit.test.ts`（24 tests passed，2026-07-27）。

### 已完成与仍余项

- [x] 旧断点：`fill` 题结算、app-shipped Teaching Kernel fail-closed、跨轮 skill workflow continuity、authority bridge 的主要占位事实已关闭（§2.1）。
- [x] **P0-1：authoritative teaching presentation 主链接通。** `App.tsx` 已读取 presentation snapshot，并将 `teachingPresentation` / `onTeachingAction` 传给生产 `AgentConversationReader`；动作仍经 operation ID 与 `expectedRevision` 校验。
- [~] **P0-2：结算后的下一步动作。** `contrast_and_retry` 与 `review_due` 已有受控 IPC/CAS action；`continue_next_session` 仍只是 composer 意图，尚未成为同等级的 canonical action。
- [ ] **P0-3：ReviewView 与正常导航入口。** 尚无独立 ReviewView / 主导航消费面；目前只能从 teaching action 开始一轮到期复习。
- [ ] **P0-4：结构化回流到下一课。** settled outcome、上一课、错因和 review 摘要尚未传入生产 lesson-generation 调用。
- [ ] **P0-5：对话 Elicit 的 typed evidence producer。** `conversation_evidence_recorded` 已有类型、校验与 recorder，但生产代码尚未构造该证据。
- [ ] **P1-1：LearningObjective、MasteryProjection 与 diagnose。** 仍只有 ADR-0159 设计，未见生产投影或 schema。
- [ ] **P1-2：outcome strength。** provisional / consolidated / lapsed（或 decayed）尚未实现，ADR-0157 仍为 Proposed。
- [ ] **P1-3：Mission 成功进度。** 尚未把 `Success looks like` 投影为可核对的 learner-facing 缺口。
- [ ] **P1-4：TodayQueue。** ADR-0161 仍为 Proposed，未见聚合投影或消费面。
- [~] **P1-5：多 skill 产品面。** ADR-0163 已交付多选能力、preset、只读计划预览、本地 plan 诊断与部分内置 skill 治理；整轮全局 body budget、阶段推进/取消控制和完整 teaching-site 自动流水线仍未完成。
- [ ] **P1-6：teaching-site 确定性 handoff。** artifact schema 收敛与代码级 handoff gate 尚未交付。
- [~] **P2-1：builtin skill 内容治理。** ADR-0163 已补治理头并重写三个模板化 skill；所有模板残留、绝对路径、命名及 schema 漂移尚未整体收口。
- [ ] **P2-2：analytics 反馈教学策略。** 本地 analytics 已能读取/展示事实，但 planner/runtime 尚不消费这些信号。
- [ ] **P2-3：prompt-cache 重新测量。** 尚无 ADR-0044 所要求的本轮 skill index / turn-tail 变更测量结论。
- [ ] **P2-4：interleaving、confidence calibration 与延迟保持评估。** 依赖 objective/review 数据，尚未启动。
- [ ] **P2-5：基于可复现失败案例的复习算法升级决策。** 尚未形成案例驱动的升级结论。

> **状态口径：** 本文严格区分“已实施”“部分实施”“仅有类型/接口”“Proposed ADR”和“建议”。仓库里存在 ADR 或类型定义，不等于对应产品能力已经交付。

> **Pet 范围冻结（2026-07-27）：** 当前 Pet 功能维持现状，不再扩展为复习入口、TodayQueue 消费面、canonical review-history 展示面或新的通知/激励功能。Pet 不是本路线图 P0 的交付依赖；学习者可见的复习闭环应由 Teaching Reader 与 ReviewView 承担。

---

## 1. 执行摘要

### 1.1 当前判断

StudiumX 的教学链路已经从旧评估时的“强权威骨架，但实际教学几乎感知不到权威事实”，推进到：

> **确定性的学习事实已经能影响聊天 prompt 和跨轮 skill workflow，但还没有稳定到达学习者可见的下一步、复习入口与下一课生成。**

当前 HEAD 已经实质关闭四个旧断点：

1. `fill` 题从渲染、sidecar、preview bridge 到 evaluator 的确定性结算已经贯通。
2. 间隔复习调度内核、canonical ledger 适配器和 planner 的 `review_due` 动作已经落地。
3. 多 skill 编排已有对话级 durable state、stage cursor、gate 判定和后续轮激活，不再只是单轮计划。
4. Teaching Kernel `teach` 直接从 app-shipped builtin roots 加载，缺失或损坏时 fail-closed，不再依赖个人目录安装，也不会静默降级。

同时，最影响真实学习体验的断点仍然集中在“最后一公里”：

1. planner 的 `nextStep` 虽已进入模型 turn-tail，生产 UI 仍未消费 `TeachingTurnPresentation`，学习者看不到可靠的下一步动作。
2. ReviewScheduler 已能读真实 ledger history，但主导航没有 review 入口，`App.tsx` 也没有 `view === 'review'` 的生产渲染分支。
3. lesson generation 已预留 `priorLessons`、`workspaceContext` 等输入，却没有把 settled outcome、上一课和 planner 决策结构化回流。
4. 对话中的检索、自我解释和开放回答还不会产生生产级 `conversation_evidence_recorded`，因此“对话教得很好”仍不等于“产生了可结算证据”。
5. objective/mastery、保持强度、模型辅助评分、教学行为合同、TodayQueue、学习效果分析均只有 Proposed ADR，不能算作已交付能力。

Pet 当前仍以 lesson `createdAt` 的 seed 兼容旧提醒语义；这是接受的产品边界，不是要求接入真实 per-attempt history 的 P0 缺口。

### 1.2 优先级结论

下一阶段不应先继续扩充更多 skill 或更复杂的教学算法，而应按以下顺序推进：

1. **P0：让已有权威事实到达学习者。** 接通 authoritative snapshot、教学 Reader、结算后下一步和 review 页面。
2. **P0：让下一次学习真正承接上一次。** 将 settled outcome、错因、上一课和到期复习作为 lesson generation 的结构化输入。
3. **P0：扩大可信证据面。** 为教学对话增加 typed evidence producer，而不是让模型自行宣称用户掌握。
4. **P1：建立课程尺度状态。** 引入 LearningObjective / MasteryProjection、保持强度和 Mission 成功进度。
5. **P1/P2：治理多 skill 与效果反馈。** 增加全局正文预算、计划预览、schema 收敛和本地效果反馈，但不改变文件真相源或 settlement sole-writer。

---

## 2. 旧评估到当前 HEAD 的状态变化

### 2.1 已关闭

| 旧结论 | 当前状态 | 当前证据 | 复评结论 |
| --- | --- | --- | --- |
| `fill` 题生成了但 evaluator 不结算 | **已实施** | [ADR-0155](../adr/0155-fill-quiz-settlement-via-sidecar-v2.md)；`src/shared/fill-answer.ts`；`src/main/learning-outcome-evaluator.ts` | 旧 gap 已关闭。答案归一化与 digest、sidecar v2、渲染、preview bridge、evaluator 已形成确定性全链；HTML sidecar 变体仍保守 unsupported 是有意边界 |
| `teach` 需要个人安装，缺失时可能退化为普通聊天 | **已关闭，且采用了更安全的方案** | `src/main/skill-library/core-teaching-kernel.ts`；`src/main/teaching-conversation-runtime.ts` | Teaching Kernel 从经验证的 app-shipped builtin roots 加载；不读取 personal root 作为内核；缺失/损坏时返回 `Teaching Kernel unavailable`，不应再建议静默自动安装 |
| 多 skill 只有单轮 plan，`scheduled_later` 永远不会成为 active | **核心已实施** | [ADR-0156](../adr/0156-skill-orchestration-conversation-continuity.md)；`skill-orchestration-state-store.ts`；`skill-orchestration-host.ts`；runtime 接线 | 对话级 durable state、stage cursor、completed stages、artifact facts 和 gate 判定已落地；后续轮可推进阶段 |
| authority bridge 只喂占位 mission/resource/artifact 事实 | **已关闭主要占位问题** | `src/main/skill-orchestration-authority-bridge.ts` | bridge 会读取真实 Mission/resource/artifact/review facts，并回显 snapshot 的 action/reason；不能再写成“权威平面对实际 turn 影响趋近于零” |

### 2.2 部分实施

| 能力 | 已完成部分 | 仍缺部分 | 准确口径 |
| --- | --- | --- | --- |
| 间隔复习 | 纯 scheduler、`[1,3,7,21,60]` 阶梯、ledger scan adapter、`review_due`、bridge `dueCount`、Pet 共用 scheduler | 正常 review 页面/入口；结算后的 learner action | **调度内核已实施，学习者可见消费面未闭合** |
| planner 影响实际教学 | `nextStepAction`、`nextStepReason`、resource/evidence/artifact facts 已进入 `<skill-orchestration-plan>` turn-tail | 未成为 learner-safe UI 动作；未进入 lesson generation；仍依赖模型遵循提示 | **对模型已有约束影响，对产品流程尚非确定性控制** |
| 多 skill workflow | host policy、冲突/依赖、stage、gate、跨轮 state、active-only 正文装配 | 计划预览、阶段 UI、推进/取消动作、全局 token 预算、完整 teaching-site 自动流水线 | **对话级 workflow continuity 已有，产品级 workflow UX 未交付** |
| Teaching Reader | `AgentConversationReader` 支持 `teachingPresentation` 与 `onTeachingAction` | `App.tsx` 的生产调用只传普通 `presentation` | **组件能力存在，生产主链未接线** |
| Pet 复习提醒 | 已调用共享 ReviewScheduler | 每课传 `history: []`，只以 lesson `createdAt` 作 anchor；范围冻结，不接入真实学习历史 | **维持现状；不是本路线图的待交付功能** |

### 2.3 尚未实施或只有接口

| 缺口 | 当前证据 | 对学习者的影响 |
| --- | --- | --- |
| settled outcome / prior lessons 回流 lesson generation | `buildLessonSystemPrompt` 有 `priorLessons`、`workspaceContext`、`conversationExcerpt`；`teaching-lesson-generation.ts` 的生产调用未传这些值 | 新课仍可能重复定义、忽略上一课错因，不能形成可靠的连续课程 |
| 教学对话产生 typed evidence | 类型、normalizer、recorder 支持 `conversation_evidence_recorded`；生产代码没有构造该 kind 的路径 | 自我解释、开放回答、苏格拉底式问答无法进入可信证据链 |
| Mission 成功标准结构化回检 | bridge 只投影 Mission 是否 available/absent | 系统无法回答“距离 Mission 的 Success looks like 还差什么” |
| analytics 反馈教学决策 | 已有本地 `LearningAnalyticsService` 和 Workbench analytics | planner/runtime 不消费效果信号，观测面还不是教学策略反馈环 |
| 通用 skill manifest 治理 | 冲突与角色规则由 host-owned builtin policy 提供 | 对 builtin 有治理，但不能据此宣称任意第三方 skill 都遵守相同教学契约 |

### 2.4 仅为 Proposed ADR

以下文档提供了合理设计方向，但在 `d308289` 不能被描述为已交付：

- [ADR-0157：LearningOutcome strength / consolidation](../adr/0157-learning-outcome-strength-and-consolidation.md)
- [ADR-0158：model-assisted GradingCandidate](../adr/0158-model-assisted-grading-candidate.md)
- [ADR-0159：LearningObjective / MasteryProjection](../adr/0159-learning-objectives-and-mastery-projection.md)
- [ADR-0160：Teaching turn behavior contract](../adr/0160-teaching-turn-behavior-contract.md)
- [ADR-0161：TodayQueue](../adr/0161-today-learning-queue-projection.md)
- [ADR-0162：local learning effectiveness analytics](../adr/0162-local-learning-effectiveness-analytics.md)

它们共同描述的是下一代闭环，不是当前 As-Is。

---

## 3. 当前完整教学链路（As-Is）

### 3.1 权威与输入层

1. 工作区中的 `MISSION.md`、课程、资源和学习记录仍是教学真相源。
2. `LearningSessionLedger` 保存 canonical session/event；projection、review schedule、orchestration state 都必须可重建，不能反向成为教学权威。
3. outcome settlement 仍由 coordinator/host 的 sole-writer 路径完成，typed evidence 必须先通过规范化和 provenance 校验。
4. memory 只在既有同意门控下使用；它能辅助个性化，但不是掌握事实。

这部分仍是系统最强的基础：StudiumX 宁可“不知道”，也不允许模型凭一句自然语言把学习状态写成 `established`。

### 3.2 教学对话与 skill 编排

当前教学 turn 的主要流程可以概括为：

```text
conversation + user input
  → 加载 authority facts（Mission / resource / artifact / review / nextStep）
  → 加载 ConversationOrchestrationState（若存在）
  → 纯 planner 选择 mode、stage 与 skill execution
  → host 检查依赖、artifact writer 冲突、gate、prior state
  → 只加载 active_now skill 正文；Teaching Kernel 必须存在
  → stable policy prefix + turn-tail orchestration plan
  → agent loop / tools（仍受 tools.enabled、effect lattice 与审批约束）
  → gate 结果与 stage cursor 以 best-effort 保存为可重建投影
```

相比旧基线，关键进步是：

- `scheduled_later` 已有跨轮语义。
- gate 使用 allow-listed artifact facts 做确定性检查。
- `nextStepAction/reason` 会进入 prompt，不再完全脱离实际 turn。
- 非 active skill 不装配全文，避免所有 skill 同轮争夺注意力。
- `teach` 是保留内核，来自 app-shipped roots；个人 skill 不能冒充 Teaching Kernel。

但这里仍有一个重要边界：**prompt 中出现 planner 决策，不等于产品已经执行该决策。** 模型仍可能表述不一致，renderer 也尚未把 action 投影成受控按钮。

### 3.3 Lesson 生成、证据与结算

当前 lesson 主链为：

```text
Mission + learner prompt + recalled memories + generator settings
  → LessonPlan JSON
  → schema sanitize / fallback
  → static HTML + assessment sidecar
  → preview interaction bridge
  → typed lesson interaction evidence
  → LearningSession ledger
  → deterministic evaluator
  → sole-writer committer
  → outcome + next-step projection
```

已成立的能力：

- choice 与受支持的 fill evidence 可以进入确定性的 outcome 评价；flashcard rating 则进入 review history 投影，不冒充 quiz settlement。
- fill 的 accepted answers 不把明文答案直接当作不受约束的模型评分输入。
- evaluator 与 committer 仍维持“证据不足不建立掌握”的保守姿态。
- planner 已增加 `review_due`，不再只有即时重试或继续下一课。

主要断点：

- `teaching-lesson-generation.ts` 没有把上一课、settled outcome、错因、planner action 传给已存在的 prompt 槽位。
- 对话中的 Elicit 不会生产同等级 typed evidence。
- outcome 仍缺少跨日保持强度；一次当场全对与隔日成功检索尚未区分。
- learner-facing Reader 未显示 authoritative next step，因此结算完成后仍可能只得到普通文本回复。

### 3.4 Review 与动机层

[ADR-0154](../adr/0154-spaced-review-scheduler-and-review-due-planner-action.md) 已建立正确的领域方向：

- scheduler 是纯函数，时间由 caller 显式传入。
- review facts 从 canonical ledger 的 `quiz_answered` / `flashcard_rated` 派生。
- 固定阶梯和默认 due limit 避免把复习做成债务墙。
- `dueCount` 可以影响 planner。

然而产品面仍断在两处：

1. `WorkspaceView` 有 `review` 类型，store 也会在 `setView('review')` 时加载 cards，但主导航没有正常 review 项，`App.tsx` 没有 review 渲染分支。
2. 没有统一的“完成当前题 → 结算 → 立即重试 / 加入到期复习 / 继续下一课”交互闭环。

Pet 保持当前提醒功能和 seed 语义；不要求其与 canonical projection 等价，也不以它承载新的复习、通知或激励产品能力。

因此目前可以说“系统知道有复习债”，还不能说“学习者每天都能顺畅还复习债”。

---

## 4. 学习者旅程走查

### 4.1 第一次开始学习

| 环节 | 当前表现 | 判断 |
| --- | --- | --- |
| 明确目标 | Mission 文件提供稳定目标，教学对话可读其存在性和摘要 | 基础可靠 |
| 诊断已有水平 | 依赖自然语言澄清和模型判断；没有 objective-level placement | 偏弱 |
| 选择教学策略 | Teaching Kernel + active skills 能约束模型 | 有方法论，但主要是 prompt contract |
| 形成课程 | 可生成静态 lesson、资源与测验 | 已可用 |
| 明确“今天做什么” | 没有 TodayQueue；planner UI 未接通 | 明显断点 |

### 4.2 学习过程中答错

理想闭环应是：错误 evidence → settled outcome → 对比纠错 → 新检索 → 再结算。

当前系统已经能做到前半段的可信记录和 planner `contrast_and_retry` 决策，但 learner-safe action 未进入生产 Reader。结果是：领域层知道应当重试，学习者看到的仍可能只是模型生成的普通建议。这里是 P0 中收益最高、架构风险最低的接线点。

### 4.3 当场答对

choice/受支持 fill 的答对可以成为 established outcome 的输入，但当前没有“当场掌握”和“跨日保持”的强度区分。若立即推进新内容，系统可能高估学习稳定性；若一律不推进，又会把短课体验做得过重。因此更合理的方向不是放宽 evaluator，而是采用 ADR-0157 所描述的 provisional/consolidated 投影，并让隔日检索改变强度。

### 4.4 第二天回来

系统已有能力从 ledger 派生 due items，并让 `review_due` 优先于继续新课；但普通用户没有稳定入口消费这一结果。第二天旅程因此仍是当前最大的学习科学—产品断层：**算法存在，行为未发生。** 该断层由 ReviewView/Teaching Reader 解决，不通过扩展 Pet 解决。

### 4.5 使用多个教学 skill 完成一个产物

例如“先设计课程，再生成资源，再打包 teaching site”：

- planner 能按角色、依赖、artifact scope、priority 形成阶段计划。
- 状态文件能记住 stage cursor 和已完成阶段。
- 后续 turn 可以把 `scheduled_later` 推进为 `active_now`。
- 同一 artifact scope 的多个 writer 会按优先级排除冲突者。

但用户还看不到计划、当前阶段和 gate 结果，也不能显式批准推进/取消。部分 teaching-site skill 正文还隐含 shell 或外部工具假设，而产品运行时仍必须服从 `tools.enabled`、workspaceShell、effect lattice、路径围栏和审批。故当前适合称为“host 编排核心”，不宜称为“完整自动课程站流水线”。

---

## 5. 多 Skill 编排专项复评

### 5.1 已有的治理能力

当前实现已不再是简单的多份 `SKILL.md` 全文拼接：

| 治理维度 | 当前能力 |
| --- | --- |
| 角色与阶段 | host-owned builtin policy 定义 role、stage、requires、accepts、produces、artifactScopes |
| 依赖 | missing dependency fail-closed；未知 skill 被排除 |
| 写冲突 | 同 artifact scope 的双 writer 由最高 priority 胜出，其余 excluded，并产生诊断 |
| 正文装配 | stage-scoped；仅 `active_now` 加载正文；Teaching Kernel 是受控例外 |
| 延后执行 | `scheduled_later` 已能通过 prior state 在后续轮激活 |
| gate | 基于 allow-listed artifact facts 的确定性检查 |
| durable continuity | `.agent-sessions/skill-orchestration/<conversationId>.json`；严格 normalize、原子替换、损坏 fail-soft |
| 预算降级 | planner 类型支持 `budgetConstrained`，可延后 enhancer/packager |

这些能力足以推翻旧评估中“完全没有优先级、冲突与跨轮治理”的笼统表述。

### 5.2 仍存在的编排缺口

1. **生产路径没有真实提供 `budgetConstrained`。** 当前主要是类型、planner 分支和测试能力，尚未由 authority/runtime 的真实预算压力稳定驱动。
2. **没有整轮全局 skill 正文预算。** `teaching-conversation-prompt.ts` 对每个 skill 分别截断到 `14_000` 字符，多 skill 叠加时仍可能放大 turn-tail。
3. **stable prefix 仍受 active skill index 变化影响。** skillReferences 改变会改变前缀形状；需要按 [ADR-0044](../adr/0044-teaching-prompt-cache-contract.md) 重新量化命中率，而不是仅凭命名认定其稳定。
4. **规则是 builtin host policy，不是通用 manifest contract。** 它能治理内建能力，但没有授权不可信 skill 自行声明任意执行能力。
5. **产品 UI 缺失。** 没有多选 chip、计划预览、阶段状态、gate 解释、显式推进或取消。
6. **工具假设未完全对齐。** skill 正文提出 shell/外部动作时，必须以产品 effect lattice 和审批结果为准，不能把文档工作流当作已授权执行。
7. **产物体系仍分裂。** `teach` 家族使用 `lessons/*.html` / learning records；`teaching-site` 家族偏向 `course-package/` / `course-data.js`，两套目录与 schema 缺少正式桥接。

### 5.3 Builtin skill 内容治理债

`/tmp/sx-eval/reader-builtin-skills.json` 暴露的以下问题在当前 HEAD 仍值得保留：

- `course-designer`、`learning-assessor`、`teaching-resource-generator` 的职责和模板存在重叠。
- 多个正文仍出现 `d:/GitHub/ai-workshop/...` 一类外部绝对路径示例。
- `_shared/domain-primitives.md` 与各 skill 示例存在字段/schema 漂移。
- ID 与目录命名存在 `day-1` / `day1`、`d{n}-u{m}` / `day1.u-2` 等不一致。
- `teach` 与 `teaching-site` 的 artifact 语义没有被统一到一个 canonical handoff。

这三个模板型 skill 现在已经被 host policy 纳入编排，不能再称为“运行时孤儿”；问题已经从“完全不参与运行”转为“内容边界、schema 和产品语义需要收敛”。

---

## 6. 学习科学能力复评

| 学习机制 | 当前实现 | 实际成熟度 | 下一步 |
| --- | --- | --- | --- |
| Retrieval practice | lesson quiz、flashcard；choice/fill 可结算，flashcard rating 可进入复习历史 | **中等**：静态题型可信，但对话 Elicit 不计入证据 | 增加 conversation evidence producer；维持 provenance 与 deterministic settlement |
| Immediate corrective feedback | planner 有 `contrast_and_retry` | **部分**：决定进入 prompt，未成为受控 learner action | 接通 Reader action，并要求新证据后再结算 |
| Spacing | ReviewScheduler + `review_due` | **内核已完成、产品未完成** | ReviewView、导航、今日消费面；Pet 维持现状 |
| Retention | 无跨日 strength | **未实施** | ADR-0157 的 provisional/consolidated/decayed 投影 |
| Diagnostic assessment | 自然语言澄清 | **较弱** | objective-level diagnose，可跳过，不把 instant help 强制课程化 |
| Mastery model | lesson outcome，暂无 objective graph | **未实施** | ADR-0159；projection 可重建，不能成为第二 writer |
| Interleaving | kernel 原则为主 | **未产品化** | 在 objective/review queue 稳定后再引入，先做可复现评估 |
| Metacognition | flashcard rating 提供有限自评 | **较弱** | 对比 confidence 与结果，避免只采集主观“懂了” |
| Learning analytics | 本地 usage/study analytics 已有 | **观测存在，教学反馈未形成** | 在 ADR-0162 落地后，仅用 allow-listed 聚合调整策略 |

最重要的判断是：StudiumX 目前缺的不是更多教学法名词，而是让已经编码的 retrieval、spacing 和 corrective action 在真实用户旅程中发生。

---

## 7. 建议的 To-Be 闭环

### 7.1 权威流

```text
Workspace files / Mission
        │
        ├──────────────┐
        ▼              ▼
Teaching chat       Static lesson
        │              │
        └──── typed evidence ────┐
                                 ▼
                    LearningSessionLedger
                                 │
                                 ▼
               deterministic evaluator + sole writer
                                 │
                    ┌────────────┼─────────────┐
                    ▼            ▼             ▼
              NextStep       ReviewSchedule   future MasteryProjection
                    │            │             │
                    └────────────┼─────────────┘
                                 ▼
             learner-safe presentation / lesson-generation input
                                 │
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
              Chat action      ReviewView       Next lesson
```

必须保持的单向性：

- UI、TodayQueue、analytics 和 orchestration state 都是消费者或投影；Pet 维持当前独立功能，不作为本路线图新增消费面。
- 它们不能直接写 `established`，也不能绕过 coordinator。
- skill 可以建议动作、生成候选产物或收集 evidence，但不能自行 settlement。

### 7.2 多 skill 流

```text
user intent + authority facts + prior orchestration state
  → deterministic plan
  → learner-visible plan preview
  → one active stage
  → tools/effects under normal approval
  → deterministic artifact gates
  → state advance
  → next stage or teaching settlement
```

产品层需要明确区分：

- **建议加入计划**：skill 被选中，但尚未加载正文或执行。
- **当前阶段**：唯一需要模型重点执行的角色集合。
- **等待 gate**：缺少哪些可验证 artifact facts。
- **需要用户批准的 effect**：沿用现有三态审批，不创造“自动全放行”。
- **完成**：产物存在不等于学习目标掌握；仍需 evidence 与 settlement。

---

## 8. 实施路线图

### P0：让闭环到达学习者

#### P0-1：接通 authoritative teaching presentation

**目标：** 将 canonical 的 production snapshot/nextStep 经新增的受控读取链路和 presentation mapper 送到 `AgentConversationReader`。

**当前缺口：** `TeachingTurnSnapshot` 目前只存在于 renderer 的 presentation mapper；尚无 shared learner-safe snapshot DTO，也没有 canonical snapshot 从 main → preload → renderer 的闭合 read IPC。`App.tsx` 也尚未向 `AgentConversationReader` 传入 `teachingPresentation` 或 `onTeachingAction`。

**最小交付：**

- 定义 shared、read-only、learner-safe snapshot DTO，并以 closed main → preload → renderer read IPC 暴露；renderer 不自行成为 authority。
- snapshot 必须绑定 operation ID 与 revision；`App.tsx` 的生产调用传入 `teachingPresentation` 与受控 `onTeachingAction`。
- 只展示 allow-listed learner-safe 文案，不把内部 reason、路径、prompt 或 secret 直接暴露到 DOM。
- stale snapshot/action 必须通过 `expectedRevision` 或既有 optimistic concurrency 语义拒绝并刷新。

**验收：** 一次错误答案结算后，UI 稳定显示 `contrast_and_retry` 对应动作；刷新/重开后由 canonical 文件重建同一状态；覆盖 stale snapshot 的拒绝与重新读取/刷新。

#### P0-2：把结算后的下一步变成一等动作

至少支持：

- `contrast_and_retry`
- `review_due`
- `continue_next_session`

动作不能只是向模型发送一段自由文本；应映射到受控命令、lesson/review deep link 或明确的下一轮 teaching intent。

#### P0-3：交付 ReviewView 与正常入口

- 在主导航或明确的首页入口展示到期复习。
- 使用 main-process canonical ledger projection，不在 renderer 重造第二套调度事实。
- due list 默认 3–5 项，逾期不惩罚，不绑定 streak 压力。
- 完成复习必须追加正确的 typed interaction，并从 canonical history 重新投影 schedule；只有 interaction type 被 evaluator/committer 支持时才进入 settlement 路径。`flashcard_rated` 只贡献 review history，绝不能暗示 mastery 或 `established` outcome。

#### P0-4：结构化回流到下一课

给 lesson generation 提供受预算约束的：

- 上一课标识、标题、目标和路径；
- 最新 settled outcome 与主要错误类别；
- planner action/reason 的 learner-safe 投影；
- 到期复习摘要；
- 必要的 workspace context。

不应把完整 ledger、完整对话或自由文本内部诊断直接塞入 prompt。

#### P0-5：增加对话 Elicit 的 typed evidence producer

- 明确什么用户动作构成 `conversation_evidence_recorded`。
- provenance 必须绑定 conversation、turn、LearningSession 与当前 `itemId`。objective binding 是 P1 / ADR-0159 的 schema 前提，不是 P0 隐含要求。
- 模型只能产出 grading candidate 或结构化观察，不能直接写 established outcome。
- 为重放、fork、steer 保持 `toolsReplayed: false` 和 evidence 去重语义。

### P1：让教学决策具有课程尺度

1. **LearningObjective + MasteryProjection + diagnose**：将 lesson 结果聚合到 objective，但仍为可重建投影。
2. **Outcome strength**：区分 provisional、consolidated、lapsed/decayed；隔日检索才提升保持强度。
3. **Mission success progress**：将 `Success looks like` 结构化为可核对目标，显示缺口而非二元 available/absent。
4. **TodayQueue**：聚合 review due、planner next step 与既有 study task；不建立新权威。
5. **多 skill 全局预算与计划 UI**：整轮 body budget、阶段预览、gate 解释、推进/取消。
6. **teaching-site 确定性 handoff**：把“已有必要产物”从 prompt 约定升级为代码 gate，并统一 teach/site artifact schema。

### P2：治理与效果优化

1. 清理 builtin skill 模板残留、绝对路径、命名和 schema 漂移。
2. 让本地学习效果 analytics 以封闭 allow-list 反馈教学策略，同时保持 usage ledger 与 teaching authority 正交。
3. 按 ADR-0044 重新测量 skill index / turn-tail 变化对 prompt cache 的影响。
4. 在 objective 与 review 数据可靠后，再评估 interleaving、confidence calibration 和延迟保持测试。
5. 用真实、可复现的学习失败案例决定是否升级复习算法；不要因“更先进”直接引入复杂自适应模型。

---

## 9. 验收标准

### 9.1 P0 端到端场景

至少需要以下自动化或可重复集成场景：

1. **答错闭环：** preview/chat evidence → canonical ledger → evaluator → committer → `contrast_and_retry` → Reader action → 新尝试。
2. **fill 闭环：** accepted answer 的大小写/空白归一化保持一致；错误答案不建立 outcome；不受支持 sidecar 继续 fail-closed。
3. **隔日复习：** 用显式 `now` 派生 due → ReviewView/planner 一致 → 完成后追加正确 typed interaction 并重投影 canonical schedule → 下次 due 改变；`flashcard_rated` 只更新 review history，不能建立 mastery 或 `established` outcome，只有受支持 interaction type 才进入 evaluator/committer。Pet 不属于此验收路径，维持现有功能即可。
4. **跨轮 skill：** stage A 产物满足 gate → 保存 state → 重启/下一轮 → stage B 激活；损坏 state fail-soft 重算。
5. **lesson 承接：** 上一课错误与 settled outcome 改变下一课 prompt/input；没有权威事实时不编造。
6. **对话证据：** conversation evidence provenance 不匹配 session/turn 时拒绝；模型输出不能直接 settlement。

### 9.2 架构与安全门禁

- settlement writer 数量不增加。
- 所有 IPC 写路径继续要求 `expectedRevision`。
- orchestration/review/mastery/today queue 均可从 canonical 文件重建。
- `tools.enabled` 关闭时不执行 shell；开启后仍经过 effect lattice、sandbox/approval 与路径围栏。
- 不增加 YOLO、DangerFullAccess、always-approve 产品标签。
- secret/token 不进入 public DTO、Doctor、support bundle、prompt 或教学证据。
- 不自动写 memory/profile，不静默安装或创建 skill。
- 不引入 FTS5/向量库作为产品搜索面。
- prompt prefix/cache 形状变化必须更新 ADR-0044 影响说明并运行相应 teaching-impact gate。

### 9.3 建议测试集合

按实际触达范围至少运行：

```bash
pnpm typecheck
pnpm run check:teaching-evidence
pnpm run check:teaching-ipc-contract
pnpm run check:tool-contract
pnpm run check:security
pnpm test:unit
```

若只修改本文档，则不要求运行生产测试套件；应执行链接、自洽性和 `git diff --check` 检查。

---

## 10. 产品地板与非目标

以下约束不是路线图中的待讨论项，而是所有实现的前提：

1. **文件是教学真相源。** SQLite、analytics、agent run、queue、Pet、orchestration state 都不能替代 canonical workspace files/ledger。
2. **settlement sole-writer 不变。** skill、renderer、model grader 只能产出 evidence/candidate/projection。
3. **evidence-gated mastery 不变。** 不因 UX 接通而放宽“模型说学会了”的禁令。
4. **`expectedRevision` 不放宽。** 新 UI action 不能绕过并发控制。
5. **无默认静默 shell。** teaching-site workflow 必须接受工具关闭或审批拒绝。
6. **不静默自动安装 `teach`。** 当前 app-shipped + fail-loud 方案优于个人目录自动安装；未来任何安装仍需明确用户确认。
7. **不自动 memory/profile 写入。** 个性化继续同意门控。
8. **不以 analytics 作为 teaching authority。** analytics 只提供本地、可解释、可脱敏的反馈信号。
9. **不建立第二个开放 backlog。** 本文给出优先级和验收口径；架构变更仍需新建/修订 ADR 并进入正式计划。

---

## 11. 证据索引

### 11.1 核心 ADR / 规划

- [ADR-0154：间隔复习调度与 `review_due`](../adr/0154-spaced-review-scheduler-and-review-due-planner-action.md)
- [ADR-0155：fill quiz settlement](../adr/0155-fill-quiz-settlement-via-sidecar-v2.md)
- [ADR-0156：durable multi-skill continuity](../adr/0156-skill-orchestration-conversation-continuity.md)
- [ADR-0151：Teaching Kernel 与 skill orchestration](../adr/0151-teaching-kernel-and-skill-orchestration.md)
- [ADR-0012：deterministic next-step planner](../adr/0012-deterministic-next-teaching-step-planner.md)
- [ADR-0044：prompt-cache stable prefix](../adr/0044-teaching-prompt-cache-contract.md)
- [ADR 索引](../adr/README.md)
- [产品待办与 M5–M10 状态](../../todolist.md)

### 11.2 关键实现

- Review：`src/shared/review-scheduler.ts`、`src/main/review-schedule-facts.ts`、`src/main/next-teaching-step-planner.ts`
- Fill：`src/shared/fill-answer.ts`、`src/main/learning-outcome-evaluator.ts`、`src/main/ai/lesson-renderer.ts`
- Orchestration：`src/main/skill-orchestration-planner.ts`、`skill-orchestration-host.ts`、`skill-orchestration-state-store.ts`、`skill-orchestration-authority-bridge.ts`
- Runtime/prompt：`src/main/teaching-conversation-runtime.ts`、`src/main/teaching-conversation-prompt.ts`
- Teaching Kernel：`src/main/skill-library/core-teaching-kernel.ts`、`resources/builtin-skills/teach/SKILL.md`
- Lesson generation：`src/main/teaching-lesson-generation.ts`、`src/main/ai/lesson-prompts.ts`
- Evidence：`src/main/lesson-interaction-recorder.ts`、`src/shared/teaching-types/lesson-interaction.ts`
- Renderer：`src/renderer/src/App.tsx`、`src/renderer/src/views/agent-conversation/AgentConversationReader.tsx`
- Pet：`src/renderer/src/views/pet/lesson-review-due.ts`

### 11.3 关键测试

- `tests/unit/review-scheduler.unit.test.ts`
- `tests/unit/review-schedule-facts.unit.test.ts`
- `tests/unit/next-teaching-step-planner.unit.test.ts`
- `tests/unit/learning-outcome-evaluator-fill.unit.test.ts`
- `tests/unit/skill-orchestration-continuity.unit.test.ts`
- `tests/unit/skill-orchestration-planner.unit.test.ts`
- `tests/integration/lesson-interaction-recorder.integration.test.ts`

### 11.4 中断会话材料的使用边界

`/tmp/sx-eval` 共包含 10 个 JSON：6 个 reader 和 4 个 lens。`reader-learner-journey.json` 为 `null`，未作为事实证据；其余材料用于发现候选 gap。旧 lens 中关于“完全没有复习调度”“完全单轮编排”“teach 依赖手动安装”“bridge 只有占位事实”的表述，均已按当前 HEAD 修正。任何与代码或 ADR 状态冲突的旧观察均未沿用。

---

## 12. 最终判断

后续每项教学能力仍应通过同一个判断标准：

> **系统已经知道的可信学习事实，是否在正确时间，以学习者能执行的方式，改变了下一步？**

在 `d308289`：

- “知道得真”已经很强；
- “能计算下一步”和“能跨轮编排”已有核心；
- “让下一步到达学习者”仍是首要断点；
- “让下一课和第二天复习承接真实结果”是最直接的学习收益来源。

因此，下一轮建设的成功标准不是再增加多少 planner 分支或 skill，而是让一个学习者能够完整经历：**学一小段 → 做一次可信检索 → 得到确定性反馈 → 看到并执行下一步 → 第二天按真实历史复习 → 新课承接旧结果。**
