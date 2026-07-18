# Codex Rust v0.144.4 教学化借鉴与实施规划

> 状态：待实施
> 参考项目：`ref_project/codex-rust-v0.144.4`
> 适用项目：StudiumX
> 核心决策：**冻结通用 coding-agent 横向扩张，优先完成可验证的教学事实闭环。**
> 事实来源：Teaching workspace 中的本地文件；Workspace catalog、运行状态、索引和 UI 均为可重建投影。

---

## 0. 执行摘要

StudiumX 已经具备成熟的 Agent loop、工具权限、运行恢复、conversation 分支、Lesson 生成与原子发布能力。当前最大问题不是 Agent 不够强，而是教学领域的事实链没有闭合：

```text
Mission
  → Course / Session
  → Lesson / Agent conversation
  → 学习者互动证据
  → 学习结果判定
  → Learning record / Reference
  → 下一教学动作
```

目前真实工作流在“生成并保存 Lesson”之后断开：Course 主要由路径投影，Session 只是 Lesson 包装，Lesson 中的回答没有形成结构化证据，生成时的 `learningRecordNote` 又会被自动落盘为正式 Learning record，导致“计划学习什么”和“已经证明学会什么”混为一谈。

本规划的 P0 只做一个纵向切片，并严格按以下依赖推进：

```text
LearningSessionLedger
  → LessonInteractionRecorder
  → LearningOutcomeCommitter
  → NextTeachingStepPlanner
  → TeachingContextAssembler / ResourceGrounder
  → TeachingTurnPresentation
```

Codex 中的 typed events、tool orchestration、durable writer、read-repair、配置/能力快照、上下文预算和 TUI presentation 仅作为这条纵向切片的支撑机制；它们不会被独立扩张成新的通用 Agent 平台。

### 0.1 本规划的硬性取舍

1. **教学事实闭环优先于 runtime 重构。** 只有纵向切片需要的 runtime/tool/security 改造进入 P0。
2. **Learning record 必须由证据门控。** 仅生成 Lesson、仅打开 Lesson、仅有模型自述都不能产生“已掌握”记录。
3. **Session 是教学领域对象，不是 Agent run，也不是现有 `SessionEvent`。**
4. **canonical 文件优先。** 索引、catalog、状态条和时间线不能反向覆盖教学文件。
5. **默认 UI 使用教学语言。** 原始 tool name、调用参数、branch revision、模型/token 信息只能进入技术详情或诊断界面。
6. **P0 不引入 shell、MCP、插件市场、数据库、通用多 Agent 或 OS sandbox。**
7. **不再新增第二套 Agent loop、conversation store、permission manager、provider catalog、skill library 或 workspace catalog。**

---

## 1. 产品目标、术语与架构原则

本规划遵循 `MISSION.md` 与 `CONTEXT.md` 中的产品主体：

- Teaching workspace 是一个学习目标的本地长期容器。
- Mission 描述学习意图与成功标准。
- Course 是一组 Sessions。
- Session 是 Course 中的一次真实学习步骤，通常由 Lesson 锚定。
- Lesson 是一个短小、可保存、可打印、包含明确检索练习的 HTML 教学产物。
- Learning record 记录学习后真实发生的理解变化。
- Reference 是可复用的速查材料。
- Agent conversation 是教学过程的证据来源之一，但不等同于 Learning record。

### 1.1 深模块原则

每个新模块必须满足：

- **小 interface：** 调用方只需要知道有限方法、状态和错误模式。
- **深 implementation：** 文件格式、幂等、恢复、校验、兼容和投影逻辑藏在模块内部。
- **明确 seam：** 领域决策与文件系统、preview、provider、renderer 等具体 Adapter 分离。
- **interface 即测试面：** 单元测试和调用方从同一个 interface 验证行为。
- **不建假 seam：** 只有一个实现且没有真实变化点时，不提前抽象通用平台。

### 1.2 P0 成功后的目标状态

```text
用户开始/继续一次学习
  ↓
LearningSessionLedger 创建或恢复 durable Session
  ↓
Lesson / conversation 产生 typed teaching events
  ↓
LessonInteractionRecorder 记录真实互动证据
  ↓
LearningOutcomeCommitter 依据证据判定 outcome
  ├─ established / misconception_corrected → 幂等写正式 Learning record
  └─ needs_practice / not_evidenced → 不写“已掌握”记录
  ↓
NextTeachingStepPlanner 决定下一动作
  ↓
TeachingContextAssembler + ResourceGrounder 组装有 provenance、受预算约束的输入
  ↓
TeachingTurnPresentation 将运行事实投影为学习者可理解的路线、行动和保存状态
```

---

## 2. 当前能力与真实断点

## 2.1 已有强能力：必须复用，不得重复建设

| 领域 | 已有能力 | 主要 StudiumX 路径 | P0 处理方式 |
|---|---|---|---|
| Agent loop | provider/tool 循环、取消、预算、压缩、有限委派 | `src/main/ai/agent-loop.ts`、`src/main/ai/agent-loop-execution-state.ts`、`src/main/ai/context-compactor.ts` | 复用，不建 `TeachingAgentLoop` |
| Agent run 恢复 | durable run、parent-turn staging、operation journal、crash recovery | `src/main/ai/agent-run-lifecycle.ts`、`agent-run-persistence.ts`、`agent-run-store.ts`、`agent-parent-turn-staging.ts`、`agent-operation-journal.ts` | 作为执行可靠性基础，不等同 Learning Session |
| Conversation | 文件化 transcript、分支、回放、checkpoint、归档、历史、审计 | `src/main/teaching-agent-conversations.ts`、`agent-conversation-session-tree.ts`、`agent-conversation-checkpoints.ts`、`agent-conversation-history.ts` | 作为 Session 的证据引用，不建第二套 conversation store |
| 工具与权限 | registry、工作区读写、网络、ask、once/run/directory 权限、写操作幂等 | `src/main/ai/tools/`、`src/main/teaching-conversation-permissions.ts`、`src/main/ai/tool-permission-pending.ts` | 只收紧 P0 需要的类型化 outcome/effect，不全面重写 |
| Lesson 生产 | schema、repair、fallback、HTML、quiz、flashcard、Reference、原子发布 | `src/shared/lesson-schema.ts`、`src/main/lesson-plan-production.ts`、`src/main/teaching-lesson-generation.ts`、`src/main/teaching-lesson-artifacts.ts`、`src/main/ai/lesson-renderer.ts` | 扩展为 Session/Outcome 纵向切片，不另建发布系统 |
| Workspace catalog | 从本地文件构建 Mission、Course、Lesson、conversation、learning asset 投影 | `src/main/teaching-workspace-catalog.ts`、`src/main/teaching-workspace/catalog-reconciliation.ts` | 继续作为 read-side projection，不升级为真相来源 |
| Review/progress | flashcard 发现、quiz 结果聚合、持久 progress | `src/main/teaching-workspace/review.ts` | 作为 legacy evidence Adapter，逐步迁入结构化 evidence |
| Provider/Skill/Connector | provider catalog、skill library、Web/微信、本地资源、secret storage、privacy | 对应 `src/main/ai/`、`src/main/teaching-settings.ts` 和现有 `check:*` | P0 只消费现有能力；P1 再统一 capability snapshot |
| Renderer 过程投影 | composer、slash menu、Ask/permission、tool timeline、replay、会话恢复 | `src/renderer/src/App.tsx`、`agent-conversation-state.ts`、`agent-conversation-presentation.ts`、`AgentConversationReader.tsx` | 新建教学 presentation 深模块，避免继续堆入 `App.tsx` |

## 2.2 真实断点

### 2.2.1 Course 是目录投影，不是课程计划

当前 `TeachingCourseSummary` 能展示 Lesson、conversation 和数量，但没有持久的 Course outcome、先修条件、完成证据、Session 意图和顺序。`course.sessionCount` 也可能反映路径投影，而不是独立 Session 生命周期。

关键路径：`src/shared/teaching-types/workspace.ts`、`src/shared/teaching-placement.ts`、`src/main/teaching-workspace-catalog.ts`。

### 2.2.2 Session 是浅包装，不是真实学习过程

当前 `TeachingSessionSummary` 只包装一个 Lesson，没有隐藏 Session 生命周期。`sessionRelativePath` 在部分路径上实际指向整个 Lesson 目录；conversation、quiz、互动证据、outcome 均未归入同一 Session。

同时，`src/main/teaching-workspace/lifecycle.ts` 中的 `SessionEvent` 实际记录 workspace 事件，应重命名为 `TeachingWorkspaceEvent` 或 `WorkspaceEvent`，避免与教学 Session 冲突。

### 2.2.3 Lesson 互动没有成为可追溯证据

当前 review 主要聚合 `answered/correct`，缺少稳定 event ID、Session/Lesson/item provenance、attempt、置信度、misconception 类型、artifact digest 和与 conversation evidence 的统一关系。

### 2.2.4 Learning record 语义冲突

`src/main/ai/lesson-prompts.ts` 让模型在 Lesson 生成时填写 `learningRecordNote`；`src/main/ai/lesson-renderer.ts` 的 `renderLearningRecordFromPlan()` 会在没有学习证据时创建正式记录。这与 `src/main/teaching-conversation-prompt.ts` 中“仅记录学习者已展示的理解变化”冲突。

P0 必须将生成时说明改为 `assessmentRubric` / `expectedEvidence`，正式 Learning record 只能由 `LearningOutcomeCommitter` 写入。

### 2.2.5 下一教学动作仍依赖自由文本和隐式 Prompt

Lesson 生成、conversation prompt、memory recall 和 context projection 已存在，但没有有限状态的教学决策模块，无法稳定 fixture 测试。

### 2.2.6 资源 grounding 不闭合

Lesson 的 `primarySource` 可以由模型直接生成，没有要求绑定已解析的 `RESOURCES.md` 或实际 search/fetch 结果；资源不可用时也没有明确 `resource_gap`。

### 2.2.7 运行事件与 UI 仍以 Agent 技术语义为主

当前 `AgentRealtimeEvent` 主要是 `chunk/status/tool/terminal`。tool outcome 又通过字符串和 `error` 字段猜测。UI 容易显示“思考过程”、原始工具名、绝对路径和运行状态，而不是“检索练习、Lesson、Learning record、轮到你”。

### 2.2.8 可靠性较强，但尚未服务于教学事实提交

现有原子写、operation journal、run recovery、catalog reconciliation 尚未形成完整链：

```text
证据写入成功 → outcome commit → canonical Learning record → catalog 可修复 → UI 才显示已保存/已掌握
```

---

## 3. 从 Codex 借鉴的机制与精确参考路径

### 3.1 Turn / Item 生命周期与 typed events

参考：

- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/items.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/approvals.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/app-server/README.md`
- `ref_project/codex-rust-v0.144.4/codex-rs/app-server/src/bespoke_event_handling.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/app-server/src/outgoing_message.rs`

采用教学事件：`session_opened`、`lesson_attached`、`retrieval_prompt_presented`、`retrieval_response_submitted`、`quiz_answered`、`flashcard_rated`、`conversation_evidence_recorded`、`outcome_committed`、`learning_record_committed`、`next_step_decided`、`turn_requires_action` 和 terminal events。要求稳定 `eventId/sessionId/turnId/itemId`，completed/committed 是权威状态，delta 只用于实时投影。

### 3.2 Tool lifecycle 与类型化 outcome

参考：

- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/registry.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/router.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/orchestrator.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/lifecycle.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/events.rs`

P0 不全面重写工具系统，只在教学事实 effect seam 引入 `completed/invalid_arguments/permission_denied/canceled/conflict/failed` 类型化结果。无效 JSON 不再静默退化为 `{}`；核心状态不能靠字符串正则推断。完整 Tool Dispatcher 放 P1。

### 3.3 显式状态转换

参考：

- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/session/turn.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tasks/lifecycle.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/state/turn.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/app-server/src/thread_status.rs`

Learning Session 和 Learning Outcome 使用合法 transition table，调用方不得用任意 patch 将状态改为 completed/established。

### 3.4 Durable writer、barrier 与 read-repair

参考：

- `ref_project/codex-rust-v0.144.4/codex-rs/thread-store/src/store.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/thread-store/src/live_thread.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/recorder.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/recorder_tests.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/state_db.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/state/src/runtime/recovery.rs`

采用 canonical-first、明确 flush/publish/settle ack、有限重试、scan-and-repair、单对象 quarantine。首版不复制 JSONL+SQLite 双持久化。

### 3.5 配置来源、能力快照和上下文预算

参考：

- `ref_project/codex-rust-v0.144.4/codex-rs/config/src/loader/README.md`
- `ref_project/codex-rust-v0.144.4/codex-rs/config/src/state.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/config/src/config_layer_source.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/config/src/merge.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/config/src/fingerprint.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/service.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/render.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/injection.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/context/available_skills_instructions.rs`

P0 的 `TeachingContextAssembler` 返回带 provenance 和预算报告的上下文；P1 再深化 `TeachingConfigResolver`、`TeachingCapabilityCatalog` 和 immutable snapshot。P0 不创建第二套 provider/skill catalog。

### 3.6 TUI presentation discipline

参考：

- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/bottom_pane/chat_composer.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/bottom_pane/chat_composer/draft_state.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/bottom_pane/request_user_input/mod.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/bottom_pane/action_required_title.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/history_cell/approvals.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/history_cell/request_user_input.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/resume_picker.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/status_indicator_widget.rs`

采用 composer 状态机、“轮到你”固定位置、typed history cells、草稿恢复、渐进披露和恢复说明。教学化映射为“目标确认 → 检索练习 → 讲解/形成 Lesson → 保存 Learning record”。

### 3.7 Effect policy、审计与 doctor

参考：

- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/request_permissions.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/permissions.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/sandboxing.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/exec_policy.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/cli/src/doctor.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/cli/src/doctor/runtime.rs`
- `ref_project/codex-rust-v0.144.4/.github/workflows/blocking-ci.yml`

P0 只保证 Session/evidence/Learning record/resource effects 有 operation ID、资源、allow/prompt/deny、scope 和 receipt。结构化 doctor、全仓 effect policy、blocking CI 放 P1。

---

## 4. 明确不借鉴的内容

1. **通用 coding-agent 工具面：** shell、unified exec、`apply_patch`、任意进程、Git Agent 化、任意代码执行。
2. **完整 OS sandbox：** Linux Landlock/seccomp、macOS Seatbelt、Windows restricted token/WFP 等。
3. **MCP、插件市场和远程 skills：** P0/P1 不建设 server 生命周期、OAuth、marketplace、远程安装。
4. **通用多 Agent 平台：** 不扩大 spawn/send/wait/close、agent jobs、用户可见子任务树。
5. **Raw reasoning：** 不保存/展示 chain-of-thought，只展示资源、动作、权限、产物和简洁证据解释。
6. **数据库成为真相来源：** SQLite 只能是未来可重建 projection，不能替代教学文件。
7. **企业/云配置：** 不复制 MDM、EnterpriseManaged、cloud config bundle。
8. **Bazel/Rust 双构建与默认远程遥测。**
9. **继续扩展 conversation branching：** P2 只做教学 read model，不增加存储格式。
10. **Coding Agent UX：** 默认不显示 Git branch、diff、revision、token、rate limit、tool queue、Fork/head/tombstone、“思考过程”。

明确拒绝的参考路径包括：

- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/handlers/shell.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/handlers/unified_exec.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/runtimes/apply_patch.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/unified_exec/`

---

## 5. 目标领域模型与文件原则

### 5.1 核心对象必须分离

| 对象 | 权威来源 | 不得被当作 |
|---|---|---|
| Agent conversation turns | conversation 文件 | Learning record |
| Learner profile memory | memory store | 已掌握能力 |
| Session evidence events | Session ledger | 最终 outcome |
| Learning outcome | outcome commit 文件/记录 | 原始 transcript |
| Learning record | `learning-records/` canonical 文件 | Lesson 生成时的目标说明 |
| Workspace catalog | 从磁盘重建的投影 | 写入真相 |
| Agent run checkpoint | `.agent-sessions/` | 教学 Session |
| Workspace lifecycle event | `.studiumx` 运行/工作区事件 | 教学 Session evidence |

### 5.2 P0 建议的 canonical 形态

具体文件名允许实施 agent 在不破坏原则的前提下细化，但必须满足：

```text
Teaching workspace/
  learning-sessions/
    <session-id>/
      session.json              # identity、Course/Lesson refs、状态、版本
      events.jsonl 或 events/   # append-only typed evidence，eventId 幂等
      outcome.json              # 已提交 outcome 与 provenance
  learning-records/
    <record-id>.md              # 只有 established/corrected 才产生
```

如果复用 `.studiumx/` 作为内部存储，仍必须保证 Learning record 位于正式 `learning-records/`，Session 对学习者可解释且可迁移，schema 有版本，catalog 可重建，legacy Lesson 可通过 Adapter 只读投影，且不要求一次性迁移全部旧文件。

### 5.3 Outcome 与 Next Step 状态

```ts
type LearningOutcomeKind =
  | 'established'
  | 'misconception_corrected'
  | 'needs_practice'
  | 'not_evidenced'

type NextTeachingStepKind =
  | 'teach_new'
  | 'contrast_and_retry'
  | 'guided_practice'
  | 'spaced_review'
  | 'fill_resource_gap'
  | 'course_complete'
```

只有前两个 outcome 允许创建正式 Learning record。每个 next-step 决定必须包含 evidence refs 和面向学习者的简短解释，不能只返回自由文本。

---

## 6. 分阶段 Backlog 与依赖图

### 6.1 依赖图

```text
P0-1 LearningSessionLedger
  ↓
P0-2 LessonInteractionRecorder + minimal typed teaching events
  ↓
P0-3 LearningOutcomeCommitter + evidence-gated durable commit
  ↓
P0-4 NextTeachingStepPlanner
  ↓
P0-5 TeachingContextAssembler + minimal ResourceGrounder + budget/provenance
  ↓
P0-6 TeachingTurnPresentation
  ↓
P0-7 Golden E2E / restart / idempotency audit

P1-A Canonical Teaching Event Protocol ─┐
P1-B Typed Tool Dispatcher/EffectPolicy ├─ 支撑 runtime 可解释性与安全
P1-C Config/Capability Snapshot ────────┘
P1-D CourseDefinition
P1-E ResourceGrounder 深化
P1-F WorkspaceInspector + doctor/read-repair
P1-G Provider privacy/audit correlation
P1-H Blocking CI
P1-I Teaching composer / command / a11y 完整化

P2-A Learning branch projection
P2-B Long-session resume picker / advanced technical inspector
P2-C Conservative parallel read tools（有性能证据才做）
P2-D File watcher / optimistic config concurrency（有真实冲突才做）
P2-E External MCP/helper isolation（有真实 Adapter/不可信代码才做）
```

### 6.2 优先级决策

- **P0：只做教学事实纵向切片。** 任何支撑改造必须直接证明 `Lesson → 回答 → Evidence → Outcome → Learning record/不记录 → Next step → 恢复后继续`。
- **P1：加固深模块和产品可解释性。** 处理 P0 暴露出的共性：canonical event protocol、类型化 tool/effect、配置来源、能力快照、Course definition、doctor、隐私和 CI。
- **P2：需求驱动扩展。** 并行、watcher、MCP、helper process、branch comparison 必须有实际产品或性能证据。

---

# 7. P0 Work Packages

## P0-1：LearningSessionLedger

### 目标

把 Session 从 Lesson 包装字段升级为可持久、可恢复、可审计的真实学习步骤，并将 Lesson、conversation、evidence、outcome 归到同一 Session。

### StudiumX 落点

- `src/shared/teaching-types/workspace.ts`
- `src/shared/teaching-placement.ts`
- `src/main/teaching-workspace-catalog.ts`
- `src/main/teaching-workspace/lifecycle.ts`
- `src/main/teaching-lesson-generation.ts`
- `src/main/teaching-agent-conversations.ts`
- `src/main/teaching-workspace.ts`（仅 façade 编排）
- 新模块建议：`src/main/learning-session-ledger.ts` 或 `src/main/learning-session/`
- 新共享类型建议：`src/shared/teaching-types/learning-session.ts`

### Codex 机制参考

- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/codex_thread.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/recorder.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/thread-store/src/store.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/state_db.rs`

### 深模块 interface / seam

```ts
interface LearningSessionLedger {
  open(input: OpenLearningSessionInput): Promise<LearningSessionSnapshot>
  append(sessionId: string, event: LearningSessionEvent): Promise<LearningSessionSnapshot>
  complete(sessionId: string, outcomeRef: LearningOutcomeRef): Promise<LearningSessionSnapshot>
  load(sessionId: string): Promise<LearningSessionSnapshot | null>
}
```

Interface 隐藏 schema validation、eventId 幂等、append/publish barrier、crash marker、legacy Lesson projection、scan-and-repair、quarantine 和 catalog reconciliation。

真实 Adapter：

1. canonical file Adapter：新 Session 格式；
2. legacy Lesson Adapter：将旧 Lesson 投影成只读 Session。

### 验收标准

1. 生成新 Lesson 时创建 durable Session，并绑定 Course/Lesson ref。
2. Agent conversation 可显式绑定 Session，而不只通过 Course 路径归类。
3. Session 有 schema version、稳定 ID、时间、状态和版本。
4. 相同 `eventId` 重放不重复追加。
5. 应用重启后仅依赖本地文件恢复 Session。
6. 旧 Lesson 无需迁移即可出现在 Session 列表，标记为 legacy/read-only projection。
7. `TeachingSessionSummary` 不再是“一 Session 一 Lesson”的浅包装；旧字段通过兼容 Adapter 提供。
8. `SessionEvent` 重命名为 workspace 语义，不能与教学 Session event 混用。
9. catalog 丢失时能从 canonical Session/Lesson 文件重建。
10. 损坏单个 Session 文件时只隔离该对象，保留原始字节并产生诊断。

### 测试命令

现有回归：

```powershell
pnpm run check:teaching-placement
pnpm run check:lesson-generation-flow
pnpm run check:course-conversations
pnpm run check:agent-conversation-catalog
pnpm run check:agent-conversation-state
pnpm run check:agent-run-recovery
pnpm run check:learning-work-reconcile
node scripts/check-workspace-catalog-reconciliation.mjs
pnpm run typecheck
```

新增建议：

```powershell
node scripts/check-learning-session-ledger.mjs
node scripts/check-learning-session-legacy-projection.mjs
node scripts/check-learning-session-recovery.mjs
pnpm exec vitest run --project unit tests/unit/learning-session-ledger.unit.test.ts
pnpm exec vitest run --project integration tests/integration/learning-session-ledger.integration.test.ts
```

### 风险与迁移

- 风险：默认 Course、命名 Course 和 legacy conversation 路径存在多套特殊分支；Session 与 Agent run/旧 `SessionEvent` 易混淆。
- 迁移：双读单写；新 Session 写 canonical 格式，旧 Lesson 只读投影；不批量移动旧文件；legacy 路径识别收进 Adapter；稳定后删除浅包装，不引入 `TeachingSessionV2Summary`。

---

## P0-2：LessonInteractionRecorder 与最小 typed teaching events

### 目标

让 Lesson preview、review 和 Agent conversation 中的学习者表现形成结构化、幂等、可追溯 evidence，而不是让 renderer 或自由文本直接决定掌握状态。

### StudiumX 落点

- `src/shared/lesson-styles.ts`
- `src/shared/preview-markdown-bridge.ts`
- `src/renderer/src/markdown-preview.tsx`
- `src/main/teaching-workspace/review.ts`
- `src/shared/teaching-ipc-contract.ts`
- `src/main/teaching-ipc-gateway.ts`
- `src/shared/teaching-types/agent.ts`
- 新模块建议：`src/main/lesson-interaction-recorder.ts`
- 新类型建议：`src/shared/teaching-types/learning-evidence.ts`

### Codex 机制参考

- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/items.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/app-server/src/bespoke_event_handling.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/request_user_input.rs`

### 深模块 interface / seam

```ts
interface LessonInteractionRecorder {
  record(event: LessonInteraction): Promise<EvidenceReceipt>
  list(sessionId: string): Promise<LearningEvidence[]>
}

type LessonInteraction =
  | QuizAnswered
  | RetrievalResponseSubmitted
  | FlashcardRated
  | LessonOpened
  | LessonCompleted
  | ConversationEvidenceRecorded
```

Seam 位于不可信 Lesson preview/renderer 与 main process canonical evidence 存储之间。preview 只能提交受限 ID 和回答，不得指定任意路径。

每个事件至少包含 `eventId/workspaceId/courseId/sessionId/lessonId/itemId/attempt/observedAt/artifactDigest`，conversation evidence 另带 `turnId`。

### 验收标准

1. quiz、retrieval response、flashcard rating 均产生 typed evidence。
2. 重复 `eventId` 不重复计数或追加。
3. 同一 item 的多次 attempt 保留，不压缩成 boolean。
4. Lesson 脚本不能指定 workspace 绝对路径或其他 Session ID。
5. evidence 写入后重启仍存在，并可由 Session ledger 加载。
6. 旧 review progress 可通过 Adapter 投影为 legacy evidence，不伪造缺失字段。
7. conversation evidence 引用明确 turn/item，不解析 Assistant 自由文本。
8. realtime 与 replay 消费同一事件得到相同 projection。
9. terminal/completed event 参与 reducer，不能只依赖 IPC invoke 返回。
10. 不保存 raw chain-of-thought。

### 测试命令

```powershell
pnpm run check:teaching-ipc-contract
pnpm run check:teaching-ipc-commands
pnpm run check:application-runtime
pnpm run check:agent-event-bus
pnpm run check:agent-process-timeline
pnpm run check:lesson-markdown
pnpm run check:markdown-preview
pnpm run typecheck
node scripts/check-lesson-interaction-recorder.mjs
node scripts/check-teaching-evidence-events.mjs
node scripts/check-evidence-idempotency.mjs
pnpm exec vitest run --project unit tests/unit/lesson-interaction-recorder.unit.test.ts
pnpm exec vitest run --project integration tests/integration/lesson-interaction-recorder.integration.test.ts
```

### 风险与迁移

- 风险：preview 是不可信输入面；同一回答可能由多个通道重复送达；长回答引入隐私和体积问题。
- 迁移：新 recorder 先接新 Lesson；旧 `progress.json` 只读投影；event schema 带版本；长文本优先保存 hash、受控摘要和用户明确提交内容；旧 chunk/status/tool 进入兼容期，新教学代码只消费 typed events。

---

## P0-3：LearningOutcomeCommitter 与证据门控提交

### 目标

将原始学习证据转换为可审计 outcome，并只在证据充分时幂等写入正式 Learning record。

### StudiumX 落点

- `src/main/ai/lesson-renderer.ts`
- `src/main/ai/lesson-prompts.ts`
- `src/shared/lesson-schema.ts`
- `src/main/teaching-lesson-artifacts.ts`
- `src/main/teaching-conversation-runtime.ts`
- `src/main/teaching-workspace/review.ts`
- `src/main/ai/agent-operation-journal.ts`
- `src/main/ai/agent-run-persistence.ts`
- `src/main/teaching-workspace/learning-assets-catalog.ts`
- 新模块建议：`src/main/learning-outcome-committer.ts`

### Codex 机制参考

- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tasks/lifecycle.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/state/turn.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/recorder.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/policy.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/thread-store/src/store.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/state/src/runtime/recovery.rs`

### 深模块 interface / seam

```ts
interface LearningOutcomeCommitter {
  evaluate(input: OutcomeEvaluationInput): OutcomeDecision
  commit(input: OutcomeCommitInput): Promise<OutcomeCommitResult>
  reconcile(sessionId: string): Promise<OutcomeReconciliation>
}

type OutcomeCommitResult =
  | { kind: 'committed'; outcome: LearningOutcome; record?: LearningRecordRef }
  | { kind: 'already_committed'; outcome: LearningOutcome; record?: LearningRecordRef }
  | { kind: 'insufficient_evidence'; outcome: LearningOutcome }
  | { kind: 'conflict'; message: string }
  | { kind: 'failed'; message: string; retryable: boolean }
```

`evaluate` 尽量纯函数；`commit` 负责 durable effect。调用方不得直接写 Learning record。

### 状态不变量

- `established` / `misconception_corrected`：允许正式 Learning record。
- `needs_practice` / `not_evidenced`：禁止正式 Learning record。
- outcome 必须引用 Session、Lesson、evidence IDs 和规则/模型版本。
- Learning record 文件成功是 commit 成功必要条件；catalog 更新不是必要条件，但必须可修复。

### 验收标准

1. 仅生成 Lesson 不创建正式 Learning record。
2. `learningRecordNote` 被删除或迁移为 `assessmentRubric` / `expectedEvidence`。
3. 只有 `established` 和 `misconception_corrected` 能写 `learning-records/`。
4. 每条 record 包含 Session、Lesson、conversation turn/quiz evidence provenance。
5. 相同 outcome/operation 重试不产生重复文件。
6. `needs_practice` 不写“已掌握”，但可被 planner 消费。
7. canonical record 成功而 catalog 未更新时可 reconcile，UI 仅显示“正在确认保存”。
8. canonical 写失败时不得写 completed/established projection。
9. 无法确认副作用是否完成时不自动重复写，进入 review/reconcile。
10. 损坏旧 record 不被自动覆盖，进入 quarantine/diagnostic。

### 测试命令

```powershell
pnpm run check:conversation-lesson-tool
pnpm run check:lesson-generation-flow
pnpm run check:agent-operation-idempotency
pnpm run check:agent-parent-turn-staging
pnpm run check:agent-run-recovery
pnpm run check:agent-conversation-audit-metadata
pnpm run check:workspace-change-history
pnpm run check:learning-work-reconcile
pnpm run typecheck
node scripts/check-learning-outcome-committer.mjs
node scripts/check-learning-record-evidence-gate.mjs
node scripts/check-learning-outcome-recovery.mjs
node scripts/check-learning-record-read-repair.mjs
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
pnpm exec vitest run --project integration tests/integration/learning-outcome-commit.integration.test.ts
```

### 风险与迁移

- 风险：删除自动 record 破坏现有 Lesson fixture；规则过激会误判掌握；rename 后 settlement 前崩溃形成交错状态。
- 迁移：生成时 record 改为非事实型 rubric；legacy reader 标记 `legacy_generated`，不得自动作为掌握证据；使用稳定 identity 实现幂等；commit 采用 stage → flush → atomic publish → outcome marker → catalog reconcile；不确定时返回 `not_evidenced`。

---

## P0-4：NextTeachingStepPlanner

### 目标

根据 Mission、Course、最新 Session、Learning evidence/outcome 和 resource readiness，以有限状态决定下一教学动作。

### StudiumX 落点

- `src/shared/teaching-workflow.ts`
- `src/main/teaching-conversation-lesson-tool.ts`
- `src/main/teaching-lesson-generation.ts`
- `src/main/teaching-conversation-runtime.ts`
- 新模块建议：`src/main/next-teaching-step-planner.ts`
- 新类型建议：`src/shared/teaching-types/next-teaching-step.ts`

### Codex 机制参考

- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/session/turn.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tasks/lifecycle.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/orchestrator.rs`

### 深模块 interface / seam

```ts
interface NextTeachingStepPlanner {
  decide(input: NextTeachingStepInput): NextTeachingStep
}
```

优先实现为确定性纯模块。模型只能提供受约束的候选解释或分类辅助，不能绕过状态规则。

输入包括 Mission success criteria、Course state、最新 Session/outcome/evidence refs、resource state 和 learner preference。输出包括 `reasonCode/evidenceRefs/resourceRequirements/presentationSummary/nextSessionIntent`。

### 验收标准

1. 强证据后进入迁移/更高难度，不重复从零讲解。
2. 明确误解后选择 `contrast_and_retry`。
3. 部分正确或低置信度选择 `guided_practice`。
4. 到期复习选择 `spaced_review`。
5. 缺少可信资源时选择 `fill_resource_gap`，不生成事实密集 Lesson。
6. Mission/Course 完成证据满足时选择 `course_complete`。
7. 每个决定携带 evidence refs，可在 UI 解释。
8. 相同输入产生稳定输出，具备 fixture 表。
9. learner preference 不能把 `needs_practice` 覆盖成 `teach_new`。
10. planner 不直接写文件、不调用 provider、不操作 renderer。

### 测试命令

```powershell
pnpm run check:workflow
pnpm run check:teaching-personalization
pnpm run check:conversation-lesson-tool
pnpm run check:lesson-generation-flow
pnpm run typecheck
node scripts/check-next-teaching-step-planner.mjs
pnpm exec vitest run --project unit tests/unit/next-teaching-step-planner.unit.test.ts
```

### 风险与迁移

- 风险：有限状态过度简化；模型直接决定状态会降低确定性；P0 Course definition 尚不完整。
- 迁移：首版使用保守决策表；Course 缺失时由 legacy Adapter 构造有限状态；现有 prompt 先消费结构化 intent；记录 planner version，不反向改写历史 outcome。

---

## P0-5：TeachingContextAssembler 与最小 ResourceGrounder

### 目标

统一为 conversation、Lesson generation 和 next-step decision 提供带 provenance、受预算约束、优先本地事实的教学上下文；Lesson source 必须来自真实 GroundingPack。

### StudiumX 落点

- `src/main/teaching-conversation-turn-context.ts`
- `src/main/ai/request-context-projection.ts`
- `src/main/ai/context-compactor.ts`
- `src/main/teaching-memory-recall.ts`
- `src/main/teaching-lesson-generation.ts`
- `src/main/ai/lesson-prompts.ts`
- `src/main/teaching-workspace/learning-assets-catalog.ts`
- `src/main/ai/search-runtime.ts`
- `src/main/ai/tools/web_search.ts`
- `src/main/ai/tools/web_fetch.ts`
- 新模块建议：`src/main/teaching-context-assembler.ts`
- 新模块建议：`src/main/resource-grounder.ts`

### Codex 机制参考

- `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/service.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/render.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/injection.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/context/available_skills_instructions.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/config/src/state.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/config/src/merge.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/context_manager/history.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/compact.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/core/src/agents_md.rs`

### 深模块 interface / seam

```ts
interface TeachingContextAssembler {
  assemble(input: TeachingContextRequest): Promise<TeachingContext>
}

interface ResourceGrounder {
  ground(input: GroundingRequest): Promise<GroundingPack>
}

type TeachingContext = {
  fragments: ContextFragment[]
  grounding: GroundingPack
  report: ProjectionReport
}
```

真实 Resource Adapter：本地 `RESOURCES.md`/workspace 文件、现有 Web search/fetch、其他已配置且已允许的连接来源。

`ProjectionReport` 至少包含 included、omitted+reason、truncated before/after、estimated tokens/chars、unresolved facts 和 capability/readiness diagnostics。

预算优先级：当前问题 → Session/Lesson objective → Mission/Course → 本地证据/GroundingPack → 有效 outcomes/records → learner memory → 教学法摘要 → 外部能力说明。

### 验收标准

1. conversation 与 Lesson generator 使用同一 assembler，不各自拼接事实源。
2. Lesson generation 能读取相关 `RESOURCES.md`、`GLOSSARY.md`、`NOTES.md`。
3. `primarySource` 必须引用 GroundingPack 中的 `sourceId`。
4. source 包含 title、URL/path、retrievedAt、digest、trust/use-for provenance。
5. 来源不可用时返回 resource gap，planner 可选择 `fill_resource_gap`。
6. archived conversation 默认不注入。
7. learner memory 与 Learning outcome 保持不同 provenance。
8. 不可用、禁用、未授权能力不进入上下文。
9. 超预算时先压缩描述，不先丢 Mission/Session/本地证据。
10. 相同输入产生确定性投影和 report。
11. 外部结果不自动写入 workspace；导入必须是明确 effect。
12. P0 不创建第二套 provider/skill catalog。

### 测试命令

```powershell
pnpm run check:agent-loop-context-hygiene
pnpm run check:agent-loop-context-compaction
pnpm run check:context-compactor
pnpm run check:memory-capture
pnpm run check:teaching-personalization
pnpm run check:search-runtime
pnpm run check:web-tools-baseline
pnpm run check:web-search-providers
pnpm run check:web-fetch-safe-url
pnpm run check:provider-privacy
pnpm run check:skill-library
pnpm run typecheck
node scripts/check-teaching-context-assembler.mjs
node scripts/check-resource-grounder.mjs
node scripts/check-lesson-source-provenance.mjs
node scripts/check-context-projection-report.mjs
pnpm exec vitest run --project unit tests/unit/teaching-context-assembler.unit.test.ts
pnpm exec vitest run --project integration tests/integration/resource-grounder.integration.test.ts
```

### 风险与迁移

- 风险：assembler 演化成巨型 prompt builder；grounder 被误做成重型 RAG；readiness 拖慢 turn。
- 迁移：包住现有 request-context projection 和 Lesson prompt 输入；P0 只支持本地文件+现有 Web 工具；readiness 是带时间戳派生状态；完整 ConfigResolver/CapabilityCatalog 放 P1。

---

## P0-6：TeachingTurnPresentation

### 目标

把技术运行流投影为稳定、可访问、可恢复的教学回合，而不是直接向学习者暴露 Agent 内部事件。该模块只负责 presentation projection，不拥有教学事实、不判断掌握状态，也不根据 UI 乐观状态宣布文件已经保存。

### StudiumX 落点

- `src/renderer/src/agent-conversation-state.ts`
- `src/renderer/src/agent-conversation-projection.ts`
- `src/renderer/src/agent-conversation-presentation.ts`
- `src/renderer/src/agent-process-timeline.ts`
- `src/renderer/src/views/agent-conversation/AgentConversationReader.tsx`
- `src/renderer/src/app-shell/agent-conversation-runner.ts`
- `src/renderer/src/App.tsx`：只作为 composition seam，由集成 owner 修改
- 新模块建议：`src/renderer/src/teaching-turn-presentation.ts`
- 新测试建议：`tests/unit/teaching-turn-presentation.unit.test.ts`
- 新 E2E 建议：`tests/e2e/teaching-learning-loop.e2e.spec.ts`

### Codex 机制参考

- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/items.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/bottom_pane/chat_composer.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/resume_picker.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/history_cell/mod.rs`
- `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/status_indicator_widget.rs`

借鉴重点是：协议事件与展示状态分离、状态区域稳定、长历史可恢复、需要用户输入时有明确焦点；不借鉴终端 UI 的 coding-agent 文案和原始推理展示。

### 深模块 interface / seam

```ts
interface TeachingTurnProjector {
  project(input: TeachingTurnProjectionInput): TeachingTurnPresentation
}

type TeachingTurnPresentation = {
  turnId: string
  headline: string
  stages: TeachingStagePresentation[]
  learnerAction?: LearnerActionPresentation
  savedArtifacts: SavedArtifactPresentation[]
  foldedTechnicalDetails: TechnicalDetailPresentation[]
  announcement?: AccessibilityAnnouncement
}

type TeachingStageId =
  | 'confirm_goal'
  | 'retrieval_practice'
  | 'explain_and_form_lesson'
  | 'commit_learning_record'

type TeachingStageState =
  | 'waiting'
  | 'active'
  | 'needs_you'
  | 'complete'
  | 'error'
  | 'skipped'
```

固定的四阶段教学叙事：

1. **确认目标**：展示本 Session 的 objective/success criteria。
2. **完成检索练习**：等待或呈现学习者回答与反馈；未回答不能完成。
3. **讲解并形成 Lesson**：展示教学解释、source provenance 和 Lesson 的持久化状态。
4. **保存 Learning record**：只有 `LearningOutcomeCommitter` 的证据门控结果和 catalog/文件系统确认才能完成；`needs_practice` 时允许 `skipped`，但必须解释原因。

输入必须是 typed teaching events、session snapshot、effect outcomes 和 durable artifact snapshot。projector 不读取原始 prompt，不解析任意日志字符串，不从“工具看起来成功”推导事实。

### 不变量

- 同一时刻最多一个阶段为 `active` 或 `needs_you`。
- `needs_you` 优先于后台技术活动，固定显示在“轮到你”区域。
- `complete` 只能由领域事实或已确认 effect 推导，不能由 spinner 结束、assistant 文案或 HTTP 200 推导。
- Lesson/Learning record 的“已保存”来自文件系统/catalog reconciliation 结果。
- UI 不显示“思考过程”、chain-of-thought、隐藏 prompt 或 provider 原始请求。
- tool name、参数、URL 安全判定、operation ID 等技术细节默认折叠并脱敏。
- 重启恢复后，同一 presentation snapshot 必须可由 durable facts 重建。

### 验收标准

1. 四阶段顺序固定，分支状态通过 typed state 表达，不靠文案猜测。
2. 任一时刻最多一个 `active`/`needs_you`；测试覆盖乱序、重复和恢复事件。
3. 检索练习尚未回答时，“完成检索练习”不能进入 `complete`。
4. 错误回答后展示“需要继续练习/对比后重试”，不得显示“已掌握”。
5. Lesson 和 Learning record 保存状态由真实文件/catalog snapshot 驱动；文件缺失时显示恢复或错误态。
6. 页面不出现“思考过程”，也不泄露原始 prompt、provider payload、token、secret 或完整本地绝对路径。
7. 技术详情默认折叠，内容经过 allowlist/redaction；学习者主路径只使用教学语言。
8. 固定“轮到你”区域在需要回答、审批或恢复选择时获得焦点；关闭后焦点回到合理来源。
9. 关键状态变化使用克制的 `aria-live`；不会因 token/chunk 产生公告风暴。
10. 键盘可完成回答、重试、继续和查看来源；颜色不是唯一状态线索。
11. 重启恢复不重复公告“已保存”，也不创建第二个活动阶段。
12. `App.tsx` 只连接 projector/reader，不承载领域状态机。

### 测试命令

```powershell
pnpm run check:agent-conversation-ui
pnpm run check:agent-process-timeline
pnpm run check:agent-run-recovery
pnpm run check:external-link-controls
pnpm run typecheck
node scripts/check-teaching-turn-presentation.mjs
node scripts/check-teaching-presentation-redaction.mjs
pnpm exec vitest run --project unit tests/unit/teaching-turn-presentation.unit.test.ts
pnpm exec playwright test --project electron-e2e tests/e2e/teaching-learning-loop.e2e.spec.ts
```

其中新增的脚本和测试文件是本 work package 的交付物；若实施审计时不存在，不能用“手工看起来正常”代替完成证明。

### 风险与迁移

- 风险：presentation 层重新发明领域状态机；技术事件一对一泄漏到 UI；`aria-live` 过度播报；旧 UI 与新 UI 同时更新导致双重状态。
- 迁移：先在现有 conversation reader 内引入 projector 和 feature flag；旧 timeline 作为 folded technical details Adapter；稳定后删除 UI 侧字符串推断，但保留 legacy event adapter 一次发布周期；所有“保存成功”改为消费 durable artifact snapshot。

---

## P0-7：Golden E2E、恢复注入与发布审计

### 目标

把 P0 六个模块串成一个可重复、可故障注入、可无障碍审计的真实纵向测试。该包不新增产品能力，只负责 integration composition、fixtures、故障点和发布门禁；任何模块的局部单测都不能替代此包。

### StudiumX 落点

- 新增：`tests/e2e/teaching-learning-loop.e2e.spec.ts`
- 新增：`tests/integration/teaching-learning-loop.integration.test.ts`
- 新增：`tests/fixtures/teaching-learning-loop/`
- 新增：`scripts/check-teaching-learning-loop.mjs`
- 新增或扩展：workspace catalog reconciliation 测试 fixture
- 只由集成 owner 修改：`src/shared/teaching-ipc-contract.ts`
- 只由集成 owner 修改：`src/main/teaching-ipc-gateway.ts`
- 只由集成 owner 修改：`src/main/teaching-workspace.ts`
- 只由集成 owner 修改：`src/renderer/src/App.tsx`
- 测试配置和 `package.json` 仅在确有必要时由集成 owner 修改

### 深模块 interface / seam

E2E 只通过用户可见行为、公开 IPC 和 canonical workspace 文件验证闭环，不直接调用模块私有函数。故障注入通过窄 seam 提供：

```ts
interface TeachingPersistenceFaultInjector {
  pauseAt(point:
    | 'after_artifact_rename_before_catalog'
    | 'after_temp_write_before_publish'
  ): Promise<void>
}
```

该 seam 仅在测试构建启用，生产默认实现为空操作；不得在生产配置暴露任意路径写入或任意 crash hook。

### 验收标准

1. 完整覆盖“错误回答 → needs_practice → 对比重试 → misconception_corrected → 单一 Learning record → 继续下一 Lesson”。
2. 至少注入两个 crash window：artifact rename 后 catalog 更新前、temp write 后 publish 前。
3. 重启后 read-repair 重建 catalog/projection，不重复 Session、attempt、outcome 或 Learning record。
4. 重放相同 event ID/operation ID 的结果幂等。
5. E2E 直接检查 canonical 文件内容、catalog 投影和 UI 三者一致。
6. 测试验证真实 GroundingPack 的 `sourceId` 进入 Lesson，而不是硬编码假来源。
7. E2E 使用真实键盘路径，并执行焦点、可访问名称和 `aria-live` 断言。
8. 测试失败时保留脱敏后的 workspace fixture、截图和事件摘要，不保留 provider secret 或原始隐私 payload。
9. 下述命令在干净 checkout 可运行；不允许只在开发者已有缓存/本机 workspace 上通过。

### 测试命令

```powershell
node scripts/check-teaching-learning-loop.mjs
node scripts/check-workspace-catalog-reconciliation.mjs
pnpm exec vitest run --project integration tests/integration/teaching-learning-loop.integration.test.ts
pnpm exec playwright test --project electron-e2e tests/e2e/teaching-learning-loop.e2e.spec.ts
pnpm exec playwright test --project electron-e2e tests/e2e/teaching-learning-loop.e2e.spec.ts --repeat-each=3
```

### 风险与迁移

- 风险：E2E 使用 mock 绕过真实 writer；故障注入污染生产；时间/随机 ID 导致 flaky；只断言 UI 文案而未断言 canonical facts。
- 迁移：fixtures 使用确定性 clock/ID provider；provider 调用可录制为离线 fixture，但 writer/catalog/IPC/renderer 必须走真实路径；故障注入编译时或测试环境隔离；每个中间版本保留 legacy read compatibility，但 golden scenario 只写新格式。

---

# 8. P1 Backlog：在闭环成立后加固协议、能力与恢复

P1 的进入条件是 P0 golden E2E 已绿。P1 不是第二条主线；每项都必须说明它消除哪一个已观察到的教学闭环风险。若无法给出该证据，继续留在 backlog。

## P1-1：Canonical Teaching Event Protocol

- **StudiumX 落点：** `src/shared/teaching-types/agent.ts`、新 `src/shared/teaching-events.ts`、`src/main/ai/agent-loop-events.ts`、renderer projection adapters。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/items.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/approvals.rs`。
- **interface / seam：** `TeachingEventEnvelope { schemaVersion, eventId, sessionId, turnId, sequence, occurredAt, payload }`；payload 是封闭 discriminated union；legacy `chunk/status/tool/terminal` 只经 Adapter 转换。
- **验收：** schema/version/ordering/duplicate/unknown-event 策略明确；domain event 与 presentation event 分离；回放可重建同一投影。
- **测试命令：** `pnpm exec vitest run --project unit tests/unit/teaching-events.unit.test.ts`；`node scripts/check-teaching-event-replay.mjs`；`pnpm run typecheck`。
- **风险与迁移：** 风险是大爆炸替换现有协议；迁移采用双读单写、事件版本 upcaster、一个发布周期 telemetry，禁止永久双写。

## P1-2：Typed Tool Dispatcher 与 Effect Policy

- **StudiumX 落点：** `src/main/ai/tools/execution.ts`、tool registry/definition modules、workspace write tool、search/fetch adapters；新 `src/main/ai/tools/tool-outcome.ts` 与 `effect-policy.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/registry.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/router.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/orchestrator.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/lifecycle.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/parallel.rs`。
- **interface / seam：** `ToolDispatcher.dispatch(call): Promise<ToolOutcome<Output, ToolError>>`；outcome 显式区分 `succeeded|failed|cancelled|denied|timed_out`，effect 分类为 `read|workspace_write|external_write|privileged`。
- **验收：** 非法 JSON 不再静默变 `{}`；失败不再靠含 `error` 的字符串推断；effect 先授权后执行；operation ID 与 audit correlation 可追踪。
- **测试命令：** `pnpm run check:workspace-write-tool`；`pnpm run check:web-fetch-safe-url`；`pnpm exec vitest run --project unit tests/unit/tool-dispatcher.unit.test.ts`。
- **风险与迁移：** 风险是破坏现有工具返回契约；迁移为每个现有工具建 typed adapter，先 shadow-compare 再删除字符串推断；P1 不新增 shell/MCP 工具。

## P1-3：显式 Agent Run 状态机

- **StudiumX 落点：** agent runner/recovery、`src/renderer/src/app-shell/agent-conversation-runner.ts`、run persistence；新 `agent-run-state-machine.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/session/turn.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tasks/lifecycle.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/codex_thread.rs`。
- **interface / seam：** `AgentRunStateMachine.transition(current, command|event): TransitionResult`；状态与 teaching Session 分离。
- **验收：** waiting/running/awaiting_user/cancelling/completed/failed/interrupted 的合法边明确；恢复与取消幂等；非法转换被记录而不是静默修复。
- **测试命令：** `pnpm run check:agent-run-recovery`；`pnpm run check:agent-operation-idempotency`；`pnpm exec vitest run --project unit tests/unit/agent-run-state-machine.unit.test.ts`。
- **风险与迁移：** 风险是把 teaching Session 误合并进 run；迁移只包现有 runner，SessionLedger 通过 IDs 关联而非继承状态。

## P1-4：TeachingConfigResolver

- **StudiumX 落点：** settings/config loading、workspace preferences、provider settings；新 `src/main/teaching-config-resolver.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/config/src/state.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/config/src/merge.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/config/src/fingerprint.rs`。
- **interface / seam：** `resolve(scope): ResolvedTeachingConfig { value, sources, diagnostics, fingerprint }`；来源优先级显式。
- **验收：** default/user/workspace/session override 的来源可解释；secret 不进入普通 snapshot；配置变更可检测；无效配置返回诊断而非半应用。
- **测试命令：** `pnpm run check:settings-secret-storage`；`pnpm exec vitest run --project unit tests/unit/teaching-config-resolver.unit.test.ts`。
- **风险与迁移：** 风险是重建通用配置平台；迁移仅覆盖教学闭环消费字段，现有 settings 通过 Adapter 注入，未使用字段不搬迁。

## P1-5：TeachingCapabilityCatalog

- **StudiumX 落点：** provider/search/skill readiness、permission snapshot；新 `src/main/teaching-capability-catalog.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/service.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/render.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/injection.rs`。
- **interface / seam：** `snapshot(request): CapabilitySnapshot`，每项含 available/disabled/unconfigured/denied/degraded 与原因、freshness。
- **验收：** planner/context 只消费可用能力；disabled/unconfigured 不进入 prompt；readiness 有 TTL 且失败可降级；不建立第二 provider/skill registry。
- **测试命令：** `pnpm run check:skill-library`；`pnpm run check:web-search-providers`；`pnpm exec vitest run --project unit tests/unit/teaching-capability-catalog.unit.test.ts`。
- **风险与迁移：** 风险是 catalog 与真实执行漂移；迁移从现有 registry 派生只读 snapshot，执行前仍由 effect policy 复核。

## P1-6：Context Projection Report 与预算审计

- **StudiumX 落点：** `src/main/ai/request-context-projection.ts`、`context-compactor.ts`、P0 `teaching-context-assembler.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/context_manager/history.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/compact.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/agents_md.rs`。
- **interface / seam：** 稳定 `ProjectionReport`，记录 included/omitted/reason/truncation/budget/provenance/fingerprint。
- **验收：** 相同 facts/config 得到确定性 fingerprint；Mission/Session/本地证据优先级受测试保护；报告默认脱敏；超预算原因可诊断。
- **测试命令：** `pnpm run check:agent-loop-context-hygiene`；`pnpm run check:agent-loop-context-compaction`；`node scripts/check-context-projection-report.mjs`。
- **风险与迁移：** 风险是报告包含学习者隐私或 prompt；迁移只记录摘要、来源 ID、字节/token 估算和原因码，不记录原文。

## P1-7：Durable CourseDefinition

- **StudiumX 落点：** Course 目录/manifest、workspace lifecycle、catalog；新 `course-definition-store.ts` 与 migration reader。
- **Codex 参考：** durable state 思路参考 `ref_project/codex-rust-v0.144.4/codex-rs/thread-store/src/store.rs`，但不采用 SQLite 真相源。
- **interface / seam：** `CourseDefinitionStore.read/write/repair`；CourseDefinition 含 course ID、Mission link、目标、Session ordering 和 schema version。
- **验收：** Course 不再只由路径猜测；Session 顺序/状态可恢复；旧 workspace 可读并按需 materialize；catalog 可重建。
- **测试命令：** `node scripts/check-course-definition-store.mjs`；`node scripts/check-workspace-catalog-reconciliation.mjs`；相关 integration test。
- **风险与迁移：** 风险是批量改写用户 workspace；迁移采用 lazy materialization、备份与 dry-run report，不强制全库迁移。

## P1-8：ResourceGrounder 深化

- **StudiumX 落点：** P0 `resource-grounder.ts`、search/fetch、本地资源索引、source preview。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/service.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/render.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/injection.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/lifecycle.rs`。
- **interface / seam：** 扩展 Adapter 为统一 `GroundingSourceAdapter`，仍输出同一 `GroundingPack`。
- **验收：** 去重、freshness、digest、trust/use-for、引用失效和 safe URL 明确；失败转 resource gap；外部内容不隐式写 workspace。
- **测试命令：** `pnpm run check:search-runtime`；`pnpm run check:web-tools-baseline`；`pnpm run check:web-fetch-safe-url`；`node scripts/check-resource-grounder.mjs`。
- **风险与迁移：** 风险是演化成通用 RAG 平台；迁移只增加由真实教学场景驱动的 Adapter，向量库不进入默认路线。

## P1-9：TeachingWorkspaceInspector

- **StudiumX 落点：** teaching workspace lifecycle/catalog/placement/reconciliation；新只读 inspector。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/cli/src/doctor.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/recorder.rs`。
- **interface / seam：** `inspect(root): WorkspaceInspectionReport`，检查 canonical files、schema、dangling links、catalog drift、temp artifacts。
- **验收：** inspector 默认只读；问题有稳定 code/severity/path-safe evidence/repairability；不把 projection 当 canonical。
- **测试命令：** `node scripts/check-teaching-workspace-inspector.mjs`；`node scripts/check-workspace-catalog-reconciliation.mjs`。
- **风险与迁移：** 风险是 inspector 暗中修复；迁移将 inspect 与 repair command 分开，修复前展示计划并留审计。

## P1-10：结构化 Doctor 与恢复报告

- **StudiumX 落点：** recovery coordinator、catalog repair、settings/provider diagnostics、CLI/diagnostic UI。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/cli/src/doctor.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/state_db.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/thread-store/src/store.rs`。
- **interface / seam：** `TeachingDoctor.run(): DoctorReport`；每项输出 check ID、result、safe evidence、recommended action；repair 是单独 effect。
- **验收：** 能诊断 P0 两个 crash window、配置不可用、source gap、catalog drift；报告可导出且脱敏；doctor 失败不阻塞只读打开 workspace。
- **测试命令：** `node scripts/check-teaching-doctor.mjs`；`pnpm run check:agent-run-recovery`。
- **风险与迁移：** 风险是“一键修复”破坏事实；迁移首版只读，自动修复限于确定性 projection rebuild。

## P1-11：Audit Correlation 与 Provider Privacy

- **StudiumX 落点：** operation IDs、tool audit、provider request logging、support diagnostics。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs` 的 IDs/事件边界和 `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/lifecycle.rs` 的调用生命周期。
- **interface / seam：** `AuditCorrelation { sessionId, turnId, eventId?, operationId?, effectId? }`；日志仅存 safe metadata。
- **验收：** 一次教学 outcome 可追到 evidence/effect，而无需保存原始推理；provider payload、secret、完整学习者回答默认不进入日志；导出经过 redaction。
- **测试命令：** `pnpm run check:provider-privacy`；`pnpm run check:settings-secret-storage`；`node scripts/check-teaching-audit-correlation.mjs`。
- **风险与迁移：** 风险是可观测性成为隐私泄露面；迁移用 allowlist schema，旧自由文本日志不迁入新 audit store。

## P1-12：Teaching Composer Commands 与无障碍加固

- **StudiumX 落点：** conversation composer、reader、keyboard/focus hooks、presentation tests。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/bottom_pane/chat_composer.rs`。
- **interface / seam：** 有限 `TeachingCommand` union，例如 continue/retry/show_source/end_session；命令不等于任意工具调用。
- **验收：** 键盘、屏幕阅读器、错误恢复和 reduced motion 可用；命令可发现；不会绕过 planner/effect policy；固定“轮到你”区域稳定。
- **测试命令：** teaching E2E；axe/a11y 测试；`node scripts/check-teaching-composer-a11y.mjs`。
- **风险与迁移：** 风险是斜杠命令扩张成通用 Agent 控制台；迁移只开放教学动作，技术命令保留在诊断模式。

## P1-13：Main-process TeachingTurnCoordinator 与 Blocking CI

- **StudiumX 落点：** 新 main-process coordinator；IPC gateway；`.github/workflows/blocking-ci.yml`；package scripts。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/codex_thread.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tasks/lifecycle.rs`、`ref_project/codex-rust-v0.144.4/.github/workflows/blocking-ci.yml`。
- **interface / seam：** `TeachingTurnCoordinator.execute(command): AsyncIterable<TeachingEventEnvelope>`；只编排 P0 深模块，不拥有其领域规则。
- **验收：** renderer 不直接编排 writer/tool/provider；取消/恢复/重复命令幂等；P0 golden、security、privacy、typecheck/build 成为 blocking CI；失败产物脱敏。
- **测试命令：** 最终基线全部命令；CI workflow dry-run/仓库现有 workflow checks。
- **风险与迁移：** 风险是 coordinator 变成 God object、CI 一次性全红；迁移先包现有调用链，按可靠性分批设为 required，但 P0 golden 在发布前必须 blocking。

### P1 依赖与建议合并顺序

```text
P0 green
  ├─ P1-1 Canonical events ─┬─ P1-3 Run state ───────────────┐
  │                          └─ P1-2 Typed tools/effects ─────┤
  ├─ P1-4 Config resolver ───── P1-5 Capability catalog ─┐    │
  ├─ P1-6 Projection report ──── P1-8 Grounder deepen ───┤    │
  ├─ P1-7 CourseDefinition ───── P1-9 Inspector ─ P1-10 Doctor
  ├─ P1-11 Audit/privacy ─────────────────────────────────┤    │
  └─ P1-12 Composer/a11y ─────────────────────────────────┴─ P1-13 Coordinator/CI
```

---

# 9. P2 Backlog：仅由真实规模或风险信号触发

P2 默认不排期。每个条目必须由可量化触发信号进入实施，例如：真实 workspace 恢复耗时、Session 数量、用户需要分支学习的比例、可信 Adapter 数、故障率或支持工单。不得因“Codex 有”而建设。

## P2-1：Learning Branch Projection

- **StudiumX 落点：** SessionLedger/Planner 的只读分支投影和 UI navigator；不改变 canonical outcome 历史。
- **Codex 参考：** conversation/thread 分支恢复思想参考 `ref_project/codex-rust-v0.144.4/codex-rs/core/src/codex_thread.rs`，不照搬 coding thread 模型。
- **interface / seam：** `LearningBranchProjector.project(sessionHistory): LearningBranchView`。
- **验收：** 能表达 remediation/alternative path；Learning record 只提交一次；切换分支不复制事实。
- **测试命令：** 新 branch projection unit/integration/E2E。
- **风险与迁移：** 复杂度过高；仅当线性 planner 无法满足已观察场景时启用，从投影开始，不先改文件格式。

## P2-2：长 Session Resume Picker

- **StudiumX 落点：** session list/resume UI、ledger query/read model。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/resume_picker.rs`。
- **interface / seam：** `ResumeCandidateQuery.list(filters): ResumeCandidate[]`。
- **验收：** 按教学目标、最近动作、needs-you/blocked 状态筛选；候选来自 durable ledger；键盘/a11y 完整。
- **测试命令：** resume query unit + Electron E2E。
- **风险与迁移：** 过早服务不存在的长历史；触发阈值建议为真实 workspace 中 Session 数和恢复失败工单达到团队设定门槛。

## P2-3：高级技术 Inspector

- **StudiumX 落点：** 诊断模式中的 typed events/effects/projection report viewer。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/history_cell/mod.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/tui/src/status_indicator_widget.rs`；只借技术可见性，不展示 raw reasoning。
- **interface / seam：** 只读 `TechnicalInspectionView`，所有字段走 redaction schema。
- **验收：** 默认隐藏；可导出 safe report；任何 secret/raw prompt/reasoning 都不可见。
- **测试命令：** privacy/redaction checks + inspector E2E。
- **风险与迁移：** 形成第二主 UI；仅面向支持/开发，不能进入学习者默认导航。

## P2-4：保守的并行只读工具

- **StudiumX 落点：** typed tool dispatcher parallel scheduler。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/parallel.rs`。
- **interface / seam：** `ReadonlyToolBatch.execute`；只有声明 `effect=read` 且 resource locks 不冲突的调用可并行。
- **验收：** 输出顺序确定；取消传播；写 effect 永不并行；并发确有性能收益。
- **测试命令：** scheduler race/cancellation/idempotency tests。
- **风险与迁移：** nondeterminism；先有 profiling，再对 allowlist 工具启用，默认串行。

## P2-5：Watcher/Config 乐观并发

- **StudiumX 落点：** file watcher、config fingerprint、workspace writer precondition。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/config/src/fingerprint.rs`。
- **interface / seam：** `write(expectedFingerprint, next)` 返回 committed/conflict。
- **验收：** 外部编辑不会被静默覆盖；冲突有可恢复 UI；watcher 去抖且不生成重复事件。
- **测试命令：** concurrent edit integration tests、workspace recovery checks。
- **风险与迁移：** 假冲突与 watcher 风暴；只在观测到多人/外部编辑丢失后引入。

## P2-6：MCP（仅在存在真实教学 Adapter 时）

- **StudiumX 落点：** capability catalog、typed dispatcher 下的受限 Adapter；不是独立平台入口。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/registry.rs`；只借协议适配与 capability discovery 思路。
- **interface / seam：** `GroundingSourceAdapter` 或有限 `TeachingEffectAdapter`，必须返回现有 typed outcomes。
- **验收：** 至少一个真实教学场景、威胁模型、授权、超时、审计、隐私和离线降级完整；无任意工具透传。
- **测试命令：** Adapter contract/security/privacy tests + golden scenario 的可选变体。
- **风险与迁移：** 远程工具扩大攻击面；无真实 Adapter 和用户价值证据则永不实施。

## P2-7：Helper Isolation（仅执行不可信代码时）

- **StudiumX 落点：** 独立 helper process/OS boundary，不放进普通 teaching turn。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/lifecycle.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/spawn.rs`；不直接照搬 Codex sandbox。
- **interface / seam：** `UntrustedExecutionService`，输入输出最小化且 capability-deny-by-default。
- **验收：** threat model、资源限制、文件/网络 allowlist、kill/recovery/audit 完整；普通 Lesson/grounding 不经过 helper。
- **测试命令：** platform-specific security tests 和 abuse cases。
- **风险与迁移：** 跨平台维护成本极高；只有产品明确需要运行不可信学习代码时立项。

## P2-8：脱敏 Support Bundle

- **StudiumX 落点：** doctor、inspector、audit reports 的导出层。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/cli/src/doctor.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/recorder.rs`；不复制原始会话。
- **interface / seam：** `SupportBundleBuilder.build(policy): BundleManifest`，每个文件有来源与 redaction result。
- **验收：** 默认不含原始回答、prompt、provider payload、secret、完整绝对路径；用户预览并明确同意后导出。
- **测试命令：** snapshot/redaction/privacy/adversarial fixture tests。
- **风险与迁移：** 高价值隐私聚合；先提供本地 doctor report，只有支持流程证明需要时增加 bundle。

---

# 10. Golden E2E 场景：从错误回答到恢复后继续学习

## 10.1 Fixture 与稳定标识

测试 fixture 使用一个最小 workspace，所有时间、ID 和 provider 返回均可确定性重放：

- `Mission`：掌握一个可通过检索练习验证的概念，含明确 success criteria。
- `Course`：至少两个计划 Session，第二个依赖第一个 outcome。
- 两个可信 `Resources`：一个本地 workspace 文件、一个由现有 safe Web Adapter 取得的录制响应；都带稳定 `sourceId`、digest、trust/use-for。
- 固定 IDs：`session-001`、`lesson-001`、`attempt-wrong-001`、`attempt-correct-002`、`outcome-001`、`learning-record-001`。
- 固定 operation/event IDs 用于 duplicate replay。
- provider 只负责受控的教学解释 fixture；掌握判定仍受 deterministic rubric/evidence gate 约束。

## 10.2 Given / When / Then 主路径

### 场景 A：建立 durable Session 与 Lesson

**Given** workspace 含 Mission、Course 和两个 trusted Resources。
**When** 用户开始第一课并请求生成 Lesson。
**Then**：

1. `LearningSessionLedger` 创建唯一 `session-001`，绑定 Mission/Course/Lesson；
2. `TeachingContextAssembler` 报告包含 Mission、Session objective 和两个资源的 provenance；
3. `ResourceGrounder` 产生真实 `GroundingPack`；
4. Lesson 的 `primarySource`/source reference 必须是 GroundingPack 中的真实 `sourceId`；
5. Lesson canonical file 原子发布，catalog 可随后 reconcile；
6. **此时 `learning-records/` 中没有由该 Session 产生的 Learning record**；
7. UI 四阶段中“确认目标”完成，“完成检索练习”为 `needs_you`，其余为 `waiting`。

### 场景 B：第一次回答错误

**When** 学习者提交错误答案。
**Then**：

1. `LessonInteractionRecorder` 记录 `attempt-wrong-001`，含 prompt/rubric refs、answer evidence digest、source surface 和 event ID；
2. `LearningOutcomeCommitter.evaluate` 返回 `needs_practice`；
3. outcome 引用该 attempt，但不创建任何 mastered Learning record；
4. `NextTeachingStepPlanner` 确定性选择 `contrast_and_retry`；
5. presentation 显示对比反馈和固定“轮到你”重试区；
6. 不允许用 assistant 文案、Lesson 已打开或 tool success 把阶段标成“已掌握/记录已保存”。

### 场景 C：对比讲解后正确重试

**When** 系统执行 `contrast_and_retry`，学习者在 conversation 中给出正确回答并解释先前误区。
**Then**：

1. recorder 写入唯一 `attempt-correct-002`，关联 conversation turn evidence；
2. outcome 为 `misconception_corrected`，引用错误和正确两次 evidence；
3. committer 创建**恰好一个** `learning-record-001`；
4. record 含 Session、Lesson、evidence IDs、outcome/rule version 和 provenance；
5. catalog 可由 canonical record 重建；
6. presentation 的“保存 Learning record”仅在文件确认后进入 `complete`；
7. planner 选择继续第二个 Session/Lesson，而不是再次从 Mission 起点开始。

## 10.3 两个强制 crash/restart 窗口

### Crash window 1：artifact rename 后、catalog 更新前

1. 暂停在 `after_artifact_rename_before_catalog`；
2. 杀死并重启应用；
3. canonical Lesson/Learning record 已存在，catalog 仍旧；
4. read-repair 扫描 canonical facts，重建 catalog；
5. UI 最终显示“已保存”，但不得再次写文件或重复公告；
6. operation journal 标记 settlement/reconciled，不能生成第二个 record。

### Crash window 2：temp write 后、publish 前

1. 暂停在 `after_temp_write_before_publish`；
2. 杀死并重启应用；
3. 未 publish 的 temp artifact 不得被 catalog/UI 当作事实；
4. recovery 隔离或安全清理 temp，保留可诊断元数据；
5. 重试同一 operation ID 只发布一个 canonical artifact；
6. 如果副作用状态无法确定，返回 review/reconcile，不盲目重复写。

## 10.4 继续下一 Lesson

重启和 reconciliation 完成后，用户选择“继续学习”：

1. ledger 恢复 `session-001` 及其 outcome，Course 进度不归零；
2. planner 根据 `misconception_corrected` 进入第二个计划 Session；
3. assembler 包含第一个 Session 的有效 outcome/record provenance，但不注入无关 archived conversation；
4. 第二 Lesson 使用真实 GroundingPack 的 source ID；
5. learner memory 与正式 Learning outcome 在 report 中保持不同 provenance；
6. UI 不重新展示已经完成的 retrieval attempt 为待回答状态。

## 10.5 幂等与乱序重放

对以下输入逐一执行两次，并打乱一组 presentation event 的到达顺序：

- 同一 `TeachingInteractionSubmitted` event ID；
- 同一 outcome operation ID；
- 同一 Learning record commit ID；
- 同一 catalog reconciliation request；
- 同一恢复后的 presentation snapshot。

最终必须满足：一个 Session、两个 attempts、一个 outcome 的最终有效版本、一个 Learning record、无重复 source import、最多一个 `active/needs_you` 阶段。重复输入要返回 `already_recorded/already_committed/reconciled` 等 typed result，而不是静默成功或重复副作用。

## 10.6 Golden 验证矩阵

| 验证层 | 必须断言 |
|---|---|
| Canonical files | Session、attempt、outcome、Lesson、Learning record 的数量、schema、IDs、引用和内容语义 |
| Catalog/projection | 可由 canonical files 重建；无 dangling/duplicate；catalog 延迟不改变事实 |
| Planner | 错答为 `contrast_and_retry`；纠正后进入下一 Session；相同输入同结果 |
| Grounding | Lesson source ID 来自真实 GroundingPack；digest/trust/use-for 存在 |
| UI | 四阶段、不超过一个 active/needs-you、固定“轮到你”、保存状态不乐观 |
| A11y | 键盘完成主路径、焦点恢复、可访问名称、克制 `aria-live` |
| Privacy | 无 raw reasoning、secret、provider payload、完整本地路径或未脱敏技术细节 |
| Recovery | 两个 crash window、重启、read-repair、幂等重试全部通过 |

## 10.7 Golden 命令

```powershell
node scripts/check-teaching-learning-loop.mjs
node scripts/check-workspace-catalog-reconciliation.mjs
pnpm exec vitest run --project integration tests/integration/teaching-learning-loop.integration.test.ts
pnpm exec playwright test --project electron-e2e tests/e2e/teaching-learning-loop.e2e.spec.ts
```

若 `scripts/check-teaching-learning-loop.mjs`、integration test 或 Electron E2E 任一不存在，P0 完成状态必须为“未证明”，不能以单元测试、截图或人工演示替代。

---

# 11. 子 Agent 领取表、互斥写域与集成顺序

## 11.1 领取原则

- 一个子 Agent 一次只领取一个 ID；领取时在协调记录中写明 `owner / branch / base hash / owned paths / expected interface / upstream`。
- **互斥写域是强约束，不是建议。** 未持有路径的 worker 只能读、提出接口请求或生成最小 patch 交给 owner，不能“顺手修改”。
- 每个包先实现深模块和 contract tests，再由集成 owner 连接 hub files。
- 同一文件发生跨包需求时，默认归集成 owner；领域 owner 提供 typed interface、测试 fixture 和调用示例。
- 不允许通过新建 `*-v2.ts`、复制现有模块或新增第二 façade 绕过写域冲突。

## 11.2 P0 领取表

| ID | Work package | 建议分支 | 独占写域 | 禁止写域 | 上游依赖 |
|---|---|---|---|---|---|
| `SX-P0-SESSION` | P0-1 Ledger | `feat/sx-p0-session-ledger` | `src/main/learning-session-ledger.ts` 或 `src/main/learning-session/**`；`src/shared/teaching-types/learning-session.ts`；`src/shared/teaching-types/workspace.ts`；`src/shared/teaching-placement.ts`；`src/main/teaching-workspace/lifecycle.ts`；对应 unit/integration tests 与 ledger check scripts | 所有 hub files；outcome/context/presentation 文件 | 无；先定义稳定 Session IDs/refs |
| `SX-P0-EVIDENCE` | P0-2 Recorder | `feat/sx-p0-lesson-evidence` | `src/main/lesson-interaction-recorder.ts`；`src/shared/teaching-types/lesson-interaction.ts`；`src/shared/lesson-styles.ts`；`src/shared/preview-markdown-bridge.ts`；`src/renderer/src/markdown-preview.tsx`；对应 recorder tests/scripts | hub files；committer/planner files；不得直接写 Learning record | `SX-P0-SESSION` 的 Session/evidence ref contract |
| `SX-P0-OUTCOME` | P0-3 Committer | `feat/sx-p0-learning-outcome` | `src/main/learning-outcome-committer.ts` 或目录；`src/shared/teaching-types/learning-outcome.ts`；`src/main/ai/lesson-renderer.ts`；`src/shared/lesson-schema.ts`；`src/main/teaching-lesson-artifacts.ts`；对应 outcome tests/scripts | hub files；planner/context/presentation；不得维护第二 catalog | Session/evidence contracts |
| `SX-P0-PLANNER` | P0-4 Planner | `feat/sx-p0-next-teaching-step` | `src/main/next-teaching-step-planner.ts`；`src/shared/teaching-types/next-teaching-step.ts`；`src/shared/teaching-workflow.ts`；对应 planner tests/scripts | hub files；provider/tool implementation；UI | Session snapshot + outcome contract |
| `SX-P0-CONTEXT` | P0-5 Context/Grounder | `feat/sx-p0-teaching-context` | `src/main/teaching-context-assembler.ts`；`src/main/resource-grounder.ts`；`src/main/ai/request-context-projection.ts`；`src/main/ai/context-compactor.ts`；`src/main/teaching-memory-recall.ts`；在现有 search/fetch Adapter 中的最小改动；对应 tests/scripts | hub files；Lesson outcome 判定；新 provider/skill catalog | planner intent、Session/outcome refs |
| `SX-P0-PRESENT` | P0-6 Presentation | `feat/sx-p0-teaching-presentation` | `src/renderer/src/teaching-turn-presentation.ts`；`agent-conversation-state.ts`；`agent-conversation-projection.ts`；`agent-conversation-presentation.ts`；`agent-process-timeline.ts`；`views/agent-conversation/AgentConversationReader.tsx`；`app-shell/agent-conversation-runner.ts`；对应 unit/a11y tests | `App.tsx` 与所有 main/shared hubs；不得写领域事实 | 上述全部 typed snapshots/events |
| `SX-P0-INTEGRATE` | P0-7 Golden/Glue | `feat/sx-p0-teaching-loop-integration` | hub files；`tests/e2e/teaching-learning-loop.e2e.spec.ts`；`tests/integration/teaching-learning-loop.integration.test.ts`；fixtures；golden/reconciliation scripts；必要的 test config/package script | 不重写各深模块内部；不扩大工具/runtime/config 范围 | 严格等待六个领域包 contracts green |

表中同一现有文件若在包描述中被多个模块提及但未列入该包独占写域，均视为集成写域。例如 `src/main/teaching-conversation-runtime.ts`、`src/main/teaching-lesson-generation.ts`、`src/main/ai/lesson-prompts.ts`、workspace catalog 模块和 review façade，默认由 `SX-P0-INTEGRATE` 持锁。

## 11.3 Hub files：仅集成 owner 可写

以下文件默认由 `SX-P0-INTEGRATE` 独占；其他 worker 只能提交接口请求或最小 diff 建议：

- `src/shared/teaching-ipc-contract.ts`
- `src/main/teaching-ipc-gateway.ts`
- `src/main/teaching-workspace.ts`
- `src/main/teaching-conversation-runtime.ts`
- `src/main/teaching-lesson-generation.ts`
- `src/main/teaching-conversation-lesson-tool.ts`
- `src/main/ai/lesson-prompts.ts`
- `src/main/teaching-workspace/learning-assets-catalog.ts`
- `src/main/teaching-workspace/review.ts`
- shared barrel files（所有 `index.ts`/统一 export 文件）
- `src/renderer/src/App.tsx`
- `package.json` 与 lockfile
- Vitest/Playwright/Electron 测试配置
- blocking CI workflow

如确需转移锁，协调者必须先记录旧 owner 已停止修改、最新 commit hash 和新 owner；不得并行写同一 hub。

## 11.4 严格集成顺序

```text
1. SX-P0-SESSION
2. SX-P0-EVIDENCE
3. SX-P0-OUTCOME
4. SX-P0-PLANNER
5. SX-P0-CONTEXT
6. SX-P0-PRESENT
7. SX-P0-INTEGRATE
```

每一步的 merge gate：接口/contract tests 绿、目标命令有证据、迁移行为有 fixture、changed paths 未越界、风险在 handoff 中明确。下游不得用本地未推送代码作为隐式依赖；依赖必须是已推送 commit hash。

## 11.5 分支、commit 与 push 规范

1. 每个 work package 一个独立分支，基于协调者指定的已知 commit；分支名使用表中建议或 `feat/sx-<package>`。
2. 每个绿灯 checkpoint 立即 commit 并 push；不要把多个包压在一个巨型 commit 中。
3. 推荐 commit 前缀：`feat(teaching): ...`、`test(teaching): ...`、`refactor(teaching): ...`；文档为 `docs: ...`。
4. 禁止 force push；已推送分支需要改历史时，追加修正 commit，或在协调者同意后创建新分支。
5. 禁止回退其他 Agent 的改动；禁止为消除冲突执行宽泛的 `checkout --ours/--theirs`、整目录覆盖或删除未知文件。
6. 冲突逐 hunk 理解并解决；无法确认语义时停止该文件合并并请求 owner，不得猜测。
7. 禁止删除、skip、放宽断言或只改 snapshot 来“让测试变绿”；测试变化必须对应经批准的领域语义变化。
8. 不提交 secret、本机绝对路径、调试 dump、provider payload、构建产物或无关格式化。
9. push 前至少执行包级 tests、`pnpm run typecheck`、`git diff --check` 和 changed-path 审计。
10. 每次 handoff 必须报告：分支、commit hash、已 push 的 remote ref、测试命令与结果、changed paths、未解决风险、所需下游接口。
11. once-pushed branch 不通过 rebase+force 更新；需要同步上游时使用普通 merge 并进行窄冲突解决，或新建后继分支。
12. 集成 owner 只写 glue/hubs/golden tests，不得借集成之名重写已验收深模块；发现接口不够深时退回原 owner 追加 commit。

---

# 12. 跨包风险登记与迁移总策略

| 风险 | 早期信号 | P0 缓解 | 迁移/回滚策略 | 停止条件 |
|---|---|---|---|---|
| Learning record 语义继续混淆 | 生成 Lesson 后出现 record；UI 用“计划”当“掌握” | committer 单一写入口；evidence gate；删除/降级 `learningRecordNote` | legacy 记录标记 `legacy_generated`，双读但新代码单写；不批量删除用户文件 | 任一路径仍可绕过 committer 写正式 record，P0 停止发布 |
| Session 与 Agent run/旧 workspace `SessionEvent` 混淆 | 类型互相复用、状态互相覆盖 | 独立 ID/type/store；legacy Adapter | 旧字段兼容一个发布周期，逐调用点迁移 | 无法从类型和文件辨别三种对象时不合并 |
| 文件系统与 catalog 交错状态 | UI 宣布保存但文件缺失；重启出现重复 | atomic publish、operation identity、read-repair、golden crash windows | canonical 文件优先；catalog 丢失重建；损坏对象 quarantine | 两个 crash window 任一不能自动恢复，P0 未完成 |
| 模型判定不稳定 | 相同 evidence 得出不同 outcome | 确定性 rubric/规则优先；模型只提供受约束 signal；保守默认 | 记录 evaluator version；旧 outcome 不反向重判 | 重放相同输入不能得到稳定 outcome 时停止 |
| typed event 演化成全量协议重写 | P0 PR 修改所有 Agent 事件/工具 | P0 仅最小 teaching event union + Adapter | canonical protocol 延后 P1；双读单写 | P0 diff 出现与闭环无关的大面积 protocol 改造时拆包 |
| context assembler 成为巨型 prompt builder | facts、能力、prompt、工具选择混在同一文件 | 小 interface；projection report；adapterized Grounder | 包裹现有 projection，按 provenance 逐源迁移 | 无法在单测中独立验证预算/来源时拒绝合并 |
| Grounder 变成重型 RAG | 引入向量库/新 provider/隐式导入 | P0 仅本地资源+现有 Web Adapter | resource gap 而非平台扩张 | P0 新增数据库、MCP 或第二搜索栈则回退范围 |
| UI 乐观状态污染事实 | spinner 完成即“已保存/已掌握” | projector 只消费 durable snapshots | legacy UI 置于 Adapter/feature flag 后，逐项移除推断 | E2E 找到任一无事实依据的 complete 状态时阻塞 |
| 隐私/推理泄露 | logs/UI/artefact 含 prompt、reasoning、secret | allowlist projection、redaction、privacy checks | 旧日志不迁入 audit；技术详情默认折叠 | 任一 golden artifact 泄露受限字段时停止发布 |
| 多 Agent 文件冲突 | hub files 同时被改；barrel/package.json 高频冲突 | 独占写域和单一 integration owner | 窄 patch/handoff；不得 broad ours/theirs | owner 不清晰时暂停该文件所有写入 |
| 双读长期存在 | legacy Adapter 无删除条件 | 记录 telemetry/fixture coverage 与移除日期 | 新格式单写；达到兼容窗口后删除 legacy write path | 发现永久双写或两个 canonical truth 时阻塞 P1 |
| 横向 scope creep | shell/MCP/plugins/sandbox/通用多 Agent 混入 P0 | freeze 清单、changed-path audit | 拆到 P2/独立 ADR，不在闭环分支实现 | 任一非必要横向能力成为 P0 依赖时拒绝发布 |

迁移总原则：**双读单写、canonical 优先、投影可重建、旧事实不重解释、故障时保守、迁移可审计。** 不做全 workspace 原地批量改写；不因 schema 更新删除用户原始文件；不确定数据进入 quarantine/diagnostic，而不是被默认修复覆盖。

---

# 13. Definition of Done

## 13.1 每个 Work Package 的 DoD

任何 P0/P1/P2 work package 只有同时满足以下条件才可标记完成：

1. **Scope：** 变更只覆盖已领取写域和已批准 glue；没有横向功能夹带。
2. **Deep interface：** 文档中的 interface/seam 已落地或有经评审的等价设计；调用方不需要知道文件布局、恢复细节或字符串约定。
3. **Typed behavior：** 成功、失败、拒绝、取消、冲突和幂等结果使用类型表达；不依赖错误字符串猜测领域事实。
4. **Domain invariants：** 包对应的不变量有自动化测试，负例与重复输入都覆盖。
5. **Durability：** 若有写 effect，必须覆盖 stage/publish/settlement、重启和 read-repair；投影失败不改变 canonical 事实。
6. **Migration：** legacy 输入有 fixture；新代码单写新格式；损坏和未知版本有保守行为。
7. **Security/privacy：** 最小权限、safe path/URL、secret/provider privacy、redaction 相关检查通过；日志只含 allowlist metadata。
8. **Accessibility：** 有 UI 的包覆盖键盘、焦点、可访问名称、状态公告和错误恢复。
9. **Tests：** 文档列出的新增脚本/测试文件真实存在且通过；现有相关回归、typecheck 和 `git diff --check` 通过。
10. **Handoff：** 分支与 commit 已 push；报告 hash、命令证据、changed paths、风险和下游 contract。
11. **Docs/diagnostics：** 新 schema/状态/error code 有最小维护说明；doctor/inspection 能解释不可恢复状态。
12. **No shortcuts：** 无 skipped/deleted tests、宽泛 type assertion、silent fallback、第二套 store/catalog/loop 或 `*-v2` 逃逸接口。

## 13.2 P0 各包额外完成证明

| 包 | 不可替代的完成证明 |
|---|---|
| P0-1 Ledger | 重启可仅凭 canonical files 恢复；legacy Lesson 可只读投影；重复 event 不重复 Session |
| P0-2 Recorder | preview/review/conversation 至少两种真实输入 surface 产生同一 typed evidence；未回答和重复回答正确处理 |
| P0-3 Committer | 生成/打开 Lesson 不写 record；`needs_practice` 不写；`misconception_corrected` 恰写一个；catalog drift 可修复 |
| P0-4 Planner | 错答稳定选择 `contrast_and_retry`；纠正后继续下一 Session；同输入确定性；不由模型自由文本决定状态 |
| P0-5 Context/Grounder | conversation/Lesson 共用 assembler；真实 source ID 进入 Lesson；预算/provenance/report 可审计 |
| P0-6 Presentation | 四阶段、最多一个 active/needs-you、保存状态来自 durable facts、无 raw reasoning、a11y 主路径通过 |
| P0-7 Golden | 主路径、两个 crash window、重复/乱序重放、canonical/catalog/UI 三层断言和 Electron E2E 全绿 |

## 13.3 P0 总体 DoD

P0 只有满足以下全部条件才完成：

- 纵向链 `Ledger → Recorder → Committer → Planner → Assembler/Grounder → Presentation` 通过公开 interface 串接；
- golden scenario 在干净 checkout、离线 fixture 和 Electron E2E 中可重复运行；
- 错误回答永不创建 mastered Learning record；纠正后恰好创建一个；
- 两个 crash window 重启后无事实丢失、无重复副作用、catalog 可重建；
- 下一 Lesson 使用先前真实 outcome，而不是从零开始；
- Lesson source 引用真实 GroundingPack source ID；
- renderer/main/catalog 任一 projection 失败都不能覆写 canonical teaching facts；
- 默认 UI 使用教学语言，技术详情折叠脱敏，无 raw reasoning；
- keyboard/focus/`aria-live` 审计通过；
- security、provider privacy、secret storage、repository hygiene 和现有 Agent recovery 回归通过；
- 所有 P0 分支按互斥写域完成 push，集成分支没有未解释的越界文件；
- P1/P2 未被隐式设为 P0 运行前提。

## 13.4 Freeze Release Criteria：横向扩张冻结门

P0 发布候选不得新增或要求以下能力：

- shell/terminal 任意执行；
- MCP server/client 或远程任意工具透传；
- 插件市场、插件安装和动态加载；
- OS sandbox/helper isolation（除非另立安全项目且不阻塞 P0）；
- SQLite/数据库作为 teaching workspace 真相源；
- 通用多 Agent 编排、Agent marketplace 或多 Agent 主 UI；
- 第二 Agent loop、第二 provider/skill/config/workspace catalog；
- 通用 Tool Dispatcher 全量重写；
- 原始 chain-of-thought/reasoning 展示或保存；
- conversation branch 的进一步横向能力；
- 与 golden teaching loop 无直接依赖的 runtime/config/security 平台化。

发布审计若发现上述内容，默认结论是“拆出 P1/P2/独立项目”，而不是扩大 P0。安全修复只有在阻止 P0 闭环暴露的具体风险时可作为最小支撑进入 P0。

---

# 14. 完成审计清单

审计者逐项勾选并附证据链接/commit hash；任何“无法确认”按未通过处理。

## 14.1 教学领域事实审计

- [ ] Session 是 durable teaching object，且与 Agent run、workspace lifecycle event 类型/文件分离。
- [ ] Course/Lesson/conversation/evidence/outcome/record 的 IDs 和引用可沿 canonical files 追踪。
- [ ] 仅生成、打开或浏览 Lesson 不产生 mastered Learning record。
- [ ] `learningRecordNote` 已删除或降级为非事实型 rubric/expected evidence。
- [ ] 错误回答生成 attempt 和 `needs_practice`，不生成 mastered record。
- [ ] 纠正误区生成 `misconception_corrected`，且恰好一个 record 引用全部必要 evidence。
- [ ] 无回答、证据损坏、来源不明或模型不确定时保守为 `not_evidenced/needs_practice`。
- [ ] planner 的状态集合有限、输入显式、相同输入确定性。
- [ ] 继续下一课使用先前 outcome/record provenance，不从 Mission 起点重置。
- [ ] learner memory、模型摘要、Learning outcome 和 Learning record 没有被合并成同一事实类型。

## 14.2 Typed event、tool/effect 与状态审计

- [ ] P0 teaching events 为 discriminated union，含 stable event ID/session ID/turn ID/sequence/schema version。
- [ ] 重复、乱序、未知事件有明确策略；不靠 arbitrary log string 驱动领域状态。
- [ ] P0 所需 tool/effect outcome 至少显式区分 success/failure/denied/cancelled/unknown settlement。
- [ ] invalid JSON 不在新教学路径静默变空对象；错误字符串不决定成功。
- [ ] workspace write 有 operation identity、effect boundary 和授权/路径校验。
- [ ] run state 与 teaching Session state 不互相覆盖。
- [ ] UI `complete` 不是由 chunk 结束、HTTP 200、assistant 自述或 tool name 推导。

## 14.3 持久化、恢复与迁移审计

- [ ] canonical local files 是 source of truth；catalog/index/UI 可删除后重建。
- [ ] 写路径包含校验、temp/stage、flush（按平台能力）、atomic publish、settlement/reconciliation。
- [ ] artifact rename 后 catalog 前 crash 通过自动化测试。
- [ ] temp write 后 publish 前 crash 通过自动化测试。
- [ ] 相同 event/operation/commit 重放不会重复 Session、attempt、outcome 或 record。
- [ ] catalog 延迟、丢失或损坏不改变 canonical teaching fact。
- [ ] 单对象损坏被隔离并保留原始字节，不阻止其余 workspace 只读/修复。
- [ ] legacy 数据双读单写；没有永久双写和第二 canonical store。
- [ ] schema/version/unknown-field 策略有 fixture；旧事实不会因新 evaluator 版本被静默重判。
- [ ] repair 行为可审计；不确定副作用进入 review/reconcile 而非盲目重试。

## 14.4 Context、Grounding 与能力预算审计

- [ ] conversation 与 Lesson generation 使用同一 TeachingContextAssembler。
- [ ] Mission、Session objective、本地证据和有效 outcome 的优先级有测试。
- [ ] archived conversation 默认不注入；omitted reason 可见。
- [ ] GroundingPack 中每个 source 有 ID、title、URL/path-safe ref、retrievedAt、digest、trust/use-for。
- [ ] Lesson 引用的 source ID 真实存在于该回合 GroundingPack。
- [ ] 来源不可用生成 resource gap，不伪造来源或自动导入外部内容。
- [ ] 不可用、禁用、未配置、未授权能力不进入上下文。
- [ ] ProjectionReport 可解释 included/omitted/truncated/budget/fingerprint，且不包含原始敏感内容。
- [ ] 超预算时不先丢 Mission/Session/local evidence。
- [ ] P0 未新增第二 provider/skill/config catalog、向量库或 MCP。

## 14.5 Teaching Presentation 与无障碍审计

- [ ] UI 固定呈现“确认目标/完成检索练习/讲解并形成 Lesson/保存 Learning record”四阶段。
- [ ] 同一时刻最多一个 `active` 或 `needs_you`。
- [ ] 未回答 retrieval practice 不可 complete；错答不会显示“已掌握”。
- [ ] Lesson/Learning record 保存态来自文件系统/catalog reconciliation。
- [ ] “轮到你”区域固定、可键盘到达，动作完成后焦点返回合理位置。
- [ ] 关键变化有克制 `aria-live`，token/chunk 不触发公告风暴。
- [ ] 状态不只依赖颜色；错误、跳过和恢复态有文字/图标语义。
- [ ] 技术详情默认折叠并 allowlist/redact；外链走安全控制。
- [ ] UI、日志、support artifact 不出现“思考过程”、raw chain-of-thought、隐藏 prompt 或 provider payload。
- [ ] 重启恢复不重复活动阶段、保存公告或 learner action。

## 14.6 安全与隐私审计

- [ ] effect 按 read/workspace write/external write/privileged 分类，P0 只开放闭环必要能力。
- [ ] workspace path、symlink/escape、safe URL、external link controls 通过现有检查。
- [ ] provider secret 使用既有 secret storage，不进入 canonical files、event envelopes、logs 或 test artifacts。
- [ ] 学习者原始回答仅在教学事实确需的位置保存；audit/report 优先保存 digest/IDs/safe metadata。
- [ ] 故障截图、trace、fixture 和导出产物经过隐私检查。
- [ ] 禁用/未授权能力不会因恢复或 planner fallback 被重新启用。
- [ ] 未引入 shell、MCP、插件、任意远程工具或 OS sandbox 的新攻击面。
- [ ] security/privacy 测试不是 non-blocking warning。

## 14.7 工程与协作审计

- [ ] 每个包有唯一 owner、独立分支、已知 base hash 和互斥写域。
- [ ] hub files 只由 integration owner 修改；无宽泛 ours/theirs 或整目录覆盖。
- [ ] changed paths 与领取表一致；没有无关格式化、生成物、secret 或本机路径。
- [ ] 所有新增 interface 有 contract tests；所有状态不变量有负例。
- [ ] 新增脚本/测试真实存在；没有 skip、only、删除测试或放宽断言。
- [ ] package branch 已 push，handoff 含 branch/hash/test evidence/risks。
- [ ] integration 按固定顺序进行，下游只依赖已 push hash。
- [ ] `git diff --check`、typecheck、unit、integration、build 和 blocking checks 全绿。
- [ ] P0 golden 在干净 checkout 可运行，并至少重复运行三次排查 flaky。
- [ ] 文档与实现的术语、schema、路径和命令一致；若实现选择等价设计，已有 ADR/评审记录。

## 14.8 最终命令基线

在 P0 集成分支的干净 checkout 中执行：

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
node scripts/check-workspace-catalog-reconciliation.mjs
node scripts/check-teaching-learning-loop.mjs
pnpm exec playwright test --project electron-e2e tests/e2e/teaching-learning-loop.e2e.spec.ts
```

补充稳定性运行：

```powershell
pnpm exec playwright test --project electron-e2e tests/e2e/teaching-learning-loop.e2e.spec.ts --repeat-each=3
```

如果上述 proposed script/test 在实施审计时不存在、命令被替换为手工步骤、或仅在污染的本机 workspace 中通过，完成状态均为“未证明”。若仓库脚本名称在实施期间经批准变更，必须同步本规划/ADR，并保留等价或更强的自动化覆盖。

---

# 15. 最终实施结论

StudiumX 下一阶段不应追求“更像通用 coding agent”，而应证明一件更难也更有产品价值的事：**一次真实学习互动能够成为可信证据，证据能够形成可恢复的教学事实，事实能够决定下一教学动作，并以学习者能理解的方式呈现。**

因此，首个可领取里程碑不是 Tool Dispatcher、MCP、配置中心或多 Agent，而是完整的 P0 纵向链。Codex Rust v0.144.4 的价值在于提供 typed lifecycle、effect outcome、durable state、read-repair、budgeted context 和 disciplined presentation 的机制参考；StudiumX 必须把这些机制压缩到教学闭环所需的最小、深而稳定的模块中。

只有 Golden E2E 在错误回答、纠正、崩溃、恢复、幂等重放和继续下一课的全过程都通过，才可以解除 P1 的加固工作；只有真实使用信号出现，才可以讨论 P2 的横向能力。
